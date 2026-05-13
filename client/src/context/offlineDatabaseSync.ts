import { API_BASE_URL } from '../services/api';
import {
    sanitizeOfflineMetadata,
    sanitizeOfflineSourceMetadata,
    type OfflineDatabaseMetadata,
    type OfflineSourceMetadata,
} from '../utils/offlineDatabase';
import {
    buildFiscalOfflineDatabaseUrls,
    buildFiscalBundleUrls,
    normalizeFiscalR2BaseUrl,
    type FiscalSourceId,
} from './offlineSources';

export const OFFLINE_CHANNEL_NAME = 'offline-db-channel';
export const OFFLINE_WAIT_TIMEOUT_MS = 240_000;
const OFFLINE_METADATA_TIMEOUTS_MS = [4_000, 10_000, 20_000] as const;
const BUNDLED_FISCAL_BASE_PATH = 'fiscal-bases';

export interface FiscalR2DatabaseAvailability {
    metadata: OfflineDatabaseMetadata | null;
    r2BaseUrl: string;
}

export function getOfflineDatabaseApiBaseUrl(): string {
    return API_BASE_URL;
}

export function getFiscalR2BaseUrl(): string {
    const env = import.meta.env as { VITE_FISCAL_R2_BASE_URL?: string | undefined };
    return normalizeFiscalR2BaseUrl(env.VITE_FISCAL_R2_BASE_URL);
}

export function getBundledFiscalR2BaseUrl(): string {
    const env = import.meta.env as { BASE_URL?: string | undefined };
    const basePath = env.BASE_URL || '/';
    const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`;

    if (typeof window === 'undefined') {
        return normalizeFiscalR2BaseUrl(`${normalizedBasePath}${BUNDLED_FISCAL_BASE_PATH}`);
    }

    return normalizeFiscalR2BaseUrl(
        new URL(
            `${normalizedBasePath}${BUNDLED_FISCAL_BASE_PATH}`,
            window.location.origin,
        ).toString(),
    );
}

export function getOfflineDbPublicSeed(): string {
    const env = import.meta.env as { VITE_OFFLINE_DB_PUBLIC_SEED?: string | undefined };
    return (env.VITE_OFFLINE_DB_PUBLIC_SEED || '').trim();
}

export function getMissingStaticOfflineDatabaseConfig(): string[] {
    const missing: string[] = [];
    if (!getOfflineDbPublicSeed()) missing.push('VITE_OFFLINE_DB_PUBLIC_SEED');
    return missing;
}

export function assertStaticOfflineDatabaseConfig(): void {
    const missing = getMissingStaticOfflineDatabaseConfig();
    if (missing.length > 0) {
        throw new Error(
            `Configuração de bundles fiscais R2 incompleta: ${missing.join(', ')}.`,
        );
    }
}

export async function fetchAvailableFiscalR2DatabaseMetadata(
    r2BaseUrls = [getFiscalR2BaseUrl(), getBundledFiscalR2BaseUrl()],
): Promise<FiscalR2DatabaseAvailability> {
    const candidates = [...new Set(
        r2BaseUrls
            .map((baseUrl) => normalizeFiscalR2BaseUrl(baseUrl))
            .filter(Boolean),
    )];
    let lastError: unknown = null;

    for (const r2BaseUrl of candidates) {
        try {
            const metadata = await fetchFiscalR2DatabaseAvailabilityMetadata(r2BaseUrl);
            if (metadata) {
                return { metadata, r2BaseUrl };
            }
        } catch (err) {
            lastError = err;
        }
    }

    if (lastError) {
        throw lastError instanceof Error
            ? lastError
            : new Error('R2 metadata check failed for an unknown reason');
    }

    return {
        metadata: null,
        r2BaseUrl: candidates[0] ?? '',
    };
}

export async function fetchOfflineSourceAvailabilityMetadata(
    r2BaseUrl: string,
    source: FiscalSourceId,
): Promise<OfflineSourceMetadata | null> {
    let lastError: unknown = null;
    for (const timeoutMs of OFFLINE_METADATA_TIMEOUTS_MS) {
        try {
            return await fetchOfflineSourceAvailabilityMetadataOnce(
                r2BaseUrl,
                source,
                timeoutMs,
            );
        } catch (err) {
            lastError = err;
            if (!isRetryableOfflineMetadataError(err)) break;
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error('Source metadata check failed for an unknown reason');
}

export async function fetchFiscalR2DatabaseAvailabilityMetadata(
    r2BaseUrl: string,
): Promise<OfflineDatabaseMetadata | null> {
    let lastError: unknown = null;
    for (const timeoutMs of OFFLINE_METADATA_TIMEOUTS_MS) {
        try {
            return await fetchFiscalR2DatabaseAvailabilityMetadataOnce(
                r2BaseUrl,
                timeoutMs,
            );
        } catch (err) {
            lastError = err;
            if (!isRetryableOfflineMetadataError(err)) break;
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error('R2 metadata check failed for an unknown reason');
}

async function fetchFiscalR2DatabaseAvailabilityMetadataOnce(
    r2BaseUrl: string,
    timeoutMs: number,
): Promise<OfflineDatabaseMetadata | null> {
    const { metadataUrl } = buildFiscalOfflineDatabaseUrls(r2BaseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(metadataUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error(`R2 metadata check failed (${response.status})`);
        }

        const metadata = sanitizeOfflineMetadata(await response.json());
        return metadata?.encrypted_sha256?.trim() ? metadata : null;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchOfflineSourceAvailabilityMetadataOnce(
    r2BaseUrl: string,
    source: FiscalSourceId,
    timeoutMs: number,
): Promise<OfflineSourceMetadata | null> {
    const { metadataUrl } = buildFiscalBundleUrls(r2BaseUrl, source);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(metadataUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error(`Source metadata check failed (${response.status})`);
        }

        return sanitizeOfflineSourceMetadata(source, await response.json());
    } finally {
        clearTimeout(timer);
    }
}

export async function fetchEncryptedFiscalBundle(
    r2BaseUrl: string,
    source: FiscalSourceId,
): Promise<Response> {
    const { encryptedUrl } = buildFiscalBundleUrls(r2BaseUrl, source);
    const response = await fetch(encryptedUrl, {
        method: 'GET',
        headers: { Accept: 'application/octet-stream' },
    });

    if (!response.ok) {
        throw new Error(`Source bundle download failed (${response.status})`);
    }

    return response;
}

export async function primeOfflineShellCache(): Promise<void> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        return;
    }

    const urls = new Set<string>([
        globalThis.location.pathname,
        globalThis.location.origin,
        globalThis.location.href,
    ]);

    if (typeof document !== 'undefined') {
        const scriptElements = document.querySelectorAll<HTMLScriptElement>('script[src]');
        const linkElements = document.querySelectorAll<HTMLLinkElement>(
            'link[rel="stylesheet"][href], link[rel="modulepreload"][href]',
        );

        scriptElements.forEach((element) => {
            if (!element.src) return;
            urls.add(new URL(element.src, globalThis.location.href).toString());
        });
        linkElements.forEach((element) => {
            if (!element.href) return;
            urls.add(new URL(element.href, globalThis.location.href).toString());
        });
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
            type: 'CACHE_APP_SHELL',
            payload: {
                urls: [...urls],
            },
        });
    } catch {
        // Ignore service worker readiness issues and keep the offline DB flow working.
    }
}

export async function fetchOfflineDatabaseAvailabilityMetadata(
    apiBaseUrl: string,
): Promise<OfflineDatabaseMetadata | null> {
    let lastError: unknown = null;
    for (const timeoutMs of OFFLINE_METADATA_TIMEOUTS_MS) {
        try {
            return await fetchOfflineDatabaseAvailabilityMetadataOnce(
                apiBaseUrl,
                timeoutMs,
            );
        } catch (err) {
            lastError = err;
            if (!isRetryableOfflineMetadataError(err)) break;
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error('Version check failed for an unknown reason');
}

async function fetchOfflineDatabaseAvailabilityMetadataOnce(
    apiBaseUrl: string,
    timeoutMs: number,
): Promise<OfflineDatabaseMetadata | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${apiBaseUrl}/database/version`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Version check failed (${response.status})`);
        }

        return sanitizeOfflineMetadata(await response.json());
    } finally {
        clearTimeout(timer);
    }
}

function isRetryableOfflineMetadataError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const name = String((err as { name?: unknown }).name ?? '');
    const message = String((err as { message?: unknown }).message ?? '');
    if (name === 'AbortError' || name === 'TimeoutError') return true;
    return message.includes('Failed to fetch') || message.includes('NetworkError');
}
