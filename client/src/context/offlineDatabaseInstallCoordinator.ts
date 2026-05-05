import {
    claimOfflineDatabaseInstallLease,
    OFFLINE_LEASE_HEARTBEAT_MS,
    OFFLINE_LOCK_KEY,
    readOfflineDatabaseInstallLease,
    refreshOfflineDatabaseInstallLease,
    releaseOfflineDatabaseInstallLease,
} from './offlineDatabaseStorage';

const WEB_LOCK_NAME = 'offline-db-install';
const FALLBACK_RECHECK_MS = 2_000;

export interface CoordinatedOfflineDatabaseInstallArgs {
    owner: string;
    runInstall: () => Promise<void>;
    waitForPeerInstall: () => Promise<void>;
    onWaitingForPeer: () => void;
}

type WebLockManager = {
    request: (
        name: string,
        options: { ifAvailable: true; mode: 'exclusive' },
        callback: (lock: unknown | null) => Promise<boolean>,
    ) => Promise<boolean>;
};

function getWebLockManager(): WebLockManager | null {
    const candidate = (globalThis.navigator as Navigator & {
        locks?: WebLockManager;
    }).locks;
    return typeof candidate?.request === 'function' ? candidate : null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function isLeaseRetriable(owner: string): boolean {
    const lease = readOfflineDatabaseInstallLease();
    return !lease || lease.owner === owner || lease.expiresAt <= Date.now();
}

async function waitUntilLeaseCanBeRetried(owner: string): Promise<void> {
    while (!isLeaseRetriable(owner)) {
        const lease = readOfflineDatabaseInstallLease();
        const delay = lease
            ? Math.min(FALLBACK_RECHECK_MS, Math.max(0, lease.expiresAt - Date.now()))
            : FALLBACK_RECHECK_MS;
        await sleep(delay);
    }
}

interface LeaseStorageChangeWaiter {
    promise: Promise<void>;
    cancel: () => void;
}

function waitForLeaseStorageChange(owner: string): LeaseStorageChangeWaiter {
    if (typeof window === 'undefined') {
        return {
            promise: new Promise(() => undefined),
            cancel: () => undefined,
        };
    }

    let onStorage: ((event: StorageEvent) => void) | null = null;
    const promise = new Promise<void>((resolve) => {
        onStorage = (event: StorageEvent) => {
            if (event.key !== OFFLINE_LOCK_KEY || !isLeaseRetriable(owner)) {
                return;
            }
            if (onStorage) {
                window.removeEventListener('storage', onStorage);
                onStorage = null;
            }
            resolve();
        };
        window.addEventListener('storage', onStorage);
    });

    return {
        promise,
        cancel: () => {
            if (!onStorage) return;
            window.removeEventListener('storage', onStorage);
            onStorage = null;
        },
    };
}

async function waitForPeerOrRetriableLease(
    owner: string,
    waitForPeerInstall: () => Promise<void>,
): Promise<'peer-installed' | 'lease-retry'> {
    const peerResult = waitForPeerInstall().then(
        () => 'peer-installed' as const,
        () => 'peer-failed' as const,
    );
    const storageWaiter = waitForLeaseStorageChange(owner);
    const leaseResult = Promise.race([
        waitUntilLeaseCanBeRetried(owner),
        storageWaiter.promise,
    ]).then(() => 'lease-retry' as const);

    try {
        const result = await Promise.race([peerResult, leaseResult]);
        if (result === 'peer-installed') return result;
        if (result === 'lease-retry') return result;

        await leaseResult;
        return 'lease-retry';
    } finally {
        storageWaiter.cancel();
    }
}

async function runWithFallbackLease({
    owner,
    runInstall,
    waitForPeerInstall,
    onWaitingForPeer,
}: CoordinatedOfflineDatabaseInstallArgs): Promise<void> {
    while (true) {
        const claim = claimOfflineDatabaseInstallLease(owner);
        if (!claim.acquired) {
            onWaitingForPeer();
            const result = await waitForPeerOrRetriableLease(
                owner,
                waitForPeerInstall,
            );
            if (result === 'peer-installed') return;
            continue;
        }

        const heartbeat = setInterval(() => {
            refreshOfflineDatabaseInstallLease(owner);
        }, OFFLINE_LEASE_HEARTBEAT_MS);

        try {
            await runInstall();
            return;
        } finally {
            clearInterval(heartbeat);
            releaseOfflineDatabaseInstallLease(owner);
        }
    }
}

async function runWithWebLock(
    args: CoordinatedOfflineDatabaseInstallArgs,
    locks: WebLockManager,
): Promise<void> {
    while (true) {
        const didInstall = await locks.request(
            WEB_LOCK_NAME,
            { ifAvailable: true, mode: 'exclusive' },
            async (lock) => {
                if (!lock) return false;
                await runWithFallbackLease(args);
                return true;
            },
        );

        if (didInstall) return;

        args.onWaitingForPeer();
        if (!readOfflineDatabaseInstallLease()) {
            await sleep(FALLBACK_RECHECK_MS);
            continue;
        }

        const result = await waitForPeerOrRetriableLease(
            args.owner,
            args.waitForPeerInstall,
        );
        if (result === 'peer-installed') return;
    }
}

export async function runCoordinatedOfflineDatabaseInstall(
    args: CoordinatedOfflineDatabaseInstallArgs,
): Promise<void> {
    const locks = getWebLockManager();
    if (locks) {
        await runWithWebLock(args, locks);
        return;
    }

    await runWithFallbackLease(args);
}
