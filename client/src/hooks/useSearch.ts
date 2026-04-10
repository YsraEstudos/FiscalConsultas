import { useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { searchNCM, searchNbsServices, searchNebsEntries, searchTipi } from '../services/api';
import { useTabs, type DocType } from './useTabs';
import { useHistory } from './useHistory';
import { useSettings } from '../context/SettingsContext';
import { extractChapter, isSameChapter } from '../utils/chapterDetection';
import type { SearchResponse } from '../types/api.types';
import { isCodeSearchResponse } from '../types/api.types';
import {
    getServiceCatalogErrorInfo,
    isServiceCatalogDoc,
    reportServiceCatalogError,
} from '../utils/servicesCatalog';

const buildLoadedChaptersByDoc = (value?: Record<DocType, string[]>): Record<DocType, string[]> => ({
    nesh: value?.nesh ?? [],
    tipi: value?.tipi ?? [],
    nbs: value?.nbs ?? [],
    nebs: value?.nebs ?? [],
});

export function useSearch(
    tabsById: ReturnType<typeof useTabs>['tabsById'],
    updateTab: ReturnType<typeof useTabs>['updateTab'],
    addToHistory: ReturnType<typeof useHistory>['addToHistory']
) {
    const { tipiViewMode } = useSettings();
    const tabsByIdRef = useRef(tabsById);
    const tipiViewModeRef = useRef(tipiViewMode);

    useEffect(() => {
        tabsByIdRef.current = tabsById;
    }, [tabsById]);

    useEffect(() => {
        tipiViewModeRef.current = tipiViewMode;
    }, [tipiViewMode]);

    const updateResultsQuery = useCallback((results: SearchResponse, query: string): SearchResponse => {
        if (results.query === query) return results;

        const nextResults = { ...results, query } as SearchResponse;

        // Preserve legacy alias when source came from non-enumerable getter.
        if (isCodeSearchResponse(nextResults) && !(nextResults as any).resultados) {
            (nextResults as any).resultados = (results as any).resultados ?? (results as any).results;
        }

        return nextResults;
    }, []);

    const executeSearchForTab = useCallback(async (tabId: string, doc: DocType, query: string, saveHistory: boolean = true) => {
        if (!query) return;

        if (saveHistory) addToHistory(query);

        // Localiza a aba atual para consultar capítulos carregados
        const currentTab = tabsByIdRef.current.get(tabId);
        const loadedChaptersByDoc = buildLoadedChaptersByDoc(currentTab?.loadedChaptersByDoc);
        const loadedChaptersForDoc = loadedChaptersByDoc[doc];
        const targetChapter = extractChapter(query);

        // OTIMIZACAO: Navegacao no mesmo capitulo
        // Se o NCM alvo pertence a um capitulo ja carregado, pula o fetch e apenas dispara auto-scroll
        // CRITICO: Atualizar results.query para manter sincronizado com o targetId do ResultDisplay
        if (
            (doc === 'nesh' || doc === 'tipi') &&
            targetChapter &&
            loadedChaptersForDoc.length > 0 &&
            isSameChapter(query, loadedChaptersForDoc) &&
            currentTab?.results // Precisa ter resultados existentes para atualizar
        ) {
            // Pula o fetch - atualiza results.query e dispara auto-scroll
            updateTab(tabId, {
                ncm: query,
                title: query,
                // CRITICO: Atualiza results.query para manter sincronizado com o ResultDisplay
                results: updateResultsQuery(currentTab.results, query),
                isNewSearch: true
            });
            return; // Early exit - sem chamada a API
        }

        // Fluxo normal: buscar novos dados
        updateTab(tabId, {
            loading: true,
            error: null,
            ncm: query,
            title: query,
            isContentReady: false
        });

        try {
            const searchHandlers: Record<DocType, () => Promise<SearchResponse>> = {
                nesh: () => searchNCM(query),
                tipi: () => searchTipi(query, tipiViewModeRef.current),
                nbs: () => searchNbsServices(query),
                nebs: () => searchNebsEntries(query),
            };
            const handler = searchHandlers[doc];

            if (!handler) {
                throw new Error(`Unknown document type: ${doc}`);
            }

            const data = await handler();

            // Extrai capitulos apenas para respostas do tipo code
            const codeResults = isCodeSearchResponse(data)
                ? (data.resultados || data.results)
                : null;
            const chaptersInResponse = codeResults
                ? Object.keys(codeResults)
                : [];
            const nextLoadedChaptersForDoc = chaptersInResponse.length > 0
                ? [...new Set([...loadedChaptersForDoc, ...chaptersInResponse])]
                : [];

            updateTab(tabId, {
                results: updateResultsQuery(data, query),
                content: isCodeSearchResponse(data) ? data.markdown || '' : '',
                loading: false,
                isNewSearch: true,
                isContentReady: false,
                // Atualiza capitulos carregados apenas do documento atual
                loadedChaptersByDoc: {
                    ...loadedChaptersByDoc,
                    [doc]: nextLoadedChaptersForDoc
                }
            });
        } catch (err: any) {
            if (import.meta.env.DEV) {
                console.error(err);
            }
            let message = 'Não foi possível carregar os dados agora. Tente novamente em instantes.';

            if (isServiceCatalogDoc(doc)) {
                const serviceError = getServiceCatalogErrorInfo(err, doc);
                reportServiceCatalogError(err, doc, serviceError);
                message = serviceError.message;
            } else if (axios.isAxiosError(err)) {
                const status = err.response?.status;
                if (status === 404) {
                    message = 'Conteúdo indisponível no momento.';
                } else if (status || err.code === 'ECONNABORTED' || err.code === 'ERR_NETWORK') {
                    message = 'Não foi possível carregar os dados agora. Tente novamente em instantes.';
                }
            }

            toast.error(message);
            updateTab(tabId, {
                error: message,
                loading: false
            });
        }
    }, [addToHistory, updateResultsQuery, updateTab]);

    return { executeSearchForTab };
}
