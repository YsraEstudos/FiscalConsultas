import type { InternalAxiosRequestConfig } from 'axios';

import type { ClerkTokenGetterOptions } from './authTypes';

const PUBLIC_ROUTES = ['/status', '/glossary', '/services/'];
const JWT_DEBUG_FIELDS = ['iss', 'sub', 'sid', 'azp', 'aud', 'org_id', 'exp', 'iat', 'nbf'] as const;

export const AUTH_DEBUG_ENABLED =
    import.meta.env.DEV
    && String(import.meta.env.VITE_AUTH_DEBUG || '').toLowerCase() === 'true';

export const REQUEST_ID_HEADER = 'X-Request-Id';

let requestIdCounter = 0;

export function getRequestPath(url?: string): string {
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) return url;

    try {
        return new URL(url).pathname;
    } catch {
        return url;
    }
}

export function normalizeRequestPath(path: string): string {
    return path.startsWith('/') ? path : `/${path}`;
}

export function isPublicRoutePath(path: string): boolean {
    return PUBLIC_ROUTES.some((route) => path.startsWith(route));
}

export function logRequestPrepared(
    requestId: string,
    path: string,
    isPublicRoute: boolean,
    authGetterRegistered: boolean,
): void {
    if (!AUTH_DEBUG_ENABLED) return;
    console.info('[AUTH DEBUG] request prepared', {
        requestId,
        path,
        publicRoute: isPublicRoute,
        authGetterRegistered,
    });
}

export function logAuthorizationAttached(requestId: string, path: string): void {
    if (!AUTH_DEBUG_ENABLED) return;
    console.info('[AUTH DEBUG] authorization header attached', {
        requestId,
        path,
        hasAuthorization: true,
    });
}

export function logMissingRequestToken(path: string, requestId: string): void {
    if (!AUTH_DEBUG_ENABLED) return;
    console.warn('[API] No Clerk token available for authenticated request:', path, {
        requestId,
    });
}

export function logRequestTokenFailure(error: unknown): void {
    if (!AUTH_DEBUG_ENABLED) return;
    console.warn('[API] Failed to get auth token:', error);
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

export function getOrCreateRequestId(): string {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === 'function') {
        return cryptoApi.randomUUID();
    }

    if (typeof cryptoApi?.getRandomValues === 'function') {
        const randomBytes = new Uint8Array(8);
        cryptoApi.getRandomValues(randomBytes);
        const randomSuffix = Array.from(
            randomBytes,
            (value) => value.toString(16).padStart(2, '0'),
        ).join('');
        return `req_${Date.now()}_${randomSuffix}`;
    }

    requestIdCounter += 1;
    return `req_${Date.now()}_${requestIdCounter.toString(36)}`;
}

export function logJwtDebug(
    event: 'request' | 'retry',
    path: string,
    requestId: string,
    token: string,
    options: ClerkTokenGetterOptions,
): void {
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
        requestId,
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

export function getResponseRequestId(
    originalRequest: InternalAxiosRequestConfig | undefined,
): string | undefined {
    const requestIdHeader = originalRequest?.headers?.get?.(REQUEST_ID_HEADER)
        || originalRequest?.headers?.get?.('x-request-id');
    return typeof requestIdHeader === 'string' ? requestIdHeader : undefined;
}

export function logUnauthorizedResponse(
    status: number | undefined,
    path: string | undefined,
    requestId: string | undefined,
    detailText: string | undefined,
    refreshAttempt: 'skipped' | 'attempted',
    refreshMode: 'fresh' | 'in_flight' | 'cooldown' | 'not_applicable' | 'unknown',
): void {
    if (status !== 401 || !AUTH_DEBUG_ENABLED) return;
    console.warn('[API] 401 Unauthorized - Token missing, expired, or invalid', {
        path,
        requestId,
        detail: detailText,
        refreshAttempt,
        refreshMode,
    });
}
