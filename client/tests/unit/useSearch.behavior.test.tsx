import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STORAGE_KEYS } from '../../src/constants';
import { SettingsProvider } from '../../src/context/SettingsContext';
import { useSearch } from '../../src/hooks/useSearch';
import type { Tab } from '../../src/hooks/useTabs';

const refs = vi.hoisted(() => ({
  searchNCMMock: vi.fn(),
  searchTipiMock: vi.fn(),
  searchNbsServicesMock: vi.fn(),
  searchNebsEntriesMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../../src/services/api', () => ({
  searchNCM: refs.searchNCMMock,
  searchTipi: refs.searchTipiMock,
  searchNbsServices: refs.searchNbsServicesMock,
  searchNebsEntries: refs.searchNebsEntriesMock,
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: refs.toastErrorMock,
  },
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
    loadedChaptersByDoc: { nesh: [], tipi: [], nbs: [], nebs: [] },
    ...overrides,
  };
}

function makeAxiosError(status?: number, code?: string) {
  return {
    isAxiosError: true,
    response: status ? { status } : undefined,
    code,
  };
}

describe('useSearch behavior', () => {
  beforeEach(() => {
    refs.searchNCMMock.mockReset();
    refs.searchTipiMock.mockReset();
    refs.searchNbsServicesMock.mockReset();
    refs.searchNebsEntriesMock.mockReset();
    refs.toastErrorMock.mockReset();
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
  });

  it('uses the persisted TIPI view mode and skips history writes when saveHistory=false', async () => {
    localStorage.setItem(STORAGE_KEYS.TIPI_VIEW_MODE, 'family');

    const updateTab = vi.fn();
    const addToHistory = vi.fn();
    const tabsById = new Map([
      ['tab-1', createTab({ document: 'tipi', loadedChaptersByDoc: { nesh: [], tipi: ['84'], nbs: [], nebs: [] } })],
    ]);

    refs.searchTipiMock.mockResolvedValue({
      success: true,
      type: 'code',
      query: '0101',
      results: {
        '01': {
          capitulo: '01',
          titulo: 'Animais vivos',
          notas_gerais: null,
          posicao_alvo: '0101',
          posicoes: [],
        },
      },
      total: 1,
      total_capitulos: 1,
      markdown: '<h3>01.01</h3>',
    });

    const { result } = renderHook(() => useSearch(tabsById, updateTab, addToHistory), { wrapper });

    await act(async () => {
      await result.current.executeSearchForTab('tab-1', 'tipi', '0101', false);
    });

    expect(addToHistory).not.toHaveBeenCalled();
    expect(refs.searchTipiMock).toHaveBeenCalledWith('0101', 'family');
    expect(updateTab).toHaveBeenNthCalledWith(1, 'tab-1', expect.objectContaining({
      loading: true,
      ncm: '0101',
      title: '0101',
    }));
    expect(updateTab).toHaveBeenNthCalledWith(2, 'tab-1', expect.objectContaining({
      loading: false,
      loadedChaptersByDoc: {
        nesh: [],
        tipi: ['84', '01'],
        nbs: [],
        nebs: [],
      },
    }));
  });

  it('resets loaded chapters when a text search response has no chapter map to merge', async () => {
    const updateTab = vi.fn();
    const addToHistory = vi.fn();
    const tabsById = new Map([
      ['tab-1', createTab({ loadedChaptersByDoc: { nesh: ['84'], tipi: [], nbs: [], nebs: [] } })],
    ]);

    refs.searchNCMMock.mockResolvedValue({
      success: true,
      type: 'text',
      query: 'motor',
      normalized: 'motor',
      match_type: 'all_words',
      warning: null,
      results: [],
      total_capitulos: 0,
    });

    const { result } = renderHook(() => useSearch(tabsById, updateTab, addToHistory), { wrapper });

    await act(async () => {
      await result.current.executeSearchForTab('tab-1', 'nesh', 'motor', true);
    });

    expect(refs.searchNCMMock).toHaveBeenCalledWith('motor');
    expect(updateTab).toHaveBeenLastCalledWith('tab-1', expect.objectContaining({
      content: '',
      loadedChaptersByDoc: {
        nesh: [],
        tipi: [],
        nbs: [],
        nebs: [],
      },
    }));
  });

  it.each([
    ['404 responses', makeAxiosError(404), 'Conteúdo indisponível no momento.'],
    ['generic status responses', makeAxiosError(503), 'Não foi possível carregar os dados agora. Tente novamente em instantes.'],
    ['timeouts', makeAxiosError(undefined, 'ECONNABORTED'), 'Não foi possível carregar os dados agora. Tente novamente em instantes.'],
    ['network failures', makeAxiosError(undefined, 'ERR_NETWORK'), 'Não foi possível carregar os dados agora. Tente novamente em instantes.'],
  ])('maps %s into toast and tab error state', async (_label, error, message) => {
    const updateTab = vi.fn();
    const addToHistory = vi.fn();
    const tabsById = new Map([['tab-1', createTab()]]);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    refs.searchNCMMock.mockRejectedValue(error);

    try {
      const { result } = renderHook(() => useSearch(tabsById, updateTab, addToHistory), { wrapper });

      await act(async () => {
        await result.current.executeSearchForTab('tab-1', 'nesh', '8517', true);
      });

      expect(refs.toastErrorMock).toHaveBeenCalledWith(message);
      expect(updateTab).toHaveBeenNthCalledWith(2, 'tab-1', {
        error: message,
        loading: false,
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it.each([
    ['nbs', 429, 'Muitas tentativas no catálogo de serviços. Aguarde um instante e tente novamente.'],
    ['nebs', 503, 'Catálogo de serviços indisponível no momento. Tente novamente em instantes.'],
  ])('uses the shared catalog error mapper for %s tabs', async (doc, status, message) => {
    const updateTab = vi.fn();
    const addToHistory = vi.fn();
    const tabsById = new Map([[
      'tab-1',
      createTab({ document: doc as Tab['document'] }),
    ]]);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = {
      isAxiosError: true,
      response: { status },
    };

    if (doc === 'nbs') {
      refs.searchNbsServicesMock.mockRejectedValue(error);
    } else {
      refs.searchNebsEntriesMock.mockRejectedValue(error);
    }

    try {
      const { result } = renderHook(() => useSearch(tabsById, updateTab, addToHistory), { wrapper });

      await act(async () => {
        await result.current.executeSearchForTab('tab-1', doc as Tab['document'], '1.0101.11.00', true);
      });

      expect(refs.toastErrorMock).toHaveBeenCalledWith(message);
      expect(updateTab).toHaveBeenNthCalledWith(2, 'tab-1', {
        error: message,
        loading: false,
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
