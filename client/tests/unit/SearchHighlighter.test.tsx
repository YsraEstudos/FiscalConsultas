import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { SearchHighlighter } from '../../src/components/SearchHighlighter';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('SearchHighlighter', () => {
    let containerRef: React.RefObject<HTMLElement>;

    beforeEach(() => {
        // Setup a fake container with some chapters and paragraphs
        const div = document.createElement('div');
        div.innerHTML = `
            <div id="cap-1" class="tipi-chapter">
                <h3 id="pos-84-21" class="nesh-section">84.21</h3>
                <p>O motor elétrico é uma máquina que transforma energia.</p>
                <h4 id="pos-84-21-10" class="nesh-subsection">84.21.10</h4>
                <p>O fluxo centrífugo é importante para a refrigeração.</p>
            </div>
            <div id="cap-2" class="tipi-chapter">
                <h3 id="pos-84-22" class="nesh-section">84.22</h3>
                <p>Este parágrafo contém um motor e também um sistema centrífugo integrado no mesmo bloco.</p>
            </div>
        `;
        document.body.appendChild(div);
        containerRef = { current: div } as React.RefObject<HTMLElement>;
    });

    afterEach(() => {
        if (containerRef.current) {
            document.body.removeChild(containerRef.current);
        }
        vi.restoreAllMocks();
    });

    it('identifica Match Alto quando todas as palavras estão no mesmo parágrafo', async () => {
        render(
            <SearchHighlighter
                query="motor centrífugo"
                contentContainerRef={containerRef}
                isContentReady={true}
            />
        );

        // O Match Alto deve aparecer porque o cap-2 tem 'motor' e 'centrífugo' no mesmo <p>
        const matchLabel = await screen.findByText("Match Alto");
        expect(matchLabel).toBeInTheDocument();
        expect(screen.getByText("1 subposição com alta correspondência")).toBeInTheDocument();

        // Verifica a quantidade de pill terms
        const motorPill = screen.getByRole('button', { name: /motor/i });
        const centrifugoPill = screen.getByRole('button', { name: /centrifugo/i });

        // Conta as ocorrências
        // 'motor' aparece 2 vezes
        // 'centrífugo' aparece 2 vezes
        expect(motorPill.textContent).toContain('2');
        expect(centrifugoPill.textContent).toContain('2');
    });

    it('identifica Match Pequeno quando as palavras estão no mesmo capítulo, mas não no mesmo parágrafo', async () => {
        const div = document.createElement('div');
        div.innerHTML = `
            <div id="cap-1" class="tipi-chapter">
                <p>O motor elétrico é muito potente.</p>
                <p>O sistema centrífugo ajuda no fluxo.</p>
            </div>
        `;
        const testContainerRef = { current: div };

        render(
            <SearchHighlighter
                query="motor centrífugo"
                contentContainerRef={testContainerRef as React.RefObject<HTMLElement>}
                isContentReady={true}
            />
        );

        const matchLabel = await screen.findByText("Match Pequeno");
        expect(matchLabel).toBeInTheDocument();
    });

    it('identifica Match Alto quando termos coexistem na mesma subposição em blocos diferentes', async () => {
        const div = document.createElement('div');
        div.innerHTML = `
            <div id="cap-1" class="tipi-chapter">
                <h3 id="pos-84-21" class="nesh-section">84.21</h3>
                <p>O motor elétrico aparece neste parágrafo.</p>
                <p>Já o fluxo centrífugo aparece no parágrafo seguinte.</p>
            </div>
        `;
        const testContainerRef = { current: div };

        render(
            <SearchHighlighter
                query="motor centrífugo"
                contentContainerRef={testContainerRef as React.RefObject<HTMLElement>}
                isContentReady={true}
            />
        );

        expect(await screen.findByText("Match Alto")).toBeInTheDocument();
        expect(screen.getByText("1 subposição com alta correspondência")).toBeInTheDocument();
    });

    it('identifica Matches Distantes (Nenhum) quando as palavras estão em capítulos diferentes', async () => {
        const div = document.createElement('div');
        div.innerHTML = `
            <div id="cap-1" class="tipi-chapter">
                <p>O motor elétrico.</p>
            </div>
            <div id="cap-2" class="tipi-chapter">
                <p>O sistema centrífugo.</p>
            </div>
        `;
        const testContainerRef = { current: div };

        render(
            <SearchHighlighter
                query="motor centrífugo"
                contentContainerRef={testContainerRef as React.RefObject<HTMLElement>}
                isContentReady={true}
            />
        );

        const matchLabel = await screen.findByText("Matches Distantes");
        expect(matchLabel).toBeInTheDocument();
    });

    it('permite alternar entre palavras e navegar entre ocorrências', async () => {
        if (!window.HTMLElement.prototype.scrollIntoView) {
            Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
                value: () => { },
                configurable: true,
                writable: true
            });
        }
        const scrollSpy = vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => { });

        render(
            <SearchHighlighter
                query="motor"
                contentContainerRef={containerRef}
                isContentReady={true}
            />
        );

        const nextBtn = await screen.findByTitle("Navegar para a próxima ocorrência");
        const prevBtn = await screen.findByTitle("Navegar para a ocorrência anterior");

        // The initial progress should be 1 / 2
        let progress = screen.getByText("1 / 2");
        expect(progress).toBeInTheDocument();

        // Navigate Next
        fireEvent.click(nextBtn);
        progress = screen.getByText("2 / 2");
        expect(progress).toBeInTheDocument();
        expect(scrollSpy).toHaveBeenCalled();

        // Navigate Prev
        fireEvent.click(prevBtn);
        progress = screen.getByText("1 / 2");
        expect(progress).toBeInTheDocument();
    });

    it('conta coocorrências em múltiplas subposições com alta correspondência', async () => {
        const div = document.createElement('div');
        div.innerHTML = `
            <div id="cap-1" class="tipi-chapter">
                <h3 id="pos-84-10" class="nesh-section">84.10</h3>
                <p>Motor centrífugo para teste.</p>
                <h3 id="pos-84-11" class="nesh-section">84.11</h3>
                <p>Outro motor centrífugo no mesmo capítulo.</p>
            </div>
        `;
        const testContainerRef = { current: div };

        render(
            <SearchHighlighter
                query="motor centrífugo"
                contentContainerRef={testContainerRef as React.RefObject<HTMLElement>}
                isContentReady={true}
            />
        );

        expect(await screen.findByText("2 subposições com alta correspondência")).toBeInTheDocument();
    });
});
