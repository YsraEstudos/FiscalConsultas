import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { marked } from 'marked';

import { MarkdownPane } from '../../src/components/MarkdownPane';

describe('MarkdownPane', () => {
    it('clears rendered content when markdown is empty', async () => {
        const { container, rerender } = render(<MarkdownPane markdown={'# Titulo'} />);

        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Titulo');
        });

        rerender(<MarkdownPane markdown={null} />);

        await waitFor(() => {
            expect(container.textContent).toBe('');
        });
    });

    it('sanitizes unsafe html while preserving safe rendered markdown', async () => {
        const { container } = render(
            <MarkdownPane
                markdown={[
                    '# Titulo seguro',
                    '<script>alert("xss")</script>',
                    '<a href="javascript:alert(1)" target="_blank">link inseguro</a>',
                    '<img src="javascript:alert(1)" alt="xss" />',
                    '<p data-ncm="8401">conteudo seguro</p>',
                ].join('\n')}
            />
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Titulo seguro');
        });

        expect(container.querySelector('script')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('conteudo seguro')).toHaveAttribute('data-ncm', '8401');
        expect(screen.getByText('link inseguro')).not.toHaveAttribute('href');
        expect(screen.getByText('link inseguro')).not.toHaveAttribute('rel');
    });

    it('wraps rendered nesh section headings into section cards', async () => {
        const { container } = render(
            <MarkdownPane
                markdown={'<h3 class="nesh-section" data-ncm="8401">84.01 - Secao</h3><p>Descricao</p>'}
            />
        );

        await waitFor(() => {
            expect(container.querySelector('section.nesh-section-card')).not.toBeNull();
        });

        const card = container.querySelector('section.nesh-section-card');
        expect(card).toHaveAttribute('data-ncm', '8401');
        expect(card?.querySelector('h3.nesh-section')).toHaveTextContent('84.01 - Secao');
        expect(card?.querySelector('.nesh-section-body')).toHaveTextContent('Descricao');
    });

    it('does not rewrap section headings that are already inside a card', async () => {
        const { container } = render(
            <MarkdownPane
                markdown={'<section class="nesh-section-card"><h3 class="nesh-section" data-ncm="8402">84.02 - Ja agrupado</h3><div class="nesh-section-body">Conteudo</div></section>'}
            />
        );

        await waitFor(() => {
            expect(container.querySelectorAll('section.nesh-section-card')).toHaveLength(1);
        });

        expect(container.querySelector('section.nesh-section-card h3.nesh-section')).toHaveTextContent('84.02 - Ja agrupado');
    });

    it('shows a fallback message when markdown parsing fails', async () => {
        const parseSpy = vi.spyOn(marked, 'parse').mockImplementation(() => {
            throw new Error('broken markdown');
        });
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            render(<MarkdownPane markdown={'# Falha'} />);

            await waitFor(() => {
                expect(screen.getByText('Erro ao renderizar conteúdo.')).toBeInTheDocument();
            });
        } finally {
            parseSpy.mockRestore();
            consoleErrorSpy.mockRestore();
        }
    });
});
