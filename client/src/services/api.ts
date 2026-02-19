/**
 * API Client - Axios com autenticação Clerk
 * 
 * Configuração centralizada do axios com:
 * - Base URL normalizada
 * - Interceptor para adicionar JWT do Clerk em cada request
 * - Timeout configurável
 */
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { SystemStatusResponse } from '../types/api.types';

const explicitBaseUrl = import.meta.env.VITE_API_FILTER_URL || import.meta.env.VITE_API_URL;
const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1';
const isExplicitLocalApi =
    !!explicitBaseUrl &&
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(explicitBaseUrl);
const shouldUseProxyApi =
    typeof window !== 'undefined' && isExplicitLocalApi && !isLocalHost(window.location.hostname);

const rawBaseUrl = shouldUseProxyApi ? '/api' : (explicitBaseUrl || '/api');

const normalizeApiUrl = (base: string) => {
    const trimmed = base.replace(/\/$/, '');

    if (trimmed === '/api' || trimmed.startsWith('/api/')) {
        return trimmed;
    }

    if (/^https?:\/\//i.test(trimmed)) {
        if (trimmed.endsWith('/api')) return trimmed;
        if (trimmed.endsWith('/api/')) return trimmed.slice(0, -1);
        return `${trimmed}/api`;
    }

    return trimmed;
};

const API_URL = normalizeApiUrl(rawBaseUrl);

export const api = axios.create({
    baseURL: API_URL,
    timeout: 60000,
    withCredentials: true,
});

// ============================================================
// AUTH INTERCEPTOR - Injeta o JWT do Clerk em cada request
// ============================================================

/**
 * Storage para o token getter do Clerk.
 * Isso é necessário porque o interceptor do axios é configurado uma vez,
 * mas o getToken() vem do hook useAuth que só existe dentro de componentes React.
 */
type ClerkTokenGetterOptions = {
    skipCache?: boolean;
    template?: string;
};

type ClerkTokenGetter = (options?: ClerkTokenGetterOptions) => Promise<string | null>;

let clerkGetToken: ClerkTokenGetter | null = null;
const PUBLIC_ROUTES = ['/status', '/glossary'];
const AUTH_DEBUG_ENABLED = import.meta.env.DEV && String(import.meta.env.VITE_AUTH_DEBUG || '').toLowerCase() === 'true';
const CLERK_TOKEN_TEMPLATE = (import.meta.env.VITE_CLERK_TOKEN_TEMPLATE || '').trim() || undefined;
const AUTH_REFRESH_COOLDOWN_MS = 2500;

const JWT_DEBUG_FIELDS = ['iss', 'sub', 'sid', 'azp', 'aud', 'org_id', 'exp', 'iat', 'nbf'] as const;
let inFlightForcedRefreshPromise: Promise<string | null> | null = null;
let lastForcedRefreshAtMs = 0;

function getRequestPath(url?: string): string {
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) return url;

    try {
        return new URL(url).pathname;
    } catch {
        return url;
    }
}

/**
 * Registra a função getToken do Clerk para uso no interceptor.
 * Deve ser chamado uma vez quando o AuthProvider monta.
 */
export function registerClerkTokenGetter(getter: ClerkTokenGetter) {
    clerkGetToken = getter;
}

/**
 * Remove a função getToken (chamado no unmount do AuthProvider).
 */
export function unregisterClerkTokenGetter() {
    clerkGetToken = null;
}

function buildTokenGetterOptions(skipCache = false): ClerkTokenGetterOptions {
    const options: ClerkTokenGetterOptions = {};
    if (skipCache) {
        options.skipCache = true;
    }
    if (CLERK_TOKEN_TEMPLATE) {
        options.template = CLERK_TOKEN_TEMPLATE;
    }
    return options;
}

function shouldAttemptAuthRefresh(detail?: string): boolean {
    if (!detail) return true;
    const normalized = detail.toLowerCase();

    if (
        normalized.includes('token ausente')
        || normalized.includes('missing token')
    ) {
        return false;
    }

    return (
        normalized.includes('token inválido')
        || normalized.includes('token invalido')
        || normalized.includes('token expirado')
        || normalized.includes('expired')
        || normalized.includes('invalid')
        || normalized.includes('unauthorized')
    );
}

async function getForcedRefreshToken(path: string, reason: string): Promise<{
    token: string | null;
    options: ClerkTokenGetterOptions;
    mode: 'fresh' | 'in_flight' | 'cooldown';
}> {
    const options = buildTokenGetterOptions(true);
    if (!clerkGetToken) {
        return { token: null, options, mode: 'cooldown' };
    }

    if (inFlightForcedRefreshPromise) {
        const token = await inFlightForcedRefreshPromise;
        return { token, options, mode: 'in_flight' };
    }

    const now = Date.now();
    if (lastForcedRefreshAtMs > 0 && (now - lastForcedRefreshAtMs) < AUTH_REFRESH_COOLDOWN_MS) {
        if (import.meta.env.DEV) {
            console.warn('[API] Forced token refresh skipped by cooldown', {
                path,
                reason,
                cooldownMs: AUTH_REFRESH_COOLDOWN_MS,
            });
        }
        return { token: null, options, mode: 'cooldown' };
    }

    lastForcedRefreshAtMs = now;
    inFlightForcedRefreshPromise = clerkGetToken(options);
    try {
        const token = await inFlightForcedRefreshPromise;
        return { token, options, mode: 'fresh' };
    } finally {
        inFlightForcedRefreshPromise = null;
    }
}

function decodeJwtSegment<T extends object>(segment: string): T | null {
    try {
        const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
        const padLength = (4 - (normalized.length % 4)) % 4;
        const padded = normalized + '='.repeat(padLength);
        const decoded = atob(padded);
        const parsed = JSON.parse(decoded);
        return parsed && typeof parsed === 'object' ? parsed as T : null;
    } catch {
        return null;
    }
}

function getJwtDebugPayload(token: string): {
    header: Record<string, unknown>;
    claims: Record<string, unknown>;
} | null {
    const parts = token.split('.');
    if (parts.length < 2) return null;

    const header = decodeJwtSegment<Record<string, unknown>>(parts[0]);
    const claims = decodeJwtSegment<Record<string, unknown>>(parts[1]);
    if (!header || !claims) return null;

    return { header, claims };
}

function maskToken(token: string): string {
    if (token.length <= 24) return token;
    return `${token.slice(0, 12)}...${token.slice(-12)}`;
}

function logJwtDebug(event: 'request' | 'retry', path: string, token: string, options: ClerkTokenGetterOptions) {
    if (!AUTH_DEBUG_ENABLED) return;

    const parsed = getJwtDebugPayload(token);
    const now = Math.floor(Date.now() / 1000);
    const claims = parsed?.claims || {};
    const header = parsed?.header || {};
    const exp = typeof claims.exp === 'number' ? claims.exp : null;
    const iat = typeof claims.iat === 'number' ? claims.iat : null;
    const nbf = typeof claims.nbf === 'number' ? claims.nbf : null;
    const projectedClaims = Object.fromEntries(
        JWT_DEBUG_FIELDS.map((field) => [field, claims[field]]),
    );

    console.info('[AUTH DEBUG] JWT metadata', {
        event,
        path,
        tokenPreview: maskToken(token),
        template: options.template || null,
        skipCache: !!options.skipCache,
        header: {
            alg: header.alg,
            kid: header.kid,
            typ: header.typ,
        },
        claims: projectedClaims,
        timing: {
            now,
            expInSec: exp === null ? null : exp - now,
            iatAgeSec: iat === null ? null : now - iat,
            nbfInSec: nbf === null ? null : nbf - now,
        },
    });
}

// Request interceptor para adicionar o token JWT
api.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
        const path = getRequestPath(config.url);
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        const isPublicRoute = PUBLIC_ROUTES.some(route => normalizedPath.startsWith(route));

        // Se temos um getter de token registrado, busca o token
        if (clerkGetToken && !isPublicRoute) {
            try {
                const primaryOptions = buildTokenGetterOptions(false);
                let token = await clerkGetToken(primaryOptions);
                let usedOptions = primaryOptions;
                if (!token) {
                    const fallback = await getForcedRefreshToken(normalizedPath, 'missing_token_in_request_interceptor');
                    token = fallback.token;
                    usedOptions = fallback.options;
                }
                if (token) {
                    config.headers.set('Authorization', `Bearer ${token}`);
                    logJwtDebug('request', normalizedPath, token, usedOptions);
                } else if (import.meta.env.DEV) {
                    console.warn('[API] No Clerk token available for authenticated request:', normalizedPath);
                }
            } catch (error) {
                // Falha silenciosa - request continua sem token
                console.warn('[API] Failed to get auth token:', error);
            }
        }
        return config;
    },
    (error: AxiosError) => {
        return Promise.reject(error);
    }
);

// Response interceptor para tratar erros de autenticação
api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const status = error.response?.status;
        const originalRequest = error.config as (InternalAxiosRequestConfig & { _retryAuth?: boolean }) | undefined;
        const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
        const detailText = typeof detail === 'string' ? detail : undefined;
        let refreshAttempt: 'skipped' | 'attempted' = 'skipped';
        let refreshMode: 'fresh' | 'in_flight' | 'cooldown' | 'not_applicable' = 'not_applicable';

        if (
            status === 401
            && originalRequest
            && !originalRequest._retryAuth
            && clerkGetToken
            && shouldAttemptAuthRefresh(detailText)
        ) {
            const path = getRequestPath(originalRequest.url);
            const normalizedPath = path.startsWith('/') ? path : `/${path}`;
            const isPublicRoute = PUBLIC_ROUTES.some(route => normalizedPath.startsWith(route));

            if (!isPublicRoute) {
                originalRequest._retryAuth = true;
                refreshAttempt = 'attempted';
                try {
                    const refresh = await getForcedRefreshToken(normalizedPath, detailText || '401_without_detail');
                    refreshMode = refresh.mode;
                    const freshToken = refresh.token;
                    if (freshToken) {
                        originalRequest.headers.set('Authorization', `Bearer ${freshToken}`);
                        logJwtDebug('retry', normalizedPath, freshToken, refresh.options);
                        return api.request(originalRequest);
                    }
                } catch (refreshError) {
                    refreshMode = 'fresh';
                    console.warn('[API] Failed to refresh token after 401:', refreshError);
                }
            }
        }

        if (status === 401) {
            console.warn('[API] 401 Unauthorized - Token missing, expired, or invalid', {
                path: originalRequest?.url,
                detail: detailText,
                refreshAttempt,
                refreshMode,
            });
        }
        return Promise.reject(error);
    }
);

// ============================================================
// API FUNCTIONS
// ============================================================

// ============================================================
// PERFORMANCE: In-memory + localStorage cache for chapter data
// ============================================================
const CACHE_PREFIX = 'nesh_cache_';
const CACHE_INDEX_KEY = 'nesh_cache_index_v1';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_ENTRIES = 30;
const CACHE_EVICT_BATCH_SIZE = 10;
const MEMORY_CACHE_MAX = 50;

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

interface CacheIndex {
    [key: string]: number;
}

// In-memory cache (fastest - survives within session)
const memoryCache = new Map<string, CacheEntry<any>>();
const inFlightRequests = new Map<string, Promise<any>>();

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
        // Ignore storage errors
    }
}

function removeLocalStorageCacheEntry(key: string, index?: CacheIndex): void {
    localStorage.removeItem(CACHE_PREFIX + key);
    if (index) delete index[key];
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

function normalizeCodeResponseAliases<T>(data: T): T {
    if (!data || typeof data !== 'object') return data;

    const candidate = data as {
        type?: string;
        results?: unknown;
        resultados?: unknown;
    };

    if (candidate.type !== 'code' || !candidate.results || candidate.resultados) {
        return data;
    }

    Object.defineProperty(candidate, 'resultados', {
        get() {
            return this.results;
        },
        enumerable: false,
        configurable: true
    });

    return data;
}

function getCached<T>(key: string): T | null {
    // 1. Check memory cache first (fastest)
    const memEntry = memoryCache.get(key);
    if (memEntry && Date.now() - memEntry.timestamp < CACHE_TTL_MS) {
        // Refresh insertion order (simple LRU behavior)
        memoryCache.delete(key);
        memoryCache.set(key, memEntry);
        return normalizeCodeResponseAliases(memEntry.data);
    }
    if (memEntry) memoryCache.delete(key);

    // 2. Check localStorage (survives page reloads)
    try {
        const index = getCacheIndex();
        const raw = localStorage.getItem(CACHE_PREFIX + key);
        if (raw) {
            const entry: CacheEntry<T> = JSON.parse(raw);
            if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
                // Promote to memory cache
                setMemoryCacheEntry(key, entry);
                if (index[key] !== entry.timestamp) {
                    index[key] = entry.timestamp;
                    saveCacheIndex(index);
                }
                return normalizeCodeResponseAliases(entry.data);
            }
            removeLocalStorageCacheEntry(key, index);
            saveCacheIndex(index);
        } else if (index[key]) {
            delete index[key];
            saveCacheIndex(index);
        }
    } catch {
        // localStorage unavailable or corrupt - ignore
    }
    return null;
}

function setCache<T>(key: string, data: T): void {
    const normalizedData = normalizeCodeResponseAliases(data);
    const entry: CacheEntry<T> = { data: normalizedData, timestamp: Date.now() };

    // Memory cache
    setMemoryCacheEntry(key, entry);

    // localStorage (with eviction)
    try {
        const index = getCacheIndex();

        // Cleanup stale index entries without parsing full payloads
        for (const indexedKey of Object.keys(index)) {
            if (!localStorage.getItem(CACHE_PREFIX + indexedKey)) {
                delete index[indexedKey];
            }
        }

        const isNewKey = !Object.prototype.hasOwnProperty.call(index, key);
        if (isNewKey && Object.keys(index).length >= CACHE_MAX_ENTRIES) {
            const oldestKeys = Object.keys(index)
                .sort((a, b) => index[a] - index[b])
                .slice(0, CACHE_EVICT_BATCH_SIZE);

            for (const oldestKey of oldestKeys) {
                removeLocalStorageCacheEntry(oldestKey, index);
            }
        }

        index[key] = entry.timestamp;
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
        saveCacheIndex(index);
    } catch {
        // localStorage full or unavailable - memory cache still works
    }
}

function withInFlightDedup<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = inFlightRequests.get(key);
    if (existing) {
        return existing as Promise<T>;
    }

    const request = factory().finally(() => {
        inFlightRequests.delete(key);
    });

    inFlightRequests.set(key, request as Promise<any>);
    return request;
}

export const searchNCM = async (query: string): Promise<any> => {
    // Performance: Check cache for code queries (chapter data is static)
    const cacheKey = `nesh:${query}`;
    const cached = getCached<any>(cacheKey);
    if (cached) return cached;

    return withInFlightDedup(`ncm:${query}`, async () => {
        const response = await api.get(`/search?ncm=${encodeURIComponent(query)}`);
        const data = normalizeCodeResponseAliases(response.data);

        // Cache code search results (chapter data). Text search is not cached.
        if (data?.type === 'code' && data?.success) {
            setCache(cacheKey, data);
        }
        return data;
    });
};

export const searchTipi = async (
    query: string,
    viewMode: 'chapter' | 'family' = 'family'
): Promise<any> => {
    // Performance: Check cache for code queries
    const cacheKey = `tipi:${query}:${viewMode}`;
    const cached = getCached<any>(cacheKey);
    if (cached) return cached;

    return withInFlightDedup(`tipi:${query}:${viewMode}`, async () => {
        const response = await api.get(`/tipi/search?ncm=${encodeURIComponent(query)}&view_mode=${viewMode}`);
        const data = normalizeCodeResponseAliases(response.data);

        // Cache code search results
        if (data?.type === 'code' && data?.success) {
            setCache(cacheKey, data);
        }
        return data;
    });
};

export const getGlossaryTerm = async (term: string): Promise<any> => {
    const response = await api.get(`/glossary?term=${encodeURIComponent(term)}`);
    return response.data;
};

export const getSystemStatus = async (): Promise<SystemStatusResponse> => {
    const response = await api.get('/status');
    return response.data;
};

export const getAuthSession = async (): Promise<{ authenticated: boolean }> => {
    const response = await api.get('/auth/me');
    return response.data;
};

/**
 * Busca notas de um capítulo específico (cross-chapter references).
 * Usado para acessar notas de capítulos não carregados no contexto atual.
 */
export const fetchChapterNotes = async (chapter: string): Promise<{
    success: boolean;
    capitulo: string;
    notas_parseadas: Record<string, string>;
    notas_gerais: string | null;
}> => {
    const response = await api.get(`/nesh/chapter/${encodeURIComponent(chapter)}/notes`);
    return response.data;
};
