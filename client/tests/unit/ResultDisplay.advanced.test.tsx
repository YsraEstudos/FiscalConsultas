import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marked } from 'marked';

import { ResultDisplay } from '../../src/components/ResultDisplay';
import { NeshRenderer } from '../../src/utils/NeshRenderer';

const hoisted = vi.hoisted(() => ({
  sidebarPositionRef: { value: 'right' as 'left' | 'right' },
  robustCallsRef: { value: [] as any[] },
  debugWarnMock: vi.fn(),
  toastErrorMock: vi.fn(),
  getNeshChapterBodyMock: vi.fn(),
  authStateRef: {
    value: {
      userName: 'Teste',
      userImageUrl: null as string | null,
      isSignedIn: true,
      isLoading: false,
      userId: 'user_test',
      canUseRestrictedUi: true,
    },
  },
  commentsStateRef: {
    value: {
      comments: [] as any[],
      addComment: vi.fn(),
      editComment: vi.fn(),
      removeComment: vi.fn(),
      commentedAnchors: [] as string[],
      loadCommentedAnchors: vi.fn().mockResolvedValue([]),
      loadComments: vi.fn().mockResolvedValue(undefined),
      resetFetchedAnchors: vi.fn(),
    },
  },
  selectionStateRef: {
    value: {
      selection: null as any,
      clearSelection: vi.fn(),
      onPopoverMouseDown: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/api', () => ({
  getNeshChapterBody: hoisted.getNeshChapterBodyMock,
}));

vi.mock('../../src/context/SettingsContext', () => ({
  useSettings: () => ({
    sidebarPosition: hoisted.sidebarPositionRef.value,
  }),
}));

vi.mock('../../src/hooks/useRobustScroll', () => ({
  useRobustScroll: (args: any) => {
    hoisted.robustCallsRef.value.push(args);
  },
}));

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => hoisted.authStateRef.value,
}));

vi.mock('../../src/hooks/useComments', () => ({
  useComments: () => hoisted.commentsStateRef.value,
}));

vi.mock('../../src/hooks/useTextSelection', () => ({
  useTextSelection: () => hoisted.selectionStateRef.value,
}));

vi.mock('../../src/components/HighlightPopover', () => ({
  HighlightPopover: ({ selection, onRequestComment, onPopoverMouseDown }: any) => (
    <div data-testid="highlight-popover">
      <span data-testid="highlight-selection">{selection?.text ?? ''}</span>
      <button data-testid="highlight-request-comment" onMouseDown={onPopoverMouseDown} onClick={onRequestComment}>
        request-comment
      </button>
    </div>
  ),
}));

vi.mock('../../src/components/CommentPanel', () => ({
  CommentPanel: ({ pending, comments, currentUserId, onSubmit, onDismiss, onEdit, onDelete }: any) => (
    <div data-testid="comment-panel" data-user-id={currentUserId ?? ''}>
      <span data-testid="comment-panel-pending">{pending?.anchorKey ?? ''}</span>
      <span data-testid="comment-panel-count">{comments.length}</span>
      <button data-testid="comment-panel-submit" onClick={() => onSubmit('Comentário enviado', false)}>
        submit-comment
      </button>
      <button data-testid="comment-panel-dismiss" onClick={onDismiss}>
        dismiss-comment
      </button>
      <button data-testid="comment-panel-edit" onClick={() => onEdit('comment-1', 'Editado')}>
        edit-comment
      </button>
      <button data-testid="comment-panel-delete" onClick={() => onDelete('comment-1')}>
        delete-comment
      </button>
    </div>
  ),
}));

vi.mock('../../src/components/CommentDrawer', () => ({
  CommentDrawer: ({ open, pending, comments, currentUserId, onClose, onSubmit, onDismiss, onEdit, onDelete }: any) => (
    <div data-testid="comment-drawer" data-open={String(Boolean(open))} data-user-id={currentUserId ?? ''}>
      <span data-testid="comment-drawer-pending">{pending?.anchorKey ?? ''}</span>
      <span data-testid="comment-drawer-count">{comments.length}</span>
      <span data-testid="comment-drawer-user-id">{currentUserId ?? ''}</span>
      <button data-testid="comment-drawer-close" onClick={onClose}>
        close-drawer
      </button>
      <button data-testid="comment-drawer-submit" onClick={() => onSubmit('Comentário drawer', true)}>
        submit-drawer
      </button>
      <button data-testid="comment-drawer-dismiss" onClick={onDismiss}>
        dismiss-drawer
      </button>
      <button data-testid="comment-drawer-edit" onClick={() => onEdit?.('comment-1', 'Editado drawer')}>
        edit-drawer
      </button>
      <button data-testid="comment-drawer-delete" onClick={() => onDelete?.('comment-1')}>
        delete-drawer
      </button>
    </div>
  ),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: hoisted.toastErrorMock,
    success: vi.fn(),
  },
}));

vi.mock('../../src/utils/debug', () => ({
  debug: {
    warn: hoisted.debugWarnMock,
  },
}));

vi.mock('../../src/components/TextSearchResults', () => ({
  TextSearchResults: ({ results, query, onResultClick }: any) => (
    <div data-testid="text-results-mock">
      <span data-testid="text-results-count">{results?.length ?? 0}</span>
      <span data-testid="text-results-query">{query}</span>
      <button data-testid="text-result-click" onClick={() => onResultClick('8517')}>
        trigger-result-click
      </button>
    </div>
  ),
}));

vi.mock('../../src/components/Sidebar', () => ({
  Sidebar: ({ onNavigate, activeAnchorId, isOpen, searchQuery }: any) => (
    <div data-testid="sidebar-mock" data-open={String(Boolean(isOpen))} data-query={searchQuery ?? ''}>
      <span data-testid="sidebar-active-anchor">{activeAnchorId ?? ''}</span>
      <button data-testid="sidebar-nav-generated" onClick={() => onNavigate('84.13')}>
        nav-generated
      </button>
      <button data-testid="sidebar-nav-tipi" onClick={() => onNavigate('1108.1')}>
        nav-tipi
      </button>
      <button data-testid="sidebar-nav-direct" onClick={() => onNavigate('pos-85-17')}>
        nav-direct
      </button>
      <button data-testid="sidebar-nav-section" onClick={() => onNavigate('chapter-84-consideracoes')}>
        nav-section
      </button>
      <button data-testid="sidebar-nav-missing" onClick={() => onNavigate('missing-anchor')}>
        nav-missing
      </button>
    </div>
  ),
}));

function renderDataNcmFallbackCase({
  query,
  markdown,
  chapterKey,
  positionCode,
  description,
  tabId,
}: {
  query: string;
  markdown: string;
  chapterKey: string;
  positionCode: string;
  description: string;
  tabId: string;
}) {
  render(
    <ResultDisplay
      data={{
        type: 'code',
        query,
        markdown,
        resultados: {
          [chapterKey]: {
            capitulo: chapterKey,
            posicoes: [{ codigo: positionCode, descricao: description }],
          },
        },
      }}
      mobileMenuOpen={false}
      onCloseMobileMenu={vi.fn()}
      isActive={true}
      tabId={tabId}
      isNewSearch={false}
      onConsumeNewSearch={vi.fn()}
    />,
  );
}

describe('ResultDisplay advanced behavior', () => {
  let intersectionCallbacks: Array<(entries: any[]) => void>;
  let requestIdleCallbackMock: ReturnType<typeof vi.fn>;
  let cancelIdleCallbackMock: ReturnType<typeof vi.fn>;
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cancelRafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hoisted.robustCallsRef.value = [];
    hoisted.debugWarnMock.mockReset();
    hoisted.toastErrorMock.mockReset();
    hoisted.getNeshChapterBodyMock.mockReset();
    hoisted.getNeshChapterBodyMock.mockResolvedValue({
      success: true,
      capitulo: '84',
      conteudo: 'Conteudo hidratado',
      notas_parseadas: {},
      notas_gerais: null,
      secoes: null,
    });
    hoisted.sidebarPositionRef.value = 'right';
    hoisted.authStateRef.value = {
      userName: 'Teste',
      userImageUrl: null,
      isSignedIn: true,
      isLoading: false,
      userId: 'user_test',
      canUseRestrictedUi: true,
    };
    hoisted.commentsStateRef.value = {
      comments: [],
      addComment: vi.fn().mockResolvedValue(true),
      editComment: vi.fn().mockResolvedValue(undefined),
      removeComment: vi.fn().mockResolvedValue(undefined),
      commentedAnchors: [],
      loadCommentedAnchors: vi.fn().mockResolvedValue([]),
      loadComments: vi.fn().mockResolvedValue(undefined),
      resetFetchedAnchors: vi.fn(),
    };
    hoisted.selectionStateRef.value = {
      selection: null,
      clearSelection: vi.fn(),
      onPopoverMouseDown: vi.fn(),
    };
    intersectionCallbacks = [];
    // @ts-expect-error - test bridge
    globalThis.nesh = { smartLinkSearch: vi.fn(), openTextResultInNewTab: vi.fn() };

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1440,
      writable: true,
    });
    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    cancelRafSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);

    requestIdleCallbackMock = vi.fn((cb: any) => {
      cb({ didTimeout: false, timeRemaining: () => 20 });
      return 7;
    });
    cancelIdleCallbackMock = vi.fn();
    // @ts-expect-error - not always in JSDOM
    globalThis.requestIdleCallback = requestIdleCallbackMock;
    // @ts-expect-error - not always in JSDOM
    globalThis.cancelIdleCallback = cancelIdleCallbackMock;

    class MockIntersectionObserver {
      callback: (entries: any[]) => void;
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(callback: (entries: any[]) => void) {
        this.callback = callback;
        intersectionCallbacks.push(callback);
      }
    }

    // @ts-expect-error - test replacement
    globalThis.IntersectionObserver = MockIntersectionObserver;

    Object.defineProperty(globalThis, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('forwards text result clicks to globalThis.nesh.openTextResultInNewTab with the preserved text query', () => {
    render(
      <ResultDisplay
        data={{ type: 'text', results: [{ ncm: '8517' } as any], query: 'telefone' }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-text"
        latestTextQuery="motor centrif"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('text-result-click'));
    expect((globalThis as any).nesh.openTextResultInNewTab).toHaveBeenCalledWith('8517', 'motor centrif');
    expect((globalThis as any).nesh.smartLinkSearch).not.toHaveBeenCalled();
  });

  it('falls back to the backend query when latestTextQuery is missing', () => {
    render(
      <ResultDisplay
        data={{ type: 'text', results: [{ ncm: '8517' } as any], query: 'telefone industrial' }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-text-fallback"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('text-result-click'));
    expect((globalThis as any).nesh.openTextResultInNewTab).toHaveBeenCalledWith('8517', 'telefone industrial');
  });

  it('renders TIPI fallback, applies aliquot classes and toggles sidebar', async () => {
    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '1001',
          resultados: {
            '10': {
              capitulo: '10',
              titulo: 'Cereais',
              posicoes: [
                { codigo: '10.01', ncm: '10.01', descricao: 'Zero', aliquota: '0', nivel: 1 },
                { codigo: '10.02', ncm: '10.02', descricao: 'NT', aliquota: 'NT', nivel: 2 },
                { codigo: '10.03', ncm: '10.03', descricao: 'Baixa', aliquota: '3', nivel: 3 },
                { codigo: '10.04', ncm: '10.04', descricao: 'Media', aliquota: '8', nivel: 4 },
                { codigo: '10.05', ncm: '10.05', descricao: 'Alta', aliquota: '15', nivel: 7 },
                { codigo: '10.06', ncm: '10.06', descricao: 'Texto', aliquota: 'abc', nivel: 1 },
              ],
            },
          },
        }}
        mobileMenuOpen={true}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-tipi"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Cereais')).toBeInTheDocument();
      expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();
    });

    expect(document.querySelector('.aliquot-zero')).toBeTruthy();
    expect(document.querySelector('.aliquot-nt')).toBeTruthy();
    expect(document.querySelector('.aliquot-low')).toBeTruthy();
    expect(document.querySelector('.aliquot-med')).toBeTruthy();
    expect(document.querySelector('.aliquot-high')).toBeTruthy();
    expect(document.querySelector('.tipi-nivel-5')).toBeTruthy();
    expect(document.querySelector('article.tipi-position[data-ncm="10.01"]')).toBeTruthy();

    const toggle = screen.getByRole('button', { name: 'Recolher navegação' });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Expandir navegação' })).toBeInTheDocument();
  });

  it('sorts TIPI fallback chapters by chapter number before rendering', async () => {
    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '1001',
          resultados: {
            '10': {
              capitulo: '10',
              titulo: 'Cereais',
              posicoes: [{ codigo: '10.01', ncm: '10.01', descricao: 'Cereais', aliquota: '0', nivel: 1 }],
            },
            '2': {
              capitulo: '2',
              titulo: 'Produtos hortícolas',
              posicoes: [{ codigo: '02.01', ncm: '02.01', descricao: 'Produtos hortícolas', aliquota: '0', nivel: 1 }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-tipi-sorted"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      const chapters = Array.from(document.querySelectorAll('.tipi-chapter'));
      expect(chapters).toHaveLength(2);
      expect(chapters[0]).toHaveAttribute('id', 'cap-2');
      expect(chapters[1]).toHaveAttribute('id', 'cap-10');
    });
  });

  it('keeps TIPI sidebar highlight on the clicked item while smooth scroll settles', async () => {
    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '1108.1',
          resultados: {
            '11': {
              capitulo: '11',
              titulo: 'Amidos e féculas',
              posicoes: [
                { codigo: '1108.1', ncm: '1108.1', descricao: 'Amidos e féculas', aliquota: '0', nivel: 2 },
                { codigo: '1108.2', ncm: '1108.2', descricao: 'Inulina', aliquota: '0', nivel: 2 },
              ],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-tipi-highlight"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.getElementById('pos-1108-1')).not.toBeNull();
      expect(document.getElementById('pos-1108-2')).not.toBeNull();
      expect(intersectionCallbacks.length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByTestId('sidebar-nav-tipi'));
    expect(screen.getByTestId('sidebar-active-anchor')).toHaveTextContent('pos-1108-1');

    const nextTarget = document.getElementById('pos-1108-2');
    if (!nextTarget) {
      throw new Error('Expected pos-1108-2 to exist for intersection test');
    }

    act(() => {
      intersectionCallbacks[0]([
        {
          isIntersecting: true,
          target: nextTarget,
          boundingClientRect: { top: 0 },
        },
      ] as any[]);
    });

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-active-anchor')).toHaveTextContent('pos-1108-1');
    });
  });

  it('releases the manual navigation lock after it expires and resumes observer updates', async () => {
    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '1108.1',
          resultados: {
            '11': {
              capitulo: '11',
              titulo: 'Amidos e féculas',
              posicoes: [
                { codigo: '1108.1', ncm: '1108.1', descricao: 'Amidos e féculas', aliquota: '0', nivel: 2 },
                { codigo: '1108.2', ncm: '1108.2', descricao: 'Inulina', aliquota: '0', nivel: 2 },
              ],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-tipi-lock-expiry"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.getElementById('pos-1108-1')).not.toBeNull();
      expect(document.getElementById('pos-1108-2')).not.toBeNull();
      expect(intersectionCallbacks.length).toBeGreaterThan(0);
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:00:00.000Z'));

    fireEvent.click(screen.getByTestId('sidebar-nav-tipi'));
    expect(screen.getByTestId('sidebar-active-anchor')).toHaveTextContent('pos-1108-1');

    const sameTarget = document.getElementById('pos-1108-1');
    if (!sameTarget) {
      throw new Error('Expected pos-1108-1 to exist for intersection test');
    }

    act(() => {
      intersectionCallbacks[0]([
        {
          isIntersecting: true,
          target: sameTarget,
          boundingClientRect: { top: 0 },
        },
      ] as any[]);
    });

    expect(screen.getByTestId('sidebar-active-anchor')).toHaveTextContent('pos-1108-1');

    fireEvent.click(screen.getByTestId('sidebar-nav-tipi'));

    const nextTarget = document.getElementById('pos-1108-2');
    if (!nextTarget) {
      throw new Error('Expected pos-1108-2 to exist for intersection test');
    }

    act(() => {
      vi.advanceTimersByTime(901);
    });

    act(() => {
      intersectionCallbacks[0]([
        {
          isIntersecting: true,
          target: nextTarget,
          boundingClientRect: { top: 0 },
        },
      ] as any[]);
    });

    expect(screen.getByTestId('sidebar-active-anchor')).toHaveTextContent('pos-1108-2');

    vi.clearAllTimers();
  });

  it('uses NeshRenderer fallback and resolves sidebar navigation ids', async () => {
    hoisted.getNeshChapterBodyMock.mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    const renderFallbackSpy = vi
      .spyOn(NeshRenderer, 'renderFullResponse')
      .mockReturnValue('<div class="section-consideracoes">Bloco sem id</div><h3 id="pos-84-13">Bombas</h3>');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8413',
          resultados: {
            '84': {
              capitulo: '84',
              secoes: {
                consideracoes: 'Bloco sem id',
              },
              posicoes: [{ codigo: '84.13', anchor_id: 'pos-84-13', descricao: 'Bombas' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-nesh-fallback"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Bombas')).toBeInTheDocument();
    });

    expect(renderFallbackSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('sidebar-nav-generated'));
    expect(scrollIntoViewMock).toHaveBeenCalled();

    const anchor = document.getElementById('pos-84-13');
    expect(anchor?.classList.contains('flash-highlight')).toBe(true);

    fireEvent.click(screen.getByTestId('sidebar-nav-section'));
    const sectionAnchor = document.getElementById('chapter-84-consideracoes');
    expect(sectionAnchor).not.toBeNull();
    expect(sectionAnchor?.classList.contains('flash-highlight')).toBe(true);
    expect(screen.getByTestId('sidebar-active-anchor')).toHaveTextContent('chapter-84-consideracoes');

    fireEvent.click(screen.getByTestId('sidebar-nav-missing'));
    expect(hoisted.debugWarnMock).toHaveBeenCalledWith('[Navigate] target not found:', 'missing-anchor');

    warnSpy.mockRestore();
  });

  it('assigns an id to the nearest section wrapper when section selectors are missing', async () => {
    const renderFallbackSpy = vi
      .spyOn(NeshRenderer, 'renderFullResponse')
      .mockReturnValue('<section><h3>Considerações gerais</h3><p>Bloco sem id</p></section><h3 id="pos-84-13">Bombas</h3>');

    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8413',
          resultados: {
            '84': {
              capitulo: '84',
              secoes: {
                consideracoes: 'Bloco sem id',
              },
              posicoes: [{ codigo: '84.13', anchor_id: 'pos-84-13', descricao: 'Bombas' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-nesh-section-wrapper"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Bombas')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('sidebar-nav-section'));

    await waitFor(() => {
      const sectionAnchor = document.getElementById('chapter-84-consideracoes');
      expect(sectionAnchor).not.toBeNull();
      expect(sectionAnchor?.tagName).toBe('SECTION');
      expect(sectionAnchor?.classList.contains('flash-highlight')).toBe(true);
      expect(screen.getByTestId('sidebar-active-anchor')).toHaveTextContent('chapter-84-consideracoes');
    });

    renderFallbackSpy.mockRestore();
  });

  it('skips section candidates that fall beyond the next chapter boundary', async () => {
    const renderFallbackSpy = vi
      .spyOn(NeshRenderer, 'renderFullResponse')
      .mockReturnValue('<span id="chapter-84"></span><section><h3>Considerações gerais</h3><p>Bloco interno</p></section><span id="chapter-85"></span><div class="section-consideracoes">Bloco fora do capítulo</div><h3 id="pos-84-13">Bombas</h3>');

    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8413',
          resultados: {
            '84': {
              capitulo: '84',
              secoes: {
                consideracoes: 'Bloco interno',
              },
              posicoes: [{ codigo: '84.13', anchor_id: 'pos-84-13', descricao: 'Bombas' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-nesh-section-bounds"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Bombas')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('sidebar-nav-section'));

    await waitFor(() => {
      const sectionAnchor = document.getElementById('chapter-84-consideracoes');
      expect(sectionAnchor).not.toBeNull();
      expect(sectionAnchor?.tagName).toBe('SECTION');
      expect(screen.getByTestId('sidebar-active-anchor')).toHaveTextContent('chapter-84-consideracoes');
    });

    renderFallbackSpy.mockRestore();
  });

  it('prefers offline rendered HTML over NeshRenderer fallback for multiline note lists', async () => {
    const renderFallbackSpy = vi.spyOn(NeshRenderer, 'renderFullResponse');
    const { container } = render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8401',
          markdown: `
            <div class="offline-html">
              <ol class="nesh-list">
                <li>
                  As partes excluídas pela <span class="note-ref" data-note="1">Nota 1</span> da
                  Seção ou pela <span class="note-ref" data-note="1">Nota 1</span> do presente Capítulo.
                </li>
              </ol>
            </div>
          `,
          resultados: {
            '84': {
              capitulo: '84',
              posicoes: [{ codigo: '84.01', anchor_id: 'pos-84-01', descricao: 'Reatores nucleares' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-nesh-offline-html"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('.offline-html .nesh-list li')).not.toBeNull();
    });

    expect(renderFallbackSpy).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.offline-html .nesh-list > li')).toHaveLength(1);
    expect(container.querySelector('.offline-html .nesh-list')?.textContent).toContain('Seção ou pela');
    expect(container.querySelectorAll('.offline-html .note-ref')).toHaveLength(2);

    renderFallbackSpy.mockRestore();
  });

  it('enables robust auto-scroll for new search and consumes final scroll', async () => {
    const onConsumeNewSearch = vi.fn();

    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8517',
          markdown: '<h3 id="pos-85-17">Item 8517</h3>',
          resultados: {
            '85': {
              capitulo: '85',
              posicao_alvo: '85.17',
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-autoscroll"
        isNewSearch={true}
        onConsumeNewSearch={onConsumeNewSearch}
      />,
    );

    await waitFor(() => {
      expect(hoisted.robustCallsRef.value.some((call) => call.shouldScroll === true)).toBe(true);
    });

    const container = document.getElementById('results-content-tab-autoscroll') as HTMLDivElement;
    expect(container).not.toBeNull();
    container.scrollTop = 333;

    const shouldScrollCall = [...hoisted.robustCallsRef.value].reverse().find((call) => call.shouldScroll === true);
    expect(shouldScrollCall).toBeDefined();

    act(() => {
      shouldScrollCall?.onComplete(true);
    });
    expect(onConsumeNewSearch).toHaveBeenCalledWith('tab-autoscroll', 333);

    act(() => {
      shouldScrollCall?.onComplete(false);
    });
    expect(onConsumeNewSearch).toHaveBeenCalledTimes(1);
  });

  it('consumes the stored new-search scroll position after the tab becomes inactive', async () => {
    const onConsumeNewSearch = vi.fn();
    const onPersistScroll = vi.fn();

    const { container, rerender } = render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8517',
          markdown: '<h3 id="pos-85-17">Item 8517</h3>',
          resultados: {
            '85': {
              capitulo: '85',
              posicao_alvo: '85.17',
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-new-search-store"
        isNewSearch={false}
        onConsumeNewSearch={onConsumeNewSearch}
        onPersistScroll={onPersistScroll}
      />,
    );

    const contentContainer = container.querySelector('#results-content-tab-new-search-store') as HTMLElement;
    expect(contentContainer).not.toBeNull();

    contentContainer.scrollTop = 333;
    fireEvent.scroll(contentContainer);

    rerender(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8517',
          markdown: '<h3 id="pos-85-17">Item 8517</h3>',
          resultados: {
            '85': {
              capitulo: '85',
              posicao_alvo: '85.17',
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={false}
        tabId="tab-new-search-store"
        isNewSearch={true}
        onConsumeNewSearch={onConsumeNewSearch}
        onPersistScroll={onPersistScroll}
      />,
    );

    await waitFor(() => {
      expect(onConsumeNewSearch).toHaveBeenCalledWith('tab-new-search-store', 333);
    });
  });

  it('returns early from scroll restoration when the target scroll position is already settled', async () => {
    const originalScrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    const readCounts = new WeakMap<HTMLElement, number>();

    try {
      Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
        configurable: true,
        get(this: HTMLElement) {
          if (this.id === 'results-content-tab-scroll-restored') {
            const reads = readCounts.get(this) ?? 0;
            readCounts.set(this, reads + 1);
            return reads === 0 ? 0 : 120;
          }

          return originalScrollTopDescriptor?.get?.call(this) ?? 0;
        },
        set(this: HTMLElement, value: number) {
          if (this.id === 'results-content-tab-scroll-restored') {
            return;
          }

          originalScrollTopDescriptor?.set?.call(this, value);
        },
      });

      const { container } = render(
        <ResultDisplay
          data={{
            type: 'code',
            query: '8517',
            markdown: '<h3 id="pos-85-17">Item 8517</h3>',
            resultados: {
              '85': {
                capitulo: '85',
                posicao_alvo: '85.17',
                posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
              },
            },
          }}
          mobileMenuOpen={false}
          onCloseMobileMenu={vi.fn()}
          isActive={true}
          tabId="tab-scroll-restored"
          initialScrollTop={120}
          isNewSearch={false}
          onConsumeNewSearch={vi.fn()}
        />,
      );

      const contentContainer = container.querySelector('#results-content-tab-scroll-restored') as HTMLElement;
      expect(contentContainer).not.toBeNull();
      expect(readCounts.get(contentContainer) ?? 0).toBeGreaterThanOrEqual(2);
    } finally {
      if (originalScrollTopDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalScrollTopDescriptor);
      }
    }
  });

  it('retries scroll restoration when the scroll position does not stick', async () => {
    const originalScrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const originalClientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    const readCounts = new WeakMap<HTMLElement, number>();

    try {
      Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
        configurable: true,
        get(this: HTMLElement) {
          if (this.id === 'results-content-tab-scroll-retry') {
            const reads = readCounts.get(this) ?? 0;
            readCounts.set(this, reads + 1);
            return 0;
          }

          return originalScrollTopDescriptor?.get?.call(this) ?? 0;
        },
        set(this: HTMLElement, value: number) {
          if (this.id === 'results-content-tab-scroll-retry') {
            return;
          }

          originalScrollTopDescriptor?.set?.call(this, value);
        },
      });
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
        configurable: true,
        get(this: HTMLElement) {
          return this.id === 'results-content-tab-scroll-retry' ? 2000 : (originalScrollHeightDescriptor?.get?.call(this) ?? 0);
        },
      });
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get(this: HTMLElement) {
          return this.id === 'results-content-tab-scroll-retry' ? 500 : (originalClientHeightDescriptor?.get?.call(this) ?? 0);
        },
      });

      const { container } = render(
        <ResultDisplay
          data={{
            type: 'code',
            query: '8517',
            markdown: '<h3 id="pos-85-17">Item 8517</h3>',
            resultados: {
              '85': {
                capitulo: '85',
                posicao_alvo: '85.17',
                posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
              },
            },
          }}
          mobileMenuOpen={false}
          onCloseMobileMenu={vi.fn()}
          isActive={true}
          tabId="tab-scroll-retry"
          initialScrollTop={120}
          isNewSearch={false}
          onConsumeNewSearch={vi.fn()}
        />,
      );

      const contentContainer = container.querySelector('#results-content-tab-scroll-retry') as HTMLElement;
      expect(contentContainer).not.toBeNull();

      await waitFor(() => {
        expect(contentContainer).toHaveTextContent('Item 8517');
      });

      expect(readCounts.get(contentContainer) ?? 0).toBeGreaterThan(2);
    } finally {
      if (originalScrollTopDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalScrollTopDescriptor);
      }
      if (originalScrollHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeightDescriptor);
      }
      if (originalClientHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeightDescriptor);
      }
    }
  });

  it('treats whitespace-only queries as invalid auto-scroll targets', async () => {
    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '   ',
          markdown: '<h3>Espaços ignorados</h3>',
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-whitespace-query"
        isNewSearch={true}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Espaços ignorados')).toBeInTheDocument();
    });

    expect(
      hoisted.robustCallsRef.value.some((call) => call.shouldScroll === true),
    ).toBe(false);
  });

  it('waits for the target anchor before enabling robust auto-scroll on chunked renders', async () => {
    const pendingIdleCallbacks: Array<(deadline: { didTimeout: boolean; timeRemaining: () => number }) => void> = [];
    const longChunk = 'x'.repeat(51000);
    requestIdleCallbackMock.mockImplementation((cb: any) => {
      pendingIdleCallbacks.push(cb);
      return pendingIdleCallbacks.length;
    });

    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '840810',
          markdown: `<p>${longChunk}</p><hr><h3 id="pos-84-08">84.08 - Bombas</h3>`,
          resultados: {
            '84': {
              capitulo: '84',
              posicao_alvo: '84.08',
              posicoes: [{ codigo: '84.08', anchor_id: 'pos-84-08', descricao: 'Bombas' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-autoscroll-chunked"
        isNewSearch={true}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(hoisted.robustCallsRef.value.length).toBeGreaterThan(0);
    });

    expect(pendingIdleCallbacks.length).toBeGreaterThan(0);
    expect(
      hoisted.robustCallsRef.value.some((call) => call.shouldScroll === true),
    ).toBe(false);

    await act(async () => {
      pendingIdleCallbacks.forEach((callback) => {
        callback({ didTimeout: false, timeRemaining: () => 20 });
      });
    });

    await waitFor(() => {
      expect(document.getElementById('pos-84-08')).not.toBeNull();
      expect(
        hoisted.robustCallsRef.value.some(
          (call) => call.shouldScroll === true
            && (Array.isArray(call.targetId)
              ? call.targetId.includes('pos-84-08')
              : call.targetId === 'pos-84-08'),
        ),
      ).toBe(true);
    });
  });

  it('keeps successful chapter hydration when another chapter body fetch fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    hoisted.getNeshChapterBodyMock.mockImplementation(async (chapter: string) => {
      if (chapter === '84') {
        return {
          success: true,
          capitulo: '84',
          conteudo: 'Conteudo hidratado 84',
          notas_parseadas: {},
          notas_gerais: null,
          secoes: null,
        };
      }

      throw new Error(`Falha ao hidratar ${chapter}`);
    });

    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8413',
          resultados: {
            '84': {
              capitulo: '84',
              titulo: 'Capitulo 84',
              posicoes: [{ codigo: '84.13', anchor_id: 'pos-84-13', descricao: 'Bombas' }],
            },
            '85': {
              capitulo: '85',
              titulo: 'Capitulo 85',
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Telefones' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-partial-hydration"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(hoisted.getNeshChapterBodyMock).toHaveBeenCalledWith('84');
      expect(hoisted.getNeshChapterBodyMock).toHaveBeenCalledWith('85');
    });

    await waitFor(() => {
      expect(screen.getByText('Conteudo hidratado 84')).toBeInTheDocument();
    });

    expect(errorSpy).toHaveBeenCalledWith(
      '[ResultDisplay] Failed to fetch chapter body',
      expect.objectContaining({ chapter: '85' }),
    );

    await waitFor(() => {
      expect(screen.queryByText('Carregando conteúdo detalhado...')).not.toBeInTheDocument();
    });

    errorSpy.mockRestore();
  });

  it('notifies the parent when chapter hydration enriches code results', async () => {
    const onHydratedResults = vi.fn();

    hoisted.getNeshChapterBodyMock.mockResolvedValue({
      success: true,
      capitulo: '84',
      conteudo: 'Conteudo hidratado 84',
      notas_parseadas: { '4': 'Nota 4 hidratada' },
      notas_gerais: 'Notas gerais hidratadas',
      secoes: null,
    });

    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8413',
          resultados: {
            '84': {
              capitulo: '84',
              titulo: 'Capitulo 84',
              conteudo: '',
              notas_parseadas: {},
              posicoes: [{ codigo: '84.13', anchor_id: 'pos-84-13', descricao: 'Bombas' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-hydrated-callback"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
        onHydratedResults={onHydratedResults}
      />,
    );

    await waitFor(() => {
      expect(hoisted.getNeshChapterBodyMock).toHaveBeenCalledWith('84');
    });

    await waitFor(() => {
      expect(onHydratedResults).toHaveBeenCalledWith(
        'tab-hydrated-callback',
        expect.objectContaining({
          '84': expect.objectContaining({
            capitulo: '84',
            conteudo: 'Conteudo hidratado 84',
            notas_parseadas: { '4': 'Nota 4 hidratada' },
            notas_gerais: 'Notas gerais hidratadas',
          }),
        }),
      );
    });
  });

  it('falls back to the chapter key when hydrated chapter entries omit capitulo and renders note anchors', async () => {
    hoisted.getNeshChapterBodyMock.mockResolvedValue({
      success: true,
      capitulo: '84',
      conteudo: 'Conteudo hidratado 84',
      notas_parseadas: { '4': 'Nota 4 hidratada' },
      notas_gerais: 'Notas gerais hidratadas',
      secoes: null,
    });

    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8413',
          resultados: {
            '84': {
              capitulo: '',
              titulo: 'Capitulo 84',
              conteudo: '',
              notas_parseadas: {},
              notas_gerais: '',
              posicoes: [{ codigo: '84.13', anchor_id: 'pos-84-13', descricao: 'Bombas' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-hydrated-fallback"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(hoisted.getNeshChapterBodyMock).toHaveBeenCalledWith('84');
    });

    await waitFor(() => {
      expect(screen.getByText('Conteudo hidratado 84')).toBeInTheDocument();
      expect(document.getElementById('chapter--notas')).not.toBeNull();
    });
  });

  it('skips hydration merges when the fetched chapter does not match an existing result entry', async () => {
    const onHydratedResults = vi.fn();

    hoisted.getNeshChapterBodyMock.mockResolvedValue({
      success: true,
      capitulo: '99',
      conteudo: 'Conteudo hidratado 99',
      notas_parseadas: {},
      notas_gerais: null,
      secoes: null,
    });

    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8413',
          resultados: {
            '84': {
              capitulo: '',
              titulo: 'Capitulo 84',
              conteudo: '',
              notas_parseadas: {},
              notas_gerais: '',
              posicoes: [{ codigo: '84.13', anchor_id: 'pos-84-13', descricao: 'Bombas' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-hydrated-mismatch"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
        onHydratedResults={onHydratedResults}
      />,
    );

    await waitFor(() => {
      expect(hoisted.getNeshChapterBodyMock).toHaveBeenCalledWith('84');
    });

    await waitFor(() => {
      expect(onHydratedResults).toHaveBeenCalled();
      expect(screen.queryByText('Conteudo hidratado 99')).not.toBeInTheDocument();
    });
  });

  it('logs hydration failures when applying merged chapter bodies throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onHydratedResults = vi.fn();

    const brokenChapterBody: Record<string, unknown> = {};
    Object.defineProperty(brokenChapterBody, 'capitulo', {
      enumerable: true,
      get() {
        throw new Error('Falha ao aplicar hidratação');
      },
    });
    Object.defineProperty(brokenChapterBody, 'conteudo', {
      enumerable: true,
      value: 'Conteudo hidratado 84',
    });
    Object.defineProperty(brokenChapterBody, 'notas_parseadas', {
      enumerable: true,
      value: { '4': 'Nota 4 hidratada' },
    });
    Object.defineProperty(brokenChapterBody, 'notas_gerais', {
      enumerable: true,
      value: 'Notas gerais hidratadas',
    });
    Object.defineProperty(brokenChapterBody, 'secoes', {
      enumerable: true,
      value: null,
    });
    hoisted.getNeshChapterBodyMock.mockResolvedValue(brokenChapterBody as any);

    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8413',
          resultados: {
            '84': {
              capitulo: '84',
              titulo: 'Capitulo 84',
              conteudo: '',
              notas_parseadas: {},
              posicoes: [{ codigo: '84.13', anchor_id: 'pos-84-13', descricao: 'Bombas' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-hydration-error"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
        onHydratedResults={onHydratedResults}
      />,
    );

    await waitFor(() => {
      expect(hoisted.getNeshChapterBodyMock).toHaveBeenCalledWith('84');
    });

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        '[ResultDisplay] Failed to hydrate chapter bodies',
        expect.any(Error),
      );
    });

    errorSpy.mockRestore();
  });

  it('stops showing the chapter hydration loading state when all chapter body requests fail', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    hoisted.getNeshChapterBodyMock.mockRejectedValue(new Error('Falha 401'));

    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8413',
          resultados: {
            '84': {
              capitulo: '84',
              titulo: 'Capitulo 84',
              posicoes: [{ codigo: '84.13', anchor_id: 'pos-84-13', descricao: 'Bombas' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-all-hydration-fail"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    expect(screen.getByText('Carregando conteúdo detalhado...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText('Carregando conteúdo detalhado...')).not.toBeInTheDocument();
    });

    expect(errorSpy).toHaveBeenCalledWith(
      '[ResultDisplay] Failed to fetch chapter body',
      expect.objectContaining({ chapter: '84' }),
    );

    errorSpy.mockRestore();
  });

  it('keeps robust auto-scroll enabled as a fallback when a text query also activates SearchHighlighter', async () => {
    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8517',
          markdown: '<h3 id="pos-85-17">Item 8517</h3><p>Motor no capitulo</p>',
          resultados: {
            '85': {
              capitulo: '85',
              posicao_alvo: '85.17',
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-autoscroll-fallback"
        latestTextQuery="motor"
        isNewSearch={true}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        hoisted.robustCallsRef.value.some(
          (call) => call.shouldScroll === true
            && (Array.isArray(call.targetId)
              ? call.targetId.includes('pos-85-17')
              : call.targetId === 'pos-85-17'),
        ),
      ).toBe(true);
    });
  });

  it('cancels a pending anchor update when navigation is retriggered before RAF flush', async () => {
    const pendingRafs: FrameRequestCallback[] = [];

    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '1108.1',
          resultados: {
            '11': {
              capitulo: '11',
              titulo: 'Amidos e féculas',
              posicoes: [
                { codigo: '1108.1', ncm: '1108.1', descricao: 'Amidos e féculas', aliquota: '0', nivel: 2 },
                { codigo: '1108.2', ncm: '1108.2', descricao: 'Inulina', aliquota: '0', nivel: 2 },
              ],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-tipi-raf-cancel"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.getElementById('pos-1108-1')).not.toBeNull();
      expect(intersectionCallbacks.length).toBeGreaterThan(0);
    });

    rafSpy.mockImplementation((callback: FrameRequestCallback) => {
      pendingRafs.push(callback);
      return pendingRafs.length;
    });
    cancelRafSpy.mockImplementation(() => undefined);

    const firstTarget = document.getElementById('pos-1108-1');
    const secondTarget = document.getElementById('pos-1108-2');
    if (!firstTarget || !secondTarget) {
      throw new Error('Expected TIPI targets to exist for RAF cancellation test');
    }

    act(() => {
      intersectionCallbacks[0]([
        {
          isIntersecting: true,
          target: firstTarget,
          boundingClientRect: { top: 0 },
        },
      ] as any[]);
    });

    act(() => {
      intersectionCallbacks[0]([
        {
          isIntersecting: true,
          target: secondTarget,
          boundingClientRect: { top: 0 },
        },
      ] as any[]);
    });

    expect(cancelRafSpy).toHaveBeenCalledWith(1);
    expect(pendingRafs.length).toBeGreaterThanOrEqual(2);
  });

  it('assigns fallback id via data-ncm and syncs active anchor from intersection', async () => {
    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8517',
          markdown: '<h3 data-ncm="85.17">Item sem id</h3>',
          resultados: {
            '85': {
              capitulo: '85',
              posicao_alvo: '85.17',
              posicoes: [{ codigo: '85.17', descricao: 'Item sem id' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-anchor-fallback"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      const fallbackAnchor = document.querySelector('[data-ncm="85.17"]') as HTMLElement | null;
      expect(fallbackAnchor?.id).toBe('pos-85-17');
    });

    const fallbackAnchor = document.querySelector('[data-ncm="85.17"]') as HTMLElement;
    expect(intersectionCallbacks.length).toBeGreaterThan(0);

    act(() => {
      intersectionCallbacks[0]([
        {
          isIntersecting: true,
          target: fallbackAnchor,
          boundingClientRect: { top: 12 },
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-active-anchor')).toHaveTextContent('pos-85-17');
    });
  });

  it('injects section ids and syncs active anchor for structured sections', async () => {
    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8517',
          markdown: '<span id="cap-85"></span><div class="section-consideracoes"><h3>Considerações Gerais</h3></div><h3 id="pos-85-17">Item 8517</h3>',
          resultados: {
            '85': {
              capitulo: '85',
              secoes: {
                consideracoes: 'Considerações Gerais',
              },
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-section-anchor"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      const section = document.querySelector('.section-consideracoes') as HTMLElement | null;
      expect(section?.id).toBe('chapter-85-consideracoes');
    });

    const section = document.getElementById('chapter-85-consideracoes') as HTMLElement;
    const observerCallback = intersectionCallbacks[intersectionCallbacks.length - 1];

    act(() => {
      observerCallback([
        {
          isIntersecting: true,
          target: section,
          boundingClientRect: { top: 8 },
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-active-anchor')).toHaveTextContent('chapter-85-consideracoes');
    });
  });

  it('handles numeric structured section payloads when generating section anchors', async () => {
    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8517',
          markdown: '<span id="cap-85"></span><div class="section-consideracoes"><h3>Considerações 123</h3></div><h3 id="pos-85-17">Item 8517</h3>',
          resultados: {
            '85': {
              capitulo: '85',
              secoes: {
                consideracoes: 123,
              },
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-section-anchor-number"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      const section = document.querySelector('.section-consideracoes') as HTMLElement | null;
      expect(section?.id).toBe('chapter-85-consideracoes');
    });
  });

  it('clears markup while inactive and rehydrates it when the tab becomes active again', async () => {
    const onContentReady = vi.fn();
    const data = {
      type: 'code' as const,
      query: '8517',
      markdown: '<h3 id="pos-85-17">Item 8517</h3><p>Conteudo ativo</p>',
      resultados: {
        '85': {
          capitulo: '85',
          posicao_alvo: '85.17',
          posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
        },
      },
    };

    const { container, rerender } = render(
      <ResultDisplay
        data={data}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-reactivate"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
        onContentReady={onContentReady}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Conteudo ativo')).toBeInTheDocument();
      expect(onContentReady).toHaveBeenCalledTimes(1);
    });

    rerender(
      <ResultDisplay
        data={data}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={false}
        tabId="tab-reactivate"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
        onContentReady={onContentReady}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Conteudo ativo')).toBeInTheDocument();
    });

    const contentContainer = container.querySelector('#results-content-tab-reactivate');
    expect(contentContainer?.textContent).toContain('Conteudo ativo');

    rerender(
      <ResultDisplay
        data={data}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-reactivate"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
        onContentReady={onContentReady}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Conteudo ativo')).toBeInTheDocument();
      expect(onContentReady).toHaveBeenCalledTimes(1);
    });
  });

  it('ignores non-string structured section payloads when generating section anchors', async () => {
    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '8517',
          markdown: '<span id="cap-85"></span><h3 id="pos-85-17">Item 8517</h3>',
          resultados: {
            '85': {
              capitulo: '85',
              secoes: {
                consideracoes: { nested: true },
              },
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-non-string-section"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Item 8517')).toBeInTheDocument();
    });

    expect(document.getElementById('chapter-85-consideracoes')).toBeNull();
  });

  it('replaces search highlighter marks on query change without accumulating wrappers', async () => {
    const baseData = {
      type: 'code' as const,
      query: '8517',
      markdown: '<h3 id="pos-85-17">Item 8517</h3><p>Motor bomba motor</p>',
      resultados: {
        '85': {
          capitulo: '85',
          posicao_alvo: '85.17',
          posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
        },
      },
    };

    const { container, rerender } = render(
      <ResultDisplay
        data={baseData}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-query-highlight"
        latestTextQuery="motor"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      const marks = container.querySelectorAll('mark[data-sh-term="motor"]');
      expect(marks).toHaveLength(2);
      expect(Array.from(marks).every((mark) => mark.textContent?.toLowerCase() === 'motor')).toBe(true);
    });

    rerender(
      <ResultDisplay
        data={baseData}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-query-highlight"
        latestTextQuery="bomba"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      const marks = container.querySelectorAll('mark[data-sh-term="bomba"]');
      expect(marks).toHaveLength(1);
      expect(marks[0]?.textContent?.toLowerCase()).toBe('bomba');
      expect(container.querySelectorAll('mark mark')).toHaveLength(0);
      expect(container.querySelectorAll('mark[data-sh-term="motor"]')).toHaveLength(0);
    });
  });

  it('unwraps search highlights when the query is cleared and the component unmounts', async () => {
    const data = {
      type: 'code' as const,
      query: '8517',
      markdown: '<h3 id="pos-85-17">Item 8517</h3><p>Motor bomba motor</p>',
      resultados: {
        '85': {
          capitulo: '85',
          posicao_alvo: '85.17',
          posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
        },
      },
    };

    const { container, rerender, unmount } = render(
      <ResultDisplay
        data={data}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-query-highlight-cleanup"
        latestTextQuery="motor"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('#results-content-tab-query-highlight-cleanup')).toHaveTextContent('Motor bomba motor');
    });

    rerender(
      <ResultDisplay
        data={data}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-query-highlight-cleanup"
        latestTextQuery=""
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll('mark[data-sh-term="motor"]')).toHaveLength(0);
    });

    unmount();
    expect(container.querySelectorAll('mark[data-sh-term="motor"]')).toHaveLength(0);
  });

  it('uses chunked rendering path for very large payloads', async () => {
    const longChunk = 'x'.repeat(51000);
    const data = {
      type: 'code' as const,
      markdown: `<hr><p>${longChunk}</p><hr><p>fim-chunk</p>`,
      resultados: {
        '99': { capitulo: '99', posicoes: [] },
      },
    };

    const { unmount } = render(
      <ResultDisplay
        data={data}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-chunk"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('fim-chunk')).toBeInTheDocument();
    });
    expect(requestIdleCallbackMock).toHaveBeenCalled();

    unmount();
    expect(cancelIdleCallbackMock).toHaveBeenCalled();
  });

  it('handles rendering exceptions and shows fallback error text', async () => {
    const parseSpy = vi.spyOn(marked, 'parse').mockImplementation(() => {
      throw new Error('parse fail');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ResultDisplay
        data={{
          type: 'code',
          markdown: '# Titulo legado',
          resultados: { '01': { capitulo: '01', posicoes: [] } },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-render-error"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(parseSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith('Content render error:', expect.any(Error));
    });

    parseSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('blocks comment toggling while auth is still loading', async () => {
    hoisted.authStateRef.value = {
      ...hoisted.authStateRef.value,
      isLoading: true,
    };

    render(
      <ResultDisplay
        data={{
          type: 'code',
          markdown: '<h3 id="pos-85-17">Item 8517</h3>',
          resultados: { '85': { capitulo: '85', posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17' }] } },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-comments-auth-loading"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ativar comentários' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ativar comentários' }));
    expect(hoisted.toastErrorMock).toHaveBeenCalledWith('Aguarde a autenticação carregar e tente novamente.');
  });

  it('blocks comment toggling for signed-out users and LAN development hosts', async () => {
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
    try {
      hoisted.authStateRef.value = {
        ...hoisted.authStateRef.value,
        isSignedIn: false,
      };

      const { rerender } = render(
        <ResultDisplay
          data={{
            type: 'code',
            markdown: '<h3 id="pos-85-17">Item 8517</h3>',
            resultados: { '85': { capitulo: '85', posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17' }] } },
          }}
          mobileMenuOpen={false}
          onCloseMobileMenu={vi.fn()}
          isActive={true}
          tabId="tab-comments-auth"
          isNewSearch={false}
          onConsumeNewSearch={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Ativar comentários' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Ativar comentários' }));
      expect(hoisted.toastErrorMock).toHaveBeenCalledWith('Faça login para usar comentários.');

      hoisted.toastErrorMock.mockReset();
      hoisted.authStateRef.value = {
        ...hoisted.authStateRef.value,
        isSignedIn: true,
      };
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: new URL('https://192.168.0.25/'),
      });

      rerender(
        <ResultDisplay
          data={{
            type: 'code',
            markdown: '<h3 id="pos-85-17">Item 8517</h3>',
            resultados: { '85': { capitulo: '85', posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17' }] } },
          }}
          mobileMenuOpen={false}
          onCloseMobileMenu={vi.fn()}
          isActive={true}
          tabId="tab-comments-auth"
          isNewSearch={false}
          onConsumeNewSearch={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Ativar comentários' }));
      expect(hoisted.toastErrorMock).toHaveBeenCalledWith(
        'Comentários não estão disponíveis neste ambiente agora.',
      );
    } finally {
      if (originalLocationDescriptor) {
        Object.defineProperty(globalThis, 'location', originalLocationDescriptor);
      }
    }
  });

  it('hides comment controls when restricted UI is not available', () => {
    hoisted.authStateRef.value = {
      ...hoisted.authStateRef.value,
      canUseRestrictedUi: false,
    };

    render(
      <ResultDisplay
        data={{
          type: 'code',
          markdown: '<h3 id="pos-85-17">Item 8517</h3>',
          resultados: { '85': { capitulo: '85', posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17' }] } },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-comments-restricted"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Ativar comentários' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('comment-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('comment-drawer')).not.toBeInTheDocument();
  });

  it('loads commented anchors, applies DOM markers, and opens the drawer when a commented anchor is clicked on narrow screens', async () => {
    hoisted.commentsStateRef.value = {
      ...hoisted.commentsStateRef.value,
      comments: [{ id: 'comment-1', body: 'Já existe' }],
      commentedAnchors: ['pos-85-17'],
    };
    globalThis.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 1280px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as any;

    const { rerender } = render(
      <ResultDisplay
        data={{
          type: 'code',
          markdown: '<h3 id="pos-85-17">Item 8517</h3><p>Conteúdo com comentário</p>',
          resultados: {
            '85': {
              capitulo: '85',
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-comments-markers"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ativar comentários' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ativar comentários' }));

    await waitFor(() => {
      expect(hoisted.commentsStateRef.value.loadCommentedAnchors).toHaveBeenCalledTimes(1);
      expect(document.getElementById('pos-85-17')?.classList.contains('has-comment')).toBe(true);
    });

    fireEvent.click(document.getElementById('pos-85-17') as HTMLElement);

    await waitFor(() => {
      expect(hoisted.commentsStateRef.value.loadComments).toHaveBeenCalledWith('pos-85-17', expect.any(Number));
      expect(screen.getByTestId('comment-drawer')).toHaveAttribute('data-open', 'true');
      expect(screen.getByTestId('comment-panel-count')).toHaveTextContent('1');
    });

    hoisted.commentsStateRef.value = {
      ...hoisted.commentsStateRef.value,
      commentedAnchors: [],
    };

    rerender(
      <ResultDisplay
        data={{
          type: 'code',
          markdown: '<h3 id="pos-85-17">Item 8517</h3><p>Conteúdo com comentário</p>',
          resultados: {
            '85': {
              capitulo: '85',
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-comments-markers"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.getElementById('pos-85-17')?.classList.contains('has-comment')).toBe(false);
    });
  });

  it('uses the timeout fallback when idle callback APIs are unavailable', async () => {
    const originalRequestIdleCallback = (globalThis as any).requestIdleCallback;
    const originalCancelIdleCallback = (globalThis as any).cancelIdleCallback;

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    // @ts-expect-error - emulate browsers without requestIdleCallback
    globalThis.requestIdleCallback = undefined;
    // @ts-expect-error - emulate browsers without cancelIdleCallback
    globalThis.cancelIdleCallback = undefined;

    try {
      const longChunk = 'x'.repeat(51000);
      const { unmount } = render(
        <ResultDisplay
          data={{
            type: 'code',
            markdown: `<hr><p>${longChunk}</p><hr><p>fim-chunk</p>`,
            resultados: {
              '99': { capitulo: '99', posicoes: [] },
            },
          }}
          mobileMenuOpen={false}
          onCloseMobileMenu={vi.fn()}
          isActive={true}
          tabId="tab-chunk-timeout-fallback"
          isNewSearch={false}
          onConsumeNewSearch={vi.fn()}
        />,
      );

      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(screen.getByText('fim-chunk')).toBeInTheDocument();

      unmount();
      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      globalThis.requestIdleCallback = originalRequestIdleCallback;
      globalThis.cancelIdleCallback = originalCancelIdleCallback;
      clearTimeoutSpy.mockRestore();
    }
  });

  it.each([
    {
      label: '8-digit',
      query: '49089000',
      markdown: '<h3 data-ncm="4908.90.00">Item 4908</h3>',
      chapterKey: '49',
      positionCode: '49.08',
      description: 'Item 4908',
      selector: '[data-ncm="4908.90.00"]',
      expectedId: 'pos-4908-90-00',
      tabId: 'tab-data-ncm-8digits',
    },
    {
      label: '4-digit',
      query: '8517',
      markdown: '<h3 data-ncm="8517">Item sem id compacto</h3>',
      chapterKey: '85',
      positionCode: '85.17',
      description: 'Item sem id compacto',
      selector: '[data-ncm="8517"]',
      expectedId: 'pos-85-17',
      tabId: 'tab-data-ncm-4digits',
    },
  ])('uses the $label data-ncm fallback when assigning anchor ids', async (testCase) => {
    renderDataNcmFallbackCase(testCase);

    await waitFor(() => {
      const fallbackAnchor = document.querySelector(testCase.selector) as HTMLElement | null;
      expect(fallbackAnchor?.id).toBe(testCase.expectedId);
    });
  });

  it('prefers prefix matches when the query only matches a code prefix', async () => {
    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '1108',
          resultados: {
            '11': {
              capitulo: '11',
              titulo: 'Amidos e féculas',
              posicoes: [
                { codigo: '1108.1', ncm: '1108.1', descricao: 'Amidos e féculas', aliquota: '0', nivel: 2 },
                { codigo: '1108.2', ncm: '1108.2', descricao: 'Inulina', aliquota: '0', nivel: 2 },
              ],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-prefix-match"
        isNewSearch={true}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        hoisted.robustCallsRef.value.some((call) => Array.isArray(call.targetId)
          ? call.targetId.includes('pos-1108-1')
          : call.targetId === 'pos-1108-1'),
      ).toBe(true);
    });
  });

  it('prefers the topmost visible intersection target when multiple anchors are visible', async () => {
    render(
      <ResultDisplay
        data={{
          type: 'code',
          query: '1108.1',
          resultados: {
            '11': {
              capitulo: '11',
              titulo: 'Amidos e féculas',
              posicoes: [
                { codigo: '1108.1', ncm: '1108.1', descricao: 'Amidos e féculas', aliquota: '0', nivel: 2 },
                { codigo: '1108.2', ncm: '1108.2', descricao: 'Inulina', aliquota: '0', nivel: 2 },
              ],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-intersection-sort"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.getElementById('pos-1108-1')).not.toBeNull();
      expect(document.getElementById('pos-1108-2')).not.toBeNull();
      expect(intersectionCallbacks.length).toBeGreaterThan(0);
    });

    act(() => {
      intersectionCallbacks[0]([
        {
          isIntersecting: true,
          target: document.getElementById('pos-1108-2'),
          boundingClientRect: { top: 40 },
        },
        {
          isIntersecting: true,
          target: document.getElementById('pos-1108-1'),
          boundingClientRect: { top: 8 },
        },
      ] as any[]);
    });

    expect(screen.getByTestId('sidebar-active-anchor')).toHaveTextContent('pos-1108-1');
  });

  it('delegates sidebar toggling to the mobile menu callback on narrow screens', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 800,
      writable: true,
    });
    const onToggleMobileMenu = vi.fn();

    render(
      <ResultDisplay
        data={{
          type: 'code',
          markdown: '<h3 id="pos-85-17">Item 8517</h3>',
          resultados: {
            '85': {
              capitulo: '85',
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        onToggleMobileMenu={onToggleMobileMenu}
        isActive={true}
        tabId="tab-sidebar-mobile-toggle"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Recolher navegação' }));
    expect(onToggleMobileMenu).toHaveBeenCalledTimes(1);
  });

  it('closes the mobile menu directly when no toggle callback is provided', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 800,
      writable: true,
    });
    const onCloseMobileMenu = vi.fn();

    render(
      <ResultDisplay
        data={{
          type: 'code',
          markdown: '<h3 id="pos-85-17">Item 8517</h3>',
          resultados: {
            '85': {
              capitulo: '85',
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={true}
        onCloseMobileMenu={onCloseMobileMenu}
        isActive={true}
        tabId="tab-sidebar-mobile-close"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Recolher navegação' }));
    expect(onCloseMobileMenu).toHaveBeenCalledTimes(1);
  });

  it('reports invalid text selections and opens a pending comment for valid selections', async () => {
    globalThis.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 1280px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as any;

    hoisted.selectionStateRef.value = {
      selection: {
        text: 'Texto sem anchor',
        anchorKey: '',
        rect: { top: 120 },
      },
      clearSelection: vi.fn(),
      onPopoverMouseDown: vi.fn(),
    };

    const { rerender } = render(
      <ResultDisplay
        data={{
          type: 'code',
          markdown: '<h3 id="pos-85-17">Item 8517</h3><p>Texto selecionável</p>',
          resultados: {
            '85': {
              capitulo: '85',
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-selection"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ativar comentários' }));
    await waitFor(() => {
      expect(screen.getByTestId('highlight-popover')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('highlight-request-comment'));
    expect(hoisted.toastErrorMock).toHaveBeenCalledWith('Selecione texto dentro de um elemento NCM para comentar.');

    hoisted.toastErrorMock.mockReset();
    hoisted.selectionStateRef.value = {
      selection: {
        text: 'Texto com anchor',
        anchorKey: 'pos-85-17',
        rect: { top: 150 },
      },
      clearSelection: vi.fn(),
      onPopoverMouseDown: vi.fn(),
    };

    rerender(
      <ResultDisplay
        data={{
          type: 'code',
          markdown: '<h3 id="pos-85-17">Item 8517</h3><p>Texto selecionável</p>',
          resultados: {
            '85': {
              capitulo: '85',
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-selection"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('highlight-request-comment'));

    await waitFor(() => {
      expect(screen.getByTestId('comment-panel-pending')).toHaveTextContent('pos-85-17');
      expect(screen.getByTestId('comment-drawer')).toHaveAttribute('data-open', 'true');
    });
    expect(hoisted.selectionStateRef.value.clearSelection).toHaveBeenCalled();
  });

  it('submits, dismisses, edits, and deletes comments through the mocked comment surfaces', async () => {
    hoisted.selectionStateRef.value = {
      selection: {
        text: 'Texto com anchor',
        anchorKey: 'pos-85-17',
        rect: { top: 150 },
      },
      clearSelection: vi.fn(),
      onPopoverMouseDown: vi.fn(),
    };

    render(
      <ResultDisplay
        data={{
          type: 'code',
          markdown: '<h3 id="pos-85-17">Item 8517</h3><p>Texto selecionável</p>',
          resultados: {
            '85': {
              capitulo: '85',
              posicoes: [{ codigo: '85.17', anchor_id: 'pos-85-17', descricao: 'Item 8517' }],
            },
          },
        }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-comment-actions"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ativar comentários' }));
    await waitFor(() => {
      expect(screen.getByTestId('highlight-popover')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('highlight-request-comment'));
    await waitFor(() => {
      expect(screen.getByTestId('comment-panel-pending')).toHaveTextContent('pos-85-17');
    });

    fireEvent.click(screen.getByTestId('comment-panel-submit'));
    await waitFor(() => {
      expect(hoisted.commentsStateRef.value.addComment).toHaveBeenCalledWith(
        expect.objectContaining({
          anchorKey: 'pos-85-17',
          selectedText: 'Texto com anchor',
        }),
        'Comentário enviado',
        false,
        'Teste',
        null,
      );
      expect(screen.getByTestId('comment-panel-pending')).toHaveTextContent('');
    });

    fireEvent.click(screen.getByTestId('comment-panel-edit'));
    expect(hoisted.commentsStateRef.value.editComment).toHaveBeenCalledWith('comment-1', 'Editado');

    fireEvent.click(screen.getByTestId('comment-panel-delete'));
    expect(hoisted.commentsStateRef.value.removeComment).toHaveBeenCalledWith('comment-1');

    fireEvent.click(screen.getByTestId('comment-panel-dismiss'));
    expect(screen.getByTestId('comment-panel-pending')).toHaveTextContent('');
  });
});
