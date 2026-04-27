import { decryptDatabase, setAppSeed, sha256Hex } from "./crypto.js";
import { getLocalNebsDetail, getLocalNbsDetail } from "./catalogSearch.js";
import {
  readFromOpfs,
  readSeed,
  readVersion,
  removeFromOpfs,
  saveSeed,
  saveToOpfs,
  saveVersion,
} from "./opfs.js";
import { postWorkerError, postWorkerProgress, postWorkerResult, postWorkerStatus } from "./protocol.js";
import { getStructuredSearchWithCache } from "./searchRuntime.js";
import { loadDatabaseFromBytes } from "./sqlite.js";
import { clearSearchCache, closeWorkerDb, getWorkerDb, getWorkerStatus, getWorkerVersion, setWorkerStatus, setWorkerVersion } from "./state.js";
import { TOKEN_REFRESH_TIMEOUT_MS } from "./constants.js";

/** @type {Map<string, {resolve: (token: string) => void, reject: (error: Error) => void, timeout: ReturnType<typeof setTimeout>}>} */
const tokenRefreshRequests = new Map();

function buildAuthHeaders(clerkToken) {
  if (!clerkToken || typeof clerkToken !== "string") {
    throw new Error("Faça login para instalar o banco offline.");
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${clerkToken}`,
  };
}

function handleTokenResponse(id, payload) {
  const pending = tokenRefreshRequests.get(id);
  if (!pending) return;
  tokenRefreshRequests.delete(id);
  clearTimeout(pending.timeout);

  if (payload?.error) {
    const error = new Error(String(payload.error));
    if (typeof payload.errorName === "string") {
      error.name = payload.errorName;
    }
    if (typeof payload.errorStack === "string") {
      error.stack = payload.errorStack;
    }
    pending.reject(error);
    return;
  }
  if (!payload?.clerkToken || typeof payload.clerkToken !== "string") {
    pending.reject(new Error("Faça login para instalar o banco offline."));
    return;
  }
  pending.resolve(payload.clerkToken);
}

async function requestFreshClerkToken(id, currentToken) {
  if (!id) return currentToken;
  self.postMessage({ type: "REFRESH_TOKEN", id, payload: {} });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      tokenRefreshRequests.delete(id);
      reject(new Error("Token refresh timed out"));
    }, TOKEN_REFRESH_TIMEOUT_MS);
    tokenRefreshRequests.set(id, { resolve, reject, timeout });
  });
}

async function handleInitMessage(id, payload) {
  const encData = await readFromOpfs();
  const version = await readVersion();
  const seed = await readSeed();

  if (!encData || !version || !seed) {
    setWorkerStatus("not_installed");
    postWorkerStatus(id, { status: "not_installed" });
    return;
  }

  setWorkerStatus("checking");
  postWorkerStatus(id, { status: "checking" });

  const chunkSize = payload?.chunkSize || 65536;
  const iterations = payload?.pbkdf2Iterations || 600000;
  /** @type {Uint8Array | null} */
  let plaintext = null;

  try {
    setAppSeed(seed);
    plaintext = await decryptDatabase(encData, chunkSize, iterations);
    await loadDatabaseFromBytes(plaintext);
  } catch (error) {
    if (plaintext) {
      plaintext.fill(0);
    }
    closeWorkerDb();
    setWorkerVersion(null);
    setWorkerStatus("error");
    await removeFromOpfs();
    const message = error instanceof Error ? error.message : "Unknown error";
    const recoverableMessage = `${message}. Reinstale o banco offline para continuar.`;
    postWorkerStatus(id, {
      status: "error",
      error: recoverableMessage,
      recoverable: true,
    });
    postWorkerError(id, recoverableMessage);
    return;
  }

  plaintext.fill(0);
  setWorkerStatus("ready");
  setWorkerVersion(version);
  postWorkerStatus(id, {
    status: "ready",
    version,
    sizeBytes: encData.length,
  });
}

async function readEncryptedDatabaseBlob(dlResp, id) {
  const contentLength = Number.parseInt(dlResp.headers.get("content-length") || "0", 10);
  const reader = dlResp.body?.getReader();
  if (!reader) throw new Error("No response body");

  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;

    if (contentLength > 0) {
      const dlProgress = 10 + Math.round((received / contentLength) * 60);
      postWorkerProgress(id, dlProgress, "fetching_database");
    }
  }

  const encryptedBlob = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    encryptedBlob.set(chunk, offset);
    offset += chunk.length;
  }

  return encryptedBlob;
}

async function requestInstallToken(apiBase, clerkToken, requestId) {
  let activeToken = clerkToken;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const tokenResp = await fetch(`${apiBase}/database/token`, {
      method: "POST",
      headers: buildAuthHeaders(activeToken),
    });

    if (tokenResp.ok) {
      return tokenResp.json();
    }

    const errText = await tokenResp.text();
    if (tokenResp.status === 401 && attempt === 0) {
      activeToken = await requestFreshClerkToken(requestId, activeToken);
      continue;
    }
    throw new Error(`Token request failed (${tokenResp.status}): ${errText}`);
  }
  throw new Error("Token request failed");
}

async function fetchEncryptedDatabase(apiBase, token, clerkToken, requestId) {
  let activeToken = clerkToken;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const dlResp = await fetch(`${apiBase}/database/download`, {
      method: "POST",
      headers: buildAuthHeaders(activeToken),
      body: JSON.stringify({ token }),
    });

    if (dlResp.ok) {
      return dlResp;
    }

    const errText = await dlResp.text();
    if (dlResp.status === 401 && attempt === 0) {
      activeToken = await requestFreshClerkToken(requestId, activeToken);
      continue;
    }
    throw new Error(
      `Offline database retrieval failed (${dlResp.status}): ${errText}`
    );
  }
  throw new Error("Offline database retrieval failed");
}

async function updateInstalledVersion(apiBase) {
  let nextVersion = null;

  try {
    const versionResp = await fetch(`${apiBase}/database/version`);
    if (versionResp.ok) {
      const versionData = await versionResp.json();
      nextVersion = versionData.version;
    }
  } catch {
    nextVersion = null;
  }

  if (!nextVersion) {
    nextVersion = new Date().toISOString().slice(0, 10);
  }

  setWorkerVersion(nextVersion);
  await saveVersion(nextVersion || "unknown");
}

async function handleInstallMessage(id, payload) {
  setWorkerStatus("installing");
  postWorkerProgress(id, 0, "requesting_token");

  const apiBase = payload?.apiBase || "/api";
  /** @type {Uint8Array | null} */
  let plaintext = null;

  try {
    let clerkToken = payload?.clerkToken;
    clerkToken = await requestFreshClerkToken(id, clerkToken);
    const tokenData = await requestInstallToken(apiBase, clerkToken, id);
    const {
      token,
      app_seed: appSeed,
      encrypted_sha256: expectedEncryptedSha256,
      chunk_size: chunkSize = 65536,
      pbkdf2_iterations: iterations = 600000,
    } = tokenData;
    if (!appSeed || typeof appSeed !== "string") {
      throw new Error("Offline database key was not provided by the server");
    }
    setAppSeed(appSeed);

    postWorkerProgress(id, 10, "fetching_database");

    clerkToken = await requestFreshClerkToken(id, clerkToken);
    const dlResp = await fetchEncryptedDatabase(apiBase, token, clerkToken, id);
    const encryptedBlob = await readEncryptedDatabaseBlob(dlResp, id);

    if (expectedEncryptedSha256) {
      postWorkerProgress(id, 72, "verifying_integrity");
      const actualEncryptedSha256 = await sha256Hex(encryptedBlob);
      if (actualEncryptedSha256 !== expectedEncryptedSha256) {
        throw new Error("Offline database integrity verification failed");
      }
    }

    postWorkerProgress(id, 75, "decrypting");
    plaintext = await decryptDatabase(encryptedBlob, chunkSize, iterations);

    postWorkerProgress(id, 85, "loading");
    await loadDatabaseFromBytes(plaintext);

    postWorkerProgress(id, 90, "saving");
    await removeFromOpfs();
    try {
      setAppSeed(appSeed);
      await saveToOpfs(encryptedBlob);
      await saveSeed(appSeed);
      await updateInstalledVersion(apiBase);
    } catch (error) {
      await removeFromOpfs();
      throw error;
    }

    setWorkerStatus("ready");
    postWorkerProgress(id, 100, "done");
    postWorkerStatus(id, {
      status: "ready",
      version: getWorkerVersion(),
      sizeBytes: encryptedBlob.length,
    });
  } catch (error) {
    setWorkerStatus("error");
    const message = error instanceof Error ? error.message : "Unknown error";
    const recoverableMessage = `${message}. Reinstale o banco offline para continuar.`;
    postWorkerStatus(id, {
      status: "error",
      error: recoverableMessage,
      recoverable: true,
    });
    postWorkerError(id, recoverableMessage);
    await removeFromOpfs().catch(() => undefined);
    return;
  } finally {
    if (plaintext) {
      plaintext.fill(0);
    }
  }
}

function handleSearchMessage(id, payload) {
  if (!getWorkerDb() || getWorkerStatus() !== "ready") {
    postWorkerResult(id, { results: null, source: "not_ready" });
    return;
  }

  const t0 = performance.now();
  const { docType, query, viewMode } = payload;
  const cachedSearch = getStructuredSearchWithCache(docType, query, viewMode);

  if (cachedSearch.cacheHit) {
    const totalDurationMs = performance.now() - t0;
    postWorkerResult(id, {
      results: cachedSearch.results,
      source: "local",
      docType,
      query,
      searchType: cachedSearch.searchType,
      markdown: cachedSearch.markdown,
      timing: { sqlDurationMs: 0, totalDurationMs, cacheHit: true },
    });
    return;
  }

  const totalDurationMs = performance.now() - t0;
  postWorkerResult(id, {
    results: cachedSearch.results,
    source: "local",
    docType,
    query,
    searchType: cachedSearch.searchType,
    markdown:
      typeof cachedSearch.markdown === "string"
        ? cachedSearch.markdown
        : undefined,
    timing: {
      sqlDurationMs: totalDurationMs,
      totalDurationMs,
      cacheHit: false,
    },
  });
}

function handleNbsDetailMessage(id, payload) {
  if (!getWorkerDb() || getWorkerStatus() !== "ready") {
    postWorkerResult(id, { detail: null, source: "not_ready" });
    return;
  }

  const detail = getLocalNbsDetail(
    String(payload.code || ""),
    Number(payload.page || 1),
    Number(payload.pageSize || 50)
  );
  postWorkerResult(id, { detail, source: "local" });
}

function handleNebsDetailMessage(id, payload) {
  if (!getWorkerDb() || getWorkerStatus() !== "ready") {
    postWorkerResult(id, { detail: null, source: "not_ready" });
    return;
  }

  const detail = getLocalNebsDetail(String(payload.code || ""));
  postWorkerResult(id, { detail, source: "local" });
}

function handleGetStatusMessage(id) {
  postWorkerStatus(id, {
    status: getWorkerStatus(),
    version: getWorkerVersion(),
  });
}

async function handleRemoveMessage(id) {
  closeWorkerDb();
  setWorkerVersion(null);
  setWorkerStatus("not_installed");
  clearSearchCache();

  await removeFromOpfs();
  postWorkerStatus(id, { status: "not_installed" });
}

export async function dispatchWorkerMessage(type, id, payload) {
  switch (type) {
    case "TOKEN_RESPONSE":
      if (id) {
        handleTokenResponse(id, payload);
      }
      return;
    case "INIT":
      await handleInitMessage(id, payload);
      return;
    case "INSTALL":
      await handleInstallMessage(id, payload);
      return;
    case "SEARCH":
      handleSearchMessage(id, payload);
      return;
    case "GET_NBS_DETAIL":
      handleNbsDetailMessage(id, payload);
      return;
    case "GET_NEBS_DETAIL":
      handleNebsDetailMessage(id, payload);
      return;
    case "GET_STATUS":
      handleGetStatusMessage(id);
      return;
    case "REMOVE":
      await handleRemoveMessage(id);
      return;
    default:
      postWorkerError(id, `Unknown message type: ${type}`);
  }
}
