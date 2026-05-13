import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import {
    compareOfflineVersions,
    formatOfflineDatabaseErrorMessage,
    isOfflineSourceMetadata,
    type OfflineDatabaseMetadata,
} from '../utils/offlineDatabase';
import {
    buildOfflineDatabaseInitPayload,
    createOfflineDatabaseInstanceId,
    getOfflineDatabaseSupportReport,
    persistStoredOfflineDatabaseMetadata,
    persistStoredOfflineSourceMetadata,
    readStoredOfflineDatabaseMetadata,
    runOfflineDatabaseTaskInBackground,
    type OfflineDatabaseSupportReport,
} from './offlineDatabaseStorage';
import {
    fetchFiscalR2DatabaseAvailabilityMetadata,
    getMissingStaticOfflineDatabaseConfig,
    getFiscalR2BaseUrl,
    getOfflineDbPublicSeed,
    primeOfflineShellCache,
} from './offlineDatabaseSync';
import type {
    OfflineDatabaseInitResult,
    OfflineDatabaseStatus,
} from './offlineDatabase.types';
import type { OfflineDatabaseOperationsArgs } from './offlineDatabaseOperations.shared';
import { useOfflineDatabaseBroadcastChannel } from './offlineDatabaseRuntime/useOfflineDatabaseBroadcastChannel';
import { useOfflineDatabaseSyncWaiter } from './offlineDatabaseRuntime/useOfflineDatabaseSyncWaiter';
import { useOfflineDatabaseWorkerBridge } from './offlineDatabaseRuntime/useOfflineDatabaseWorkerBridge';
import { useAuth } from './AuthContext';

function readInitialOfflineMetadata(): OfflineDatabaseMetadata | null {
    if (getFiscalR2BaseUrl() && getOfflineDbPublicSeed()) {
        return readStoredOfflineDatabaseMetadata();
    }

    return readStoredOfflineDatabaseMetadata();
}

export interface OfflineDatabaseRuntimeState {
    status: OfflineDatabaseStatus;
    progress: number;
    progressStep: string;
    localVersion: string | null;
    remoteVersion: string | null;
    updateAvailable: boolean;
    error: string | null;
    dbSizeBytes: number | null;
    isSupported: boolean;
    supportReport: OfflineDatabaseSupportReport;
    isRemoving: boolean;
}

export interface OfflineDatabaseRuntimeActions extends OfflineDatabaseOperationsArgs {
    initializeInstalledDatabase: (
        metadata?: OfflineDatabaseMetadata | null,
    ) => Promise<OfflineDatabaseInitResult>;
}

export interface OfflineDatabaseRuntimeValue {
    state: OfflineDatabaseRuntimeState;
    actions: OfflineDatabaseRuntimeActions;
}

export function useOfflineDatabaseRuntime(): OfflineDatabaseRuntimeValue {
    const { userId, isLoading } = useAuth();
    const supportReport = useMemo(() => getOfflineDatabaseSupportReport(), []);
    const isSupported = supportReport.supported;
    const instanceIdRef = useRef(createOfflineDatabaseInstanceId());
    const remoteCheckRef = useRef<Promise<OfflineDatabaseMetadata | null> | null>(null);
    const remoteMetaRef = useRef<OfflineDatabaseMetadata | null>(
        readInitialOfflineMetadata(),
    );

    const [status, setStatus] = useState<OfflineDatabaseStatus>(
        isSupported || supportReport.canRecoverWithIsolationReload
            ? 'checking'
            : 'unsupported',
    );
    const [progress, setProgress] = useState(0);
    const [progressStep, setProgressStep] = useState('');
    const [localVersion, setLocalVersion] = useState<string | null>(
        remoteMetaRef.current?.version ?? null,
    );
    const [remoteVersion, setRemoteVersion] = useState<string | null>(
        remoteMetaRef.current?.version ?? null,
    );
    const [error, setError] = useState<string | null>(null);
    const [dbSizeBytes, setDbSizeBytes] = useState<number | null>(
        remoteMetaRef.current?.size_bytes ?? null,
    );
    const [isRemoving, setIsRemoving] = useState(false);

    const updateAvailable = useMemo(
        () =>
            compareOfflineVersions(remoteVersion, localVersion) > 0
            && status !== 'installing'
            && status !== 'updating'
            && !isRemoving,
        [isRemoving, localVersion, remoteVersion, status],
    );

    const {
        waitForOtherTabSync,
        resolveSyncWaiter,
        rejectSyncWaiter,
    } = useOfflineDatabaseSyncWaiter();

    const {
        isWorkerReady,
        sendToWorker,
    } = useOfflineDatabaseWorkerBridge({
        isSupported,
        setStatus,
        setProgress,
        setProgressStep,
        setError,
        setLocalVersion,
        setDbSizeBytes,
    });

    const applyInstalledMetadata = useCallback(
        (metadata: OfflineDatabaseMetadata | null) => {
            if (!metadata) return;
            remoteMetaRef.current = metadata;
            if (isOfflineSourceMetadata(metadata)) {
                persistStoredOfflineSourceMetadata(
                    metadata.source,
                    metadata,
                );
            } else {
                persistStoredOfflineDatabaseMetadata(metadata);
            }
            setLocalVersion(metadata.version);
            setRemoteVersion(metadata.version);
            setDbSizeBytes(metadata.size_bytes ?? null);
            setError(null);
        },
        [],
    );

    const initializeInstalledDatabase = useCallback(
        async (metadata?: OfflineDatabaseMetadata | null): Promise<OfflineDatabaseInitResult> => {
            if (!isWorkerReady) {
                return { ok: false, error: 'Worker not ready' };
            }

            const initMetadata =
                metadata ?? remoteMetaRef.current ?? readStoredOfflineDatabaseMetadata();
            try {
                // BUG-3 fix: seed is NO LONGER read from sessionStorage here.
                // The worker reads it directly from OPFS via readSeed(userId),
                // where it is stored encrypted with user-scoped AES-GCM.
                const publicSeed = getOfflineDbPublicSeed();
                await sendToWorker(
                    {
                        type: 'INIT',
                        id: null,
                        payload: {
                            ...buildOfflineDatabaseInitPayload(initMetadata),
                            userId,
                            publicSeed: publicSeed || undefined,
                        },
                    },
                    30_000,
                );
                return { ok: true };
            } catch (err) {
                const message = formatOfflineDatabaseErrorMessage(
                    err,
                    'Falha ao carregar o banco local',
                );
                setStatus('error');
                setError(message);
                return { ok: false, error: message };
            }
        },
        [isWorkerReady, sendToWorker, userId],
    );


    const refreshOfflineDatabaseAvailability = useCallback(
        async (force = false): Promise<OfflineDatabaseMetadata | null> => {
            if (!isSupported) return null;
            if (!force && remoteCheckRef.current) {
                return remoteCheckRef.current;
            }

            const request = (async () => {
                try {
                    const r2BaseUrl = getFiscalR2BaseUrl();
                    const missingStaticConfig = getMissingStaticOfflineDatabaseConfig();
                    if (missingStaticConfig.length > 0) {
                        throw new Error(
                            `Configuração de bundles fiscais R2 incompleta: ${missingStaticConfig.join(', ')}.`,
                        );
                    }
                    const metadata = await fetchFiscalR2DatabaseAvailabilityMetadata(
                        r2BaseUrl,
                    );
                    remoteMetaRef.current = metadata;
                    if (metadata) {
                        persistStoredOfflineDatabaseMetadata(metadata);
                    }
                    setRemoteVersion(metadata?.version ?? null);
                    setDbSizeBytes((current) => current ?? metadata?.size_bytes ?? null);
                    return metadata;
                } catch (err) {
                    console.warn(
                        'fetchOfflineDatabaseAvailabilityMetadata failed',
                        err,
                    );
                    return remoteMetaRef.current;
                }
            })();

            remoteCheckRef.current = request;
            const metadata = await request;
            if (remoteCheckRef.current === request) {
                remoteCheckRef.current = null;
            }
            return metadata;
        },
        [isSupported],
    );

    const { broadcast } = useOfflineDatabaseBroadcastChannel({
        isSupported,
        instanceId: instanceIdRef.current,
        remoteMetaRef,
        applyInstalledMetadata,
        initializeInstalledDatabase,
        resolveSyncWaiter,
        rejectSyncWaiter,
        sendToWorker,
        setStatus,
        setProgress,
        setProgressStep,
        setError,
        setLocalVersion,
        setRemoteVersion,
        setDbSizeBytes,
    });

    useEffect(() => {
        if (!isSupported || !isWorkerReady) return;

        runOfflineDatabaseTaskInBackground(initializeInstalledDatabase());
        runOfflineDatabaseTaskInBackground(primeOfflineShellCache());
    }, [
        initializeInstalledDatabase,
        isSupported,
        isWorkerReady,
    ]);

    // Wipe in-memory seed and close DB on logout.
    // We use a ref to track whether the user was previously signed in so that
    // WIPE_SEED only fires on a real logout transition (signed-in → signed-out)
    // and not on the initial Clerk hydration frame where userId is still null.
    const wasSignedInRef = useRef(false);
    useEffect(() => {
        if (!isLoading && userId) {
            wasSignedInRef.current = true;
        }
        if (!isLoading && !userId && wasSignedInRef.current && isWorkerReady
            && status !== 'not_installed' && status !== 'unsupported') {
            wasSignedInRef.current = false;
            runOfflineDatabaseTaskInBackground(
                sendToWorker({ type: 'WIPE_SEED', id: null, payload: {} }, 5000)
            );
            setStatus('not_installed');
            setLocalVersion(null);
        }
    }, [isLoading, userId, isWorkerReady, status, sendToWorker]);

    const state = useMemo<OfflineDatabaseRuntimeState>(
        () => ({
            status,
            progress,
            progressStep,
            localVersion,
            remoteVersion,
            updateAvailable,
            error,
            dbSizeBytes,
            isSupported,
            supportReport,
            isRemoving,
        }),
        [
            dbSizeBytes,
            error,
            isRemoving,
            isSupported,
            supportReport,
            localVersion,
            progress,
            progressStep,
            remoteVersion,
            status,
            updateAvailable,
        ],
    );

    const actions = useMemo<OfflineDatabaseRuntimeActions>(
        () => ({
            isSupported,
            status,
            localVersion,
            remoteVersion,
            userId,
            instanceId: instanceIdRef.current,
            remoteMetadataRef: remoteMetaRef,
            broadcast,
            waitForOtherTabSync,
            sendToWorker,
            refreshOfflineDatabaseAvailability,
            applyInstalledMetadata,
            setStatus,
            setProgress,
            setProgressStep,
            setError,
            setLocalVersion,
            setRemoteVersion,
            setDbSizeBytes,
            setIsRemoving,
            initializeInstalledDatabase,
        }),
        [
            applyInstalledMetadata,
            broadcast,
            initializeInstalledDatabase,
            isSupported,
            localVersion,
            refreshOfflineDatabaseAvailability,
            remoteVersion,
            userId,
            sendToWorker,
            status,
            waitForOtherTabSync,
        ],
    );

    return { state, actions };
}
