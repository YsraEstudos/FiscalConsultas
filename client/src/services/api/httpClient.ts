import axios from 'axios';

import { configureApiAuthTransport } from './authTransport';

const explicitBaseUrl = import.meta.env.VITE_API_FILTER_URL || import.meta.env.VITE_API_URL;

const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1';

const isExplicitLocalApi =
    !!explicitBaseUrl &&
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(explicitBaseUrl);

const shouldUseDevProxyApi = import.meta.env.DEV;
const hasGlobalLocation = typeof globalThis.location !== 'undefined';
const shouldUseProxyApi =
    shouldUseDevProxyApi
    || (hasGlobalLocation && isExplicitLocalApi && !isLocalHost(globalThis.location.hostname));

const rawBaseUrl = shouldUseProxyApi ? '/api' : (explicitBaseUrl || '/api');

function normalizeApiUrl(base: string): string {
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
}

export const API_BASE_URL = normalizeApiUrl(rawBaseUrl);

export const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 60000,
    // Clerk auth is forwarded via Authorization header; avoid leaking ambient cookies cross-origin.
    withCredentials: false,
});

export const SYSTEM_STATUS_TIMEOUT_MS = 4000;
export const AUTH_SESSION_TIMEOUT_MS = 8000;

export function withDevCacheBust(path: string): string {
    if (!import.meta.env.DEV) {
        return path;
    }

    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}_dev_bust=${Date.now()}`;
}

configureApiAuthTransport(api);
