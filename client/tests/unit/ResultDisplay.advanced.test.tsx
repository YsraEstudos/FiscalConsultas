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
  authStateRef: {
    value: {
      userName: 'Teste',
      userImageUrl: null as string | null,
      isSignedIn: true,
      isLoading: false,
      userId: 'user_test',
      userEmail: 'allowed@example.com',
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
      <button data-testid="comment-panel-submit" onClick={() => void onSubmit('Comentário enviado', false)}>
        submit-comment
      </button>
      <button data-testid="comment-panel-dismiss" onClick={onDismiss}>
        dismiss-comment
      </button>
      <button data-testid="comment-panel-edit" onClick={() => void onEdit('comment-1', 'Editado')}>
        edit-comment
      </button>
      <button data-testid="comment-panel-delete" onClick={() => void onDelete('comment-1')}>
        delete-comment
      </button>
    </div>
  ),
}));

vi.mock('../../src/components/CommentDrawer', () => ({
  CommentDrawer: ({ open, pending, comments, onClose, onSubmit }: any) => (
    <div data-testid="comment-drawer" data-open={String(Boolean(open))}>
      <span data-testid="comment-drawer-pending">{pending?.anchorKey ?? ''}</span>
      <span data-testid="comment-drawer-count">{comments.length}</span>
      <button data-testid="comment-drawer-close" onClick={onClose}>
        close-drawer
      </button>
      <button data-testid="comment-drawer-submit" onClick={() => void onSubmit('Comentário drawer', true)}>
        submit-drawer
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
    hoisted.sidebarPositionRef.value = 'right';
    hoisted.authStateRef.value = {
      userName: 'Teste',
      userImageUrl: null,
      isSignedIn: true,
      isLoading: false,
      userId: 'user_test',
      userEmail: 'allowed@example.com',
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
    vi.stubEnv('VITE_RESTRICTED_UI_EMAILS', 'allowed@example.com');

    // @ts-expect-error - test bridge
    globalThis.nesh = { smartLinkSearch: vi.fn(), openTextResultInNewTab: vi.fn() };

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

    Object.defineProperty(window, 'matchMedia', {
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

    const toggle = screen.getByRole('button', { name: 'Recolher navegação' });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Expandir navegação' })).toBeInTheDocument();
  });

  it('uses NeshRenderer fallback and resolves sidebar navigation ids', async () => {
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
      expect(screen.queryByText('Conteudo ativo')).not.toBeInTheDocument();
    });

    const contentContainer = container.querySelector('#results-content-tab-reactivate');
    expect(contentContainer?.textContent).not.toContain('Conteudo ativo');

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
      expect(onContentReady).toHaveBeenCalledTimes(2);
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
    const originalLocation = window.location;
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
      Object.defineProperty(window, 'location', {
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
        'Comentários exigem token Clerk válido. Em desenvolvimento, use http://localhost:5173.',
      );
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it('loads commented anchors, applies DOM markers, and opens the drawer when a commented anchor is clicked on narrow screens', async () => {
    hoisted.commentsStateRef.value = {
      ...hoisted.commentsStateRef.value,
      comments: [{ id: 'comment-1', body: 'Já existe' }],
      commentedAnchors: ['pos-85-17'],
    };
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 1280px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as any;

    render(
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
  });

  it('reports invalid text selections and opens a pending comment for valid selections', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
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
