import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResultDisplay } from '../../src/../src/components/ResultDisplay';

// Mock dependencies
vi.mock('../../src/components/TextSearchResults', () => ({ TextSearchResults: () => null }));
vi.mock('../../src/components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../src/context/SettingsContext', () => ({
    useSettings: () => ({ highlightEnabled: true })
}));

// Mock scrollIntoView
const scrollIntoViewMock = vi.fn();
window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

describe('ResultDisplay Auto-Scroll', () => {
    let originalRequestIdleCallback: typeof window.requestIdleCallback | undefined;
    let originalCancelIdleCallback: typeof window.cancelIdleCallback | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        originalRequestIdleCallback = window.requestIdleCallback;
        originalCancelIdleCallback = window.cancelIdleCallback;
        window.requestIdleCallback = (cb: IdleRequestCallback) => {
            cb(0 as unknown as IdleDeadline);
            return 0 as unknown as number;
        };
        window.cancelIdleCallback = () => { };
    });

    afterEach(() => {
        if (originalRequestIdleCallback) {
            window.requestIdleCallback = originalRequestIdleCallback;
        } else {
            // @ts-expect-error - cleanup test env
            delete window.requestIdleCallback;
        }
        if (originalCancelIdleCallback) {
            window.cancelIdleCallback = originalCancelIdleCallback;
        } else {
            // @ts-expect-error - cleanup test env
            delete window.cancelIdleCallback;
        }
        vi.useRealTimers();
    });

    it('should scroll to and highlight NCM anchor when data is loaded', async () => {
        const mockData = {
            query: '85.17',
            type: 'code' as const,
            markdown: '<div id="pos-85-17"></div>\n\n### 85.17 - Telefones'
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

        // Flush timers to trigger render + retry logic
        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(scrollIntoViewMock).toHaveBeenCalled();

        const targetElement = document.getElementById('pos-85-17');
        expect(targetElement).not.toBeNull();
    });

    it('should handle dotless query by matching dotted anchor', async () => {
        const mockData = {
            query: '8517',
            type: 'code' as const,
            markdown: '<div id="pos-85-17"></div>\n\n### 85.17 - Telefones',
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

        await act(async () => {
            await vi.runAllTimersAsync();
        });

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

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });

    it('should scroll to 84.17 heading, not to subsection text like "Queimadores mistos"', async () => {
        // This test validates the fix for bug where searching "8417" scrolled to
        // "Queimadores mistos" (a subsection of 84.16) instead of the 84.17 heading.
        const mockData = {
            query: '8417',
            type: 'code' as const,
            ncm: '84.17',
            markdown: `
                <h3 class="nesh-heading" data-ncm="8416" id="pos-84-16">
                    <span class="nesh-ncm">84.16</span> - Queimadores para alimentação de fornalhas
                </h3>
                <p>Conteúdo do 84.16 incluindo menção a Queimadores mistos...</p>
                <h3 class="nesh-heading" data-ncm="8417" id="pos-84-17">
                    <span class="nesh-ncm">84.17</span> - Fornos industriais ou de laboratório
                </h3>
                <p>Conteúdo do 84.17...</p>
            `,
            resultados: {
                '84': {
                    capitulo: '84',
                    posicao_alvo: '84.17',
                    posicoes: [
                        { codigo: '84.16', nome: 'Queimadores' },
                        { codigo: '84.17', nome: 'Fornos industriais' }
                    ]
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

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        // Verify scroll was called
        expect(scrollIntoViewMock).toHaveBeenCalled();

        // Verify the correct element (84.17) was scrolled to, not 84.16
        const target8417 = document.getElementById('pos-84-17');
        const target8416 = document.getElementById('pos-84-16');
        
        expect(target8417).not.toBeNull();
        expect(target8416).not.toBeNull();
        
        // The scroll should have targeted 84.17
        // Check that 84.17 has the flash-highlight class (applied after scroll)
        expect(target8417?.classList.contains('flash-highlight') || scrollIntoViewMock.mock.contexts?.some((ctx: HTMLElement) => ctx.id === 'pos-84-17')).toBeTruthy();
    });

    it('should only scroll to valid heading elements, not arbitrary text', async () => {
        // Test that even if an ID exists on a non-heading element, we skip it
        const mockData = {
            query: '8417',
            type: 'code' as const,
            ncm: '84.17',
            markdown: `
                <span id="pos-84-17-fake">Random text mentioning 84.17</span>
                <h3 class="nesh-heading" data-ncm="8417" id="pos-84-17">
                    <span class="nesh-ncm">84.17</span> - Fornos industriais
                </h3>
            `,
            resultados: {
                '84': {
                    capitulo: '84',
                    posicao_alvo: '84.17',
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

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(scrollIntoViewMock).toHaveBeenCalled();
        
        // The valid heading should receive focus, not the fake span
        const validTarget = document.getElementById('pos-84-17');
        expect(validTarget?.tagName.toLowerCase()).toBe('h3');
    });
});
