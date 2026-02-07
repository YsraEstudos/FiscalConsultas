import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResultDisplay } from '../src/components/ResultDisplay';
import { SettingsProvider } from '../src/context/SettingsContext';

// Mock dependencies
vi.mock('../src/components/TextSearchResults', () => ({ TextSearchResults: () => null }));
vi.mock('../src/components/Sidebar', () => ({ Sidebar: () => null }));

// Mock scrollIntoView
const scrollIntoViewMock = vi.fn();
Element.prototype.scrollIntoView = scrollIntoViewMock;

describe('Reproduction: 8417 Search Issue', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        scrollIntoViewMock.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should scroll to the real 84.17 heading, NOT to a reference in 84.16', async () => {
        // SCENARIO:
        // Position 84.16 description mentions "84.17". 
        // We suspect the scroller might be grabbing that reference instead of the real heading.

        const mockData = {
            query: '8417', // User typed this
            type: 'code' as const,
            ncm: '84.17',
            // Simulating markdown that Nesh might generate
            markdown: `
<a href="#" id="pos-84-17" data-impostor="true">Link impostor 84.17</a>
<p>Texto qualquer...</p>
<h3 class="nesh-section" id="pos-84-17" data-ncm="8417">
    <strong>84.17</strong> - Fornos industriais ou de laboratório...
</h3>
            `,
            resultados: {
                '84': {
                    capitulo: '84',
                    posicao_alvo: '84.17',
                    posicoes: [
                        { codigo: '84.17', anchor_id: 'pos-84-17' }
                    ]
                }
            }
        };

        const { container } = render(
            <SettingsProvider>
                <ResultDisplay
                    data={mockData}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={true}
                    tabId="tab-bug-repro"
                    isNewSearch={true}
                    onConsumeNewSearch={vi.fn()}
                />
            </SettingsProvider>
        );

        // Run logic
        // We use wait because MutationObserver is async
        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(scrollIntoViewMock).toHaveBeenCalled();

        // The mock might have been called multiple times if we iterate?
        // But useRobustScroll stops after first success.
        // We want to ensure the element that triggered scroll is the H3.

        // Find the element instance from the mock call
        const scrolledElement = scrollIntoViewMock.mock.contexts[0] as HTMLElement;

        console.log('Scrolled Tag:', scrolledElement.tagName);
        expect(scrolledElement.tagName).toBe('H3');
        expect(scrolledElement.getAttribute('data-impostor')).toBeNull();
    });
});
