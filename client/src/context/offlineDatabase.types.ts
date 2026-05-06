import type {
    NbsCatalogDetailApiResponse,
} from '../types/api.types';
import type { FiscalSourceId } from './offlineSources';
import type { OfflineDatabaseMetadata } from '../utils/offlineDatabase';

export type OfflineDatabaseStatus =
    | 'checking'
    | 'not_installed'
    | 'installing'
    | 'ready'
    | 'updating'
    | 'error'
    | 'unsupported';

export type OfflineFiscalSourceId = FiscalSourceId;
export type OfflineLegacyDocumentType = 'ncm';
export type OfflineSearchDocumentType =
    | Exclude<OfflineFiscalSourceId, 'unspsc'>
    | OfflineLegacyDocumentType;
export type OfflineDocumentType = OfflineSearchDocumentType;

export interface OfflineDatabaseState {
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

export type OfflineDatabaseInitResult =
    | { ok: true }
    | { ok: false; error: string };

export interface OfflineCatalogSearchResult {
    results: Record<string, unknown>[] | Record<string, unknown> | null;
    searchType: 'text' | 'code';
    markdown?: string;
    timing?: {
        sqlDurationMs: number;
        totalDurationMs: number;
        cacheHit: boolean;
    };
}

export interface OfflineDatabaseContextValue extends OfflineDatabaseState {
    installOfflineDatabase: () => Promise<void>;
    removeOfflineDatabase: () => Promise<void>;
    refreshOfflineDatabaseAvailability: (
        force?: boolean,
    ) => Promise<OfflineDatabaseMetadata | null>;
    searchOfflineCatalog: (
        docType: OfflineDocumentType,
        query: string,
        viewMode?: string,
    ) => Promise<OfflineCatalogSearchResult | null>;
    fetchOfflineNeshChapterNotes: (
        chapter: string,
    ) => Promise<Record<string, string> | null>;
    fetchOfflineNbsCatalogDetail: (
        code: string,
        options?: { page?: number; pageSize?: number },
    ) => Promise<NbsCatalogDetailApiResponse | null>;


    // Legacy compatibility
    install: () => Promise<void>;
    remove: () => Promise<void>;
    refreshAvailability: (force?: boolean) => Promise<OfflineDatabaseMetadata | null>;
    searchLocal: (
        docType: OfflineDocumentType,
        query: string,
        viewMode?: string,
    ) => Promise<OfflineCatalogSearchResult | null>;
    getNeshChapterNotesLocal: (
        chapter: string,
    ) => Promise<Record<string, string> | null>;
    getNbsDetailLocal: (
        code: string,
        options?: { page?: number; pageSize?: number },
    ) => Promise<NbsCatalogDetailApiResponse | null>;
}

export interface PendingOfflineDatabaseRequest {
    resolve: (value: OfflineDatabaseWorkerResponse) => void;
    reject: (reason: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

export interface PendingOfflineDatabaseSyncWaiter {
    resolve: () => void;
    reject: (reason: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

export type OfflineDatabaseWorkerRequest =
    | {
        type: 'INIT';
        id: string | null;
        payload: { chunkSize: number; pbkdf2Iterations: number; seed?: string };
    }
    | {
        type: 'INSTALL';
        id: string | null;
        payload: { apiBase: string; clerkToken?: string | null };
    }
    | {
        type: 'TOKEN_RESPONSE';
        id: string;
        payload: {
            clerkToken?: string | null;
            error?: string;
            errorName?: string;
            errorStack?: string;
            errorValue?: string;
        };
    }
    | {
        type: 'REMOVE';
        id: string | null;
        payload: Record<string, never>;
    }
    | {
        type: 'SEARCH';
        id: string | null;
        payload: {
            docType: OfflineDocumentType;
            query: string;
            viewMode?: string;
        };
    }
    | {
        type: 'GET_NBS_DETAIL';
        id: string | null;
        payload: {
            code: string;
            page: number;
            pageSize: number;
        };
    };

export type OfflineDatabaseWorkerReadyMessage = {
    type: 'READY';
    id: null;
    payload: Record<string, never>;
};

export type OfflineDatabaseWorkerProgressMessage = {
    type: 'PROGRESS';
    id: string | null;
    payload: { progress?: number; step?: string };
};

export type OfflineDatabaseWorkerStatusMessage = {
    type: 'STATUS';
    id: string | null;
    payload: {
        status: OfflineDatabaseStatus;
        version?: string | null;
        sizeBytes?: number | null;
        error?: unknown;
        seed?: string;
    };
};

export type OfflineDatabaseWorkerResultMessage = {
    type: 'RESULT';
    id: string;
    payload: {
        results?: Record<string, unknown>[] | Record<string, unknown> | null;
        searchType?: 'text' | 'code';
        markdown?: string;
        timing?: OfflineCatalogSearchResult['timing'];
        detail?:
            | NbsCatalogDetailApiResponse
            | null;
    };
};

export type OfflineDatabaseWorkerErrorMessage = {
    type: 'ERROR';
    id: string | null;
    payload: { error?: unknown };
};

export type OfflineDatabaseWorkerRefreshTokenMessage = {
    type: 'REFRESH_TOKEN';
    id: string | null;
    payload: Record<string, never>;
};

export type OfflineDatabaseWorkerResponse =
    | OfflineDatabaseWorkerReadyMessage
    | OfflineDatabaseWorkerProgressMessage
    | OfflineDatabaseWorkerStatusMessage
    | OfflineDatabaseWorkerResultMessage
    | OfflineDatabaseWorkerErrorMessage
    | OfflineDatabaseWorkerRefreshTokenMessage;

export type OfflineDatabaseWorkerMessage =
    | OfflineDatabaseWorkerRequest
    | OfflineDatabaseWorkerResponse;

export type OfflineDatabaseChannelMessage =
    | {
        type: 'INSTALLING';
        source: OfflineFiscalSourceId;
        senderId: string;
        payload: { mode: 'installing' | 'updating' };
    }
    | {
        type: 'INSTALLED';
        source: OfflineFiscalSourceId;
        senderId: string;
        payload: { metadata: OfflineDatabaseMetadata | null };
    }
    | {
        type: 'REMOVED';
        source: OfflineFiscalSourceId;
        senderId: string;
        payload: Record<string, never>;
    }
    | {
        type: 'ERROR';
        source: OfflineFiscalSourceId;
        senderId: string;
        payload: { message: string };
    };
