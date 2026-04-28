import { useEffect, useMemo } from 'react';

import { useOfflineDatabaseOperations } from './offlineDatabaseOperations';
import { useOfflineDatabaseRuntime } from './offlineDatabaseRuntime';
import type { OfflineDatabaseContextValue } from './offlineDatabase.types';

export function useOfflineDatabaseController(): OfflineDatabaseContextValue {
    const { state, actions } = useOfflineDatabaseRuntime();
    const {
        installOfflineDatabase,
        removeOfflineDatabase,
        searchOfflineCatalog,
        fetchOfflineNeshChapterNotes,
        fetchOfflineNbsCatalogDetail,
    } = useOfflineDatabaseOperations(actions);

    useEffect(() => {
        if (!state.isSupported || state.status !== 'ready' || !state.updateAvailable) {
            return;
        }

        void installOfflineDatabase().catch(() => {
            // Install lifecycle errors are already captured in shared state.
        });
    }, [installOfflineDatabase, state.isSupported, state.status, state.updateAvailable]);

    return useMemo<OfflineDatabaseContextValue>(
        () => ({
            ...state,
            installOfflineDatabase,
            removeOfflineDatabase,
            refreshOfflineDatabaseAvailability:
                actions.refreshOfflineDatabaseAvailability,
            searchOfflineCatalog,
            fetchOfflineNeshChapterNotes,
            fetchOfflineNbsCatalogDetail,
            install: installOfflineDatabase,
            remove: removeOfflineDatabase,
            refreshAvailability: actions.refreshOfflineDatabaseAvailability,
            searchLocal: searchOfflineCatalog,
            getNeshChapterNotesLocal: fetchOfflineNeshChapterNotes,
            getNbsDetailLocal: fetchOfflineNbsCatalogDetail,
        }),
        [
            actions.refreshOfflineDatabaseAvailability,
            fetchOfflineNbsCatalogDetail,
            fetchOfflineNeshChapterNotes,
            installOfflineDatabase,
            removeOfflineDatabase,
            searchOfflineCatalog,
            state,
        ],
    );
}
