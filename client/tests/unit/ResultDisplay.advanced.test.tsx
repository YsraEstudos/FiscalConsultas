import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marked } from 'marked';

import { ResultDisplay } from '../../src/components/ResultDisplay';
import { NeshRenderer } from '../../src/utils/NeshRenderer';

const hoisted = vi.hoisted(() => ({
  sidebarPositionRef: { value: 'right' as 'left' | 'right' },
  robustCallsRef: { value: [] as any[] },
  debugWarnMock: vi.fn(),
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
  useAuth: () => ({
    userName: 'Teste',
    userImageUrl: null,
  }),
}));

vi.mock('../../src/hooks/useComments', () => ({
  useComments: () => ({
    comments: [],
    addComment: vi.fn(),
    editComment: vi.fn(),
    removeComment: vi.fn(),
    commentedAnchors: [],
    loadCommentedAnchors: vi.fn().mockResolvedValue([]),
    loadComments: vi.fn().mockResolvedValue(undefined),
    resetFetchedAnchors: vi.fn(),
  }),
}));

vi.mock('../../src/hooks/useTextSelection', () => ({
  useTextSelection: () => ({
    selection: null,
    clearSelection: vi.fn(),
    onPopoverMouseDown: vi.fn(),
  }),
}));

vi.mock('../../src/components/HighlightPopover', () => ({
  HighlightPopover: () => null,
}));

vi.mock('../../src/components/CommentPanel', () => ({
  CommentPanel: () => null,
}));

vi.mock('../../src/components/CommentDrawer', () => ({
  CommentDrawer: () => null,
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
    hoisted.sidebarPositionRef.value = 'right';
    intersectionCallbacks = [];

    // @ts-expect-error - test bridge
    window.nesh = { smartLinkSearch: vi.fn() };

    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('forwards text result clicks to window.nesh.smartLinkSearch', () => {
    render(
      <ResultDisplay
        data={{ type: 'text', results: [{ ncm: '8517' } as any], query: 'telefone' }}
        mobileMenuOpen={false}
        onCloseMobileMenu={vi.fn()}
        isActive={true}
        tabId="tab-text"
        isNewSearch={false}
        onConsumeNewSearch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('text-result-click'));
    expect((window as any).nesh.smartLinkSearch).toHaveBeenCalledWith('8517');
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

  it('replaces text-query highlights on query change without accumulating wrappers', async () => {
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
      const marks = container.querySelectorAll('mark[data-text-query-highlight="true"]');
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
      const marks = container.querySelectorAll('mark[data-text-query-highlight="true"]');
      expect(marks).toHaveLength(1);
      expect(marks[0]?.textContent?.toLowerCase()).toBe('bomba');
      expect(container.querySelectorAll('mark mark')).toHaveLength(0);
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
});
