import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownPane } from '../../src/components/MarkdownPane';

describe('MarkdownPane', () => {
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
});
