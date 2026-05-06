import {
    useCallback,
    useEffect,
    useRef,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from 'react';

import {
    formatOfflineDatabaseErrorMessage,
    type OfflineDatabaseMetadata,
} from '../../utils/offlineDatabase';
import {
    persistStoredOfflineDatabaseMetadata,
    runOfflineDatabaseTaskInBackground,
} from '../offlineDatabaseStorage';
import {
    OFFLINE_CHANNEL_NAME,
    primeOfflineShellCache,
} from '../offlineDatabaseSync';
import type {
    OfflineDatabaseChannelMessage,
    OfflineDatabaseInitResult,
    OfflineDatabaseStatus,
    OfflineDatabaseWorkerRequest,
    OfflineDatabaseWorkerResponse,
} from '../offlineDatabase.types';

type UseOfflineDatabaseBroadcastChannelArgs = {
    isSupported: boolean;
    instanceId: string;
    remoteMetaRef: MutableRefObject<OfflineDatabaseMetadata | null>;
    applyInstalledMetadata: (metadata: OfflineDatabaseMetadata | null) => void;
    initializeInstalledDatabase: (
        metadata?: OfflineDatabaseMetadata | null,
    ) => Promise<OfflineDatabaseInitResult>;
    resolveSyncWaiter: () => void;
    rejectSyncWaiter: (message: string) => void;
    sendToWorker: (
        request: OfflineDatabaseWorkerRequest,
        timeoutMs?: number,
    ) => Promise<OfflineDatabaseWorkerResponse>;
    setStatus: Dispatch<SetStateAction<OfflineDatabaseStatus>>;
    setProgress: Dispatch<SetStateAction<number>>;
    setProgressStep: Dispatch<SetStateAction<string>>;
    setError: Dispatch<SetStateAction<string | null>>;
    setLocalVersion: Dispatch<SetStateAction<string | null>>;
    setRemoteVersion: Dispatch<SetStateAction<string | null>>;
    setDbSizeBytes: Dispatch<SetStateAction<number | null>>;
};

export function useOfflineDatabaseBroadcastChannel({
    isSupported,
    instanceId,
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
}: UseOfflineDatabaseBroadcastChannelArgs) {
    const channelRef = useRef<BroadcastChannel | null>(null);

    const broadcast = useCallback((message: OfflineDatabaseChannelMessage) => {
        channelRef.current?.postMessage(message);
    }, []);

    useEffect(() => {
        if (!isSupported || typeof BroadcastChannel === 'undefined') return undefined;

        const channel = new BroadcastChannel(OFFLINE_CHANNEL_NAME);
        channelRef.current = channel;

        channel.onmessage = (event: MessageEvent<OfflineDatabaseChannelMessage>) => {
            const message = event.data;
            if (!message || message.senderId === instanceId) return;

            if (message.type === 'INSTALLING') {
                const nextStatus =
                    message.payload.mode === 'updating' ? 'updating' : 'installing';
                setStatus((current) => (current === 'ready' ? current : nextStatus));
                setProgress((current) => (current > 0 ? current : 5));
                setProgressStep('waiting_for_other_tab');
                return;
            }

            if (message.type === 'INSTALLED') {
                applyInstalledMetadata(message.payload.metadata);
                setProgress(95);
                setProgressStep('syncing_with_other_tab');
                runOfflineDatabaseTaskInBackground(
                    (async () => {
                        const result = await initializeInstalledDatabase(
                            message.payload.metadata,
                        );
                        await primeOfflineShellCache();
                        if (result.ok) {
                            resolveSyncWaiter();
                            return;
                        }

                        rejectSyncWaiter(result.error);
                    })(),
                );
                return;
            }

            if (message.type === 'REMOVED') {
                persistStoredOfflineDatabaseMetadata(null);
                setProgress(0);
                setProgressStep('');
                setRemoteVersion(remoteMetaRef.current?.version ?? null);
                runOfflineDatabaseTaskInBackground(
                    (async () => {
                        try {
                            await sendToWorker(
                                {
                                    type: 'REMOVE',
                                    id: null,
                                    payload: {},
                                },
                                10_000,
                            );
                            resolveSyncWaiter();
                        } catch (error) {
                            setStatus('not_installed');
                            setLocalVersion(null);
                            setDbSizeBytes(null);
                            setError(null);
                            rejectSyncWaiter(
                                formatOfflineDatabaseErrorMessage(
                                    error,
                                    'Falha ao remover o banco offline',
                                ),
                            );
                        }
                    })(),
                );
                return;
            }

            if (message.type === 'ERROR') {
                const normalizedError = formatOfflineDatabaseErrorMessage(
                    message.payload.message,
                );
                setError(normalizedError);
                rejectSyncWaiter(normalizedError);
            }
        };

        return () => {
            channel.close();
            channelRef.current = null;
        };
    }, [
        applyInstalledMetadata,
        initializeInstalledDatabase,
        instanceId,
        isSupported,
        rejectSyncWaiter,
        remoteMetaRef,
        resolveSyncWaiter,
        sendToWorker,
        setDbSizeBytes,
        setError,
        setLocalVersion,
        setProgress,
        setProgressStep,
        setRemoteVersion,
        setStatus,
    ]);

    return { broadcast };
}
