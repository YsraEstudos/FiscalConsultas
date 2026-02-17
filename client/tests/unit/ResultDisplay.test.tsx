import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResultDisplay } from '../../src/components/ResultDisplay';
import { SettingsProvider } from '../../src/context/SettingsContext';

// Mock child components to isolate ResultDisplay logic
vi.mock('../../src/components/TextSearchResults', () => ({
    TextSearchResults: ({ results }: { results: any[] }) => <div data-testid="text-results">{results.length} results found</div>
}));

vi.mock('../../src/components/Sidebar', () => ({
    Sidebar: () => <div data-testid="sidebar">Sidebar</div>
}));

describe('ResultDisplay Component', () => {
    beforeEach(() => {
        // Mock scrollIntoView
        Element.prototype.scrollIntoView = vi.fn();

        // Mock requestIdleCallback to run immediately
        globalThis.requestIdleCallback = (cb: any) => {
            return window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
        };
        globalThis.cancelIdleCallback = (id: number) => window.clearTimeout(id);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders empty state when no data is provided', () => {
        render(
            <SettingsProvider>
                <ResultDisplay
                    data={null}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={true}
                    tabId="tab-1"
                    isNewSearch={false}
                    onConsumeNewSearch={vi.fn()}
                />
            </SettingsProvider>
        );
        expect(screen.getByText('Sem resultados para exibir.')).toBeInTheDocument();
    });

    it('renders text search results correctly', () => {
        const mockData = {
            type: 'text' as const,
            results: [1, 2, 3] as any[],
            query: 'test'
        };
        render(
            <SettingsProvider>
                <ResultDisplay
                    data={mockData}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={true}
                    tabId="tab-1"
                    isNewSearch={false}
                    onConsumeNewSearch={vi.fn()}
                />
            </SettingsProvider>
        );
        expect(screen.getByTestId('text-results')).toHaveTextContent('3 results found');
    });

    it('renders markdown content correctly', async () => {
        const mockData = {
            type: 'code' as const,
            markdown: '# Title\nSome content',
            resultados: []
        };
        render(
            <SettingsProvider>
                <ResultDisplay
                    data={mockData as any}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={true}
                    tabId="tab-1"
                    isNewSearch={false}
                    onConsumeNewSearch={vi.fn()}
                />
            </SettingsProvider>
        );
        // marked parses # Title to <h1 id="title">Title</h1>
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Title');
            expect(screen.getByText('Some content')).toBeInTheDocument();
        });
    });

    it('renders code content from data.results when data.resultados is missing', async () => {
        const mockData = {
            type: 'code' as const,
            query: '8422',
            results: {
                '84': {
                    capitulo: '84',
                    titulo: 'Capitulo 84',
                    posicoes: [
                        {
                            codigo: '84.22',
                            ncm: '8422',
                            descricao: 'Maquina de lavar',
                            anchor_id: 'pos-84-22',
                            aliquota: '0'
                        }
                    ]
                }
            }
        };

        render(
            <SettingsProvider>
                <ResultDisplay
                    data={mockData as any}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={true}
                    tabId="tab-1"
                    isNewSearch={false}
                    onConsumeNewSearch={vi.fn()}
                />
            </SettingsProvider>
        );

        await waitFor(() => {
            expect(screen.queryByText('Sem resultados para exibir.')).not.toBeInTheDocument();
            expect(screen.getByText('Maquina de lavar')).toBeInTheDocument();
        });
    });

    it('persists scroll position when tab becomes inactive', async () => {
        const onPersistScroll = vi.fn();
        const mockData = {
            type: 'text' as const,
            results: [1, 2] as any[],
            query: 'test'
        };

        const { container, rerender } = render(
            <SettingsProvider>
                <ResultDisplay
                    data={mockData}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={true}
                    tabId="tab-1"
                    isNewSearch={false}
                    onConsumeNewSearch={vi.fn()}
                    onPersistScroll={onPersistScroll}
                />
            </SettingsProvider>
        );

        const scrollContainer = container.querySelector('#results-content-tab-1') as HTMLDivElement | null;
        expect(scrollContainer).not.toBeNull();
        if (!scrollContainer) return;

        scrollContainer.scrollTop = 240;
        fireEvent.scroll(scrollContainer);

        rerender(
            <SettingsProvider>
                <ResultDisplay
                    data={mockData}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={false}
                    tabId="tab-1"
                    isNewSearch={false}
                    onConsumeNewSearch={vi.fn()}
                    onPersistScroll={onPersistScroll}
                />
            </SettingsProvider>
        );

        await waitFor(() => {
            expect(onPersistScroll).toHaveBeenCalledWith('tab-1', 240);
        });
    });

    it('restores scroll position when tab becomes active (non-new search)', async () => {
        const mockData = {
            type: 'text' as const,
            results: [1] as any[],
            query: 'test'
        };

        const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            cb(0);
            return 0;
        });

        const { container, rerender } = render(
            <SettingsProvider>
                <ResultDisplay
                    data={mockData}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={false}
                    tabId="tab-1"
                    isNewSearch={false}
                    onConsumeNewSearch={vi.fn()}
                />
            </SettingsProvider>
        );

        const scrollContainer = container.querySelector('#results-content-tab-1') as HTMLDivElement | null;
        expect(scrollContainer).not.toBeNull();
        if (!scrollContainer) return;

        scrollContainer.scrollTop = 0;

        rerender(
            <SettingsProvider>
                <ResultDisplay
                    data={mockData}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={true}
                    tabId="tab-1"
                    isNewSearch={false}
                    onConsumeNewSearch={vi.fn()}
                    initialScrollTop={180}
                />
            </SettingsProvider>
        );

        expect(scrollContainer.scrollTop).toBe(180);

        rafSpy.mockRestore();
    });


});
