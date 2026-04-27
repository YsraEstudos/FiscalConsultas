import { useCallback } from 'react';

import type {
    NbsCatalogDetailApiResponse,
    NebsExplanatoryDetailApiResponse,
} from '../types/api.types';
import type {
    OfflineCatalogSearchResult,
    OfflineDocumentType,
} from './offlineDatabase.types';
import {
    extractOfflineCatalogSearchResult,
    extractOfflineWorkerDetail,
} from './offlineDatabaseWorkerClient';
import type { OfflineDatabaseOperations } from './offlineDatabaseOperations.shared';
import type { OfflineDatabaseOperationsArgs } from './offlineDatabaseOperations.shared';

export function useOfflineDatabaseQueries({
    sendToWorker,
    status,
}: Pick<OfflineDatabaseOperationsArgs, 'sendToWorker' | 'status'>): Pick<
    OfflineDatabaseOperations,
    | 'searchOfflineCatalog'
    | 'fetchOfflineNeshChapterNotes'
    | 'fetchOfflineNbsCatalogDetail'
    | 'fetchOfflineNebsEntryDetail'
> {
    const searchOfflineCatalog = useCallback(
        async (
            docType: OfflineDocumentType,
            query: string,
            viewMode?: string,
        ): Promise<OfflineCatalogSearchResult | null> => {
            if (status !== 'ready') return null;

            try {
                const response = await sendToWorker(
                    {
                        type: 'SEARCH',
                        id: null,
                        payload: { docType, query, viewMode },
                    },
                    5_000,
                );

                return extractOfflineCatalogSearchResult(response);
            } catch {
                return null;
            }
        },
        [sendToWorker, status],
    );

    const fetchOfflineNeshChapterNotes = useCallback(
        async (chapter: string): Promise<Record<string, string> | null> => {
            if (status !== 'ready') return null;

            const response = await searchOfflineCatalog('nesh', chapter);
            if (response?.searchType !== 'code') {
                return null;
            }

            const results = response.results;
            if (!results || Array.isArray(results)) {
                return null;
            }

            const chapterResult = results[chapter] as
                | { notas_parseadas?: Record<string, string> | null }
                | undefined;

            return chapterResult?.notas_parseadas ?? null;
        },
        [searchOfflineCatalog, status],
    );

    const fetchOfflineNbsCatalogDetail = useCallback(
        async (
            code: string,
            options: { page?: number; pageSize?: number } = {},
        ): Promise<NbsCatalogDetailApiResponse | null> => {
            if (status !== 'ready') return null;

            try {
                const response = await sendToWorker(
                    {
                        type: 'GET_NBS_DETAIL',
                        id: null,
                        payload: {
                            code,
                            page: options.page ?? 1,
                            pageSize: options.pageSize ?? 50,
                        },
                    },
                    10_000,
                );

                return extractOfflineWorkerDetail<NbsCatalogDetailApiResponse>(response);
            } catch {
                return null;
            }
        },
        [sendToWorker, status],
    );

    const fetchOfflineNebsEntryDetail = useCallback(
        async (code: string): Promise<NebsExplanatoryDetailApiResponse | null> => {
            if (status !== 'ready') return null;

            try {
                const response = await sendToWorker(
                    {
                        type: 'GET_NEBS_DETAIL',
                        id: null,
                        payload: { code },
                    },
                    10_000,
                );

                return extractOfflineWorkerDetail<NebsExplanatoryDetailApiResponse>(response);
            } catch {
                return null;
            }
        },
        [sendToWorker, status],
    );

    return {
        searchOfflineCatalog,
        fetchOfflineNeshChapterNotes,
        fetchOfflineNbsCatalogDetail,
        fetchOfflineNebsEntryDetail,
    };
}
