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
    isOfflineDatabaseSupported,
    persistStoredOfflineDatabaseMetadata,
    persistStoredOfflineSourceMetadata,
    readStoredOfflineDatabaseMetadata,
    readStoredOfflineSourceMetadata,
    runOfflineDatabaseTaskInBackground,
} from './offlineDatabaseStorage';
import {
    fetchOfflineSourceAvailabilityMetadata,
    fetchOfflineDatabaseAvailabilityMetadata,
    getFiscalR2BaseUrl,
    getOfflineDbPublicSeed,
    getOfflineDatabaseApiBaseUrl,
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

const LEGACY_MONOLITHIC_BUNDLE_SOURCE = 'nesh';

function readInitialOfflineMetadata(): OfflineDatabaseMetadata | null {
    if (getFiscalR2BaseUrl() && getOfflineDbPublicSeed()) {
        return readStoredOfflineSourceMetadata(LEGACY_MONOLITHIC_BUNDLE_SOURCE);
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
    const isSupported = useMemo(() => isOfflineDatabaseSupported(), []);
    const instanceIdRef = useRef(createOfflineDatabaseInstanceId());
    const remoteCheckRef = useRef<Promise<OfflineDatabaseMetadata | null> | null>(null);
    const remoteMetaRef = useRef<OfflineDatabaseMetadata | null>(
        readInitialOfflineMetadata(),
    );

    const [status, setStatus] = useState<OfflineDatabaseStatus>(
        isSupported ? 'checking' : 'unsupported',
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
            persistStoredOfflineDatabaseMetadata(metadata);
            if (isOfflineSourceMetadata(metadata)) {
                persistStoredOfflineSourceMetadata(
                    metadata.source,
                    metadata,
                );
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
                const seed = sessionStorage.getItem('offline_db_seed');
                const publicSeed = getOfflineDbPublicSeed();
                const sourcePayload =
                    publicSeed && isOfflineSourceMetadata(initMetadata)
                        ? {
                            source: initMetadata.source,
                            publicSeed,
                        }
                        : {};
                await sendToWorker(
                    {
                        type: 'INIT',
                        id: null,
                        payload: {
                            ...buildOfflineDatabaseInitPayload(initMetadata),
                            seed: seed || undefined,
                            ...sourcePayload,
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
        [isWorkerReady, sendToWorker],
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
                    const publicSeed = getOfflineDbPublicSeed();
                    const metadata = r2BaseUrl && publicSeed
                        ? await fetchOfflineSourceAvailabilityMetadata(
                            r2BaseUrl,
                            LEGACY_MONOLITHIC_BUNDLE_SOURCE,
                        )
                        : await fetchOfflineDatabaseAvailabilityMetadata(
                            getOfflineDatabaseApiBaseUrl(),
                        );
                    remoteMetaRef.current = metadata;
                    if (isOfflineSourceMetadata(metadata)) {
                        persistStoredOfflineSourceMetadata(metadata.source, metadata);
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
        runOfflineDatabaseTaskInBackground(
            refreshOfflineDatabaseAvailability(false),
        );
        runOfflineDatabaseTaskInBackground(primeOfflineShellCache());
    }, [
        initializeInstalledDatabase,
        isSupported,
        isWorkerReady,
        refreshOfflineDatabaseAvailability,
    ]);

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
            isRemoving,
        }),
        [
            dbSizeBytes,
            error,
            isRemoving,
            isSupported,
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
            sendToWorker,
            status,
            waitForOtherTabSync,
        ],
    );

    return { state, actions };
}
