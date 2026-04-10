import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ServicesWorkspace } from '../../src/components/ServicesWorkspace';

const baseNbsState = {
  results: [],
  selectedCode: null,
  detail: null,
  isSearching: false,
  isLoadingDetail: false,
} as const;

const baseNebsState = {
  results: [],
  selectedCode: null,
  detail: null,
  isSearching: false,
  isLoadingDetail: false,
  hasSearched: true,
} as const;

describe('ServicesWorkspace security', () => {
  it('escapes raw NBS note body_text instead of injecting it as HTML', () => {
    const { container } = render(
      <ServicesWorkspace
        doc="nbs"
        nbsState={{
          ...baseNbsState,
          detail: {
            success: true,
            item: {
              code: '1.01',
              code_clean: '101',
              description: 'Servico teste',
              parent_code: null,
              level: 1,
              has_nebs: true,
            },
            ancestors: [],
            children: [],
            nebs: {
              code: '1.01',
              code_clean: '101',
              title: 'Nota teste',
              body_text: '<img src=x onerror=alert(1) />\n<script>alert(1)</script>\ntexto seguro',
              body_markdown: null,
              title_normalized: 'nota teste',
              body_normalized: 'texto seguro',
              section_title: 'Secao',
              page_start: 1,
              page_end: 1,
            },
          },
        }}
        nebsState={baseNebsState}
        onSelectNbs={() => {}}
        onSelectNebs={() => {}}
        onSwitchDoc={() => {}}
      />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/texto seguro/i)).toBeInTheDocument();
    expect(container.textContent).toContain('<img src=x onerror=alert(1) />');
  });

  it('sanitizes NEBS markdown output before rendering the note detail', () => {
    const { container } = render(
      <ServicesWorkspace
        doc="nebs"
        nbsState={baseNbsState}
        nebsState={{
          ...baseNebsState,
          detail: {
            success: true,
            item: {
              code: '1.01',
              code_clean: '101',
              description: 'Servico teste',
              parent_code: null,
              level: 1,
              has_nebs: true,
            },
            ancestors: [],
            entry: {
              code: '1.01',
              code_clean: '101',
              title: 'Nota teste',
              body_text: 'fallback',
              body_markdown: [
                '# Titulo seguro',
                '<script>alert(1)</script>',
                '[unsafe](javascript:alert(1))',
              ].join('\n'),
              title_normalized: 'nota teste',
              body_normalized: 'titulo seguro',
              section_title: 'Secao',
              page_start: 1,
              page_end: 1,
            },
          },
        }}
        onSelectNbs={() => {}}
        onSelectNebs={() => {}}
        onSwitchDoc={() => {}}
      />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Titulo seguro');
    const unsafeLink = screen.getByText('unsafe');
    expect(unsafeLink).not.toHaveAttribute('href');
  });
});
