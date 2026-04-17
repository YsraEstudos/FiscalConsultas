/**
 * Local Database Context
 *
 * Manages the full offline lifecycle:
 * - Worker communication
 * - Cross-tab coordination
 * - Version checks and update availability
 * - App-shell caching via the service worker
 * - Local search and local NBS/NEBS detail retrieval
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { NbsDetailResponse, NebsDetailResponse } from "../types/api.types";
import {
  compareOfflineVersions,
  sanitizeOfflineMetadata,
  type OfflineDatabaseMetadata,
} from "../utils/offlineDatabase";
import { API_BASE_URL } from "../services/api";

export type DbStatus =
  | "checking"
  | "not_installed"
  | "installing"
  | "ready"
  | "updating"
  | "error"
  | "unsupported";

export type DocType = "nbs" | "nebs" | "tipi" | "ncm" | "nesh";

const OFFLINE_META_KEY = "offline-db:installed-meta";
const OFFLINE_LOCK_KEY = "offline-db:install-lock";
const OFFLINE_CHANNEL_NAME = "offline-db-channel";
const OFFLINE_LOCK_TTL_MS = 180_000;
const OFFLINE_WAIT_TIMEOUT_MS = 240_000;

interface WorkerMessage {
  type: string;
  id: string | null;
  payload: Record<string, unknown>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

type ChannelMessage =
  | {
      type: "INSTALLING";
      source: string;
      payload: { mode: "installing" | "updating" };
    }
  | {
      type: "INSTALLED";
      source: string;
      payload: { metadata: OfflineDatabaseMetadata | null };
    }
  | {
      type: "REMOVED";
      source: string;
      payload: {};
    }
  | {
      type: "ERROR";
      source: string;
      payload: { message: string };
    };

interface LocalDatabaseState {
  status: DbStatus;
  progress: number;
  progressStep: string;
  localVersion: string | null;
  remoteVersion: string | null;
  updateAvailable: boolean;
  error: string | null;
  dbSizeBytes: number | null;
  isSupported: boolean;
  isRemoving: boolean;
}

interface LocalSearchResult {
  results: Record<string, unknown>[] | Record<string, unknown> | null;
  searchType: "text" | "code";
}

interface LocalDatabaseContextType extends LocalDatabaseState {
  install: () => Promise<void>;
  remove: () => Promise<void>;
  refreshAvailability: (force?: boolean) => Promise<OfflineDatabaseMetadata | null>;
  searchLocal: (
    docType: DocType,
    query: string,
    viewMode?: string
  ) => Promise<LocalSearchResult | null>;
  getNbsDetailLocal: (
    code: string,
    options?: { page?: number; pageSize?: number }
  ) => Promise<NbsDetailResponse | null>;
  getNebsDetailLocal: (code: string) => Promise<NebsDetailResponse | null>;
}

const DEFAULT_LOCAL_DATABASE_CONTEXT: LocalDatabaseContextType = {
  status: "unsupported",
  progress: 0,
  progressStep: "",
  localVersion: null,
  remoteVersion: null,
  updateAvailable: false,
  error: null,
  dbSizeBytes: null,
  isSupported: false,
  isRemoving: false,
  install: async () => {
    throw new Error("Offline DB not supported in this browser");
  },
  remove: async () => undefined,
  refreshAvailability: async () => null,
  searchLocal: async () => null,
  getNbsDetailLocal: async () => null,
  getNebsDetailLocal: async () => null,
};

const LocalDatabaseContext = createContext<LocalDatabaseContextType>(
  DEFAULT_LOCAL_DATABASE_CONTEXT
);

function isOfflineDbSupported(): boolean {
  if (typeof SharedArrayBuffer === "undefined") return false;
  if (typeof Worker === "undefined") return false;
  if (typeof crypto?.subtle === "undefined") return false;
  if (typeof navigator?.storage?.getDirectory !== "function") return false;
  return true;
}

function readStoredMetadata(): OfflineDatabaseMetadata | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return sanitizeOfflineMetadata(
      JSON.parse(localStorage.getItem(OFFLINE_META_KEY) || "null")
    );
  } catch {
    return null;
  }
}

function persistStoredMetadata(metadata: OfflineDatabaseMetadata | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (!metadata) {
      localStorage.removeItem(OFFLINE_META_KEY);
      return;
    }
    localStorage.setItem(OFFLINE_META_KEY, JSON.stringify(metadata));
  } catch {
    // Ignore storage failures. The worker state remains authoritative.
  }
}

function getInstallLock(): { owner: string; expiresAt: number } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(OFFLINE_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.owner || !parsed?.expiresAt) return null;
    if (Number(parsed.expiresAt) <= Date.now()) {
      localStorage.removeItem(OFFLINE_LOCK_KEY);
      return null;
    }
    return {
      owner: String(parsed.owner),
      expiresAt: Number(parsed.expiresAt),
    };
  } catch {
    return null;
  }
}

function setInstallLock(owner: string): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    const nextValue = JSON.stringify({
      owner,
      expiresAt: Date.now() + OFFLINE_LOCK_TTL_MS,
    });
    localStorage.setItem(OFFLINE_LOCK_KEY, nextValue);
    return getInstallLock()?.owner === owner;
  } catch {
    return true;
  }
}

function clearInstallLock(owner: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const current = getInstallLock();
    if (!current || current.owner === owner) {
      localStorage.removeItem(OFFLINE_LOCK_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}

async function primeOfflineShellCache() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 1500);
      }),
    ]);
    if (!registration) {
      return;
    }
    registration.active?.postMessage({
      type: "CACHE_APP_SHELL",
      payload: {
        urls: [
          globalThis.location.pathname,
          globalThis.location.origin,
          globalThis.location.href,
        ],
      },
    });
  } catch {
    // Ignore service worker readiness issues and keep the offline DB flow working.
  }
}

function buildInitPayload(
  metadata: OfflineDatabaseMetadata | null | undefined
): Record<string, unknown> {
  return {
    chunkSize: metadata?.chunk_size || 65536,
    pbkdf2Iterations: metadata?.pbkdf2_iterations || 600000,
  };
}

function runInBackground(task: Promise<unknown>) {
  task.catch(() => undefined);
}

function getOfflineApiBaseUrl() {
  return API_BASE_URL;
}

let fallbackInstanceCounter = 0;

function createInstanceId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `offline-db-${globalThis.crypto.randomUUID()}`;
  }

  fallbackInstanceCounter += 1;
  return `offline-db-${Date.now()}-${fallbackInstanceCounter}`;
}

export function LocalDatabaseProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const isSupported = useMemo(() => isOfflineDbSupported(), []);
  const instanceIdRef = useRef(createInstanceId());
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const workerRef = useRef<Worker | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const workerReadyRef = useRef(false);
  const idCounterRef = useRef(0);
  const syncWaiterRef = useRef<{
    resolve: () => void;
    reject: (reason: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);
  const remoteCheckRef = useRef<Promise<OfflineDatabaseMetadata | null> | null>(
    null
  );
  const remoteMetaRef = useRef<OfflineDatabaseMetadata | null>(readStoredMetadata());

  const [status, setStatus] = useState<DbStatus>(
    isSupported ? "checking" : "unsupported"
  );
  const [progress, setProgress] = useState(0);
  const [progressStep, setProgressStep] = useState("");
  const [localVersion, setLocalVersion] = useState<string | null>(
    remoteMetaRef.current?.version || null
  );
  const [remoteVersion, setRemoteVersion] = useState<string | null>(
    remoteMetaRef.current?.version || null
  );
  const [error, setError] = useState<string | null>(null);
  const [dbSizeBytes, setDbSizeBytes] = useState<number | null>(
    remoteMetaRef.current?.size_bytes || null
  );
  const [isRemoving, setIsRemoving] = useState(false);

  const updateAvailable = useMemo(
    () =>
      compareOfflineVersions(remoteVersion, localVersion) > 0 &&
      status !== "installing" &&
      status !== "updating",
    [localVersion, remoteVersion, status]
  );

  const nextId = useCallback(() => {
    idCounterRef.current += 1;
    return `req_${idCounterRef.current}_${Date.now()}`;
  }, []);

  const sendToWorker = useCallback(
    (
      type: string,
      payload: Record<string, unknown> = {},
      timeoutMs = 120_000
    ): Promise<WorkerMessage> =>
      new Promise((resolve, reject) => {
        const worker = workerRef.current;
        if (!worker) {
          reject(new Error("Worker not initialized"));
          return;
        }

        const id = nextId();
        const timeout = setTimeout(() => {
          pendingRef.current.delete(id);
          reject(new Error("Worker request timed out"));
        }, timeoutMs);

        pendingRef.current.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timeout,
        });

        worker.postMessage({ type, id, payload });
      }),
    [nextId]
  );

  const resolveSyncWaiter = useCallback(() => {
    if (!syncWaiterRef.current) return;
    clearTimeout(syncWaiterRef.current.timeout);
    syncWaiterRef.current.resolve();
    syncWaiterRef.current = null;
  }, []);

  const rejectSyncWaiter = useCallback((message: string) => {
    if (!syncWaiterRef.current) return;
    clearTimeout(syncWaiterRef.current.timeout);
    syncWaiterRef.current.reject(new Error(message));
    syncWaiterRef.current = null;
  }, []);

  const waitForOtherTabSync = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        if (syncWaiterRef.current) {
          reject(new Error("Another synchronization is already pending"));
          return;
        }

        syncWaiterRef.current = {
          resolve,
          reject,
          timeout: setTimeout(() => {
            rejectSyncWaiter(
              "Outra aba iniciou a instalação offline, mas não concluiu a sincronização a tempo."
            );
          }, OFFLINE_WAIT_TIMEOUT_MS),
        };
      }),
    [rejectSyncWaiter]
  );

  const initializeInstalledDatabase = useCallback(
    async (metadata?: OfflineDatabaseMetadata | null) => {
      if (!workerReadyRef.current) return;

      const initMetadata = metadata || remoteMetaRef.current || readStoredMetadata();
      try {
        await sendToWorker("INIT", buildInitPayload(initMetadata), 30_000);
      } catch (err) {
        setStatus("error");
        setError(
          err instanceof Error ? err.message : "Falha ao carregar o banco local"
        );
      }
    },
    [sendToWorker]
  );

  const refreshAvailability = useCallback(
    async (force = false): Promise<OfflineDatabaseMetadata | null> => {
      if (!isSupported) return null;
      if (!force && remoteCheckRef.current) {
        return remoteCheckRef.current;
      }

      const request = (async () => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          try {
            const response = await fetch(`${getOfflineApiBaseUrl()}/database/version`, {
              method: "GET",
              headers: { Accept: "application/json" },
              signal: controller.signal,
            });

            if (!response.ok) {
              throw new Error(`Version check failed (${response.status})`);
            }

            const metadata = sanitizeOfflineMetadata(await response.json());
            remoteMetaRef.current = metadata;
            setRemoteVersion(metadata?.version || null);
            setDbSizeBytes((current) => current ?? metadata?.size_bytes ?? null);
            return metadata;
          } finally {
            clearTimeout(timer);
          }
        } catch {
          return remoteMetaRef.current;
        }
      })();

      remoteCheckRef.current = request;
      const metadata = await request;
      if (remoteCheckRef.current === request) {
        remoteCheckRef.current = null;
      }
      return metadata;
    },
    [isSupported]
  );

  const broadcast = useCallback((message: ChannelMessage) => {
    channelRef.current?.postMessage(message);
  }, []);

  const applyInstalledMetadata = useCallback((metadata: OfflineDatabaseMetadata | null) => {
    if (!metadata) return;
    remoteMetaRef.current = metadata;
    persistStoredMetadata(metadata);
    setLocalVersion(metadata.version);
    setRemoteVersion(metadata.version);
    setDbSizeBytes(metadata.size_bytes || null);
    setError(null);
  }, []);

  const handleWorkerMessage = useCallback(
    (event: MessageEvent<WorkerMessage>) => {
      const { type, id, payload } = event.data;
      const pending = id ? pendingRef.current.get(id) : undefined;

      if (type === "PROGRESS") {
        setProgress((payload.progress as number) || 0);
        setProgressStep((payload.step as string) || "");
        return;
      }

      if (type === "STATUS") {
        const nextStatus = payload.status as DbStatus;
        setStatus(nextStatus);
        setLocalVersion((payload.version as string) || null);
        setDbSizeBytes((payload.sizeBytes as number) || null);
        if (nextStatus === "error") {
          setError((payload.error as string) || "Unknown error");
        }
        if (nextStatus === "ready") {
          setProgress(100);
          setProgressStep("done");
          setError(null);
        }
        if (
          id &&
          pending &&
          (nextStatus === "ready" || nextStatus === "not_installed")
        ) {
          clearTimeout(pending.timeout);
          pendingRef.current.delete(id);
          pending.resolve(event.data);
        }
        return;
      }

      if (type === "RESULT") {
        if (!id || !pending) return;
        clearTimeout(pending.timeout);
        pendingRef.current.delete(id);
        pending.resolve(event.data);
        return;
      }

      if (type === "ERROR") {
        setError((payload.error as string) || "Unknown error");
        setStatus("error");
        if (!id || !pending) return;
        clearTimeout(pending.timeout);
        pendingRef.current.delete(id);
        pending.reject(
          new Error((payload.error as string) || "Worker error")
        );
      }
    },
    []
  );

  useEffect(() => {
    if (!isSupported) return undefined;

    const worker = new Worker(new URL("../workers/db.worker.js", import.meta.url), {
      type: "module",
    });

    workerRef.current = worker;
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (event) => {
      setError(`Worker error: ${event.message}`);
      setStatus("error");
    };

    const onReady = () => {
      workerReadyRef.current = true;
      runInBackground(initializeInstalledDatabase());
      runInBackground(refreshAvailability(false));
      runInBackground(primeOfflineShellCache());
    };

    const readyListener = (event: MessageEvent<WorkerMessage>) => {
      if (event.data?.type !== "READY") return;
      worker.removeEventListener("message", readyListener as EventListener);
      onReady();
    };

    worker.addEventListener("message", readyListener as EventListener);

    return () => {
      workerReadyRef.current = false;
      worker.terminate();
      workerRef.current = null;
      for (const [, pending] of pendingRef.current) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Worker terminated"));
      }
      pendingRef.current.clear();
    };
  }, [handleWorkerMessage, initializeInstalledDatabase, isSupported, refreshAvailability]);

  useEffect(() => {
    if (!isSupported || typeof BroadcastChannel === "undefined") return undefined;

    const channel = new BroadcastChannel(OFFLINE_CHANNEL_NAME);
    channelRef.current = channel;

    channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
      const message = event.data;
      if (!message || message.source === instanceIdRef.current) return;

      if (message.type === "INSTALLING") {
        setStatus((current) =>
          current === "ready"
            ? current
            : message.payload.mode === "updating"
              ? "updating"
              : "installing"
        );
        setProgress((current) => (current > 0 ? current : 5));
        setProgressStep("waiting_for_other_tab");
        return;
      }

      if (message.type === "INSTALLED") {
        applyInstalledMetadata(message.payload.metadata);
        setProgress(95);
        setProgressStep("syncing_with_other_tab");
        runInBackground(
          initializeInstalledDatabase(message.payload.metadata)
            .finally(() => primeOfflineShellCache())
            .finally(() => {
              resolveSyncWaiter();
            })
        );
        return;
      }

      if (message.type === "REMOVED") {
        persistStoredMetadata(null);
        setProgress(0);
        setProgressStep("");
        setRemoteVersion(remoteMetaRef.current?.version || null);
        runInBackground(
          sendToWorker("REMOVE", {}, 10_000).catch(() => {
            setStatus("not_installed");
            setLocalVersion(null);
            setDbSizeBytes(null);
            setError(null);
          })
        );
        resolveSyncWaiter();
        return;
      }

      if (message.type === "ERROR") {
        setError(message.payload.message);
        rejectSyncWaiter(message.payload.message);
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [
    applyInstalledMetadata,
    initializeInstalledDatabase,
    isSupported,
    rejectSyncWaiter,
    resolveSyncWaiter,
    sendToWorker,
  ]);

  const install = useCallback(async () => {
    if (!isSupported) {
      throw new Error("Offline DB not supported in this browser");
    }

    const targetStatus: DbStatus =
      compareOfflineVersions(remoteVersion, localVersion) > 0 ||
      localVersion !== null
        ? "updating"
        : "installing";

    setStatus(targetStatus);
    setProgress(0);
    setProgressStep("starting");
    setError(null);

    const currentLock = getInstallLock();
    const lockOwner = instanceIdRef.current;
    const ownsLock = !currentLock || currentLock.owner === lockOwner
      ? setInstallLock(lockOwner)
      : false;

    if (!ownsLock) {
      setProgress(5);
      setProgressStep("waiting_for_other_tab");
      await waitForOtherTabSync();
      return;
    }

    broadcast({
      type: "INSTALLING",
      source: lockOwner,
      payload: { mode: targetStatus === "updating" ? "updating" : "installing" },
    });

    try {
      const metadata = await refreshAvailability(true);
      if (metadata) {
        remoteMetaRef.current = metadata;
        setRemoteVersion(metadata.version);
      }

      runInBackground(primeOfflineShellCache());
      await sendToWorker(
        "INSTALL",
        {
          apiBase: getOfflineApiBaseUrl(),
        },
        180_000
      );

      const effectiveMetadata =
        (await refreshAvailability(true)) || remoteMetaRef.current || readStoredMetadata();

      applyInstalledMetadata(effectiveMetadata);
      setStatus("ready");
      setProgress(100);
      setProgressStep("done");

      broadcast({
        type: "INSTALLED",
        source: lockOwner,
        payload: { metadata: effectiveMetadata },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Installation failed unexpectedly";
      setStatus("error");
      setError(message);
      broadcast({
        type: "ERROR",
        source: lockOwner,
        payload: { message },
      });
      throw err;
    } finally {
      clearInstallLock(lockOwner);
    }
  }, [
    applyInstalledMetadata,
    broadcast,
    isSupported,
    localVersion,
    refreshAvailability,
    remoteVersion,
    sendToWorker,
    waitForOtherTabSync,
  ]);

  const remove = useCallback(async () => {
    setIsRemoving(true);
    try {
      await sendToWorker("REMOVE", {}, 10_000);
      persistStoredMetadata(null);
      setLocalVersion(null);
      setRemoteVersion(remoteMetaRef.current?.version || null);
      setDbSizeBytes(null);
      setProgress(0);
      setProgressStep("");
      setError(null);
      broadcast({
        type: "REMOVED",
        source: instanceIdRef.current,
        payload: {},
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Removal failed");
    } finally {
      setIsRemoving(false);
    }
  }, [broadcast, sendToWorker]);

  const searchLocal = useCallback(
    async (
      docType: DocType,
      query: string,
      viewMode?: string
    ): Promise<LocalSearchResult | null> => {
      if (status !== "ready") return null;

      try {
        const response = (await sendToWorker(
          "SEARCH",
          { docType, query, viewMode },
          5_000
        )) as WorkerMessage;

        if (response.payload?.results === null) return null;
        return {
          results:
            (response.payload?.results as
              | Record<string, unknown>[]
              | Record<string, unknown>
              | null) || null,
          searchType:
            ((response.payload?.searchType as "text" | "code") || "text"),
        };
      } catch {
        return null;
      }
    },
    [sendToWorker, status]
  );

  const getNbsDetailLocal = useCallback(
    async (
      code: string,
      options: { page?: number; pageSize?: number } = {}
    ): Promise<NbsDetailResponse | null> => {
      if (status !== "ready") return null;

      try {
        const response = (await sendToWorker(
          "GET_NBS_DETAIL",
          {
            code,
            page: options.page || 1,
            pageSize: options.pageSize || 50,
          },
          10_000
        )) as WorkerMessage;

        return (response.payload.detail as NbsDetailResponse) || null;
      } catch {
        return null;
      }
    },
    [sendToWorker, status]
  );

  const getNebsDetailLocal = useCallback(
    async (code: string): Promise<NebsDetailResponse | null> => {
      if (status !== "ready") return null;

      try {
        const response = (await sendToWorker(
          "GET_NEBS_DETAIL",
          { code },
          10_000
        )) as WorkerMessage;

        return (response.payload.detail as NebsDetailResponse) || null;
      } catch {
        return null;
      }
    },
    [sendToWorker, status]
  );

  const contextValue = useMemo<LocalDatabaseContextType>(
    () => ({
      status,
      progress,
      progressStep,
      localVersion,
      remoteVersion,
      updateAvailable,
      error,
      dbSizeBytes,
      isSupported,
      isRemoving,
      install,
      remove,
      refreshAvailability,
      searchLocal,
      getNbsDetailLocal,
      getNebsDetailLocal,
    }),
    [
      dbSizeBytes,
      error,
      getNebsDetailLocal,
      getNbsDetailLocal,
      install,
      isRemoving,
      isSupported,
      localVersion,
      progress,
      progressStep,
      refreshAvailability,
      remoteVersion,
      remove,
      searchLocal,
      status,
      updateAvailable,
    ]
  );

  return (
    <LocalDatabaseContext.Provider value={contextValue}>
      {children}
    </LocalDatabaseContext.Provider>
  );
}

export function useLocalDatabase() {
  return useContext(LocalDatabaseContext);
}

export function useOptionalLocalDatabase() {
  return useContext(LocalDatabaseContext);
}
