import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SettingsProvider } from '../../src/context/SettingsContext';
import { TextSearchResults } from '../../src/components/TextSearchResults';

vi.mock('react-virtuoso', () => ({
    Virtuoso: ({ data, itemContent }: any) => (
        <div data-testid="virtuoso">
            {data.map((item: any, index: number) => (
                <div key={index}>{itemContent(index, item)}</div>
            ))}
        </div>
    )
}));

describe('TextSearchResults', () => {
    it('renders empty state when no results', () => {
        render(
            <SettingsProvider>
                <TextSearchResults results={null} query="" onResultClick={vi.fn()} />
            </SettingsProvider>
        );

        expect(screen.getByText('Nenhum resultado encontrado')).toBeTruthy();
    });

    it('highlights matching query text', () => {
        const results = [
            { ncm: '0101', tipo: 'position', descricao: 'Cavalo vivo', tier: 1, tier_label: 'Exato' }
        ];

        render(
            <SettingsProvider>
                <TextSearchResults results={results as any} query="Cavalo" onResultClick={vi.fn()} />
            </SettingsProvider>
        );

        const matches = screen.getAllByText('Cavalo');
        const highlighted = matches.find((el) =>
            el.tagName === 'SPAN' && el.className.includes('searchHighlight')
        );
        expect(highlighted).toBeTruthy();
    });

    it('virtualizes when list is large', () => {
        const results = Array.from({ length: 70 }).map((_, i) => ({
            ncm: `00${i}`,
            tipo: 'position',
            descricao: `Item ${i}`,
            tier: 3,
            tier_label: 'Parcial'
        }));

        render(
            <SettingsProvider>
                <TextSearchResults results={results as any} query="Item" onResultClick={vi.fn()} />
            </SettingsProvider>
        );

        expect(screen.getByTestId('virtuoso')).toBeTruthy();
    });
});
