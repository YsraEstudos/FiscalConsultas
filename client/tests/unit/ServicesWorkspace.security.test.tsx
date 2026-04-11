import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ServicesWorkspace } from '../../src/components/ServicesWorkspace';

vi.mock('../../src/context/SettingsContext', () => ({
  useSettings: () => ({
    openNewTab: false,
  }),
}));

const noop = () => {};

const baseItem = {
  code: '1.01',
  code_clean: '101',
  description: 'Servico teste',
  parent_code: null,
  level: 1,
  has_nebs: true,
} as const;

const baseNote = {
  code: '1.01',
  code_clean: '101',
  title: 'Nota teste',
  body_text: 'fallback',
  body_markdown: null,
  title_normalized: 'nota teste',
  body_normalized: 'texto seguro',
  section_title: 'Secao',
  page_start: 1,
  page_end: 1,
} as const;

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

function buildNbsDetail(noteOverrides: Partial<typeof baseNote>) {
  return {
    success: true,
    item: baseItem,
    ancestors: [],
    children: [],
    nebs: {
      ...baseNote,
      ...noteOverrides,
    },
  } as const;
}

function buildNebsDetail(entryOverrides: Partial<typeof baseNote>) {
  return {
    success: true,
    item: baseItem,
    ancestors: [],
    entry: {
      ...baseNote,
      ...entryOverrides,
    },
  } as const;
}

function renderNbsWorkspace(noteOverrides: Partial<typeof baseNote>) {
  return render(
    <ServicesWorkspace
      doc="nbs"
      nbsState={{
        ...baseNbsState,
        detail: buildNbsDetail(noteOverrides),
      }}
      nebsState={baseNebsState}
      onSelectNbs={noop}
      onSelectNebs={noop}
      onSwitchDoc={noop}
    />,
  );
}

function renderNebsWorkspace(entryOverrides: Partial<typeof baseNote>) {
  return render(
    <ServicesWorkspace
      doc="nebs"
      nbsState={baseNbsState}
      nebsState={{
        ...baseNebsState,
        detail: buildNebsDetail(entryOverrides),
      }}
      onSelectNbs={noop}
      onSelectNebs={noop}
      onSwitchDoc={noop}
    />,
  );
}

describe('ServicesWorkspace security', () => {
  it('escapes raw NBS note body_text instead of injecting it as HTML', () => {
    const { container } = renderNbsWorkspace({
      body_text: '<img src=x onerror=alert(1) />\n<script>alert(1)</script>\ntexto seguro',
    });

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/texto seguro/i)).toBeInTheDocument();
    expect(container.textContent).toContain('<img src=x onerror=alert(1) />');
  });

  it('normalizes Windows newlines when rendering plain-text note content', () => {
    const { container } = renderNbsWorkspace({
      body_text: 'Primeira linha\r\nSegunda linha\r\n\r\nNovo paragrafo',
      body_normalized: 'primeira linha segunda linha novo paragrafo',
    });

    const noteBody = container.querySelector('[class*="notesContent"]');

    expect(noteBody?.querySelectorAll('p')).toHaveLength(2);
    expect(noteBody?.querySelector('br')).not.toBeNull();
    expect(screen.getByText('Novo paragrafo')).toBeInTheDocument();
  });

  it('sanitizes NEBS markdown output before rendering the note detail', () => {
    const { container } = renderNebsWorkspace({
      body_markdown: [
        '# Titulo seguro',
        '<script>alert(1)</script>',
        '[unsafe](javascript:alert(1))',
      ].join('\n'),
      body_normalized: 'titulo seguro',
    });

    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Titulo seguro');
    const unsafeLink = screen.getByText('unsafe');
    expect(unsafeLink).not.toHaveAttribute('href');
  });

  it('falls back to plain text when markdown is fully stripped by sanitization', () => {
    const { container } = renderNebsWorkspace({
      body_markdown: '<script>alert(1)</script>',
      body_text: 'fallback seguro',
      body_normalized: 'fallback seguro',
    });

    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('fallback seguro')).toBeInTheDocument();
  });
});
