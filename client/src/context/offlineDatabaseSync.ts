import { API_BASE_URL } from '../services/api';
import { sanitizeOfflineMetadata, type OfflineDatabaseMetadata } from '../utils/offlineDatabase';

export const OFFLINE_CHANNEL_NAME = 'offline-db-channel';
export const OFFLINE_WAIT_TIMEOUT_MS = 240_000;
const OFFLINE_METADATA_TIMEOUTS_MS = [4_000, 10_000, 20_000] as const;

export function getOfflineDatabaseApiBaseUrl(): string {
    return API_BASE_URL;
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
