import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsProvider } from '../../src/context/SettingsContext';
import { useSearch } from '../../src/hooks/useSearch';
import type { CodeSearchResponse, ChapterData } from '../../src/types/api.types';
import type { Tab } from '../../src/hooks/useTabs';
import { searchNCM, searchTipi } from '../../src/services/api';

vi.mock('../../src/services/api', () => ({
    searchNCM: vi.fn(),
    searchTipi: vi.fn()
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SettingsProvider>{children}</SettingsProvider>
);

const createChapterData = (chapter: string): ChapterData => ({
    ncm_buscado: `${chapter}22`,
    capitulo: chapter,
    posicao_alvo: `${chapter}.22`,
    posicoes: [{ codigo: `${chapter}.22`, descricao: 'Item', anchor_id: `pos-${chapter}-22` }],
    notas_gerais: null,
    notas_parseadas: {},
    conteudo: 'Conteudo',
    real_content_found: true,
    erro: null
});

const createCodeResponse = (chapter: string, query: string): CodeSearchResponse => ({
    success: true,
    type: 'code',
    query,
    normalized: null,
    results: { [chapter]: createChapterData(chapter) },
    resultados: { [chapter]: createChapterData(chapter) },
    total_capitulos: 1,
    markdown: `<h3 id="pos-${chapter}-22">${chapter}.22</h3>`
});

describe('useSearch Hook', () => {
    const searchNCMMock = vi.mocked(searchNCM);
    const searchTipiMock = vi.mocked(searchTipi);

    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should skip fetch and only update state for same-chapter navigation', async () => {
        const updateTab = vi.fn();
        const addToHistory = vi.fn();
        const tabs: Tab[] = [
            {
                id: 'tab-1',
                title: '8421',
                document: 'nesh',
                content: '<h3>84.21</h3>',
                loading: false,
                error: null,
                ncm: '84.21',
                results: createCodeResponse('84', '8421'),
                loadedChaptersByDoc: { nesh: ['84'], tipi: [] }
            }
        ];
        const tabsById = new Map(tabs.map(tab => [tab.id, tab]));

        const { result } = renderHook(
            () => useSearch(tabsById, updateTab, addToHistory),
            { wrapper }
        );

        await act(async () => {
            await result.current.executeSearchForTab('tab-1', 'nesh', '8422.1', true);
        });

        expect(searchNCMMock).not.toHaveBeenCalled();
        expect(searchTipiMock).not.toHaveBeenCalled();
        expect(updateTab).toHaveBeenCalledTimes(1);
        expect(updateTab).toHaveBeenCalledWith('tab-1', expect.objectContaining({
            ncm: '8422.1',
            title: '8422.1',
            isNewSearch: true,
            results: expect.objectContaining({ query: '8422.1' })
        }));
    });

    it('should fetch when navigating to a different chapter', async () => {
        const updateTab = vi.fn();
        const addToHistory = vi.fn();
        const tabs: Tab[] = [
            {
                id: 'tab-1',
                title: '8421',
                document: 'nesh',
                content: '<h3>84.21</h3>',
                loading: false,
                error: null,
                ncm: '84.21',
                results: createCodeResponse('84', '8421'),
                loadedChaptersByDoc: { nesh: ['84'], tipi: [] }
            }
        ];
        const tabsById = new Map(tabs.map(tab => [tab.id, tab]));

        searchNCMMock.mockResolvedValue(createCodeResponse('73', '7308'));

        const { result } = renderHook(
            () => useSearch(tabsById, updateTab, addToHistory),
            { wrapper }
        );

        await act(async () => {
            await result.current.executeSearchForTab('tab-1', 'nesh', '7308', true);
        });

        expect(searchNCMMock).toHaveBeenCalledTimes(1);
        expect(searchNCMMock).toHaveBeenCalledWith('7308');

        expect(updateTab.mock.calls[0]).toEqual([
            'tab-1',
            expect.objectContaining({
                loading: true,
                error: null,
                ncm: '7308',
                title: '7308'
            })
        ]);

        expect(updateTab.mock.calls[1]).toEqual([
            'tab-1',
            expect.objectContaining({
                loading: false,
                isNewSearch: true,
                results: expect.objectContaining({ query: '7308' }),
                loadedChaptersByDoc: {
                    nesh: expect.arrayContaining(['84', '73']),
                    tipi: []
                }
            })
        ]);
    });
});
