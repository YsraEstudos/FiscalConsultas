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
let clerkGetToken: (() => Promise<string | null>) | null = null;

/**
 * Registra a função getToken do Clerk para uso no interceptor.
 * Deve ser chamado uma vez quando o AuthProvider monta.
 */
export function registerClerkTokenGetter(getter: () => Promise<string | null>) {
    clerkGetToken = getter;
}

/**
 * Remove a função getToken (chamado no unmount do AuthProvider).
 */
export function unregisterClerkTokenGetter() {
    clerkGetToken = null;
}

// Request interceptor para adicionar o token JWT
api.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
        // Se temos um getter de token registrado, busca o token
        if (clerkGetToken) {
            try {
                const token = await clerkGetToken();
                if (token) {
                    config.headers.set('Authorization', `Bearer ${token}`);
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
    (error: AxiosError) => {
        if (error.response?.status === 401) {
            // Token expirado ou inválido
            console.warn('[API] 401 Unauthorized - Token may be expired');
            // Aqui poderia disparar um evento para o AuthContext forçar re-auth
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
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_ENTRIES = 30;

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

// In-memory cache (fastest - survives within session)
const memoryCache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string): T | null {
    // 1. Check memory cache first (fastest)
    const memEntry = memoryCache.get(key);
    if (memEntry && Date.now() - memEntry.timestamp < CACHE_TTL_MS) {
        return memEntry.data;
    }
    if (memEntry) memoryCache.delete(key);

    // 2. Check localStorage (survives page reloads)
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + key);
        if (raw) {
            const entry: CacheEntry<T> = JSON.parse(raw);
            if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
                // Promote to memory cache
                memoryCache.set(key, entry);
                return entry.data;
            }
            localStorage.removeItem(CACHE_PREFIX + key);
        }
    } catch {
        // localStorage unavailable or corrupt - ignore
    }
    return null;
}

function setCache<T>(key: string, data: T): void {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };

    // Memory cache
    memoryCache.set(key, entry);

    // localStorage (with eviction)
    try {
        // Evict old entries if too many
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.startsWith(CACHE_PREFIX)) keys.push(k);
        }
        if (keys.length >= CACHE_MAX_ENTRIES) {
            // Remove oldest entries
            const entries = keys.map(k => {
                try {
                    const v = JSON.parse(localStorage.getItem(k) || '{}');
                    return { key: k, ts: v.timestamp || 0 };
                } catch { return { key: k, ts: 0 }; }
            });
            entries.sort((a, b) => a.ts - b.ts);
            for (let i = 0; i < Math.min(10, entries.length); i++) {
                localStorage.removeItem(entries[i].key);
            }
        }
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch {
        // localStorage full or unavailable - memory cache still works
    }
}

export const searchNCM = async (query: string): Promise<any> => {
    // Performance: Check cache for code queries (chapter data is static)
    const cacheKey = `nesh:${query}`;
    const cached = getCached<any>(cacheKey);
    if (cached) return cached;

    const response = await api.get(`/search?ncm=${encodeURIComponent(query)}`);
    const data = response.data;

    // Normalize: backend no longer sends 'resultados' (v4.3 — saves ~860KB per response).
    // We add a JS reference so existing components (Sidebar, ResultDisplay) keep working.
    if (data?.type === 'code' && data?.results) {
        data.resultados = data.results; // JS ref copy, zero memory cost
    }

    // Cache code search results (chapter data). Text search is not cached.
    if (data?.type === 'code' && data?.success) {
        setCache(cacheKey, data);
    }
    return data;
};

export const searchTipi = async (query: string, viewMode: 'chapter' | 'family' = 'family'): Promise<any> => {
    // Performance: Check cache for code queries
    const cacheKey = `tipi:${query}:${viewMode}`;
    const cached = getCached<any>(cacheKey);
    if (cached) return cached;

    const response = await api.get(`/tipi/search?ncm=${encodeURIComponent(query)}&view_mode=${viewMode}`);
    const data = response.data;

    // Normalize: backend no longer sends 'resultados' (v4.3)
    if (data?.type === 'code' && data?.results) {
        data.resultados = data.results;
    }

    // Cache code search results
    if (data?.type === 'code' && data?.success) {
        setCache(cacheKey, data);
    }
    return data;
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
