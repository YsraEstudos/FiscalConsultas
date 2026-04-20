import { useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { searchNCM, searchNbsServices, searchNebsEntries, searchTipi } from '../services/api';
import { useTabs, type DocType } from './useTabs';
import { useHistory } from './useHistory';
import { useSettings } from '../context/SettingsContext';
import { useLocalDatabase } from '../context/LocalDatabaseContext';
import { extractChapter, isSameChapter } from '../utils/chapterDetection';
import type { SearchResponse, NbsSearchResponse, NebsSearchResponse, TipiTextSearchResponse, TextSearchResponse } from '../types/api.types';
import { isCodeSearchResponse } from '../types/api.types';
import { buildLocalCodeSearchResponse } from '../utils/searchResultMarkup';
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

/**
 * Normalize local Worker search results into the SearchResponse format.
 */
function normalizeLocalResults(
    doc: DocType,
    query: string,
    results: Record<string, unknown>[]
): SearchResponse | null {
    const safeResults = Array.isArray(results) ? results : [];

    switch (doc) {
        case 'nbs': {
            const response: NbsSearchResponse = {
                success: true, query, normalized: query,
                results: safeResults.map((r) => ({
                    code: String(r.code || ''), code_clean: String(r.code_clean || ''),
                    description: String(r.description || ''),
                    parent_code: r.parent_code ? String(r.parent_code) : null,
                    level: Number(r.level || 0), has_nebs: Boolean(r.has_nebs),
                })),
                total: safeResults.length,
            };
            return response;
        }
        case 'nebs': {
            const response: NebsSearchResponse = {
                success: true, query, normalized: query,
                results: safeResults.map((r) => ({
                    code: String(r.code || ''),
                    title: String(r.title || ''),
                    excerpt: String(r.body_text || '').slice(0, 200),
                    page_start: Number(r.page_start || 0),
                    page_end: Number(r.page_end || 0),
                    section_title: r.section_title ? String(r.section_title) : null,
                })),
                total: safeResults.length,
            };
            return response;
        }
        case 'tipi': {
            const response: TipiTextSearchResponse = {
                success: true, type: 'text', query: query,
                normalized: query, match_type: 'fts',
                warning: null, total: safeResults.length,
                results: safeResults.map((r) => ({
                    ncm: String(r.ncm || ''),
                    capitulo: String(r.capitulo || ''),
                    descricao: String(r.descricao || ''),
                    aliquota: String(r.aliquota || ''),
                })),
            };
            return response;
        }
        case 'nesh': {
            // NESH local FTS returns flat items → build TextSearchResponse
            const response: TextSearchResponse = {
                success: true, type: 'text', query,
                normalized: query, match_type: 'all_words',
                warning: null, total_capitulos: safeResults.length,
                results: safeResults.map((r) => ({
                    ncm: String(r.codigo || ''),
                    descricao: String(r.descricao || ''),
                    tipo: 'position' as const,
                    relevancia: 1,
                    score: 1,
                    tier: 1 as const,
                    tier_label: 'Exato' as const,
                })),
            };
            return response;
        }
        default:
            return null;
    }
}

export function useSearch(
    tabsById: ReturnType<typeof useTabs>['tabsById'],
    updateTab: ReturnType<typeof useTabs>['updateTab'],
    addToHistory: ReturnType<typeof useHistory>['addToHistory']
) {
    const { tipiViewMode } = useSettings();
    const { status: dbStatus, searchLocal } = useLocalDatabase();
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
            title: query
        });

        try {
            let data: SearchResponse | null = null;
            const isOfflineScopedDoc = doc === 'nesh' || doc === 'tipi' || doc === 'nbs' || doc === 'nebs';

            // === HYBRID SEARCH: Local DB first, API fallback ===
            if (dbStatus === 'ready' && isOfflineScopedDoc) {
                try {
                    const localResponse = await searchLocal(doc as any, query, tipiViewModeRef.current);
                    if (localResponse) {
                        if (localResponse.searchType === 'code') {
                            data = doc === 'nesh' || doc === 'tipi'
                                ? buildLocalCodeSearchResponse(
                                    doc,
                                    query,
                                    localResponse.results as Record<string, any>,
                                    localResponse.markdown,
                                )
                                : null;
                        } else if (Array.isArray(localResponse.results)) {
                            data = normalizeLocalResults(doc, query, localResponse.results as Record<string, unknown>[]);
                        }
                    }
                } catch { /* silent fallback to API */ }
            }

            // Fallback to API if local returned nothing
            if (!data) {
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
                data = await handler();
            }

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
                }
            }

            toast.error(message);
            updateTab(tabId, {
                error: message,
                loading: false
            });
        }
    }, [addToHistory, updateResultsQuery, updateTab, dbStatus, searchLocal]);

    return { executeSearchForTab };
}
