import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import {
    compareOfflineVersions,
    type OfflineDatabaseMetadata,
} from '../utils/offlineDatabase';
import {
    buildOfflineDatabaseInitPayload,
    createOfflineDatabaseInstanceId,
    isOfflineDatabaseSupported,
    persistStoredOfflineDatabaseMetadata,
    readStoredOfflineDatabaseMetadata,
    runOfflineDatabaseTaskInBackground,
} from './offlineDatabaseStorage';
import {
    fetchOfflineDatabaseAvailabilityMetadata,
    getOfflineDatabaseApiBaseUrl,
    primeOfflineShellCache,
} from './offlineDatabaseSync';
import type {
    DbStatus,
    OfflineDatabaseWorkerRequest,
    OfflineDatabaseWorkerResponse,
} from './offlineDatabase.types';
import type { OfflineDatabaseOperationsArgs } from './offlineDatabaseOperations.shared';
import { useOfflineDatabaseBroadcastChannel } from './offlineDatabaseRuntime/useOfflineDatabaseBroadcastChannel';
import { useOfflineDatabaseSyncWaiter } from './offlineDatabaseRuntime/useOfflineDatabaseSyncWaiter';
import { useOfflineDatabaseWorkerBridge } from './offlineDatabaseRuntime/useOfflineDatabaseWorkerBridge';

export interface OfflineDatabaseRuntimeState {
    status: DbStatus;
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
    initializeInstalledDatabase: (metadata?: OfflineDatabaseMetadata | null) => Promise<void>;
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
        readStoredOfflineDatabaseMetadata(),
    );

    const [status, setStatus] = useState<DbStatus>(
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
            && status !== 'updating',
        [localVersion, remoteVersion, status],
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
            setLocalVersion(metadata.version);
            setRemoteVersion(metadata.version);
            setDbSizeBytes(metadata.size_bytes ?? null);
            setError(null);
        },
        [],
    );

    const initializeInstalledDatabase = useCallback(
        async (metadata?: OfflineDatabaseMetadata | null) => {
            if (!isWorkerReady) return;

            const initMetadata =
                metadata ?? remoteMetaRef.current ?? readStoredOfflineDatabaseMetadata();
            try {
                await sendToWorker(
                    {
                        type: 'INIT',
                        id: null,
                        payload: buildOfflineDatabaseInitPayload(initMetadata),
                    },
                    30_000,
                );
            } catch (err) {
                setStatus('error');
                setError(
                    err instanceof Error ? err.message : 'Falha ao carregar o banco local',
                );
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
                    const metadata = await fetchOfflineDatabaseAvailabilityMetadata(
                        getOfflineDatabaseApiBaseUrl(),
                    );
                    remoteMetaRef.current = metadata;
                    setRemoteVersion(metadata?.version ?? null);
                    setDbSizeBytes((current) => current ?? metadata?.size_bytes ?? null);
                    return metadata;
                } catch {
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
            sendToWorker: (
                request: OfflineDatabaseWorkerRequest,
                timeoutMs?: number,
            ): Promise<OfflineDatabaseWorkerResponse> => sendToWorker(request, timeoutMs),
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
