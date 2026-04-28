import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

import {
    AUTH_DEBUG_ENABLED,
    getRequestPath,
    isPublicRoutePath,
    logAuthorizationAttached,
    logJwtDebug,
    logMissingRequestToken,
    logRequestTokenFailure,
    normalizeRequestPath,
} from './authLogging';
import type {
    AuthRefreshMode,
    AuthRetryRequestConfig,
    ClerkTokenGetter,
    ClerkTokenGetterOptions,
    RetryUnauthorizedResult,
} from './authTypes';

const CLERK_TOKEN_TEMPLATE = (import.meta.env.VITE_CLERK_TOKEN_TEMPLATE || '').trim() || undefined;
const AUTH_REFRESH_COOLDOWN_MS = 2500;
const AUTH_REFRESHABLE_401_DETAILS = new Set([
    'token invalido',
    'token invalido ou expirado',
    'token expirado',
    'expired token',
    'unauthorized',
    'invalid asaas webhook token',
]);

let clerkGetToken: ClerkTokenGetter | null = null;
let inFlightForcedRefreshPromise: Promise<string | null> | null = null;
let lastForcedRefreshAtMs = 0;

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

function canonicalizeAuthDetail(detail: string): string {
    return detail
        .normalize('NFD')
        .replaceAll(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replaceAll(/[.!?]+$/g, '')
        .replaceAll(/\s+/g, ' ')
        .trim();
}

function shouldAttemptAuthRefresh(detail?: string): boolean {
    if (!detail) return true;
    const normalized = canonicalizeAuthDetail(detail);

    if (
        normalized === 'token ausente'
        || normalized === 'missing token'
    ) {
        return false;
    }

    return AUTH_REFRESHABLE_401_DETAILS.has(normalized);
}

async function getForcedRefreshToken(path: string, reason: string): Promise<{
    token: string | null;
    options: ClerkTokenGetterOptions;
    mode: AuthRefreshMode;
}> {
    const options = buildTokenGetterOptions(true);
    if (!clerkGetToken) {
        return { token: null, options, mode: 'not_applicable' };
    }

    if (inFlightForcedRefreshPromise) {
        const token = await inFlightForcedRefreshPromise;
        return { token, options, mode: 'in_flight' };
    }

    const now = Date.now();
    if (lastForcedRefreshAtMs > 0 && (now - lastForcedRefreshAtMs) < AUTH_REFRESH_COOLDOWN_MS) {
        if (AUTH_DEBUG_ENABLED) {
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
        lastForcedRefreshAtMs = Date.now();
        return { token, options, mode: 'fresh' };
    } finally {
        inFlightForcedRefreshPromise = null;
    }
}

async function resolveRequestAuthorization(path: string): Promise<{
    token: string | null;
    options: ClerkTokenGetterOptions;
}> {
    const primaryOptions = buildTokenGetterOptions(false);
    if (!clerkGetToken) {
        return { token: null, options: primaryOptions };
    }

    let token = await clerkGetToken(primaryOptions);
    let options = primaryOptions;
    if (!token) {
        const fallback = await getForcedRefreshToken(
            path,
            'missing_token_in_request_interceptor',
        );
        token = fallback.token;
        options = fallback.options;
    }

    return { token, options };
}

export function registerClerkTokenGetter(getter: ClerkTokenGetter): void {
    clerkGetToken = getter;
}

export function unregisterClerkTokenGetter(): void {
    clerkGetToken = null;
}

export async function getRegisteredClerkToken(
    options: ClerkTokenGetterOptions = {},
): Promise<string | null> {
    if (!clerkGetToken) {
        return null;
    }

    return clerkGetToken({
        ...buildTokenGetterOptions(!!options.skipCache),
        ...options,
    });
}

export function isAuthGetterRegistered(): boolean {
    return !!clerkGetToken;
}

export function shouldAuthenticateRequest(isPublicRoute: boolean): boolean {
    return !!clerkGetToken && !isPublicRoute;
}

export async function attachAuthorizationHeader(
    config: InternalAxiosRequestConfig,
    normalizedPath: string,
    requestId: string,
): Promise<void> {
    try {
        const { token, options } = await resolveRequestAuthorization(normalizedPath);
        if (!token) {
            logMissingRequestToken(normalizedPath, requestId);
            return;
        }

        config.headers.set('Authorization', `Bearer ${token}`);
        logAuthorizationAttached(requestId, normalizedPath);
        logJwtDebug('request', normalizedPath, requestId, token, options);
    } catch (error) {
        logRequestTokenFailure(error);
    }
}

export function shouldRetryUnauthorizedRequest(
    status: number | undefined,
    originalRequest: AuthRetryRequestConfig | undefined,
    detailText: string | undefined,
): originalRequest is AuthRetryRequestConfig {
    return (
        status === 401
        && !!originalRequest
        && !originalRequest._retryAuth
        && !!clerkGetToken
        && shouldAttemptAuthRefresh(detailText)
    );
}

export async function retryUnauthorizedRequest(
    apiInstance: AxiosInstance,
    originalRequest: AuthRetryRequestConfig,
    detailText: string | undefined,
    requestId: string | undefined,
): Promise<RetryUnauthorizedResult> {
    const normalizedPath = normalizeRequestPath(getRequestPath(originalRequest.url));
    if (isPublicRoutePath(normalizedPath)) {
        return {
            response: null,
            refreshAttempt: 'skipped',
            refreshMode: 'not_applicable',
        };
    }

    originalRequest._retryAuth = true;
    let refresh: Awaited<ReturnType<typeof getForcedRefreshToken>> | null = null;

    try {
        refresh = await getForcedRefreshToken(
            normalizedPath,
            detailText || '401_without_detail',
        );
        if (!refresh.token) {
            return {
                response: null,
                refreshAttempt: 'attempted',
                refreshMode: refresh.mode,
            };
        }

        originalRequest.headers.set('Authorization', `Bearer ${refresh.token}`);
        logJwtDebug(
            'retry',
            normalizedPath,
            requestId || 'unknown',
            refresh.token,
            refresh.options,
        );
        return {
            response: await apiInstance.request(originalRequest),
            refreshAttempt: 'attempted',
            refreshMode: refresh.mode,
        };
    } catch (refreshError) {
        if (AUTH_DEBUG_ENABLED) {
            console.warn('[API] Failed to refresh token after 401:', refreshError);
        }
        return {
            response: null,
            refreshAttempt: 'attempted',
            refreshMode: refresh?.mode ?? 'unknown',
        };
    }
}
