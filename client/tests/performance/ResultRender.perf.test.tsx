
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ResultDisplay } from '../../src/../src/components/ResultDisplay';

describe('Frontend Render Performance', () => {
    it('renders large result set within 300ms', async () => {
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

        render(<ResultDisplay data={largeMockData} />);

        // Wait for last item to be in document
        await screen.findByText(/Descrição complexa do item 49/);

        const end = performance.now();
        const duration = end - start;

        console.log(`\n[PERF] Render Time for 50 items: ${duration.toFixed(2)}ms`);

        // 3. Assert Performance Threshold
        // Observação: em CI/Windows o JSDOM pode variar bastante.
        expect(duration).toBeLessThan(300);
    });
});
