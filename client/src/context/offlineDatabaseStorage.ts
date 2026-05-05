import type { OfflineDatabaseMetadata } from '../utils/offlineDatabase';
import { sanitizeOfflineMetadata } from '../utils/offlineDatabase';

export const OFFLINE_META_KEY = 'offline-db:installed-meta';
export const OFFLINE_LOCK_KEY = 'offline-db:install-lock';
export const OFFLINE_LOCK_TTL_MS = 180_000;
export const OFFLINE_LEASE_HEARTBEAT_MS = 30_000;
export const OFFLINE_AUTO_INSTALL_OPT_OUT_KEY =
    'offline-db:auto-install-opt-out';

let fallbackOfflineDatabaseInstanceCounter = 0;

export interface OfflineDatabaseInstallLease {
    owner: string;
    attempt: number;
    startedAt: number;
    refreshedAt: number;
    expiresAt: number;
}

export interface OfflineDatabaseInstallLeaseClaim {
    acquired: boolean;
    lease: OfflineDatabaseInstallLease | null;
}

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
    const lease = readOfflineDatabaseInstallLease();
    if (!lease) return null;
    return {
        owner: lease.owner,
        expiresAt: lease.expiresAt,
    };
}

function normalizeOfflineDatabaseInstallLease(
    value: unknown,
): OfflineDatabaseInstallLease | null {
    if (!value || typeof value !== 'object') return null;

    const candidate = value as Partial<OfflineDatabaseInstallLease>;
    if (!candidate.owner || !candidate.expiresAt) return null;

    const now = Date.now();
    const expiresAt = Number(candidate.expiresAt);
    const startedAt = Number(candidate.startedAt ?? now);
    const refreshedAt = Number(candidate.refreshedAt ?? now);
    const attempt = Number(candidate.attempt ?? 1);

    if (
        !Number.isFinite(expiresAt)
        || !Number.isFinite(startedAt)
        || !Number.isFinite(refreshedAt)
        || !Number.isFinite(attempt)
    ) {
        return null;
    }

    return {
        owner: String(candidate.owner),
        attempt,
        startedAt,
        refreshedAt,
        expiresAt,
    };
}

export function readOfflineDatabaseInstallLease(): OfflineDatabaseInstallLease | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(OFFLINE_LOCK_KEY);
        if (!raw) return null;
        const parsed = normalizeOfflineDatabaseInstallLease(JSON.parse(raw));
        if (!parsed) return null;
        if (parsed.expiresAt <= Date.now()) {
            localStorage.removeItem(OFFLINE_LOCK_KEY);
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function claimOfflineDatabaseInstallLease(
    owner: string,
): OfflineDatabaseInstallLeaseClaim {
    if (typeof localStorage === 'undefined') {
        return { acquired: true, lease: null };
    }

    try {
        const previousRaw = localStorage.getItem(OFFLINE_LOCK_KEY);
        const previousLease = previousRaw
            ? normalizeOfflineDatabaseInstallLease(JSON.parse(previousRaw))
            : null;
        const current = readOfflineDatabaseInstallLease();
        if (current && current.owner !== owner) {
            return { acquired: false, lease: current };
        }

        const now = Date.now();
        const nextLease: OfflineDatabaseInstallLease = {
            owner,
            attempt: current?.owner === owner
                ? current.attempt
                : (previousLease?.attempt ?? 0) + 1,
            startedAt: current?.owner === owner ? current.startedAt : now,
            refreshedAt: now,
            expiresAt: now + OFFLINE_LOCK_TTL_MS,
        };

        localStorage.setItem(OFFLINE_LOCK_KEY, JSON.stringify(nextLease));
        const stored = readOfflineDatabaseInstallLease();
        return {
            acquired: stored?.owner === owner,
            lease: stored,
        };
    } catch {
        return { acquired: true, lease: null };
    }
}

export function setOfflineDatabaseInstallLock(owner: string): boolean {
    return claimOfflineDatabaseInstallLease(owner).acquired;
}

export function refreshOfflineDatabaseInstallLease(owner: string): boolean {
    if (typeof localStorage === 'undefined') return true;
    const current = readOfflineDatabaseInstallLease();
    if (current?.owner !== owner) return false;

    const now = Date.now();
    try {
        localStorage.setItem(
            OFFLINE_LOCK_KEY,
            JSON.stringify({
                ...current,
                refreshedAt: now,
                expiresAt: now + OFFLINE_LOCK_TTL_MS,
            }),
        );
        return readOfflineDatabaseInstallLease()?.owner === owner;
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

export function releaseOfflineDatabaseInstallLease(owner: string): void {
    clearOfflineDatabaseInstallLock(owner);
}

export function hasOfflineDatabaseAutoInstallOptOut(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
        return localStorage.getItem(OFFLINE_AUTO_INSTALL_OPT_OUT_KEY) === 'true';
    } catch {
        return false;
    }
}

export function setOfflineDatabaseAutoInstallOptOut(): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(OFFLINE_AUTO_INSTALL_OPT_OUT_KEY, 'true');
    } catch {
        // Ignore storage failures; auto-install remains the default.
    }
}

export function clearOfflineDatabaseAutoInstallOptOut(): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.removeItem(OFFLINE_AUTO_INSTALL_OPT_OUT_KEY);
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
