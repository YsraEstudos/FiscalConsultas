import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';

import { formatOfflineDatabaseErrorMessage } from '../../utils/offlineDatabase';
import type {
    OfflineDatabaseStatus,
    OfflineDatabaseWorkerRequest,
    OfflineDatabaseWorkerResponse,
    PendingOfflineDatabaseRequest,
} from '../offlineDatabase.types';
import {
    isOfflineDatabaseWorkerReadyMessage,
    sendOfflineDatabaseWorkerRequest,
} from '../offlineDatabaseWorkerClient';

type UseOfflineDatabaseWorkerBridgeArgs = {
    isSupported: boolean;
    setStatus: Dispatch<SetStateAction<OfflineDatabaseStatus>>;
    setProgress: Dispatch<SetStateAction<number>>;
    setProgressStep: Dispatch<SetStateAction<string>>;
    setError: Dispatch<SetStateAction<string | null>>;
    setLocalVersion: Dispatch<SetStateAction<string | null>>;
    setDbSizeBytes: Dispatch<SetStateAction<number | null>>;
};

function resolvePendingWorkerRequest(
    pendingRequests: Map<string, PendingOfflineDatabaseRequest>,
    id: string | null,
    pending: PendingOfflineDatabaseRequest | undefined,
    response: OfflineDatabaseWorkerResponse,
): void {
    if (!id || !pending) return;
    clearTimeout(pending.timeout);
    pendingRequests.delete(id);
    pending.resolve(response);
}

function rejectPendingWorkerRequest(
    pendingRequests: Map<string, PendingOfflineDatabaseRequest>,
    id: string | null,
    pending: PendingOfflineDatabaseRequest | undefined,
    error: Error,
): void {
    if (!id || !pending) return;
    clearTimeout(pending.timeout);
    pendingRequests.delete(id);
    pending.reject(error);
}

function shouldResolveStatusRequest(status: OfflineDatabaseStatus): boolean {
    return status === 'ready' || status === 'not_installed';
}

export interface OfflineDatabaseWorkerBridgeValue {
    isWorkerReady: boolean;
    sendToWorker: (
        request: OfflineDatabaseWorkerRequest,
        timeoutMs?: number,
    ) => Promise<OfflineDatabaseWorkerResponse>;
}

export function useOfflineDatabaseWorkerBridge({
    isSupported,
    setStatus,
    setProgress,
    setProgressStep,
    setError,
    setLocalVersion,
    setDbSizeBytes,
}: UseOfflineDatabaseWorkerBridgeArgs): OfflineDatabaseWorkerBridgeValue {
    const pendingRef = useRef<Map<string, PendingOfflineDatabaseRequest>>(new Map());
    const workerRef = useRef<Worker | null>(null);
    const [isWorkerReady, setIsWorkerReady] = useState(false);

    const sendToWorker = useCallback(
        (
            request: OfflineDatabaseWorkerRequest,
            timeoutMs = 120_000,
        ): Promise<OfflineDatabaseWorkerResponse> =>
            sendOfflineDatabaseWorkerRequest(
                workerRef.current,
                pendingRef.current,
                request,
                timeoutMs,
            ),
        [],
    );

    const handleWorkerMessage = useCallback(
        (event: MessageEvent<OfflineDatabaseWorkerResponse>) => {
            const { type, id, payload } = event.data;
            const pending = id ? pendingRef.current.get(id) : undefined;

            if (type === 'PROGRESS') {
                setProgress(payload.progress ?? 0);
                setProgressStep(payload.step ?? '');
                return;
            }

            if (type === 'STATUS') {
                setStatus(payload.status);
                setLocalVersion(payload.version ?? null);
                setDbSizeBytes(payload.sizeBytes ?? null);
                if (payload.status === 'error') {
                    setError(formatOfflineDatabaseErrorMessage(payload.error));
                }
                if (payload.status === 'ready') {
                    setProgress(100);
                    setProgressStep('done');
                    setError(null);
                }
                if (shouldResolveStatusRequest(payload.status)) {
                    resolvePendingWorkerRequest(
                        pendingRef.current,
                        id,
                        pending,
                        event.data,
                    );
                }
                return;
            }

            if (type === 'RESULT') {
                resolvePendingWorkerRequest(
                    pendingRef.current,
                    id,
                    pending,
                    event.data,
                );
                return;
            }

            if (type === 'ERROR') {
                const normalizedError = formatOfflineDatabaseErrorMessage(payload.error);
                setError(normalizedError);
                setStatus('error');
                rejectPendingWorkerRequest(
                    pendingRef.current,
                    id,
                    pending,
                    new Error(normalizedError),
                );
            }
        },
        [
            setDbSizeBytes,
            setError,
            setLocalVersion,
            setProgress,
            setProgressStep,
            setStatus,
        ],
    );

    useEffect(() => {
        if (!isSupported) return undefined;

        const worker = new Worker(new URL('../../workers/db.worker.js', import.meta.url), {
            type: 'module',
        });

        workerRef.current = worker;
        setIsWorkerReady(false);
        worker.onmessage = handleWorkerMessage;
        worker.onerror = (event) => {
            setError(formatOfflineDatabaseErrorMessage(`Worker error: ${event.message}`));
            setStatus('error');
        };

        const readyListener = (event: MessageEvent<OfflineDatabaseWorkerResponse>) => {
            if (!isOfflineDatabaseWorkerReadyMessage(event.data)) return;
            worker.removeEventListener('message', readyListener as EventListener);
            setIsWorkerReady(true);
        };

        worker.addEventListener('message', readyListener as EventListener);

        return () => {
            setIsWorkerReady(false);
            worker.terminate();
            workerRef.current = null;
            for (const [, pending] of pendingRef.current) {
                clearTimeout(pending.timeout);
                pending.reject(new Error('Worker terminated'));
            }
            pendingRef.current.clear();
        };
    }, [handleWorkerMessage, isSupported, setError, setStatus]);

    return {
        isWorkerReady,
        sendToWorker,
    };
}
