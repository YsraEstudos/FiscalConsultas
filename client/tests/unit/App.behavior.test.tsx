import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../src/App';

type DocType = 'nesh' | 'tipi';

type MockTab = {
  id: string;
  title: string;
  document: DocType;
  content: string | null;
  loading: boolean;
  error: string | null;
  ncm?: string;
  results?: any;
  isNewSearch?: boolean;
  scrollTop?: number;
  isContentReady?: boolean;
  loadedChaptersByDoc?: Record<DocType, string[]>;
};

const mocks = vi.hoisted(() => {
  const toastMock = Object.assign(vi.fn(), {
    error: vi.fn(),
    loading: vi.fn(() => 'loading-toast'),
    dismiss: vi.fn(),
  });

  return {
    toastMock,
    createTabMock: vi.fn(),
    closeTabMock: vi.fn(),
    switchTabMock: vi.fn(),
    updateTabMock: vi.fn(),
    executeSearchForTabMock: vi.fn(),
    addToHistoryMock: vi.fn(),
    removeFromHistoryMock: vi.fn(),
    clearHistoryMock: vi.fn(),
    fetchNotesMock: vi.fn(),
    nextTabIdRef: { value: 0 },
    sidebarPositionRef: { value: 'right' as 'left' | 'right' },
    historyRef: { value: [{ term: '8517', timestamp: 1 }] as Array<{ term: string; timestamp: number }> },
    tabsStateRef: {
      value: {
        tabs: [] as MockTab[],
        tabsById: new Map<string, MockTab>(),
        activeTabId: 'tab-1',
        activeTab: null as MockTab | null,
      },
    },
  };
});

vi.mock('react-hot-toast', () => ({
  Toaster: () => <div data-testid="toaster" />,
  toast: mocks.toastMock,
}));

vi.mock('../../src/components/Layout', () => ({
  Layout: ({
    children,
    onSearch,
    doc,
    setDoc,
    searchKey,
    onMenuOpen,
    onOpenSettings,
    onOpenTutorial,
    onOpenStats,
    onOpenComparator,
    onClearHistory,
    onRemoveHistory,
    isLoading,
  }: any) => (
    <div data-testid="layout" data-doc={doc} data-search-key={searchKey}>
      <button data-testid="layout-search-single" onClick={() => onSearch('8517')}>
        search-single
      </button>
      <button data-testid="layout-search-multi" onClick={() => onSearch('8517, 9401')}>
        search-multi
      </button>
      <button data-testid="layout-search-empty" onClick={() => onSearch(' ,   ')}>
        search-empty
      </button>
      <button data-testid="layout-set-doc-tipi" onClick={() => setDoc('tipi')}>
        setdoc-tipi
      </button>
      <button data-testid="layout-menu-toggle" onClick={onMenuOpen}>
        menu
      </button>
      <button data-testid="layout-open-settings" onClick={onOpenSettings}>
        open-settings
      </button>
      <button data-testid="layout-open-tutorial" onClick={onOpenTutorial}>
        open-tutorial
      </button>
      <button data-testid="layout-open-stats" onClick={onOpenStats}>
        open-stats
      </button>
      <button data-testid="layout-open-comparator" onClick={onOpenComparator}>
        open-comparator
      </button>
      <button data-testid="layout-clear-history" onClick={onClearHistory}>
        clear-history
      </button>
      <button data-testid="layout-remove-history" onClick={() => onRemoveHistory('8517')}>
        remove-history
      </button>
      <span data-testid="layout-loading">{String(Boolean(isLoading))}</span>
      {children}
    </div>
  ),
}));

vi.mock('../../src/components/TabsBar', () => ({
  TabsBar: ({ tabs, activeTabId, onSwitch, onClose, onNewTab }: any) => (
    <div data-testid="tabs-bar" data-count={String(tabs.length)} data-active={activeTabId}>
      <button data-testid="tabs-new" onClick={onNewTab}>
        new
      </button>
      <button data-testid="tabs-switch-tab-2" onClick={() => onSwitch('tab-2')}>
        switch
      </button>
      <button data-testid="tabs-close-tab-2" onClick={(event) => onClose(event, 'tab-2')}>
        close
      </button>
    </div>
  ),
}));

vi.mock('../../src/components/ResultDisplay', () => ({
  ResultDisplay: ({
    tabId,
    mobileMenuOpen,
    isActive,
    onCloseMobileMenu,
    onConsumeNewSearch,
    onPersistScroll,
    onContentReady,
  }: any) => (
    <div
      data-testid={`result-display-${tabId}`}
      data-mobile-open={String(Boolean(mobileMenuOpen))}
      data-active={String(Boolean(isActive))}
    >
      <button data-testid={`result-consume-scroll-${tabId}`} onClick={() => onConsumeNewSearch(tabId, 321)}>
        consume-scroll
      </button>
      <button data-testid={`result-consume-no-scroll-${tabId}`} onClick={() => onConsumeNewSearch(tabId, undefined)}>
        consume-no-scroll
      </button>
      <button data-testid={`result-persist-${tabId}`} onClick={() => onPersistScroll(tabId, 77)}>
        persist
      </button>
      <button data-testid={`result-ready-${tabId}`} onClick={onContentReady}>
        ready
      </button>
      <button data-testid={`result-close-mobile-${tabId}`} onClick={onCloseMobileMenu}>
        close-mobile
      </button>
    </div>
  ),
}));

vi.mock('../../src/components/ResultSkeleton', () => ({
  ResultSkeleton: () => <div data-testid="result-skeleton" />,
}));

vi.mock('../../src/components/Tabs/TabPanel', () => ({
  TabPanel: ({ id, children }: any) => <section data-testid={`tab-panel-${id}`}>{children}</section>,
}));

vi.mock('../../src/components/ModalManager', () => ({
  ModalManager: ({ modals, onClose, currentDoc, onOpenInDoc, onOpenInNewTab }: any) => (
    <div
      data-testid="modal-manager"
      data-settings={String(modals.settings)}
      data-tutorial={String(modals.tutorial)}
      data-stats={String(modals.stats)}
      data-comparator={String(modals.comparator)}
      data-current-doc={currentDoc}
    >
      <button data-testid="modal-close-settings" onClick={onClose.settings}>
        close-settings
      </button>
      <button data-testid="modal-close-tutorial" onClick={onClose.tutorial}>
        close-tutorial
      </button>
      <button data-testid="modal-close-stats" onClick={onClose.stats}>
        close-stats
      </button>
      <button data-testid="modal-close-comparator" onClick={onClose.comparator}>
        close-comparator
      </button>
      <button data-testid="modal-open-doc-current" onClick={() => onOpenInDoc('tipi', '1234.56.78')}>
        open-current
      </button>
      <button data-testid="modal-open-doc-new" onClick={() => onOpenInNewTab('nesh', '9401')}>
        open-new
      </button>
    </div>
  ),
}));

vi.mock('../../src/components/NotePanel', () => ({
  NotePanel: ({ isOpen, onClose, note, chapter, content, position }: any) => (
    <div
      data-testid="note-panel"
      data-open={String(Boolean(isOpen))}
      data-note={note}
      data-chapter={chapter}
      data-content={content}
      data-position={position}
    >
      <button data-testid="note-panel-close" onClick={onClose}>
        close-note
      </button>
    </div>
  ),
}));

vi.mock('../../src/hooks/useTabs', () => ({
  useTabs: () => ({
    tabs: mocks.tabsStateRef.value.tabs,
    tabsById: mocks.tabsStateRef.value.tabsById,
    activeTabId: mocks.tabsStateRef.value.activeTabId,
    activeTab: mocks.tabsStateRef.value.activeTab,
    createTab: mocks.createTabMock,
    closeTab: mocks.closeTabMock,
    switchTab: mocks.switchTabMock,
    updateTab: mocks.updateTabMock,
  }),
}));

vi.mock('../../src/hooks/useSearch', () => ({
  useSearch: () => ({
    executeSearchForTab: mocks.executeSearchForTabMock,
  }),
}));

vi.mock('../../src/hooks/useHistory', () => ({
  useHistory: () => ({
    history: mocks.historyRef.value,
    addToHistory: mocks.addToHistoryMock,
    removeFromHistory: mocks.removeFromHistoryMock,
    clearHistory: mocks.clearHistoryMock,
  }),
}));

vi.mock('../../src/context/CrossChapterNoteContext', () => ({
  useCrossChapterNotes: () => ({
    fetchNotes: mocks.fetchNotesMock,
  }),
}));

vi.mock('../../src/context/SettingsContext', () => ({
  useSettings: () => ({
    sidebarPosition: mocks.sidebarPositionRef.value,
  }),
}));

function buildTab(overrides: Partial<MockTab> = {}): MockTab {
  return {
    id: 'tab-1',
    title: 'Nova busca',
    document: 'nesh',
    content: null,
    loading: false,
    error: null,
    ncm: '',
    results: null,
    isNewSearch: false,
    scrollTop: 0,
    isContentReady: true,
    loadedChaptersByDoc: { nesh: [], tipi: [] },
    ...overrides,
  };
}

function buildCodeResults(chapters: Record<string, any>, query = '8401') {
  return {
    success: true,
    type: 'code',
    query,
    normalized: null,
    results: chapters,
    total_capitulos: Object.keys(chapters).length,
  };
}

function setTabsState(tabs: MockTab[], activeTabId = tabs[0]?.id ?? 'tab-1') {
  const tabsById = new Map<string, MockTab>(tabs.map((tab) => [tab.id, tab]));
  mocks.tabsStateRef.value = {
    tabs,
    tabsById,
    activeTabId,
    activeTab: tabsById.get(activeTabId) || tabs[0] || null,
  };
}

function appendSmartLink(ncm: string) {
  const smartLink = document.createElement('a');
  smartLink.href = '#';
  smartLink.className = 'smart-link';
  smartLink.dataset.ncm = ncm;
  document.body.appendChild(smartLink);
  return smartLink;
}

function appendNoteRef(note: string, chapter?: string) {
  const noteRef = document.createElement('button');
  noteRef.className = 'note-ref';
  noteRef.dataset.note = note;
  if (chapter) {
    noteRef.dataset.chapter = chapter;
  }
  document.body.appendChild(noteRef);
  return noteRef;
}

describe('App behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nextTabIdRef.value = 0;
    mocks.createTabMock.mockImplementation((doc: DocType = 'nesh') => `new-${doc}-${++mocks.nextTabIdRef.value}`);
    mocks.executeSearchForTabMock.mockResolvedValue(undefined);
    mocks.fetchNotesMock.mockResolvedValue({});
    mocks.historyRef.value = [{ term: '8517', timestamp: 1 }];
    mocks.sidebarPositionRef.value = 'right';
    setTabsState([buildTab({ id: 'tab-1' })], 'tab-1');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('handles split search terms and skips blank searches', async () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('layout-search-empty'));
    expect(mocks.executeSearchForTabMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('layout-search-single'));
    expect(mocks.executeSearchForTabMock).toHaveBeenNthCalledWith(1, 'tab-1', 'nesh', '8517', true);

    fireEvent.click(screen.getByTestId('layout-search-multi'));
    await waitFor(() => {
      expect(mocks.createTabMock).toHaveBeenCalledWith('nesh');
      expect(mocks.executeSearchForTabMock).toHaveBeenNthCalledWith(2, 'tab-1', 'nesh', '8517', true);
      expect(mocks.executeSearchForTabMock).toHaveBeenNthCalledWith(3, 'new-nesh-1', 'nesh', '9401', true);
    });
  });

  it('creates a new tab for every split term when active tab is occupied', async () => {
    setTabsState([
      buildTab({
        id: 'tab-1',
        ncm: '8517',
        results: buildCodeResults({
          '85': { notas_parseadas: { '1': 'Nota 1' } },
        }, '8517'),
      }),
    ]);

    render(<App />);
    fireEvent.click(screen.getByTestId('layout-search-multi'));

    await waitFor(() => {
      expect(mocks.createTabMock).toHaveBeenNthCalledWith(1, 'nesh');
      expect(mocks.createTabMock).toHaveBeenNthCalledWith(2, 'nesh');
      expect(mocks.executeSearchForTabMock).toHaveBeenNthCalledWith(1, 'new-nesh-1', 'nesh', '8517', true);
      expect(mocks.executeSearchForTabMock).toHaveBeenNthCalledWith(2, 'new-nesh-2', 'nesh', '9401', true);
    });
  });

  it('switches document in-place for empty tab and opens a new tab for populated tab', () => {
    const { unmount } = render(<App />);

    fireEvent.click(screen.getByTestId('layout-set-doc-tipi'));
    expect(mocks.updateTabMock).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({
        document: 'tipi',
        results: null,
        content: null,
        error: null,
        ncm: '',
        isContentReady: false,
        loadedChaptersByDoc: { nesh: [], tipi: [] },
      }),
    );
    expect(mocks.createTabMock).not.toHaveBeenCalled();

    unmount();
    vi.clearAllMocks();
    mocks.createTabMock.mockImplementation((doc: DocType = 'nesh') => `new-${doc}-${++mocks.nextTabIdRef.value}`);
    setTabsState([
      buildTab({
        id: 'tab-1',
        ncm: '8517',
        results: buildCodeResults({ '85': { notas_parseadas: {} } }, '8517'),
      }),
    ]);

    render(<App />);
    fireEvent.click(screen.getByTestId('layout-set-doc-tipi'));
    expect(mocks.createTabMock).toHaveBeenCalledWith('tipi');
    expect(mocks.updateTabMock).not.toHaveBeenCalled();
  });

  it('toggles modal states and handles openInDoc/openInNewTab actions', async () => {
    render(<App />);

    const modal = screen.getByTestId('modal-manager');
    expect(modal).toHaveAttribute('data-settings', 'false');
    expect(modal).toHaveAttribute('data-tutorial', 'false');
    expect(modal).toHaveAttribute('data-stats', 'false');
    expect(modal).toHaveAttribute('data-comparator', 'false');

    fireEvent.click(screen.getByTestId('layout-open-settings'));
    fireEvent.click(screen.getByTestId('layout-open-tutorial'));
    fireEvent.click(screen.getByTestId('layout-open-stats'));
    fireEvent.click(screen.getByTestId('layout-open-comparator'));

    expect(modal).toHaveAttribute('data-settings', 'true');
    expect(modal).toHaveAttribute('data-tutorial', 'true');
    expect(modal).toHaveAttribute('data-stats', 'true');
    expect(modal).toHaveAttribute('data-comparator', 'true');

    fireEvent.click(screen.getByTestId('modal-close-settings'));
    fireEvent.click(screen.getByTestId('modal-close-tutorial'));
    fireEvent.click(screen.getByTestId('modal-close-stats'));
    fireEvent.click(screen.getByTestId('modal-close-comparator'));

    expect(modal).toHaveAttribute('data-settings', 'false');
    expect(modal).toHaveAttribute('data-tutorial', 'false');
    expect(modal).toHaveAttribute('data-stats', 'false');
    expect(modal).toHaveAttribute('data-comparator', 'false');

    fireEvent.click(screen.getByTestId('layout-clear-history'));
    fireEvent.click(screen.getByTestId('layout-remove-history'));
    expect(mocks.clearHistoryMock).toHaveBeenCalledTimes(1);
    expect(mocks.removeFromHistoryMock).toHaveBeenCalledWith('8517');

    fireEvent.click(screen.getByTestId('modal-open-doc-current'));
    expect(mocks.updateTabMock).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({
        document: 'tipi',
        results: null,
        content: null,
        error: null,
        ncm: '',
        isContentReady: false,
        loadedChaptersByDoc: { nesh: [], tipi: [] },
      }),
    );
    expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('tab-1', 'tipi', '1234.56.78', false);

    fireEvent.click(screen.getByTestId('modal-open-doc-new'));
    expect(mocks.createTabMock).toHaveBeenCalledWith('nesh');
    expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('new-nesh-1', 'nesh', '9401', false);

    await waitFor(() => {
      expect(screen.getByTestId('modal-manager')).toHaveAttribute('data-current-doc', 'nesh');
    });
  });

  it('opens search in new tab when current tab already has content', () => {
    setTabsState([
      buildTab({
        id: 'tab-1',
        loading: true,
        ncm: '8517',
        results: buildCodeResults({ '85': { notas_parseadas: {} } }, '8517'),
      }),
    ]);

    render(<App />);
    fireEvent.click(screen.getByTestId('modal-open-doc-current'));

    expect(mocks.createTabMock).toHaveBeenCalledWith('tipi');
    expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('new-tipi-1', 'tipi', '1234.56.78', false);
    expect(mocks.updateTabMock).not.toHaveBeenCalled();
  });

  it('handles delegated smart links and note refs (local + cross chapter + errors)', async () => {
    setTabsState([
      buildTab({
        id: 'tab-1',
        ncm: '8401',
        results: buildCodeResults({
          '84': { notas_parseadas: { '1': 'Nota local 84' } },
        }),
      }),
    ]);

    mocks.fetchNotesMock.mockResolvedValueOnce({ '2': 'Nota cruzada 73' });
    mocks.fetchNotesMock.mockRejectedValueOnce(new Error('boom'));

    render(<App />);

    const smartLink = appendSmartLink('9401');
    fireEvent.click(smartLink);
    expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('tab-1', 'nesh', '9401', true);

    const localNoteRef = appendNoteRef('1', '84');
    fireEvent.click(localNoteRef);
    await waitFor(() => {
      expect(screen.getByTestId('note-panel')).toHaveAttribute('data-open', 'true');
    });
    expect(screen.getByTestId('note-panel')).toHaveAttribute('data-note', '1');
    expect(screen.getByTestId('note-panel')).toHaveAttribute('data-chapter', '84');
    expect(screen.getByTestId('note-panel')).toHaveAttribute('data-content', 'Nota local 84');

    fireEvent.click(screen.getByTestId('note-panel-close'));
    await waitFor(() => {
      expect(screen.getByTestId('note-panel')).toHaveAttribute('data-open', 'false');
    });

    const crossChapterNoteRef = appendNoteRef('2', '73');
    fireEvent.click(crossChapterNoteRef);
    await waitFor(() => {
      expect(mocks.fetchNotesMock).toHaveBeenCalledWith('73');
    });
    expect(mocks.toastMock.loading).toHaveBeenCalledWith('Carregando notas do Capítulo 73...');
    expect(mocks.toastMock.dismiss).toHaveBeenCalledWith('loading-toast');
    await waitFor(() => {
      expect(screen.getByTestId('note-panel')).toHaveAttribute('data-content', 'Nota cruzada 73');
    });

    const crossChapterErrorRef = appendNoteRef('3', '72');
    fireEvent.click(crossChapterErrorRef);
    await waitFor(() => {
      expect(mocks.fetchNotesMock).toHaveBeenCalledWith('72');
    });
    expect(mocks.toastMock.error).toHaveBeenCalledWith('Erro ao carregar notas do Capítulo 72.');
  });

  it('falls back to chapter scroll and errors when note content is missing', () => {
    vi.useFakeTimers();
    setTabsState([
      buildTab({
        id: 'tab-1',
        ncm: '8401',
        results: buildCodeResults({
          '84': { notas_parseadas: {} },
        }),
      }),
    ]);

    render(<App />);

    const container = document.createElement('div');
    container.id = 'results-content-tab-1';
    const notesTarget = document.createElement('div');
    notesTarget.className = 'section-notas';
    container.appendChild(notesTarget);
    document.body.appendChild(container);

    fireEvent.click(appendNoteRef('99', '84'));
    expect(notesTarget.classList.contains('flash-highlight')).toBe(true);
    expect(mocks.toastMock).toHaveBeenCalledWith('Nota 99 não encontrada. Mostrando notas do capítulo.');

    vi.advanceTimersByTime(2000);
    expect(notesTarget.classList.contains('flash-highlight')).toBe(false);

    container.remove();
    fireEvent.click(appendNoteRef('99', '84'));
    expect(mocks.toastMock.error).toHaveBeenCalledWith('Nota 99 não encontrada no capítulo 84.');
  });

  it('shows unavailable and unidentified chapter errors for notes', () => {
    setTabsState([
      buildTab({
        id: 'tab-1',
        ncm: '',
        results: {
          success: true,
          type: 'text',
          query: 'consulta',
          normalized: 'consulta',
          match_type: 'exact',
          warning: null,
          results: [],
          total_capitulos: 0,
        },
      }),
    ]);

    render(<App />);
    fireEvent.click(appendNoteRef('1', '84'));
    expect(mocks.toastMock.error).toHaveBeenCalledWith('Notas indisponíveis para esta aba.');

    setTabsState([
      buildTab({
        id: 'tab-1',
        ncm: '',
        results: buildCodeResults({
          '84': { notas_parseadas: {} },
          '85': { notas_parseadas: {} },
        }, ''),
      }),
    ]);

    const { unmount } = render(<App />);
    fireEvent.click(appendNoteRef('1'));
    expect(mocks.toastMock.error).toHaveBeenCalledWith('Não foi possível identificar o capítulo da nota.');
    unmount();
  });

  it('wires global keyboard shortcut, window bridge and tab/result callbacks', async () => {
    setTabsState(
      [
        buildTab({
          id: 'tab-1',
          document: 'nesh',
          results: buildCodeResults({ '84': { notas_parseadas: { '1': 'Nota da bridge' } } }),
          isContentReady: false,
          isNewSearch: true,
        }),
        buildTab({ id: 'tab-2', document: 'tipi', loading: true }),
        buildTab({ id: 'tab-3', document: 'nesh', error: 'Falha no backend' }),
        buildTab({ id: 'tab-4', document: 'nesh', results: null, loading: false, error: null }),
      ],
      'tab-1',
    );

    const input = document.createElement('input');
    input.id = 'ncmInput';
    document.body.appendChild(input);

    const { unmount } = render(<App />);

    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(input);

    const bridge = (window as any).nesh;
    expect(typeof bridge.smartLinkSearch).toBe('function');
    expect(typeof bridge.openNote).toBe('function');
    expect(typeof bridge.openSettings).toBe('function');

    bridge.smartLinkSearch('8501');
    expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('tab-1', 'nesh', '8501', true);

    act(() => {
      bridge.openSettings();
    });
    expect(screen.getByTestId('modal-manager')).toHaveAttribute('data-settings', 'true');

    await act(async () => {
      bridge.openNote('1', '84');
    });
    await waitFor(() => {
      expect(screen.getByTestId('note-panel')).toHaveAttribute('data-content', 'Nota da bridge');
    });

    expect(screen.getAllByTestId('result-skeleton').length).toBeGreaterThan(0);
    expect(screen.getByText('Falha no backend')).toBeInTheDocument();
    expect(screen.getByText('Pronto para buscar')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('layout-menu-toggle'));
    expect(screen.getByTestId('result-display-tab-1')).toHaveAttribute('data-mobile-open', 'true');
    fireEvent.click(screen.getByTestId('result-close-mobile-tab-1'));
    expect(screen.getByTestId('result-display-tab-1')).toHaveAttribute('data-mobile-open', 'false');

    fireEvent.click(screen.getByTestId('result-consume-scroll-tab-1'));
    expect(mocks.updateTabMock).toHaveBeenCalledWith('tab-1', { isNewSearch: false, scrollTop: 321 });
    fireEvent.click(screen.getByTestId('result-consume-no-scroll-tab-1'));
    expect(mocks.updateTabMock).toHaveBeenCalledWith('tab-1', { isNewSearch: false });
    fireEvent.click(screen.getByTestId('result-persist-tab-1'));
    expect(mocks.updateTabMock).toHaveBeenCalledWith('tab-1', { scrollTop: 77 });
    fireEvent.click(screen.getByTestId('result-ready-tab-1'));
    expect(mocks.updateTabMock).toHaveBeenCalledWith('tab-1', { isContentReady: true });

    fireEvent.click(screen.getByTestId('tabs-new'));
    fireEvent.click(screen.getByTestId('tabs-switch-tab-2'));
    fireEvent.click(screen.getByTestId('tabs-close-tab-2'));
    expect(mocks.createTabMock).toHaveBeenCalledWith('nesh');
    expect(mocks.switchTabMock).toHaveBeenCalledWith('tab-2');
    expect(mocks.closeTabMock).toHaveBeenCalledWith(expect.anything(), 'tab-2');

    unmount();
    expect((window as any).nesh).toBeUndefined();
  });
});
