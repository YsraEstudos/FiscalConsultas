import type {
    OfflineCatalogSearchResult,
    OfflineDatabaseWorkerMessage,
    OfflineDatabaseWorkerRequest,
    OfflineDatabaseWorkerResponse,
    PendingOfflineDatabaseRequest,
} from './offlineDatabase.types';

let fallbackOfflineDatabaseRequestCounter = 0;

export function createOfflineDatabaseWorkerRequestId(): string {
    fallbackOfflineDatabaseRequestCounter += 1;
    return `req_${fallbackOfflineDatabaseRequestCounter}_${Date.now()}`;
}

export function sendOfflineDatabaseWorkerRequest(
    worker: Worker | null,
    pendingRequests: Map<string, PendingOfflineDatabaseRequest>,
    request: OfflineDatabaseWorkerRequest,
    timeoutMs: number,
): Promise<OfflineDatabaseWorkerResponse> {
    return new Promise((resolve, reject) => {
        if (!worker) {
            reject(new Error('Worker not initialized'));
            return;
        }

        const effectiveRequest: OfflineDatabaseWorkerRequest & { id: string } = {
            ...request,
            id: request.id ?? createOfflineDatabaseWorkerRequestId(),
        };

        const timeout = setTimeout(() => {
            pendingRequests.delete(effectiveRequest.id);
            reject(new Error('Worker request timed out'));
        }, timeoutMs);

        pendingRequests.set(effectiveRequest.id, {
            resolve,
            reject,
            timeout,
        });

        worker.postMessage(effectiveRequest satisfies OfflineDatabaseWorkerMessage);
    });
}

export function isOfflineDatabaseWorkerReadyMessage(
    message: OfflineDatabaseWorkerResponse,
): boolean {
    return message.type === 'READY';
}

export function extractOfflineCatalogSearchResult(
    response: OfflineDatabaseWorkerResponse,
): OfflineCatalogSearchResult | null {
    if (response.type !== 'RESULT') return null;
    if (response.payload.results == null) return null;

    return {
        results: response.payload.results,
        searchType: response.payload.searchType ?? 'text',
        markdown: response.payload.markdown,
        timing: response.payload.timing,
    };
}

export function extractOfflineWorkerDetail<T>(
    response: OfflineDatabaseWorkerResponse,
): T | null {
    if (response.type !== 'RESULT') return null;
    return (response.payload.detail as T | null | undefined) ?? null;
}
