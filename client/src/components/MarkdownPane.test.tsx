import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownPane } from './MarkdownPane';

describe('MarkdownPane', () => {
    it('renders indented NESH html as html instead of a markdown code block', async () => {
        render(
            <MarkdownPane
                className="markdown-body"
                markdown={`
                    <div class="section-notas" id="chapter-85-notas">
                        <h3 class="section-header notas-header">Notas do Capítulo</h3>
                        <blockquote class="nesh-blockquote">
                            Ver posição <a href="#" class="smart-link" data-ncm="8501">85.01</a>.
                        </blockquote>
                    </div>
                `}
            />
        );

        await waitFor(() => {
            expect(screen.getByRole('link', { name: '85.01' })).toBeInTheDocument();
        });

        expect(document.querySelector('.section-notas .nesh-blockquote')).toHaveTextContent('Ver posição 85.01.');
        expect(document.querySelector('pre code')).not.toBeInTheDocument();
    });

    it('does not wrap standalone NESH headings in section cards for comparison results', async () => {
        render(
            <MarkdownPane
                className="markdown-body"
                markdown={`
                    <h3 class="nesh-section" id="pos-85-02" data-ncm="8502">
                        <strong><a href="#" class="smart-link" data-ncm="8502">85.02</a></strong> - Grupos eletrogêneos.
                    </h3>
                    <p class="nesh-paragraph">Conteúdo da posição.</p>
                `}
            />
        );

        await waitFor(() => {
            expect(screen.getByRole('link', { name: '85.02' })).toBeInTheDocument();
        });

        expect(document.querySelector('section.nesh-section-card[data-ncm="8502"]')).not.toBeInTheDocument();
        expect(document.querySelector('h3.nesh-section[data-ncm="8502"]')).toBeInTheDocument();
        expect(document.querySelector('.nesh-paragraph')).toHaveTextContent('Conteúdo da posição.');
        expect(document.querySelector('pre code')).not.toBeInTheDocument();
    });
});
