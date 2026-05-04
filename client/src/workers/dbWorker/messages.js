import { decryptDatabase, setAppSeed, sha256Hex } from "./crypto.js";
import { getLocalNbsDetail } from "./catalogSearch.js";
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

const OFFLINE_FETCH_TIMEOUT_MS = 60_000;

function getCurrentOrigin() {
  return globalThis.self?.location?.origin || globalThis.location?.origin || "";
}

function resolveNetworkTarget(url) {
  try {
    const resolvedUrl = new URL(url, getCurrentOrigin() || undefined);
    return {
      origin: resolvedUrl.origin,
      path: `${resolvedUrl.pathname}${resolvedUrl.search}`,
    };
  } catch {
    return {
      origin: String(url),
      path: "",
    };
  }
}

export function buildOfflineDatabaseNetworkErrorMessage(url, action = "request") {
  const target = resolveNetworkTarget(url);
  const targetLabel = `${target.origin}${target.path}`;

  const currentOrigin = getCurrentOrigin() || "esta origem";
  const actionLabels = {
    version: "consultar a versão do banco offline",
    token: "solicitar o token do banco offline",
    download: "baixar o banco offline",
    request: "acessar o banco offline",
  };
  const actionLabel = actionLabels[action] || actionLabels.request;

  return `Não foi possível ${actionLabel} em ${targetLabel}. Verifique se o backend permite esta origem: ${currentOrigin}.`;
}

export async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = OFFLINE_FETCH_TIMEOUT_MS,
  action = "request"
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(buildOfflineDatabaseNetworkErrorMessage(url, action), {
        cause: error,
      });
    }
    throw new Error(buildOfflineDatabaseNetworkErrorMessage(url, action), {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function handleInitMessage(id, payload) {
  const encData = await readFromOpfs();
  const version = await readVersion();
  const opfsSeed = await readSeed();
  const seed = opfsSeed || payload?.seed;
  const usedPayloadSeedFallback = !opfsSeed && Boolean(payload?.seed);

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
    if (usedPayloadSeedFallback) {
      await removeFromOpfs();
    }
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
    seed,
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

async function requestInstallToken(apiBase) {
  const tokenResp = await fetchWithTimeout(`${apiBase}/database/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  }, OFFLINE_FETCH_TIMEOUT_MS, "token");

  if (tokenResp.ok) {
    return tokenResp.json();
  }

  const errText = await tokenResp.text();
  throw new Error(`Token request failed (${tokenResp.status}): ${errText}`);
}

async function fetchEncryptedDatabase(apiBase, token) {
  const dlResp = await fetchWithTimeout(`${apiBase}/database/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }, OFFLINE_FETCH_TIMEOUT_MS, "download");

  if (dlResp.ok) {
    return dlResp;
  }

  const errText = await dlResp.text();
  throw new Error(
    `Offline database retrieval failed (${dlResp.status}): ${errText}`
  );
}

function waitBeforeOfflineDownloadRetry() {
  return new Promise((resolve) => {
    setTimeout(resolve, 1200);
  });
}

function isRetryableOfflineDownloadError(error) {
  if (!(error instanceof Error)) return false;
  if (error.message.includes("(403)") || error.message.includes("(429)")) return false;
  if (error.message.includes("integrity verification failed")) return false;
  return true;
}

async function fetchEncryptedDatabaseBundle(apiBase, id) {
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const tokenData = await requestInstallToken(apiBase);
      postWorkerProgress(id, 10, "fetching_database");
      const dlResp = await fetchEncryptedDatabase(apiBase, tokenData.token);
      const encryptedBlob = await readEncryptedDatabaseBlob(dlResp, id);
      return { tokenData, encryptedBlob };
    } catch (error) {
      lastError = error;
      if (!isRetryableOfflineDownloadError(error) || attempt === 1) break;
      postWorkerProgress(id, 10, "retrying_download");
      await waitBeforeOfflineDownloadRetry();
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Offline database download failed");
}

async function updateInstalledVersion(apiBase) {
  let nextVersion = null;

  try {
    const versionResp = await fetchWithTimeout(
      `${apiBase}/database/version`,
      {},
      OFFLINE_FETCH_TIMEOUT_MS,
      "version"
    );
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
    const { tokenData, encryptedBlob } = await fetchEncryptedDatabaseBundle(apiBase, id);
    const {
      app_seed: appSeed,
      encrypted_sha256: expectedEncryptedSha256,
      chunk_size: chunkSize = 65536,
      pbkdf2_iterations: iterations = 600000,
    } = tokenData;
    if (!appSeed || typeof appSeed !== "string") {
      throw new Error("Offline database key was not provided by the server");
    }
    setAppSeed(appSeed);

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
      seed: appSeed,
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
