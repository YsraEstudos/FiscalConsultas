const CACHE_PREFIX = 'nesh_cache_';
const CACHE_INDEX_KEY = 'nesh_cache_index_v1';
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 30;
const CACHE_EVICT_BATCH_SIZE = 10;
const MEMORY_CACHE_MAX = 50;
const PERSISTENT_CODE_CACHE_PREFIXES = ['nesh:', 'tipi:'] as const;

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

interface CacheIndex {
    [key: string]: number;
}

type StorageSafeValue =
    | string
    | number
    | boolean
    | null
    | StorageSafeValue[]
    | { [key: string]: StorageSafeValue };

const memoryCache = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();

function shouldUsePersistentCache(key: string): boolean {
    return !PERSISTENT_CODE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function getCacheIndex(): CacheIndex {
    try {
        const raw = localStorage.getItem(CACHE_INDEX_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed as CacheIndex;
    } catch {
        return {};
    }
}

function saveCacheIndex(index: CacheIndex): void {
    try {
        localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
    } catch {
        // Ignore storage errors.
    }
}

function removeLocalStorageCacheEntry(key: string, index?: CacheIndex): void {
    localStorage.removeItem(CACHE_PREFIX + key);
    if (index) delete index[key];
}

function clearLegacyPersistentCodeCache(): void {
    try {
        const index = getCacheIndex();
        let changed = false;

        for (const key of Object.keys(index)) {
            if (PERSISTENT_CODE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
                removeLocalStorageCacheEntry(key, index);
                changed = true;
            }
        }

        if (changed) {
            saveCacheIndex(index);
        }
    } catch {
        // Ignore localStorage errors on startup cleanup.
    }
}

function sanitizeStringForStorage(value: string): string {
    return value.split('\0').join('');
}

function sanitizeCacheStorageKey(key: string): string {
    return sanitizeStringForStorage(key);
}

function sanitizeValueForStorage(value: unknown): StorageSafeValue | undefined {
    if (value == null) {
        return null;
    }

    if (typeof value === 'string') {
        return sanitizeStringForStorage(value);
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    if (Array.isArray(value)) {
        return value
            .map(sanitizeValueForStorage)
            .filter((item): item is StorageSafeValue => item !== undefined);
    }

    if (typeof value !== 'object') {
        return undefined;
    }

    const sanitizedObject: Record<string, StorageSafeValue> = {};
    for (const [key, item] of Object.entries(value)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
        }

        const sanitizedItem = sanitizeValueForStorage(item);
        if (sanitizedItem !== undefined) {
            sanitizedObject[key] = sanitizedItem;
        }
    }

    return sanitizedObject;
}

function sanitizeCacheEntryForStorage<T>(entry: CacheEntry<T>): CacheEntry<StorageSafeValue> | null {
    const sanitizedData = sanitizeValueForStorage(entry.data);
    if (sanitizedData === undefined || !Number.isFinite(entry.timestamp)) {
        return null;
    }

    return {
        data: sanitizedData,
        timestamp: entry.timestamp,
    };
}

function setMemoryCacheEntry<T>(key: string, entry: CacheEntry<T>): void {
    if (memoryCache.has(key)) {
        memoryCache.delete(key);
    } else if (memoryCache.size >= MEMORY_CACHE_MAX) {
        const oldestKey = memoryCache.keys().next().value as string | undefined;
        if (oldestKey !== undefined) {
            memoryCache.delete(oldestKey);
        }
    }

    memoryCache.set(key, entry);
}

type ObjectWithHasOwn = ObjectConstructor & {
    hasOwn?: (obj: object, key: PropertyKey) => boolean;
};

function hasOwn(obj: object, key: PropertyKey): boolean {
    const objectWithHasOwn = Object as ObjectWithHasOwn;
    if (typeof objectWithHasOwn.hasOwn === 'function') {
        return objectWithHasOwn.hasOwn(obj, key);
    }
    return Object.getOwnPropertyDescriptor(obj, key) !== undefined;
}

export function normalizeCodeResponseAliases<T>(data: T): T {
    if (data && typeof data === 'object') {
        const candidate = data as {
            type?: string;
            results?: unknown;
            resultados?: unknown;
        };
        const hasResults = hasOwn(candidate, 'results');
        const hasResultados = hasOwn(candidate, 'resultados');

        if (candidate.type === 'code' && hasResults && !hasResultados) {
            Object.defineProperty(candidate, 'resultados', {
                get() {
                    return this.results;
                },
                enumerable: false,
                configurable: true,
            });
        }
    }

    return data;
}

export function getCached<T>(key: string): T | null {
    const memEntry = memoryCache.get(key) as CacheEntry<T> | undefined;
    if (memEntry && Date.now() - memEntry.timestamp < CACHE_TTL_MS) {
        memoryCache.delete(key);
        memoryCache.set(key, memEntry);
        return normalizeCodeResponseAliases(memEntry.data);
    }
    if (memEntry) {
        memoryCache.delete(key);
    }

    if (!shouldUsePersistentCache(key)) {
        return null;
    }

    try {
        const index = getCacheIndex();
        const storageKey = sanitizeCacheStorageKey(key);
        const raw = localStorage.getItem(CACHE_PREFIX + storageKey);
        if (raw) {
            const entry: CacheEntry<T> = JSON.parse(raw);
            if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
                setMemoryCacheEntry(key, entry);
                if (index[storageKey] !== entry.timestamp) {
                    index[storageKey] = entry.timestamp;
                    saveCacheIndex(index);
                }
                return normalizeCodeResponseAliases(entry.data);
            }
            removeLocalStorageCacheEntry(storageKey, index);
            saveCacheIndex(index);
        } else if (index[storageKey]) {
            delete index[storageKey];
            saveCacheIndex(index);
        }
    } catch {
        // localStorage unavailable or corrupt.
    }

    return null;
}

export function setCache<T>(key: string, data: T): void {
    const normalizedData = normalizeCodeResponseAliases(data);
    const entry: CacheEntry<T> = { data: normalizedData, timestamp: Date.now() };

    setMemoryCacheEntry(key, entry);

    if (!shouldUsePersistentCache(key)) {
        return;
    }

    try {
        const index = getCacheIndex();
        const sanitizedEntry = sanitizeCacheEntryForStorage(entry);
        if (!sanitizedEntry) {
            return;
        }

        const storageKey = sanitizeCacheStorageKey(key);
        for (const indexedKey of Object.keys(index)) {
            if (!localStorage.getItem(CACHE_PREFIX + indexedKey)) {
                delete index[indexedKey];
            }
        }

        const isNewKey = !hasOwn(index, storageKey);
        if (isNewKey && Object.keys(index).length >= CACHE_MAX_ENTRIES) {
            const oldestKeys = Object.keys(index)
                .sort((a, b) => index[a] - index[b])
                .slice(0, CACHE_EVICT_BATCH_SIZE);

            for (const oldestKey of oldestKeys) {
                removeLocalStorageCacheEntry(oldestKey, index);
            }
        }

        index[storageKey] = entry.timestamp;
        localStorage.setItem(CACHE_PREFIX + storageKey, JSON.stringify(sanitizedEntry));
        saveCacheIndex(index);
    } catch {
        // localStorage full or unavailable.
    }
}

export function withInFlightDedup<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = inFlightRequests.get(key);
    if (existing) {
        return existing as Promise<T>;
    }

    const request = factory().finally(() => {
        inFlightRequests.delete(key);
    });

    inFlightRequests.set(key, request);
    return request;
}

clearLegacyPersistentCodeCache();
