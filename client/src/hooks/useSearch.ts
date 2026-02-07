import { useCallback } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { searchNCM, searchTipi } from '../services/api';
import { useTabs, type Tab, type DocType } from './useTabs';
import { useHistory } from './useHistory';
import { useSettings } from '../context/SettingsContext';
import { extractChapter, isSameChapter } from '../utils/chapterDetection';
import type { SearchResponse } from '../types/api.types';
import { isCodeSearchResponse } from '../types/api.types';

const buildLoadedChaptersByDoc = (value?: Record<DocType, string[]>): Record<DocType, string[]> => ({
    nesh: value?.nesh ?? [],
    tipi: value?.tipi ?? []
});

export function useSearch(
    tabsById: ReturnType<typeof useTabs>['tabsById'],
    updateTab: ReturnType<typeof useTabs>['updateTab'],
    addToHistory: ReturnType<typeof useHistory>['addToHistory']
) {
    const { tipiViewMode } = useSettings();

    const updateResultsQuery = useCallback((results: SearchResponse, query: string): SearchResponse => {
        return { ...results, query };
    }, []);

    const updateTabSearchState = useCallback((
        tabId: string,
        updates: Partial<Pick<
            Tab,
            'ncm' | 'title' | 'results' | 'loading' | 'error' | 'isNewSearch' | 'loadedChaptersByDoc' | 'content'
        >>
    ) => {
        updateTab(tabId, updates);
    }, [updateTab]);

    const executeSearchForTab = useCallback(async (tabId: string, doc: DocType, query: string, saveHistory: boolean = true) => {
        if (!query) return;

        if (saveHistory) addToHistory(query);

        // Localiza a aba atual para consultar capítulos carregados
        const currentTab = tabsById.get(tabId);
        const loadedChaptersByDoc = buildLoadedChaptersByDoc(currentTab?.loadedChaptersByDoc);
        const loadedChaptersForDoc = loadedChaptersByDoc[doc];
        const targetChapter = extractChapter(query);

        // OTIMIZACAO: Navegacao no mesmo capitulo
        // Se o NCM alvo pertence a um capitulo ja carregado, pula o fetch e apenas dispara auto-scroll
        // CRITICO: Atualizar results.query para manter sincronizado com o targetId do ResultDisplay
        if (
            targetChapter &&
            loadedChaptersForDoc.length > 0 &&
            isSameChapter(query, loadedChaptersForDoc) &&
            currentTab?.results // Precisa ter resultados existentes para atualizar
        ) {
            // Pula o fetch - atualiza results.query e dispara auto-scroll
            updateTabSearchState(tabId, {
                ncm: query,
                title: query,
                // CRITICO: Atualiza results.query para manter sincronizado com o ResultDisplay
                results: updateResultsQuery(currentTab.results, query),
                isNewSearch: true
            });
            return; // Early exit - sem chamada a API
        }

        // Fluxo normal: buscar novos dados
        updateTabSearchState(tabId, { loading: true, error: null, ncm: query, title: query });

        try {
            const data = doc === 'nesh'
                ? await searchNCM(query)
                : await searchTipi(query, tipiViewMode);

            // Extrai capitulos apenas para respostas do tipo code
            const chaptersInResponse = isCodeSearchResponse(data) && data.resultados
                ? Object.keys(data.resultados)
                : [];
            const nextLoadedChaptersForDoc = chaptersInResponse.length > 0
                ? [...new Set([...loadedChaptersForDoc, ...chaptersInResponse])]
                : [];

            updateTabSearchState(tabId, {
                results: updateResultsQuery(data, query),
                content: data.markdown || data.resultados || '',
                loading: false,
                isNewSearch: true,
                // Atualiza capitulos carregados apenas do documento atual
                loadedChaptersByDoc: {
                    ...loadedChaptersByDoc,
                    [doc]: nextLoadedChaptersForDoc
                }
            });
        } catch (err: any) {
            console.error(err);
            let message = 'Erro ao buscar dados. Verifique a API.';

            if (axios.isAxiosError(err)) {
                const status = err.response?.status;
                if (status === 404) {
                    message = 'Endpoint não encontrado (404). Verifique se o backend está rodando e se a base URL está correta.';
                } else if (status) {
                    message = `Erro ${status} ao buscar dados. Verifique a API.`;
                } else if (err.code === 'ECONNABORTED') {
                    message = 'Tempo limite na requisição. Verifique a conexão com o backend.';
                } else if (err.code === 'ERR_NETWORK') {
                    message = 'Não foi possível conectar à API. Verifique se o backend está em execução.';
                }
            }

            toast.error(message);
            updateTabSearchState(tabId, {
                error: message,
                loading: false
            });
        }
    }, [addToHistory, tipiViewMode, tabsById, updateResultsQuery, updateTabSearchState]);

    return { executeSearchForTab };
}
