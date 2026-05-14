import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsProvider } from '../../src/context/SettingsContext';
import { useSearch } from '../../src/hooks/useSearch';
import type { Tab } from '../../src/hooks/useTabs';

const refs = vi.hoisted(() => ({
  searchNCMMock: vi.fn(),
  searchTipiMock: vi.fn(),
  searchNbsServicesMock: vi.fn(),
  searchLocalMock: vi.fn(),
  toastErrorMock: vi.fn(),
  dbStatus: 'not_installed',
}));

vi.mock('../../src/services/api', () => ({
  searchNCM: refs.searchNCMMock,
  searchTipi: refs.searchTipiMock,
  searchNbsServices: refs.searchNbsServicesMock,
  logSearchEvent: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: refs.toastErrorMock,
  },
}));

vi.mock('../../src/context/LocalDatabaseContext', () => ({
  useLocalDatabase: () => ({
    status: refs.dbStatus,
    searchLocal: refs.searchLocalMock,
    getNbsDetailLocal: vi.fn().mockResolvedValue(null),
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
  }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

function createTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 'tab-1',
    title: 'Busca',
    document: 'nesh',
    content: null,
    loading: false,
    error: null,
    ncm: '',
    results: null,
    loadedChaptersByDoc: { nesh: [], tipi: [], nbs: [] },
    ...overrides,
  };
}

describe('useSearch local-only behavior', () => {
  beforeEach(() => {
    refs.searchNCMMock.mockReset();
    refs.searchTipiMock.mockReset();
    refs.searchNbsServicesMock.mockReset();
    refs.searchLocalMock.mockReset();
    refs.toastErrorMock.mockReset();
    refs.dbStatus = 'not_installed';
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns early for empty queries without mutating history or tabs', async () => {
    const updateTab = vi.fn();
    const addToHistory = vi.fn();
    const tabsById = new Map([['tab-1', createTab()]]);

    const { result } = renderHook(() => useSearch(tabsById, updateTab, addToHistory), { wrapper });

    await act(async () => {
      await result.current.executeSearchForTab('tab-1', 'nesh', '', true);
    });

    expect(updateTab).not.toHaveBeenCalled();
    expect(addToHistory).not.toHaveBeenCalled();
    expect(refs.searchNCMMock).not.toHaveBeenCalled();
    expect(refs.searchTipiMock).not.toHaveBeenCalled();
    expect(refs.searchNbsServicesMock).not.toHaveBeenCalled();
  });

  it('does not call backend fiscal APIs when local NESH is not installed', async () => {
    const updateTab = vi.fn();
    const addToHistory = vi.fn();
    const tabsById = new Map([['tab-1', createTab()]]);

    const { result } = renderHook(() => useSearch(tabsById, updateTab, addToHistory), { wrapper });

    await act(async () => {
      await result.current.executeSearchForTab('tab-1', 'nesh', '0101', true);
    });

    expect(refs.searchNCMMock).not.toHaveBeenCalled();
    expect(refs.searchTipiMock).not.toHaveBeenCalled();
    expect(refs.searchNbsServicesMock).not.toHaveBeenCalled();
    expect(refs.toastErrorMock).toHaveBeenCalledWith('Instale a base NESH para pesquisar localmente.');
    expect(updateTab).toHaveBeenLastCalledWith('tab-1', {
      error: 'Instale a base NESH para pesquisar localmente.',
      loading: false,
    });
  });

  it('uses local worker results when the offline database is ready', async () => {
    refs.dbStatus = 'ready';
    refs.searchLocalMock.mockResolvedValue({
      searchType: 'text',
      results: [
        {
          codigo: '0101',
          descricao: 'Cavalos',
        },
      ],
    });
    const updateTab = vi.fn();
    const addToHistory = vi.fn();
    const tabsById = new Map([['tab-1', createTab()]]);

    const { result } = renderHook(() => useSearch(tabsById, updateTab, addToHistory), { wrapper });

    await act(async () => {
      await result.current.executeSearchForTab('tab-1', 'nesh', 'cavalo', true);
    });

    expect(refs.searchNCMMock).not.toHaveBeenCalled();
    expect(refs.searchLocalMock).toHaveBeenCalledWith('nesh', 'cavalo', 'chapter');
    expect(updateTab).toHaveBeenLastCalledWith('tab-1', expect.objectContaining({
      loading: false,
      results: expect.objectContaining({
        success: true,
        query: 'cavalo',
        total_capitulos: 1,
      }),
    }));
  });

  it('does not show install guidance when the ready local worker returns no result', async () => {
    refs.dbStatus = 'ready';
    refs.searchLocalMock.mockResolvedValue(null);
    const updateTab = vi.fn();
    const addToHistory = vi.fn();
    const tabsById = new Map([['tab-1', createTab()]]);

    const { result } = renderHook(() => useSearch(tabsById, updateTab, addToHistory), { wrapper });

    await act(async () => {
      await result.current.executeSearchForTab('tab-1', 'nesh', '0101', true);
    });

    expect(refs.searchNCMMock).not.toHaveBeenCalled();
    expect(refs.toastErrorMock).toHaveBeenCalledWith('Nenhum resultado encontrado na base local.');
    expect(refs.toastErrorMock).not.toHaveBeenCalledWith('Instale a base NESH para pesquisar localmente.');
    expect(updateTab).toHaveBeenLastCalledWith('tab-1', {
      error: 'Nenhum resultado encontrado na base local.',
      loading: false,
    });
  });

  it('maps local worker failures to a user-facing Portuguese message', async () => {
    refs.dbStatus = 'ready';
    refs.searchLocalMock.mockRejectedValue(new Error('Worker request timed out'));
    const updateTab = vi.fn();
    const addToHistory = vi.fn();
    const tabsById = new Map([['tab-1', createTab()]]);

    const { result } = renderHook(() => useSearch(tabsById, updateTab, addToHistory), { wrapper });

    await act(async () => {
      await result.current.executeSearchForTab('tab-1', 'nesh', '0101', true);
    });

    expect(refs.toastErrorMock).toHaveBeenCalledWith('Erro ao pesquisar na base local. Tente reinstalar.');
    expect(refs.toastErrorMock).not.toHaveBeenCalledWith('Worker request timed out');
    expect(updateTab).toHaveBeenLastCalledWith('tab-1', {
      error: 'Erro ao pesquisar na base local. Tente reinstalar.',
      loading: false,
    });
  });

  it('preserves same-chapter navigation without searching again', async () => {
    const updateTab = vi.fn();
    const addToHistory = vi.fn();
    const tabsById = new Map([
      ['tab-1', createTab({
        results: {
          success: true,
          type: 'text',
          query: '0101',
          normalized: '0101',
          match_type: 'all_words',
          warning: null,
          total_capitulos: 0,
          results: [],
        },
        loadedChaptersByDoc: { nesh: ['01'], tipi: [], nbs: [] },
      })],
    ]);

    const { result } = renderHook(() => useSearch(tabsById, updateTab, addToHistory), { wrapper });

    await act(async () => {
      await result.current.executeSearchForTab('tab-1', 'nesh', '0102', true);
    });

    expect(refs.searchLocalMock).not.toHaveBeenCalled();
    expect(refs.searchNCMMock).not.toHaveBeenCalled();
    expect(updateTab).toHaveBeenLastCalledWith('tab-1', expect.objectContaining({
      ncm: '0102',
      title: '0102',
      isNewSearch: true,
    }));
  });
});
