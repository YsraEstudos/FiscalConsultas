import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsProvider } from '../../src/context/SettingsContext';
import { useSearch } from '../../src/hooks/useSearch';
import type { CodeSearchResponse, ChapterData } from '../../src/types/api.types';
import type { Tab } from '../../src/hooks/useTabs';
import { searchNCM, searchTipi } from '../../src/services/api';

const localDatabaseState = vi.hoisted(() => ({
    status: 'not_installed',
    searchLocal: vi.fn().mockResolvedValue(null),
    getNbsDetailLocal: vi.fn().mockResolvedValue(null),
    getNeshChapterNotesLocal: vi.fn().mockResolvedValue(null),
    progress: 0,
    progressStep: '',
    localVersion: null,
    remoteVersion: null,
    updateAvailable: false,
    error: null,
    dbSizeBytes: null,
    isSupported: false,
    install: vi.fn(),
    remove: vi.fn(),
    refreshAvailability: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/api', () => ({
    searchNCM: vi.fn(),
    searchTipi: vi.fn(),
    searchNbsServices: vi.fn(),
}));

vi.mock('../../src/context/LocalDatabaseContext', () => ({
    useLocalDatabase: () => localDatabaseState,
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

const createCodeResponseWithNonEnumerableAlias = (chapter: string, query: string): CodeSearchResponse => {
    const response = {
        success: true,
        type: 'code',
        query,
        normalized: null,
        results: { [chapter]: createChapterData(chapter) },
        total_capitulos: 1,
        markdown: `<h3 id="pos-${chapter}-22">${chapter}.22</h3>`
    } as CodeSearchResponse;

    Object.defineProperty(response, 'resultados', {
        get() {
            return this.results;
        },
        enumerable: false,
        configurable: true
    });

    return response;
};

describe('useSearch Hook', () => {
    const searchNCMMock = vi.mocked(searchNCM);
    const searchTipiMock = vi.mocked(searchTipi);

    beforeEach(() => {
        localStorage.clear();
        localDatabaseState.status = 'not_installed';
        localDatabaseState.searchLocal.mockReset();
        localDatabaseState.searchLocal.mockResolvedValue(null);
        localDatabaseState.getNeshChapterNotesLocal.mockReset();
        localDatabaseState.getNeshChapterNotesLocal.mockResolvedValue(null);
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

    it('should search locally when navigating to a different chapter', async () => {
        localDatabaseState.status = 'ready';
        localDatabaseState.searchLocal.mockResolvedValue({
            searchType: 'code',
            results: { '73': createChapterData('73') },
            markdown: '<h3 id="pos-73-22">73.22</h3>',
        });
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
            await result.current.executeSearchForTab('tab-1', 'nesh', '7308', true);
        });

        expect(localDatabaseState.searchLocal).toHaveBeenCalledWith('nesh', '7308', expect.any(String));
        expect(searchNCMMock).not.toHaveBeenCalled();

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
                content: '<h3 id="pos-73-22">73.22</h3>',
                loading: false,
                isNewSearch: true,
                isContentReady: false,
                results: expect.objectContaining({ query: '7308' }),
                loadedChaptersByDoc: {
                    nesh: expect.arrayContaining(['84', '73']),
                    tipi: [],
                    nbs: [],
                }
            })
        ]);
    });

    it('should preserve resultados alias when cloning code response with non-enumerable getter', async () => {
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
                results: createCodeResponseWithNonEnumerableAlias('84', '8421'),
                loadedChaptersByDoc: { nesh: ['84'], tipi: [] }
            }
        ];
        const tabsById = new Map(tabs.map(tab => [tab.id, tab]));

        const { result } = renderHook(
            () => useSearch(tabsById, updateTab, addToHistory),
            { wrapper }
        );

        await act(async () => {
            await result.current.executeSearchForTab('tab-1', 'nesh', '8422', true);
        });

        expect(updateTab).toHaveBeenCalledTimes(1);
        const payload = updateTab.mock.calls[0][1] as { results: CodeSearchResponse };
        expect(payload.results.query).toBe('8422');
        expect(payload.results.resultados).toEqual(payload.results.results);
        expect(Object.prototype.propertyIsEnumerable.call(payload.results, 'resultados')).toBe(true);
    });

    it('prefers offline NESH code results and preserves offline markdown', async () => {
        localDatabaseState.status = 'ready';
        localDatabaseState.searchLocal.mockResolvedValue({
            searchType: 'code',
            results: { '84': createChapterData('84') },
            markdown: '<div class="offline-html"><ol class="nesh-list"><li>Item multilinha inteiro</li></ol></div>',
        });

        const updateTab = vi.fn();
        const addToHistory = vi.fn();
        const tabs: Tab[] = [
            {
                id: 'tab-1',
                title: '8401',
                document: 'nesh',
                content: null,
                loading: false,
                error: null,
                ncm: '',
                results: null,
                loadedChaptersByDoc: { nesh: [], tipi: [], nbs: [] }
            }
        ];
        const tabsById = new Map(tabs.map(tab => [tab.id, tab]));

        const { result } = renderHook(
            () => useSearch(tabsById, updateTab, addToHistory),
            { wrapper }
        );

        await act(async () => {
            await result.current.executeSearchForTab('tab-1', 'nesh', '8401', true);
        });

        expect(localDatabaseState.searchLocal).toHaveBeenCalledWith('nesh', '8401', expect.any(String));
        expect(searchNCMMock).not.toHaveBeenCalled();
        expect(updateTab).toHaveBeenLastCalledWith('tab-1', expect.objectContaining({
            content: '<div class="offline-html"><ol class="nesh-list"><li>Item multilinha inteiro</li></ol></div>',
            loading: false,
            results: expect.objectContaining({
                query: '8401',
                markdown: '<div class="offline-html"><ol class="nesh-list"><li>Item multilinha inteiro</li></ol></div>',
            }),
        }));
    });

    it('propagates timing info from local search and logs in DEV mode', async () => {
        localDatabaseState.status = 'ready';
        localDatabaseState.searchLocal.mockResolvedValue({
            searchType: 'code',
            results: { '84': createChapterData('84') },
            markdown: '<h1>Capítulo 84</h1>',
            timing: { sqlDurationMs: 5.2, totalDurationMs: 6.1, cacheHit: false },
        });

        const updateTab = vi.fn();
        const addToHistory = vi.fn();
        const tabs: Tab[] = [
            {
                id: 'tab-1',
                title: '8401',
                document: 'nesh',
                content: null,
                loading: false,
                error: null,
                ncm: '',
                results: null,
                loadedChaptersByDoc: { nesh: [], tipi: [], nbs: [] }
            }
        ];
        const tabsById = new Map(tabs.map(tab => [tab.id, tab]));

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const { result } = renderHook(
            () => useSearch(tabsById, updateTab, addToHistory),
            { wrapper }
        );

        await act(async () => {
            await result.current.executeSearchForTab('tab-1', 'nesh', '8401', true);
        });

        expect(localDatabaseState.searchLocal).toHaveBeenCalledWith('nesh', '8401', expect.any(String));
        expect(searchNCMMock).not.toHaveBeenCalled();

        // DEV mode should log timing info
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('[search] nesh:8401')
        );

        consoleSpy.mockRestore();
    });

    it('handles cached local search results (cacheHit=true) without errors', async () => {
        localDatabaseState.status = 'ready';
        localDatabaseState.searchLocal.mockResolvedValue({
            searchType: 'text',
            results: [
                { codigo: '84.13', descricao: 'Bombas', chapter_num: '84' },
            ],
            timing: { sqlDurationMs: 0, totalDurationMs: 0.1, cacheHit: true },
        });

        const updateTab = vi.fn();
        const addToHistory = vi.fn();
        const tabs: Tab[] = [
            {
                id: 'tab-1',
                title: 'bombas',
                document: 'nesh',
                content: null,
                loading: false,
                error: null,
                ncm: '',
                results: null,
                loadedChaptersByDoc: { nesh: [], tipi: [], nbs: [] }
            }
        ];
        const tabsById = new Map(tabs.map(tab => [tab.id, tab]));

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const { result } = renderHook(
            () => useSearch(tabsById, updateTab, addToHistory),
            { wrapper }
        );

        await act(async () => {
            await result.current.executeSearchForTab('tab-1', 'nesh', 'bombas', true);
        });

        expect(searchNCMMock).not.toHaveBeenCalled();

        // Verify cache hit is logged
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('HIT')
        );

        // Verify results are still correctly set on the tab
        expect(updateTab).toHaveBeenLastCalledWith('tab-1', expect.objectContaining({
            loading: false,
            results: expect.objectContaining({
                query: 'bombas',
                success: true,
            }),
        }));

        consoleSpy.mockRestore();
    });
});
