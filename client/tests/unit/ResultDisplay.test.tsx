import { render, screen, waitFor } from '@testing-library/react';
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


});
