
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResultDisplay } from '../../src/../src/components/ResultDisplay';

// Mock dependencies
vi.mock('./TextSearchResults', () => ({ TextSearchResults: () => null }));
vi.mock('./Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../src/context/SettingsContext', () => ({
    useSettings: () => ({ highlightEnabled: true })
}));

// Mock scrollIntoView
const scrollIntoViewMock = vi.fn();
window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

describe('ResultDisplay Auto-Scroll', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should scroll to and highlight NCM anchor when data is loaded', async () => {
        const mockData = {
            query: '85.17',
            type: 'code' as const,
            markdown: '<div id="pos-85-17"></div>\n\n### 85.17 - Telefones'
        };

        // Render ResultDisplay directly
        render(
            <ResultDisplay
                data={mockData}
                mobileMenuOpen={false}
                onCloseMobileMenu={vi.fn()}
                tabId="tab-1"
                isActive={true}
                isNewSearch={true}
                onConsumeNewSearch={vi.fn()}
            />
        );

        // Advance timers to trigger the retry logic
        // 600ms should be enough (observer finds element + 400ms delay for highlight)
        await vi.advanceTimersByTimeAsync(600);

        // Verify scrollIntoView was called on the correct element
        expect(scrollIntoViewMock).toHaveBeenCalled();

        const targetElement = document.getElementById('pos-85-17');
        expect(targetElement).not.toBeNull();
        if (targetElement) {
            expect(targetElement.classList.contains('flash-highlight')).toBe(true);
        }
    });

    it('should handle dotless query by matching dotted anchor', async () => {
        const mockData = {
            query: '8517',
            type: 'code' as const,
            // Backend returns dotted id in markdown
            markdown: '<div id="pos-85-17"></div>\n\n### 85.17 - Telefones',
            // Backend returns posicao_alvo with the correct format
            resultados: {
                '85': {
                    capitulo: '85',
                    posicao_alvo: '85.17',
                    posicoes: []
                }
            }
        };

        render(
            <ResultDisplay
                data={mockData}
                mobileMenuOpen={false}
                onCloseMobileMenu={vi.fn()}
                tabId="tab-1"
                isActive={true}
                isNewSearch={true}
                onConsumeNewSearch={vi.fn()}
            />
        );

        await vi.advanceTimersByTimeAsync(600);

        const targetElement = document.getElementById('pos-85-17');
        expect(targetElement).not.toBeNull();
        expect(scrollIntoViewMock).toHaveBeenCalled();
    });

    it('should not scroll for non-NCM search like plain text', async () => {
        const mockData = {
            query: 'computador',
            type: 'text' as const,
            results: []
        };

        render(
            <ResultDisplay
                data={mockData}
                mobileMenuOpen={false}
                onCloseMobileMenu={vi.fn()}
                tabId="tab-1"
                isActive={true}
                isNewSearch={true}
                onConsumeNewSearch={vi.fn()}
            />
        );

        await vi.advanceTimersByTimeAsync(600);

        expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });
});
