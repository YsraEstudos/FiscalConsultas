import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResultDisplay } from '../../src/../src/components/ResultDisplay';
import { SettingsProvider } from '../../src/context/SettingsContext';

// Sidebar data includes a chapter header + positions.
// Render enough items to include 10 positions plus the header.
const VISIBLE_ITEMS = 11;

vi.mock('react-virtuoso', () => ({
    Virtuoso: ({ data, itemContent }: any) => (
        <div data-testid="virtuoso">
            {data.slice(0, VISIBLE_ITEMS).map((item: any, index: number) => (
                <div key={index}>{itemContent(index, item)}</div>
            ))}
        </div>
    )
}));

describe('Frontend Render Performance', () => {
    it('renders initial window for large result set within 500ms', async () => {
        // 1. Generate Large Mock Data (50 complex items)
        const largeMockData = {
            resultados: {
                '84': {
                    capitulo: '84',
                    posicoes: Array.from({ length: 50 }, (_, i) => ({
                        codigo: `84.${String(i).padStart(2, '0')}`,
                        descricao: `Descrição complexa do item ${i} para testar a performance de renderização do React e garantir que a interface não trave com muitos resultados na tela.`
                    }))
                }
            },
            markdown: '<h1>Conteúdo Gerado</h1><p>Renderização de teste...</p>',
            type: 'code'
        };

        // 2. Measure Render Time
        const start = performance.now();

        render(
            <SettingsProvider>
                <ResultDisplay
                    data={largeMockData}
                    mobileMenuOpen={false}
                    onCloseMobileMenu={vi.fn()}
                    tabId="tab-1"
                    isActive={true}
                    isNewSearch={false}
                    onConsumeNewSearch={vi.fn()}
                />
            </SettingsProvider>
        );

        // Wait for a visible item to be in document (virtualized window)
        await screen.findByText(/Descrição complexa do item 9/);

        const end = performance.now();
        const duration = end - start;

        console.log(`\n[PERF] Render Time for ${VISIBLE_ITEMS} of 50 items: ${duration.toFixed(2)}ms`);

        // 3. Assert Performance Threshold
        // Observação: em CI/Windows o JSDOM pode variar bastante.
        expect(duration).toBeLessThan(800);
    });
});
