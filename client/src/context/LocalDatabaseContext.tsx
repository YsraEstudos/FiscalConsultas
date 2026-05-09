import { createContext, useContext, type ReactNode } from 'react';

import { useOfflineDatabaseController } from './offlineDatabaseController';
import type {
    OfflineDatabaseContextValue,
} from './offlineDatabase.types';

export type {
    OfflineCatalogSearchResult,
    OfflineDatabaseContextValue,
    OfflineDatabaseStatus,
    OfflineDocumentType,
} from './offlineDatabase.types';

const DEFAULT_LOCAL_DATABASE_CONTEXT: OfflineDatabaseContextValue = {
    status: 'unsupported',
    progress: 0,
    progressStep: '',
    localVersion: null,
    remoteVersion: null,
    updateAvailable: false,
    error: null,
    dbSizeBytes: null,
    isSupported: false,
    supportReport: {
        supported: false,
        missingFeatures: [
            'secure-context',
            'cross-origin-isolation',
            'shared-array-buffer',
            'worker',
            'web-crypto',
            'opfs',
        ],
        canRecoverWithIsolationReload: false,
        isSecureContext: false,
        crossOriginIsolated: false,
    },
    isRemoving: false,
    installOfflineDatabase: async () => {
        throw new Error('Offline DB not supported in this browser');
    },
    removeOfflineDatabase: async () => undefined,
    refreshOfflineDatabaseAvailability: async () => null,
    searchOfflineCatalog: async () => null,
    fetchOfflineNeshChapterNotes: async () => null,
    fetchOfflineNbsCatalogDetail: async () => null,
    install: async () => {
        throw new Error('Offline DB not supported in this browser');
    },
    remove: async () => undefined,
    refreshAvailability: async () => null,
    searchLocal: async () => null,
    getNeshChapterNotesLocal: async () => null,
    getNbsDetailLocal: async () => null,
};

const LocalDatabaseContext = createContext<OfflineDatabaseContextValue>(
    DEFAULT_LOCAL_DATABASE_CONTEXT,
);

export function LocalDatabaseProvider({
    children,
}: Readonly<{ children: ReactNode }>) {
    const contextValue = useOfflineDatabaseController();

    return (
        <LocalDatabaseContext.Provider value={contextValue}>
            {children}
        </LocalDatabaseContext.Provider>
    );
}

export function useOfflineDatabase() {
    return useContext(LocalDatabaseContext);
}

export function useLocalDatabase() {
    return useOfflineDatabase();
}

export function useOptionalLocalDatabase() {
    return useContext(LocalDatabaseContext);
}
