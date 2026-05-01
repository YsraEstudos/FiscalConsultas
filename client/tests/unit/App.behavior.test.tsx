import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../src/App';

type DocType = 'nesh' | 'tipi' | 'nbs';

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
  latestTextQuery?: string;
};

const mocks = vi.hoisted(() => {
  const toastMock = Object.assign(vi.fn(), {
    error: vi.fn(),
    loading: vi.fn(() => 'loading-toast'),
    dismiss: vi.fn(),
  });

  return {
    toastMock,
    installLocalDbMock: vi.fn(),
    createTabMock: vi.fn(),
    closeTabMock: vi.fn(),
    switchTabMock: vi.fn(),
    updateTabMock: vi.fn(),
    ensureServicesAccessMock: vi.fn(),
    ensureServicesSearchAccessMock: vi.fn(),
    refreshServicesStatusMock: vi.fn(),
    executeSearchForTabMock: vi.fn(),
    reportClientErrorMock: vi.fn(),
    addToHistoryMock: vi.fn(),
    removeFromHistoryMock: vi.fn(),
    clearHistoryMock: vi.fn(),
    fetchNotesMock: vi.fn(),
    nextTabIdRef: { value: 0 },
    sidebarPositionRef: { value: 'right' as 'left' | 'right' },
    historyRef: { value: [{ term: '8517', timestamp: 1 }] as Array<{ term: string; timestamp: number }> },
    localDbStatusRef: { value: 'ready' as 'checking' | 'not_installed' | 'installing' | 'ready' | 'updating' | 'error' | 'unsupported' },
    localDbProgressRef: { value: 0 },
    tabsStateRef: {
      value: {
        tabs: [] as MockTab[],
        tabsById: new Map<string, MockTab>(),
        activeTabId: 'tab-1',
        activeTab: null as MockTab | null,
      },
    },
  resultDisplayCrashTabIdRef: { value: null as string | null },
  hydratedResultsRef: { value: null as Record<string, any> | null },
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
    onOpenStats,
    onOpenComparator,
    onOpenModerate,
    onOpenProfile,
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
      <button data-testid="layout-open-stats" onClick={onOpenStats}>
        open-stats
      </button>
      <button data-testid="layout-open-comparator" onClick={onOpenComparator}>
        open-comparator
      </button>
      <button data-testid="layout-open-moderate" onClick={onOpenModerate}>
        open-moderate
      </button>
      <button data-testid="layout-open-profile" onClick={onOpenProfile}>
        open-profile
      </button>
      <button data-testid="layout-set-doc-nbs" onClick={() => setDoc('nbs')}>
        setdoc-nbs
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
    latestTextQuery,
    mobileMenuOpen,
    isActive,
    onCloseMobileMenu,
    onToggleMobileMenu,
    onConsumeNewSearch,
    onPersistScroll,
    onContentReady,
    onHydratedResults,
  }: any) => (
    (() => {
      if (mocks.resultDisplayCrashTabIdRef.value === tabId) {
        throw new Error(`ResultDisplay crashed for ${tabId}`);
      }

      return (
        <div
          data-testid={`result-display-${tabId}`}
          data-mobile-open={String(Boolean(mobileMenuOpen))}
          data-active={String(Boolean(isActive))}
          data-latest-text-query={latestTextQuery ?? ''}
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
          <button
            data-testid={`result-hydrate-${tabId}`}
            onClick={() => onHydratedResults?.(tabId, mocks.hydratedResultsRef.value)}
          >
            hydrate
          </button>
          <button data-testid={`result-close-mobile-${tabId}`} onClick={onCloseMobileMenu}>
            close-mobile
          </button>
          <button data-testid={`result-toggle-mobile-${tabId}`} onClick={onToggleMobileMenu}>
            toggle-mobile
          </button>
        </div>
      );
    })()
  ),
}));

vi.mock('../../src/components/ResultSkeleton', () => ({
  ResultSkeleton: () => <div data-testid="result-skeleton" />,
}));

vi.mock('../../src/components/ServicesTabContent', () => ({
  ServicesTabContent: ({
    doc,
    onSwitchDoc,
    onOpenDocInNewTab,
    onContentReady,
  }: any) => (
    <div data-testid={`services-tab-content-${doc}`}>
      <button data-testid={`services-switch-${doc}`} onClick={() => onSwitchDoc('nbs', '1.0101.11.00')}>
        switch
      </button>
      <button data-testid={`services-open-new-${doc}`} onClick={() => onOpenDocInNewTab('nbs', '1.0101.11.00')}>
        open-new-tab
      </button>
      <button data-testid={`services-ready-${doc}`} onClick={onContentReady}>
        ready
      </button>
    </div>
  ),
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
      data-moderate={String(modals.moderate)}
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
      <button data-testid="modal-close-moderate" onClick={onClose.moderate}>
        close-moderate
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

vi.mock('../../src/components/UserProfilePage', () => ({
  UserProfilePage: ({ isOpen, onClose }: any) => (
    <div data-testid="user-profile-page" data-open={String(Boolean(isOpen))}>
      <button data-testid="user-profile-close" onClick={onClose}>
        close-profile
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

vi.mock('../../src/utils/errorMonitoring', () => ({
  reportClientError: mocks.reportClientErrorMock,
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

vi.mock('../../src/hooks/useServicesAccess', () => ({
  useServicesAccess: () => ({
    ensureServicesAccess: mocks.ensureServicesAccessMock,
    ensureServicesSearchAccess: mocks.ensureServicesSearchAccessMock,
    refreshServicesStatus: mocks.refreshServicesStatusMock,
    servicesAvailability: 'unknown',
    servicesUnavailableReason: null,
  }),
}));

vi.mock('../../src/context/LocalDatabaseContext', () => ({
  useLocalDatabase: () => ({
    status: mocks.localDbStatusRef.value,
    progress: mocks.localDbProgressRef.value,
    install: mocks.installLocalDbMock,
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
    loadedChaptersByDoc: { nesh: [], tipi: [], nbs: [] },
    latestTextQuery: undefined,
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

function buildServiceResults(query = '1.0101.11.00') {
  return {
    success: true,
    query,
    normalized: query,
    total: 1,
    results: [{
      code: query,
      code_clean: '101011100',
      description: 'Serviços de construção de edificações residenciais de um e dois pavimentos',
      parent_code: '1.0101.1',
      level: 3,
    }],
  };
}

function setActiveNbsTab(query = '1.1706.90.00') {
  setTabsState([
    buildTab({
      id: 'tab-1',
      document: 'nbs',
      ncm: query,
      results: buildServiceResults(query),
    }),
  ]);
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

function appendServiceLink(serviceCode: string) {
  const serviceLink = document.createElement('span');
  serviceLink.className = 'service-smart-link service-code-target';
  serviceLink.dataset.serviceCode = serviceCode;
  serviceLink.textContent = serviceCode;
  document.body.appendChild(serviceLink);
  return serviceLink;
}

function middleMouseDownServiceLink(serviceCode: string) {
  const serviceLink = appendServiceLink(serviceCode);
  fireEvent.mouseDown(serviceLink, { bubbles: true, button: 1 });
  return serviceLink;
}

function appendBrokenServiceLink() {
  const serviceLink = document.createElement('span');
  serviceLink.className = 'service-smart-link service-code-target';
  serviceLink.textContent = 'broken-service-link';
  document.body.appendChild(serviceLink);
  return serviceLink;
}

function appendNoteRef(note: string, chapter?: string, tagName: 'button' | 'a' = 'button') {
  const noteRef = document.createElement(tagName);
  noteRef.className = 'note-ref';
  noteRef.dataset.note = note;
  if (noteRef instanceof HTMLAnchorElement) {
    noteRef.href = '#nota';
  }
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
    mocks.localDbStatusRef.value = 'ready';
    mocks.localDbProgressRef.value = 0;
    mocks.createTabMock.mockImplementation((doc: DocType = 'nesh') => `new-${doc}-${++mocks.nextTabIdRef.value}`);
    mocks.ensureServicesAccessMock.mockResolvedValue(true);
    mocks.ensureServicesSearchAccessMock.mockResolvedValue(true);
    mocks.refreshServicesStatusMock.mockResolvedValue(undefined);
    mocks.executeSearchForTabMock.mockResolvedValue(undefined);
    mocks.reportClientErrorMock.mockReset();
    mocks.fetchNotesMock.mockResolvedValue({});
    mocks.historyRef.value = [{ term: '8517', timestamp: 1 }];
    mocks.sidebarPositionRef.value = 'right';
    mocks.resultDisplayCrashTabIdRef.value = null;
    mocks.hydratedResultsRef.value = null;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1440,
      writable: true,
    });
    setTabsState([buildTab({ id: 'tab-1' })], 'tab-1');
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('.smart-link, .note-ref, #ncmInput, [id^="results-content-"]').forEach((node) => {
      node.remove();
    });
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

  it('reports async search failures through reportClientError', async () => {
    mocks.executeSearchForTabMock.mockRejectedValueOnce(new Error('boom'));

    render(<App />);

    fireEvent.click(screen.getByTestId('layout-search-single'));

    await waitFor(() => {
      expect(mocks.reportClientErrorMock).toHaveBeenCalledWith(expect.objectContaining({
        source: 'async-task',
        context: 'handleSearch',
        handled: true,
        error: expect.any(Error),
      }));
    });
  });

  it('does not render the configured-offline status icon when offline DB is ready', async () => {
    mocks.localDbStatusRef.value = 'ready';

    render(<App />);

    expect(screen.queryByTitle('Buscas Offline configuradas!')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Baixar BD para habilitar as buscas')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('layout-search-single'));

    await waitFor(() => {
      expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('tab-1', 'nesh', '8517', true);
    });

    expect(mocks.installLocalDbMock).not.toHaveBeenCalled();
    expect(mocks.toastMock.error).not.toHaveBeenCalledWith('O banco de dados precisa estar baixado e ativo para pesquisas locais.');
  });

  it('keeps searches working and offers install when offline DB is not installed', async () => {
    mocks.localDbStatusRef.value = 'not_installed';

    render(<App />);

    const downloadButton = screen.getByTitle('Baixar BD para habilitar as buscas');
    expect(downloadButton).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('layout-search-single'));

    await waitFor(() => {
      expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('tab-1', 'nesh', '8517', true);
    });
    expect(mocks.toastMock.error).not.toHaveBeenCalledWith('O banco de dados precisa estar baixado e ativo para pesquisas locais.');

    fireEvent.click(downloadButton);
    expect(mocks.installLocalDbMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['checking', 'Baixando... 0%'],
    ['installing', 'Baixando... 0%'],
    ['updating', 'Atualizando... 42%'],
  ] as const)('renders the busy offline action for %s', (status, title) => {
    mocks.localDbStatusRef.value = status;
    mocks.localDbProgressRef.value = status === 'updating' ? 42 : 0;

    render(<App />);

    expect(screen.getByTitle(title)).toBeInTheDocument();
    expect(mocks.installLocalDbMock).not.toHaveBeenCalled();
  });

  it('renders retry and disabled offline actions for error and unsupported states', () => {
    mocks.localDbStatusRef.value = 'error';

    const { rerender } = render(<App />);

    fireEvent.click(screen.getByTitle('Erro ao baixar. Tentar de novo'));
    expect(mocks.installLocalDbMock).toHaveBeenCalledTimes(1);

    mocks.localDbStatusRef.value = 'unsupported';
    rerender(<App />);

    expect(screen.getByTitle('Este navegador não suporta banco offline')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Baixar BD para habilitar as buscas' })).not.toBeInTheDocument();
  });

  it('blocks service searches when the service access check denies search mode', async () => {
    mocks.ensureServicesSearchAccessMock.mockResolvedValue(false);
    setTabsState([
      buildTab({
        id: 'tab-1',
        document: 'nbs',
        results: buildServiceResults('nbs'),
      }),
    ]);

    render(<App />);

    fireEvent.click(screen.getByTestId('layout-search-single'));

    await waitFor(() => {
      expect(mocks.ensureServicesSearchAccessMock).toHaveBeenCalledTimes(1);
    });
    expect(mocks.executeSearchForTabMock).not.toHaveBeenCalled();
  });

  it('blocks service tab switching when search access is denied', async () => {
    mocks.ensureServicesSearchAccessMock.mockResolvedValue(false);
    setTabsState([
      buildTab({
        id: 'tab-1',
        document: 'nbs',
        ncm: '1.0101.11.00',
        results: buildServiceResults('nbs'),
      }),
    ]);

    render(<App />);

    fireEvent.click(screen.getByTestId('services-switch-nbs'));

    await waitFor(() => {
      expect(mocks.ensureServicesSearchAccessMock).toHaveBeenCalledTimes(1);
    });
    expect(mocks.updateTabMock).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({
        document: 'nbs',
        results: null,
        content: null,
        error: null,
        ncm: '',
        isContentReady: false,
      }),
    );
    expect(mocks.executeSearchForTabMock).not.toHaveBeenCalled();
  });

  it.each(['nbs'] as const)('opens text result tabs in nesh when the active document is %s', async (doc) => {
    setTabsState([
      buildTab({
        id: 'tab-1',
        document: doc,
        results: buildServiceResults('nbs'),
      }),
    ]);

    render(<App />);

    const bridge = (globalThis as any).nesh;
    await act(async () => {
      await bridge.openTextResultInNewTab('8422', 'motor centrifo');
    });

    expect(mocks.createTabMock).toHaveBeenCalledWith('nesh', true);
    expect(mocks.updateTabMock).toHaveBeenCalledWith('new-nesh-1', { latestTextQuery: 'motor centrifo' });
    expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('new-nesh-1', 'nesh', '8422', false);
  });

  it('opens service links in NBS background tabs on middle mouse down', async () => {
    setActiveNbsTab();

    render(<App />);

    middleMouseDownServiceLink('1.17');

    await waitFor(() => {
      expect(mocks.createTabMock).toHaveBeenCalledWith('nbs', false);
      expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('new-nbs-1', 'nbs', '1.17', false);
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
        loadedChaptersByDoc: { nesh: [], tipi: [], nbs: [] },
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

  it('opens NBS immediately without forcing a background availability refresh', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('layout-set-doc-nbs'));

    expect(mocks.updateTabMock).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({
        document: 'nbs',
        results: null,
        content: null,
        error: null,
        ncm: '',
      }),
    );
    expect(mocks.refreshServicesStatusMock).not.toHaveBeenCalled();
    expect(mocks.ensureServicesAccessMock).not.toHaveBeenCalled();
  });

  it('opens and closes the moderate comments modal from the layout menu', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('layout-open-moderate'));
    expect(screen.getByTestId('modal-manager')).toHaveAttribute('data-moderate', 'true');

    fireEvent.click(screen.getByTestId('modal-close-moderate'));
    expect(screen.getByTestId('modal-manager')).toHaveAttribute('data-moderate', 'false');
  });

  it('opens and closes the profile page from the layout menu', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('layout-open-profile'));
    expect(screen.getByTestId('user-profile-page')).toHaveAttribute('data-open', 'true');

    fireEvent.click(screen.getByTestId('user-profile-close'));
    expect(screen.getByTestId('user-profile-page')).toHaveAttribute('data-open', 'false');
  });

  it('wires the restored services tab callbacks back into App state transitions', async () => {
    // This intentionally clicks nbs -> nbs: the test protects that
    // switchTabDocument still resets state via updateTabMock and re-triggers
    // executeSearchForTab instead of short-circuiting same-document services links.
    setTabsState([
      buildTab({
        document: 'nbs',
        results: buildServiceResults(),
        ncm: '1.0101.11.00',
        isContentReady: false,
      }),
    ]);

    render(<App />);

    fireEvent.click(screen.getByTestId('services-switch-nbs'));

    expect(mocks.updateTabMock).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({
        document: 'nbs',
        results: null,
        content: null,
        error: null,
        ncm: '',
        isContentReady: false,
      }),
    );
    expect(mocks.refreshServicesStatusMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('tab-1', 'nbs', '1.0101.11.00', false);
    });
    expect(mocks.ensureServicesAccessMock).not.toHaveBeenCalled();
  });

  it('wires the services tab open-new and ready callbacks back into App state transitions', async () => {
    setTabsState([
      buildTab({
        document: 'nbs',
        results: buildServiceResults('nbs'),
        ncm: '1.0101.11.00',
        isContentReady: false,
      }),
    ]);

    render(<App />);

    fireEvent.click(screen.getByTestId('services-open-new-nbs'));
    fireEvent.click(screen.getByTestId('services-ready-nbs'));

    await waitFor(() => {
      expect(mocks.createTabMock).toHaveBeenCalledWith('nbs');
      expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('new-nbs-1', 'nbs', '1.0101.11.00', false);
    });
    expect(mocks.updateTabMock).toHaveBeenCalledWith('tab-1', { isContentReady: true });
  });

  it('toggles modal states and handles openInDoc/openInNewTab actions', async () => {
    render(<App />);

    const modal = screen.getByTestId('modal-manager');
    expect(modal).toHaveAttribute('data-settings', 'false');
    expect(modal).toHaveAttribute('data-tutorial', 'false');
    expect(modal).toHaveAttribute('data-stats', 'false');
    expect(modal).toHaveAttribute('data-comparator', 'false');

    fireEvent.click(screen.getByTestId('layout-open-settings'));
    fireEvent.click(screen.getByTestId('layout-open-stats'));
    fireEvent.click(screen.getByTestId('layout-open-comparator'));

    expect(modal).toHaveAttribute('data-settings', 'true');
    expect(modal).toHaveAttribute('data-tutorial', 'false');
    expect(modal).toHaveAttribute('data-stats', 'true');
    expect(modal).toHaveAttribute('data-comparator', 'true');

    fireEvent.click(screen.getByTestId('modal-close-settings'));
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
        loadedChaptersByDoc: { nesh: [], tipi: [], nbs: [] },
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
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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

    try {
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
      expect(consoleErrorSpy).toHaveBeenCalledWith('Erro no fetchCrossChapterNotes:', expect.any(Error));
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('toasts when notes are requested from a code tab without a results map', async () => {
    setTabsState([
      buildTab({
        id: 'tab-1',
        ncm: '8413',
        results: {
          type: 'code',
          query: '8413',
          resultados: null,
          results: null,
        } as any,
      }),
    ]);

    render(<App />);

    fireEvent.click(appendNoteRef('1', '84'));

    await waitFor(() => {
      expect(mocks.toastMock.error).toHaveBeenCalledWith('Notas indisponíveis para esta aba.');
    });
  });

  it('opens local notes from hydrated chapter data after ResultDisplay updates the tab snapshot', async () => {
    setTabsState([
      buildTab({
        id: 'tab-1',
        ncm: '8413',
        results: buildCodeResults({
          '84': {
            capitulo: '84',
            conteudo: '',
            notas_parseadas: {},
            posicoes: [],
          },
        }, '8413'),
      }),
    ]);

    mocks.hydratedResultsRef.value = {
      '84': {
        capitulo: '84',
        conteudo: 'Conteúdo hidratado',
        notas_parseadas: { '4': 'Nota 4 hidratada' },
        posicoes: [],
      },
    };

    mocks.updateTabMock.mockImplementation((
      tabId: string,
      updatesOrUpdater:
        | Partial<MockTab>
        | ((currentTab: MockTab | undefined) => Partial<MockTab> | undefined),
    ) => {
      const currentTab = mocks.tabsStateRef.value.tabsById.get(tabId);
      const updates = typeof updatesOrUpdater === 'function'
        ? updatesOrUpdater(currentTab)
        : updatesOrUpdater;

      if (!currentTab || !updates) {
        return;
      }

      const nextTabs = mocks.tabsStateRef.value.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, ...updates } : tab
      );
      setTabsState(nextTabs, tabId);
    });

    const { rerender } = render(<App />);

    fireEvent.click(screen.getByTestId('result-hydrate-tab-1'));

    await waitFor(() => {
      expect(mocks.updateTabMock).toHaveBeenCalledWith('tab-1', expect.any(Function));
    });
    rerender(<App />);

    const localNoteRef = appendNoteRef('4');
    fireEvent.click(localNoteRef);

    await waitFor(() => {
      expect(screen.getByTestId('note-panel')).toHaveAttribute('data-open', 'true');
    });
    expect(screen.getByTestId('note-panel')).toHaveAttribute('data-note', '4');
    expect(screen.getByTestId('note-panel')).toHaveAttribute('data-chapter', '84');
    expect(screen.getByTestId('note-panel')).toHaveAttribute('data-content', 'Nota 4 hidratada');
    expect(mocks.toastMock).not.toHaveBeenCalledWith('Nota 4 não encontrada. Mostrando notas do capítulo.');
  });

  it('ignores hydrated results when the tab id no longer matches the current tab', async () => {
    setTabsState([
      buildTab({
        id: 'tab-1',
        ncm: '8413',
        results: buildCodeResults({
          '84': {
            capitulo: '84',
            conteudo: '',
            notas_parseadas: {},
            posicoes: [],
          },
        }, '8413'),
      }),
    ]);

    mocks.hydratedResultsRef.value = {
      '84': {
        capitulo: '84',
        conteudo: 'Conteúdo hidratado',
        notas_parseadas: {},
        posicoes: [],
      },
    };

    let observedUpdates: unknown;
    mocks.updateTabMock.mockImplementation((tabId: string, updatesOrUpdater: any) => {
      const mismatchedTab = buildTab({
        id: 'other-tab',
        results: buildCodeResults({
          '84': {
            capitulo: '84',
            conteudo: '',
            notas_parseadas: {},
            posicoes: [],
          },
        }, '8413'),
      });

      observedUpdates = typeof updatesOrUpdater === 'function'
        ? updatesOrUpdater(mismatchedTab)
        : updatesOrUpdater;
      return tabId;
    });

    render(<App />);

    fireEvent.click(screen.getByTestId('result-hydrate-tab-1'));

    await waitFor(() => {
      expect(mocks.updateTabMock).toHaveBeenCalledWith('tab-1', expect.any(Function));
    });
    expect(observedUpdates).toBeUndefined();
    mocks.updateTabMock.mockReset();
  });

  it('ignores hydrated results when the current tab results are not code search data', async () => {
    setTabsState([
      buildTab({
        id: 'tab-1',
        document: 'nesh',
        results: buildServiceResults('nbs') as any,
      }),
    ]);

    mocks.hydratedResultsRef.value = {
      '84': {
        capitulo: '84',
        conteudo: 'Conteúdo hidratado',
        notas_parseadas: {},
        posicoes: [],
      },
    };

    let observedUpdates: unknown;
    mocks.updateTabMock.mockImplementation((tabId: string, updatesOrUpdater: any) => {
      const currentTab = mocks.tabsStateRef.value.tabsById.get(tabId);
      observedUpdates = typeof updatesOrUpdater === 'function'
        ? updatesOrUpdater(currentTab)
        : updatesOrUpdater;
      return tabId;
    });

    render(<App />);

    fireEvent.click(screen.getByTestId('result-hydrate-tab-1'));

    await waitFor(() => {
      expect(mocks.updateTabMock).toHaveBeenCalledWith('tab-1', expect.any(Function));
    });
    expect(observedUpdates).toBeUndefined();
    mocks.updateTabMock.mockReset();
  });

  it('skips tab hydration entirely when the hydrated payload is missing', async () => {
    setTabsState([
      buildTab({
        id: 'tab-1',
        ncm: '8413',
        results: buildCodeResults({
          '84': {
            capitulo: '84',
            conteudo: '',
            notas_parseadas: {},
            posicoes: [],
          },
        }, '8413'),
      }),
    ]);

    mocks.hydratedResultsRef.value = null;

    render(<App />);

    fireEvent.click(screen.getByTestId('result-hydrate-tab-1'));

    await waitFor(() => {
      expect(mocks.updateTabMock).not.toHaveBeenCalled();
    });
  });

  it('opens smart links in background tab on middle mouse down', async () => {
    render(<App />);

    const smartLink = appendSmartLink('9401');
    fireEvent.mouseDown(smartLink, { bubbles: true, button: 1 });

    await waitFor(() => {
      expect(mocks.createTabMock).toHaveBeenCalledWith('nesh', false);
      expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('new-nesh-1', 'nesh', '9401', false);
    });
  });

  it('keeps note navigation working when a smart-link anchor has no NCM data', async () => {
    setTabsState([
      buildTab({
        id: 'tab-1',
        ncm: '8401',
        results: buildCodeResults({
          '84': { notas_parseadas: { '1': 'Nota combinada' } },
        }),
      }),
    ]);

    render(<App />);

    const hybridLink = appendSmartLink('');
    hybridLink.classList.add('note-ref');
    hybridLink.dataset.note = '1';
    hybridLink.dataset.chapter = '84';

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    hybridLink.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(screen.getByTestId('note-panel')).toHaveAttribute('data-open', 'true');
      expect(screen.getByTestId('note-panel')).toHaveAttribute('data-content', 'Nota combinada');
    });
    expect(mocks.executeSearchForTabMock).not.toHaveBeenCalled();
  });

  it('routes delegated service link clicks through the document click handler', async () => {
    setActiveNbsTab();

    render(<App />);

    const serviceLink = appendServiceLink('1.17');
    fireEvent.click(serviceLink);

    await waitFor(() => {
      expect(mocks.ensureServicesSearchAccessMock).toHaveBeenCalledTimes(1);
      expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('tab-1', 'nbs', '1.17', true);
    });
  });

  it('ignores delegated service links that are missing a service code', () => {
    setActiveNbsTab();

    render(<App />);

    fireEvent.click(appendBrokenServiceLink());

    expect(mocks.executeSearchForTabMock).not.toHaveBeenCalled();
    expect(mocks.createTabMock).not.toHaveBeenCalled();
  });

  it('opens service links in NBS background tabs on middle mouse down', async () => {
    setActiveNbsTab();

    render(<App />);

    middleMouseDownServiceLink('1.1706.90.00');
    middleMouseDownServiceLink('1.17');

    await waitFor(() => {
      expect(mocks.createTabMock).toHaveBeenNthCalledWith(1, 'nbs', false);
      expect(mocks.createTabMock).toHaveBeenNthCalledWith(2, 'nbs', false);
      expect(mocks.executeSearchForTabMock).toHaveBeenNthCalledWith(1, 'new-nbs-1', 'nbs', '1.1706.90.00', false);
      expect(mocks.executeSearchForTabMock).toHaveBeenNthCalledWith(2, 'new-nbs-2', 'nbs', '1.17', false);
    });
  });

  it('renders inactive ResultDisplay instances with a no-op mobile toggle handler', () => {
    setTabsState([
      buildTab({
        id: 'tab-1',
        results: buildCodeResults({
          '84': { notas_parseadas: {} },
        }, '8413'),
      }),
      buildTab({
        id: 'tab-2',
        results: buildCodeResults({
          '85': { notas_parseadas: {} },
        }, '8517'),
      }),
    ], 'tab-1');

    render(<App />);

    expect(screen.getByTestId('result-display-tab-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('result-display-tab-2')).toHaveAttribute('data-active', 'false');

    fireEvent.click(screen.getByTestId('result-toggle-mobile-tab-1'));

    expect(screen.getByTestId('result-display-tab-1')).toHaveAttribute('data-mobile-open', 'true');
    expect(screen.getByTestId('result-display-tab-2')).toHaveAttribute('data-mobile-open', 'false');

    fireEvent.click(screen.getByTestId('result-toggle-mobile-tab-2'));

    expect(screen.getByTestId('result-display-tab-1')).toHaveAttribute('data-mobile-open', 'true');
    expect(screen.getByTestId('result-display-tab-2')).toHaveAttribute('data-mobile-open', 'false');
  });

  it('opens service links on middle mouse down to avoid scroll-mode swallowing', async () => {
    setActiveNbsTab('1.1701.1');

    render(<App />);

    middleMouseDownServiceLink('1.17');

    await waitFor(() => {
      expect(mocks.createTabMock).toHaveBeenCalledWith('nbs', false);
      expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('new-nbs-1', 'nbs', '1.17', false);
    });
  });

  it('prevents native navigation for note-ref anchors handled by delegated notes', async () => {
    setTabsState([
      buildTab({
        id: 'tab-1',
        ncm: '8401',
        results: buildCodeResults({
          '84': { notas_parseadas: { '1': 'Nota local 84' } },
        }),
      }),
    ]);

    render(<App />);

    const noteRef = appendNoteRef('1', '84', 'a');
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    noteRef.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(screen.getByTestId('note-panel')).toHaveAttribute('data-open', 'true');
      expect(screen.getByTestId('note-panel')).toHaveAttribute('data-content', 'Nota local 84');
    });
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

  it('escapes chapter selectors when falling back to notes section scroll', () => {
    vi.useFakeTimers();
    setTabsState([
      buildTab({
        id: 'tab-1',
        ncm: '8401',
        results: buildCodeResults({
          '84.1': { notas_parseadas: {} },
        }),
      }),
    ]);

    render(<App />);

    const container = document.createElement('div');
    container.id = 'results-content-tab-1';
    const notesTarget = document.createElement('div');
    notesTarget.id = 'chapter-84.1-notas';
    container.appendChild(notesTarget);
    document.body.appendChild(container);

    fireEvent.click(appendNoteRef('99', '84.1'));
    expect(notesTarget.classList.contains('flash-highlight')).toBe(true);
    expect(mocks.toastMock).toHaveBeenCalledWith('Nota 99 não encontrada. Mostrando notas do capítulo.');

    vi.advanceTimersByTime(2000);
    expect(notesTarget.classList.contains('flash-highlight')).toBe(false);

    container.remove();
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
          latestTextQuery: 'motor',
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

    fireEvent.keyDown(globalThis, { key: '/' });
    expect(document.activeElement).toBe(input);

    const bridge = (globalThis as any).nesh;
    expect(typeof bridge.smartLinkSearch).toBe('function');
    expect(typeof bridge.openNote).toBe('function');
    expect(typeof bridge.openSettings).toBe('function');
    expect(typeof bridge.openTextResultInNewTab).toBe('function');

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

    expect(screen.getByTestId('result-display-tab-1')).toHaveAttribute('data-latest-text-query', 'motor');

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

    await act(async () => {
      await bridge.openTextResultInNewTab('8422', 'motor centrifo');
    });
    expect(mocks.updateTabMock).toHaveBeenCalledWith('new-nesh-2', { latestTextQuery: 'motor centrifo' });
    expect(mocks.executeSearchForTabMock).toHaveBeenCalledWith('new-nesh-2', 'nesh', '8422', false);

    unmount();
    expect((globalThis as any).nesh).toBeUndefined();
  });

  it('keeps the layout visible when ResultDisplay crashes, shows a fallback, and recovers after retry', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.resultDisplayCrashTabIdRef.value = 'tab-1';
    setTabsState([
      buildTab({
        id: 'tab-1',
        document: 'nesh',
        results: buildCodeResults({ '84': { notas_parseadas: {} } }),
      }),
    ]);

    try {
      render(<App />);

      expect(screen.getByTestId('layout')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Não foi possível renderizar os resultados.')).toBeInTheDocument();

      mocks.resultDisplayCrashTabIdRef.value = null;
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

      await waitFor(() => {
        expect(screen.getByTestId('result-display-tab-1')).toBeInTheDocument();
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
