import { API_BASE_URL } from '../services/api';
import { sanitizeOfflineMetadata, type OfflineDatabaseMetadata } from '../utils/offlineDatabase';

export const OFFLINE_CHANNEL_NAME = 'offline-db-channel';
export const OFFLINE_WAIT_TIMEOUT_MS = 240_000;

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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

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
