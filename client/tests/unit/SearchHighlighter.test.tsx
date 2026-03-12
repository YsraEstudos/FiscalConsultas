import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SearchHighlighter } from '../../src/components/SearchHighlighter';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function createRect(top: number): DOMRect {
    return {
        x: 0,
        y: top,
        top,
        bottom: top + 10,
        left: 0,
        right: 10,
        width: 10,
        height: 10,
        toJSON: () => ({}),
    } as DOMRect;
}

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
            containerRef.current.remove();
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('identifica Match Alto quando todas as palavras estão no mesmo parágrafo', async () => {
        render(
            <SearchHighlighter
                query="motor centrífugo"
                contentContainerRef={containerRef}
                isContentReady={true}
                isFullyRendered={true}
            />
        );

        // O Match Alto deve aparecer porque o cap-2 tem 'motor' e 'centrífugo' no mesmo <p>
        const matchLabels = await screen.findAllByText("Match Alto");
        expect(matchLabels.length).toBeGreaterThan(0);
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
                isFullyRendered={true}
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
                isFullyRendered={true}
            />
        );

        const matchLabels = await screen.findAllByText("Match Alto");
        expect(matchLabels.length).toBeGreaterThan(0);
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
                isFullyRendered={true}
            />
        );

        const matchLabel = await screen.findByText("Matches Distantes");
        expect(matchLabel).toBeInTheDocument();
    });

    it('permite alternar entre palavras e navegar entre ocorrências', async () => {
        if (!globalThis.HTMLElement.prototype.scrollIntoView) {
            Object.defineProperty(globalThis.HTMLElement.prototype, 'scrollIntoView', {
                value: () => { },
                configurable: true,
                writable: true
            });
        }
        const scrollSpy = vi.spyOn(globalThis.HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => { });

        render(
            <SearchHighlighter
                query="motor"
                contentContainerRef={containerRef}
                isContentReady={true}
                isFullyRendered={true}
            />
        );

        const nextBtn = await screen.findByRole('button', { name: "Navegar para a próxima ocorrência" });
        const prevBtn = await screen.findByRole('button', { name: "Navegar para a ocorrência anterior" });

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

    it('seleciona a ocorrencia inicial mais proxima usando a posicao relativa ao scroll container', async () => {
        const scrollContainer = document.createElement('div');
        scrollContainer.scrollTop = 300;

        const div = document.createElement('div');
        div.innerHTML = `
            <div id="first-paragraph"><p>Motor inicial</p></div>
            <div id="second-paragraph"><p>Motor mais proximo da area visivel</p></div>
        `;
        scrollContainer.appendChild(div);
        document.body.appendChild(scrollContainer);

        const testContainerRef = { current: div } as React.RefObject<HTMLElement>;
        const rectSpy = vi.spyOn(globalThis.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
            if (this === scrollContainer) {
                return createRect(0);
            }
            if (this.tagName === 'MARK' && this.dataset.shTerm === 'motor') {
                if (this.closest('#first-paragraph')) {
                    return createRect(-260);
                }
                if (this.closest('#second-paragraph')) {
                    return createRect(20);
                }
            }
            return createRect(0);
        });

        render(
            <SearchHighlighter
                query="motor"
                contentContainerRef={testContainerRef}
                isContentReady={true}
                isFullyRendered={true}
            />
        );

        expect(await screen.findByText("2 / 2")).toBeInTheDocument();

        rectSpy.mockRestore();
        scrollContainer.remove();
    });

    it('notifica quando o scroll inicial da busca termina', async () => {
        vi.useFakeTimers();

        const scrollCompleteSpy = vi.fn();
        const scrollContainer = document.createElement('div');
        const contentContainer = containerRef.current;
        expect(contentContainer).not.toBeNull();
        if (!contentContainer) return;
        scrollContainer.appendChild(contentContainer);
        scrollContainer.scrollTop = 0;

        const scrollSpy = vi
            .spyOn(globalThis.HTMLElement.prototype, 'scrollIntoView')
            .mockImplementation(() => {
                scrollContainer.scrollTop = 180;
                scrollContainer.dispatchEvent(new Event('scroll'));
            });

        render(
            <SearchHighlighter
                query="motor"
                contentContainerRef={containerRef}
                isContentReady={true}
                isFullyRendered={true}
                onHighlightScrollComplete={scrollCompleteSpy}
            />
        );

        expect(screen.getByText("1 / 2")).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(200);
        });

        expect(scrollSpy).toHaveBeenCalled();
        expect(scrollCompleteSpy).toHaveBeenCalledWith(180);
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
                isFullyRendered={true}
            />
        );

        expect(await screen.findByText("2 subposições com alta correspondência")).toBeInTheDocument();
    });

    it('classifica alta correspondência em bloco quando não existe subposição identificável', async () => {
        const scrollSpy = vi
            .spyOn(globalThis.HTMLElement.prototype, 'scrollIntoView')
            .mockImplementation(() => {});

        const div = document.createElement('div');
        div.innerHTML = `
            <div id="cap-1" class="tipi-chapter">
                <p>Motor centrífugo no mesmo bloco sem âncora específica.</p>
            </div>
        `;
        const testContainerRef = { current: div } as React.RefObject<HTMLElement>;

        render(
            <SearchHighlighter
                query="motor centrífugo"
                contentContainerRef={testContainerRef}
                isContentReady={true}
                isFullyRendered={true}
            />
        );

        expect(await screen.findByText("Match Alto")).toBeInTheDocument();
        expect(screen.getByText("1 bloco com alta correspondência")).toBeInTheDocument();
        await screen.findByLabelText("Fechar busca de página");
        await waitFor(() => {
            expect(scrollSpy).toHaveBeenCalled();
        });
    });

    it('permite salto manual para uma subposição de alta relevância', async () => {
        const scrollSpy = vi
            .spyOn(globalThis.HTMLElement.prototype, 'scrollIntoView')
            .mockImplementation(() => {});

        const div = document.createElement('div');
        div.innerHTML = `
            <div id="cap-1" class="tipi-chapter">
                <h3 id="pos-84-10" class="nesh-section">84.10</h3>
                <p>Motor centrífugo para teste.</p>
                <h3 id="pos-84-11" class="nesh-section">84.11</h3>
                <p>Outro motor centrífugo no mesmo capítulo.</p>
            </div>
        `;
        const testContainerRef = { current: div } as React.RefObject<HTMLElement>;

        render(
            <SearchHighlighter
                query="motor centrífugo"
                contentContainerRef={testContainerRef}
                isContentReady={true}
                isFullyRendered={true}
            />
        );

        await screen.findByText("2 subposições com alta correspondência");
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'pos-84-11' } });

        expect(scrollSpy).toHaveBeenCalled();
    });

    it('renders nothing until content is ready and hides itself when closed', async () => {
        const { rerender } = render(
            <SearchHighlighter
                query="motor"
                contentContainerRef={containerRef}
                isContentReady={false}
                isFullyRendered={false}
            />
        );

        expect(screen.queryByRole('button', { name: "Fechar busca de página" })).not.toBeInTheDocument();

        rerender(
            <SearchHighlighter
                query="motor"
                contentContainerRef={containerRef}
                isContentReady={true}
                isFullyRendered={true}
            />
        );

        const closeButton = await screen.findByRole('button', { name: "Fechar busca de página" });
        fireEvent.click(closeButton);
        expect(screen.queryByRole('button', { name: "Fechar busca de página" })).not.toBeInTheDocument();
    });

    it('keeps navigation controls disabled when there is only one match', async () => {
        const div = document.createElement('div');
        div.innerHTML = `<div id="cap-1" class="tipi-chapter"><p>Um único motor aqui.</p></div>`;
        const testContainerRef = { current: div } as React.RefObject<HTMLElement>;

        render(
            <SearchHighlighter
                query="motor"
                contentContainerRef={testContainerRef}
                isContentReady={true}
                isFullyRendered={true}
            />
        );

        const nextBtn = await screen.findByRole('button', { name: "Navegar para a próxima ocorrência" });
        const prevBtn = await screen.findByRole('button', { name: "Navegar para a ocorrência anterior" });

        expect(nextBtn).toBeDisabled();
        expect(prevBtn).toBeDisabled();
        expect(screen.getByText("1 / 1")).toBeInTheDocument();
    });
});
