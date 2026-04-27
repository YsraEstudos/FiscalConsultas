import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';

import { formatOfflineDatabaseErrorMessage } from '../../utils/offlineDatabase';
import { useAuth } from '../AuthContext';
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
    const { getToken } = useAuth();
    const getTokenRef = useRef(getToken);
    const pendingRef = useRef<Map<string, PendingOfflineDatabaseRequest>>(new Map());
    const workerRef = useRef<Worker | null>(null);
    const [isWorkerReady, setIsWorkerReady] = useState(false);

    useEffect(() => {
        getTokenRef.current = getToken;
    }, [getToken]);

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

            if (type === 'REFRESH_TOKEN') {
                if (!id) {
                    console.warn('[LocalDatabase] REFRESH_TOKEN message missing id');
                    return;
                }
                getTokenRef.current({ skipCache: true })
                    .then((token) => {
                        workerRef.current?.postMessage({
                            type: 'TOKEN_RESPONSE',
                            id,
                            payload: { clerkToken: token ?? null },
                        });
                    })
                    .catch((err: unknown) => {
                        const errorDetails: {
                            message: string;
                            name?: string;
                            stack?: string;
                            value?: string;
                        } = err instanceof Error
                            ? {
                                message: err.message,
                                name: err.name,
                                stack: err.stack,
                            }
                            : {
                                message: 'Token refresh failed',
                                value: String(err),
                            };
                        workerRef.current?.postMessage({
                            type: 'TOKEN_RESPONSE',
                            id,
                            payload: {
                                error: errorDetails.message,
                                errorName: errorDetails.name,
                                errorStack: errorDetails.stack,
                                errorValue: errorDetails.value,
                            },
                        });
                    });
                return;
            }

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
            const normalizedError = formatOfflineDatabaseErrorMessage(
                `Worker error: ${event.message || 'unknown'}`,
            );
            setError(normalizedError);
            setStatus('error');
            for (const [, pending] of pendingRef.current) {
                clearTimeout(pending.timeout);
                pending.reject(new Error(normalizedError));
            }
            pendingRef.current.clear();
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
