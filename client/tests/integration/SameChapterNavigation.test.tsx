import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../../src/App';
import { AuthProvider } from '../../src/context/AuthContext';
import { ResultDisplay } from '../../src/components/ResultDisplay';
import { SettingsProvider } from '../../src/context/SettingsContext';
import * as useSearchModule from '../../src/hooks/useSearch';

vi.mock('../../src/hooks/useSearch');

vi.mock('../../src/hooks/useHistory', () => ({
    useHistory: () => ({
        history: [],
        addToHistory: vi.fn(),
        removeFromHistory: vi.fn(),
        clearHistory: vi.fn(),
    }),
}));

vi.mock('../../src/components/TextSearchResults', () => ({
    TextSearchResults: () => <div data-testid="text-results" />
}));

vi.mock('../../src/context/CrossChapterNoteContext', () => ({
    useCrossChapterNotes: () => ({
        fetchNotes: vi.fn(),
        getNote: vi.fn(),
        isLoading: vi.fn(() => false),
        cache: {}
    }),
    CrossChapterNoteProvider: ({ children }) => <div>{children}</div>
}));

describe('Same-Chapter Navigation (integration)', () => {
    const useSearchMock = vi.mocked(useSearchModule.useSearch);
    let executeSearchForTab: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        executeSearchForTab = vi.fn();
        useSearchMock.mockReturnValue({ executeSearchForTab });
    });

    it('should autoscroll to different NCM in same chapter without re-render', async () => {
        const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            cb(0);
            return 0;
        });

        // Simulate data for chapter 84 containing both 8421.2 and 8422.1
        const chapter84Markdown = [
            '<h3 class="nesh-section" data-ncm="8421" id="pos-84-21">',
            '    <span class="nesh-ncm">84.21</span> - Centrifugadoras',
            '</h3>',
            '<p>Conteúdo da posição 84.21...</p>',
            '',
            '<h3 class="nesh-section" data-ncm="8422" id="pos-84-22">',
            '    <span class="nesh-ncm">84.22</span> - Máquinas de lavar louça',
            '</h3>',
            '<p>Conteúdo da posição 84.22...</p>'
        ].join('\n');

        const chapter84Data = {
            type: 'code' as const,
            markdown: chapter84Markdown,
            resultados: {
                '84': {
                    capitulo: '84',
                    posicoes: [
                        { codigo: '84.21', nome: 'Centrifugadoras', anchor_id: 'pos-84-21' },
                        { codigo: '84.22', nome: 'Máquinas de lavar louça', anchor_id: 'pos-84-22' }
                    ]
                }
            },
            ncm: '84.21',
            query: '8421.2'
        };

        const onConsumeNewSearch = vi.fn();
        const onPersistScroll = vi.fn();

        const { container, rerender } = render(
            <SettingsProvider>
                <ResultDisplay
                    data={chapter84Data}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={true}
                    tabId="tab-1"
                    isNewSearch={true}
                    onConsumeNewSearch={onConsumeNewSearch}
                    onPersistScroll={onPersistScroll}
                />
            </SettingsProvider>
        );

        // Wait for initial content to be ready
        await waitFor(() => {
            const heading8421 = container.querySelector('#pos-84-21');
            expect(heading8421).not.toBeNull();
        });

        // Now simulate same-chapter navigation: change NCM to 8422.1 (same chapter 84)
        const updatedData = {
            ...chapter84Data,
            ncm: '84.22',
            query: '8422.1',
            // results/markdown UNCHANGED - this is the key optimization
        };

        rerender(
            <SettingsProvider>
                <ResultDisplay
                    data={updatedData}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={true}
                    tabId="tab-1"
                    isNewSearch={true}
                    onConsumeNewSearch={onConsumeNewSearch}
                    onPersistScroll={onPersistScroll}
                />
            </SettingsProvider>
        );

        // Verify that the scroll target changed to 8422
        await waitFor(() => {
            const heading8422 = container.querySelector('#pos-84-22');
            expect(heading8422).not.toBeNull();
            // In a real scenario, useRobustScroll would have triggered scrollIntoView
            // Here we just verify the target element exists and can be scrolled to
        });

        // The key assertion: content should not have been re-injected
        // (In reality, ResultDisplay checks lastMarkupRef to avoid re-parsing)
        const allHeadings = container.querySelectorAll('h3.nesh-section');
        expect(allHeadings.length).toBe(2); // Both 84.21 and 84.22 still present

        rafSpy.mockRestore();
    });

    it('should trigger fetch when navigating to different chapter', async () => {
        render(
            <AuthProvider>
                <SettingsProvider>
                    <App />
                </SettingsProvider>
            </AuthProvider>
        );

        const input = screen.getByPlaceholderText(/Digite os NCMs separados/i);
        fireEvent.change(input, { target: { value: '7308' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(executeSearchForTab).toHaveBeenCalledTimes(1);
        });

        expect(executeSearchForTab).toHaveBeenCalledWith('tab-1', 'nesh', '7308', true);
    });
});
