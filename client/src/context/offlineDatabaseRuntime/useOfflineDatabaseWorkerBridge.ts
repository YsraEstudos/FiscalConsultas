import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';

import { getRegisteredClerkToken } from '../../services/api';
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

type OfflineDatabaseRefreshTokenResponsePayload = Extract<
    OfflineDatabaseWorkerRequest,
    { type: 'TOKEN_RESPONSE' }
>['payload'];

type OfflineDatabaseStatusResponse = Extract<
    OfflineDatabaseWorkerResponse,
    { type: 'STATUS' }
>;

type HandleWorkerStatusMessageArgs = Pick<
    UseOfflineDatabaseWorkerBridgeArgs,
    | 'setDbSizeBytes'
    | 'setError'
    | 'setLocalVersion'
    | 'setProgress'
    | 'setProgressStep'
    | 'setStatus'
> & {
    id: string | null;
    pending: PendingOfflineDatabaseRequest | undefined;
    pendingRequests: Map<string, PendingOfflineDatabaseRequest>;
    response: OfflineDatabaseWorkerResponse;
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

function buildTokenRefreshErrorPayload(err: unknown): OfflineDatabaseRefreshTokenResponsePayload {
    if (err instanceof Error) {
        return {
            error: err.message,
            errorName: err.name,
            errorStack: err.stack,
        };
    }

    return {
        error: 'Token refresh failed',
        errorValue: String(err),
    };
}

function handleRefreshTokenMessage(id: string | null, worker: Worker | null): void {
    if (!id) {
        console.warn('[LocalDatabase] REFRESH_TOKEN message missing id');
        return;
    }

    getRegisteredClerkToken({ skipCache: true })
        .then((token) => {
            worker?.postMessage({
                type: 'TOKEN_RESPONSE',
                id,
                payload: { clerkToken: token ?? null },
            });
        })
        .catch((err: unknown) => {
            worker?.postMessage({
                type: 'TOKEN_RESPONSE',
                id,
                payload: buildTokenRefreshErrorPayload(err),
            });
        });
}

function handleReadyStatus({
    setError,
    setProgress,
    setProgressStep,
}: Pick<
    UseOfflineDatabaseWorkerBridgeArgs,
    'setError' | 'setProgress' | 'setProgressStep'
>): void {
    setProgress(100);
    setProgressStep('done');
    setError(null);
    // BUG-3 fix: the seed must NOT be stored in plaintext sessionStorage.
    // It is already persisted encrypted in OPFS via saveSeed() (user-scoped
    // AES-GCM). A plaintext copy in sessionStorage can be trivially read by
    // any script in the same origin (XSS, extensions, DevTools).
}

function handleWorkerStatusMessage(
    payload: OfflineDatabaseStatusResponse['payload'],
    args: HandleWorkerStatusMessageArgs,
): void {
    const {
        id,
        pending,
        pendingRequests,
        response,
        setDbSizeBytes,
        setError,
        setLocalVersion,
        setProgress,
        setProgressStep,
        setStatus,
    } = args;

    setStatus(payload.status);
    setLocalVersion(payload.version ?? null);
    setDbSizeBytes(payload.sizeBytes ?? null);

    if (payload.status === 'error') {
        setError(formatOfflineDatabaseErrorMessage(payload.error));
    }

    if (payload.status === 'ready') {
        handleReadyStatus({ setError, setProgress, setProgressStep });
    }

    if (shouldResolveStatusRequest(payload.status)) {
        resolvePendingWorkerRequest(pendingRequests, id, pending, response);
    }
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

            if (type === 'REFRESH_TOKEN') {
                handleRefreshTokenMessage(id, workerRef.current);
                return;
            }

            if (type === 'PROGRESS') {
                setProgress(payload.progress ?? 0);
                setProgressStep(payload.step ?? '');
                return;
            }

            if (type === 'STATUS') {
                handleWorkerStatusMessage(payload, {
                    id,
                    pending,
                    pendingRequests: pendingRef.current,
                    response: event.data,
                    setDbSizeBytes,
                    setError,
                    setLocalVersion,
                    setProgress,
                    setProgressStep,
                    setStatus,
                });
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
