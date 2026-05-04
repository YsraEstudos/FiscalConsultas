import type { OfflineDatabaseMetadata } from '../utils/offlineDatabase';
import { sanitizeOfflineMetadata } from '../utils/offlineDatabase';

export const OFFLINE_META_KEY = 'offline-db:installed-meta';
export const OFFLINE_LOCK_KEY = 'offline-db:install-lock';
export const OFFLINE_LOCK_TTL_MS = 180_000;

let fallbackOfflineDatabaseInstanceCounter = 0;

export type OfflineDatabaseMissingFeature =
    | 'secure-context'
    | 'cross-origin-isolation'
    | 'shared-array-buffer'
    | 'worker'
    | 'web-crypto'
    | 'opfs';

export interface OfflineDatabaseSupportReport {
    supported: boolean;
    missingFeatures: OfflineDatabaseMissingFeature[];
    canRecoverWithIsolationReload: boolean;
    isSecureContext: boolean;
    crossOriginIsolated: boolean;
}

function isLocalhostLikeOrigin(): boolean {
    const hostname = globalThis.location?.hostname;
    return hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '[::1]';
}

export function getOfflineDatabaseSupportReport(): OfflineDatabaseSupportReport {
    const isSecureContext =
        globalThis.isSecureContext === true
        || (
            typeof globalThis.isSecureContext === 'undefined'
            && (
                globalThis.location?.protocol === 'https:'
                || isLocalhostLikeOrigin()
            )
        );
    const crossOriginIsolated = globalThis.crossOriginIsolated === true;
    const hasSharedArrayBuffer = typeof globalThis.SharedArrayBuffer !== 'undefined';
    const hasWorker = typeof globalThis.Worker !== 'undefined';
    const hasWebCrypto = typeof globalThis.crypto?.subtle !== 'undefined';
    const hasOpfs = typeof globalThis.navigator?.storage?.getDirectory === 'function';

    const missingFeatures: OfflineDatabaseMissingFeature[] = [];
    if (!isSecureContext) missingFeatures.push('secure-context');
    if (!crossOriginIsolated) missingFeatures.push('cross-origin-isolation');
    if (!hasSharedArrayBuffer) missingFeatures.push('shared-array-buffer');
    if (!hasWorker) missingFeatures.push('worker');
    if (!hasWebCrypto) missingFeatures.push('web-crypto');
    if (!hasOpfs) missingFeatures.push('opfs');

    const canRecoverWithIsolationReload =
        isSecureContext
        && !crossOriginIsolated
        && !hasSharedArrayBuffer
        && hasWorker
        && hasWebCrypto
        && hasOpfs
        && typeof globalThis.navigator?.serviceWorker !== 'undefined';

    return {
        supported: missingFeatures.length === 0,
        missingFeatures,
        canRecoverWithIsolationReload,
        isSecureContext,
        crossOriginIsolated,
    };
}

export function isOfflineDatabaseSupported(): boolean {
    return getOfflineDatabaseSupportReport().supported;
}

export function readStoredOfflineDatabaseMetadata(): OfflineDatabaseMetadata | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        return sanitizeOfflineMetadata(
            JSON.parse(localStorage.getItem(OFFLINE_META_KEY) || 'null'),
        );
    } catch {
        return null;
    }
}

export function persistStoredOfflineDatabaseMetadata(
    metadata: OfflineDatabaseMetadata | null,
): void {
    if (typeof localStorage === 'undefined') return;
    try {
        if (!metadata) {
            localStorage.removeItem(OFFLINE_META_KEY);
            return;
        }
        localStorage.setItem(OFFLINE_META_KEY, JSON.stringify(metadata));
    } catch {
        // Ignore storage failures. The worker state remains authoritative.
    }
}

export function getOfflineDatabaseInstallLock(): {
    owner: string;
    expiresAt: number;
} | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(OFFLINE_LOCK_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.owner || !parsed?.expiresAt) return null;
        if (Number(parsed.expiresAt) <= Date.now()) {
            localStorage.removeItem(OFFLINE_LOCK_KEY);
            return null;
        }
        return {
            owner: String(parsed.owner),
            expiresAt: Number(parsed.expiresAt),
        };
    } catch {
        return null;
    }
}

export function setOfflineDatabaseInstallLock(owner: string): boolean {
    if (typeof localStorage === 'undefined') return true;
    try {
        const nextValue = JSON.stringify({
            owner,
            expiresAt: Date.now() + OFFLINE_LOCK_TTL_MS,
        });
        localStorage.setItem(OFFLINE_LOCK_KEY, nextValue);
        return getOfflineDatabaseInstallLock()?.owner === owner;
    } catch {
        return true;
    }
}

export function clearOfflineDatabaseInstallLock(owner: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
        const current = getOfflineDatabaseInstallLock();
        if (!current || current.owner === owner) {
            localStorage.removeItem(OFFLINE_LOCK_KEY);
        }
    } catch {
        // Ignore storage failures.
    }
}

export function buildOfflineDatabaseInitPayload(
    metadata: OfflineDatabaseMetadata | null | undefined,
): {
    chunkSize: number;
    pbkdf2Iterations: number;
} {
    return {
        chunkSize: metadata?.chunk_size || 65536,
        pbkdf2Iterations: metadata?.pbkdf2_iterations || 600000,
    };
}

export function runOfflineDatabaseTaskInBackground(task: Promise<unknown>): void {
    task.catch(() => undefined);
}

export function createOfflineDatabaseInstanceId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return `offline-db-${globalThis.crypto.randomUUID()}`;
    }

    fallbackOfflineDatabaseInstanceCounter += 1;
    return `offline-db-${Date.now()}-${fallbackOfflineDatabaseInstanceCounter}`;
}
