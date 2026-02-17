import { render, act, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResultDisplay } from '../src/components/ResultDisplay';
import { SettingsProvider } from '../src/context/SettingsContext';

// Mock dependencies
vi.mock('../src/components/TextSearchResults', () => ({ TextSearchResults: () => null }));
vi.mock('../src/components/Sidebar', () => ({ Sidebar: () => null }));

// Storage for scroll calls
const scrollCalls: { element: HTMLElement; options: any }[] = [];

// Mock scrollIntoView to capture what element was scrolled
const scrollIntoViewMock = vi.fn(function (this: HTMLElement, options?: ScrollIntoViewOptions) {
    scrollCalls.push({ element: this, options });
});

Element.prototype.scrollIntoView = scrollIntoViewMock;

describe('TDD: 84.18 Scroll Bug Reproduction', () => {
    let originalRequestIdleCallback: typeof window.requestIdleCallback | undefined;
    let originalCancelIdleCallback: typeof window.cancelIdleCallback | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        scrollIntoViewMock.mockClear();
        scrollCalls.length = 0;

        // Mock requestIdleCallback to execute immediately
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
        }
        if (originalCancelIdleCallback) {
            window.cancelIdleCallback = originalCancelIdleCallback;
        }
        vi.useRealTimers();
    });

    it('should scroll to the REAL 84.18 heading, NOT to a reference inside 84.17 content', async () => {
        /**
         * BUG REPRODUCTION:
         * 
         * User searches for "8418" expecting to land on "84.18 - Refrigeradores..."
         * But scroll stops at "Os fornos para fusão ou ustulação de minérios" 
         * which is CONTENT inside position 84.17 that mentions 84.18.
         * 
         * The problem is that 84.17's content references 84.18 and creates
         * an anchor or element that matches before the real 84.18 heading.
         */

        const mockData = {
            query: '8418',
            type: 'code' as const,
            ncm: '84.18',
            // Simulated content where 84.17 mentions 84.18
            markdown: `
<h3 class="nesh-section" id="pos-84-17" data-ncm="8417">
    <strong>84.17</strong> - Fornos industriais ou de laboratório
</h3>
<p class="nesh-paragraph">
    Os fornos para fusão ou ustulação de minérios. 
    Ver também a posição <a href="#" class="smart-link" data-ncm="8418">84.18</a> 
    para equipamentos de refrigeração.
</p>
<p class="nesh-paragraph" id="pos-84-18">
    <!-- THIS IS THE IMPOSTOR - A paragraph with the target ID but NOT the heading -->
    Referência cruzada: Esta posição não inclui refrigeradores (84.18).
</p>

<h3 class="nesh-section" id="pos-84-18" data-ncm="8418">
    <strong>84.18</strong> - Refrigeradores, congeladores (freezers) e outros materiais
</h3>
<p class="nesh-paragraph">
    Esta posição compreende os aparelhos de produção de frio...
</p>
            `,
            resultados: {
                '84': {
                    capitulo: '84',
                    posicao_alvo: '84.18',
                    posicoes: [
                        { codigo: '84.17', anchor_id: 'pos-84-17' },
                        { codigo: '84.18', anchor_id: 'pos-84-18' }
                    ]
                }
            }
        };

        render(
            <SettingsProvider>
                <ResultDisplay
                    data={mockData}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={true}
                    tabId="tab-8418-bug"
                    isNewSearch={true}
                    onConsumeNewSearch={vi.fn()}
                />
            </SettingsProvider>
        );

        // Wait for all async operations
        await act(async () => {
            await vi.runAllTimersAsync();
        });

        // Verify scroll was called
        expect(scrollIntoViewMock).toHaveBeenCalled();

        // The FIRST scroll call should be to an H3 element (the structural heading)
        // NOT to a paragraph or other impostor element
        const firstScrolledElement = scrollCalls[0]?.element;

        expect(firstScrolledElement).toBeDefined();
        expect(firstScrolledElement.tagName).toBe('H3');
        expect(firstScrolledElement.id).toBe('pos-84-18');
        expect(firstScrolledElement.textContent).toContain('84.18');
        expect(firstScrolledElement.textContent).toContain('Refrigeradores');
    });

    it('should handle duplicate IDs by selecting the structural element (H3)', async () => {
        /**
         * Edge case: Multiple elements have the same ID (invalid HTML but happens).
         * The scroll logic should prioritize H3 over P or SPAN.
         */

        const mockData = {
            query: '8418',
            type: 'code' as const,
            ncm: '84.18',
            markdown: `
<span id="pos-84-18">Impostor span</span>
<p id="pos-84-18">Impostor paragraph</p>
<h3 class="nesh-section" id="pos-84-18" data-ncm="8418">
    <strong>84.18</strong> - Real heading
</h3>
            `,
            resultados: {
                '84': {
                    capitulo: '84',
                    posicao_alvo: '84.18',
                    posicoes: [{ codigo: '84.18', anchor_id: 'pos-84-18' }]
                }
            }
        };

        render(
            <SettingsProvider>
                <ResultDisplay
                    data={mockData}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={true}
                    tabId="tab-duplicate-id"
                    isNewSearch={true}
                    onConsumeNewSearch={vi.fn()}
                />
            </SettingsProvider>
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(scrollIntoViewMock).toHaveBeenCalled();

        const firstScrolledElement = scrollCalls[0]?.element;

        // Must be the H3, not span or p
        expect(firstScrolledElement?.tagName).toBe('H3');
    });

    it('should NOT scroll to smart-link references', async () => {
        /**
         * Smart-links like <a class="smart-link" data-ncm="8418">84.18</a>
         * should NEVER be scroll targets, even if they somehow get an ID.
         */

        const mockData = {
            query: '8418',
            type: 'code' as const,
            ncm: '84.18',
            markdown: `
<p>
    Ver <a id="pos-84-18" class="smart-link" data-ncm="8418">84.18</a>
</p>
<h3 class="nesh-section" id="pos-84-18" data-ncm="8418">
    <strong>84.18</strong> - Real heading
</h3>
            `,
            resultados: {
                '84': {
                    capitulo: '84',
                    posicao_alvo: '84.18',
                    posicoes: [{ codigo: '84.18', anchor_id: 'pos-84-18' }]
                }
            }
        };

        render(
            <SettingsProvider>
                <ResultDisplay
                    data={mockData}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    isActive={true}
                    tabId="tab-smart-link"
                    isNewSearch={true}
                    onConsumeNewSearch={vi.fn()}
                />
            </SettingsProvider>
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        const firstScrolledElement = scrollCalls[0]?.element;

        // Must NOT be an anchor tag
        expect(firstScrolledElement?.tagName).not.toBe('A');
        expect(firstScrolledElement?.tagName).toBe('H3');
    });
});
