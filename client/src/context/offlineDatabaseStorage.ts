import type { FiscalSourceId } from './offlineSources';
import type { OfflineDatabaseMetadata } from '../utils/offlineDatabase';
import {
    sanitizeOfflineMetadata,
    sanitizeOfflineSourceMetadata,
    type OfflineSourceMetadata,
} from '../utils/offlineDatabase';

export const OFFLINE_META_KEY = 'offline-db:installed-meta';
export const OFFLINE_SOURCE_META_KEY_PREFIX = 'offline_fiscal_metadata:';
export const OFFLINE_LOCK_KEY = 'offline-db:install-lock';
export const OFFLINE_LOCK_TTL_MS = 180_000;

let fallbackOfflineDatabaseInstanceCounter = 0;

export function isOfflineDatabaseSupported(): boolean {
    if (typeof SharedArrayBuffer === 'undefined') return false;
    if (typeof Worker === 'undefined') return false;
    if (typeof crypto?.subtle === 'undefined') return false;
    if (typeof navigator?.storage?.getDirectory !== 'function') return false;
    return true;
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

function getOfflineSourceMetadataKey(source: FiscalSourceId): string {
    return `${OFFLINE_SOURCE_META_KEY_PREFIX}${source}`;
}

export function readStoredOfflineSourceMetadata(
    source: FiscalSourceId,
): OfflineSourceMetadata | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        return sanitizeOfflineSourceMetadata(
            source,
            JSON.parse(localStorage.getItem(getOfflineSourceMetadataKey(source)) || 'null'),
        );
    } catch {
        return null;
    }
}

export function persistStoredOfflineSourceMetadata(
    source: FiscalSourceId,
    metadata: OfflineSourceMetadata | null,
): void {
    if (typeof localStorage === 'undefined') return;
    try {
        if (!metadata) {
            localStorage.removeItem(getOfflineSourceMetadataKey(source));
            return;
        }
        const sanitized = sanitizeOfflineSourceMetadata(source, metadata);
        if (!sanitized) {
            localStorage.removeItem(getOfflineSourceMetadataKey(source));
            return;
        }
        localStorage.setItem(
            getOfflineSourceMetadataKey(source),
            JSON.stringify(sanitized),
        );
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
