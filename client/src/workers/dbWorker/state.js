const SEARCH_CACHE_MAX = 32;

/** @type {{ db: any, currentVersion: string | null, status: 'not_installed' | 'ready' | 'installing' | 'error' | 'checking', sqlite3Api: any }} */
const workerState = {
  db: null,
  currentVersion: null,
  status: "checking",
  sqlite3Api: null,
};

/** @type {Map<string, {results: any, searchType: string, markdown?: string}>} */
const searchCache = new Map();

export function getWorkerDb() {
  return workerState.db;
}

export function setWorkerDb(nextDb) {
  workerState.db = nextDb;
}

export function closeWorkerDb() {
  if (!workerState.db) return;
  try {
    workerState.db.close();
  } catch {
    // Ignore close failures during worker lifecycle transitions.
  }
  workerState.db = null;
}

export function getWorkerVersion() {
  return workerState.currentVersion;
}

export function setWorkerVersion(version) {
  workerState.currentVersion = version;
}

export function getWorkerStatus() {
  return workerState.status;
}

export function setWorkerStatus(status) {
  workerState.status = status;
}

export function getSqliteApi() {
  return workerState.sqlite3Api;
}

export function setSqliteApi(api) {
  workerState.sqlite3Api = api;
}

export function getSearchCacheKey(docType, query, viewMode) {
  return `${docType}\0${query}\0${viewMode || ""}`;
}

export function getCachedSearchResult(key) {
  if (!searchCache.has(key)) return null;
  const value = searchCache.get(key);
  searchCache.delete(key);
  searchCache.set(key, value);
  return value;
}

export function setCachedSearchResult(key, value) {
  if (searchCache.has(key)) {
    searchCache.delete(key);
  } else if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) {
      searchCache.delete(oldest);
    }
  }
  searchCache.set(key, value);
}

export function clearSearchCache() {
  searchCache.clear();
}
