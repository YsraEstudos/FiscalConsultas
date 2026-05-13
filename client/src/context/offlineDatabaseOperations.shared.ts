import type {
    Dispatch,
    MutableRefObject,
    SetStateAction,
} from 'react';

import type {
    NbsCatalogDetailApiResponse,
} from '../types/api.types';
import type { OfflineDatabaseMetadata } from '../utils/offlineDatabase';
import type {
    OfflineCatalogSearchResult,
    OfflineDatabaseChannelMessage,
    OfflineDatabaseStatus,
    OfflineDatabaseWorkerRequest,
    OfflineDatabaseWorkerResponse,
    OfflineDocumentType,
} from './offlineDatabase.types';

export interface OfflineDatabaseOperationsArgs {
    isSupported: boolean;
    status: OfflineDatabaseStatus;
    localVersion: string | null;
    remoteVersion: string | null;
    userId: string | null;
    instanceId: string;
    remoteMetadataRef: MutableRefObject<OfflineDatabaseMetadata | null>;
    remoteBundleBaseUrlRef: MutableRefObject<string>;
    broadcast: (message: OfflineDatabaseChannelMessage) => void;
    waitForOtherTabSync: () => Promise<void>;
    sendToWorker: (
        request: OfflineDatabaseWorkerRequest,
        timeoutMs?: number,
    ) => Promise<OfflineDatabaseWorkerResponse>;
    refreshOfflineDatabaseAvailability: (
        force?: boolean,
    ) => Promise<OfflineDatabaseMetadata | null>;
    applyInstalledMetadata: (metadata: OfflineDatabaseMetadata | null) => void;
    setStatus: Dispatch<SetStateAction<OfflineDatabaseStatus>>;
    setProgress: Dispatch<SetStateAction<number>>;
    setProgressStep: Dispatch<SetStateAction<string>>;
    setError: Dispatch<SetStateAction<string | null>>;
    setLocalVersion: Dispatch<SetStateAction<string | null>>;
    setRemoteVersion: Dispatch<SetStateAction<string | null>>;
    setDbSizeBytes: Dispatch<SetStateAction<number | null>>;
    setIsRemoving: Dispatch<SetStateAction<boolean>>;
}

export interface OfflineDatabaseOperations {
    installOfflineDatabase: () => Promise<void>;
    removeOfflineDatabase: () => Promise<void>;
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
}
