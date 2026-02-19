import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { SettingsProvider } from '../../src/context/SettingsContext';
import { TextSearchResults } from '../../src/components/TextSearchResults';

const hoisted = vi.hoisted(() => ({
    virtuosoSpy: vi.fn()
}));

vi.mock('react-virtuoso', () => ({
    Virtuoso: (props: any) => {
        hoisted.virtuosoSpy(props);
        return (
            <div data-testid="virtuoso">
                <div data-testid="virtuoso-use-window">{String(props.useWindowScroll)}</div>
                <div data-testid="virtuoso-has-parent">{String(Boolean(props.customScrollParent))}</div>
                {props.data.map((item: any, index: number) => (
                    <div key={index}>{props.itemContent(index, item)}</div>
                ))}
            </div>
        );
    }
}));

function renderWithSettings(ui: React.ReactNode) {
    return render(<SettingsProvider>{ui}</SettingsProvider>);
}

describe('TextSearchResults', () => {
    beforeEach(() => {
        localStorage.clear();
        hoisted.virtuosoSpy.mockClear();
    });

    it('renders empty state when no results', () => {
        renderWithSettings(<TextSearchResults results={null} query="" onResultClick={vi.fn()} />);

        expect(screen.getByText('Nenhum resultado encontrado')).toBeTruthy();
    });

    it('highlights matching query text', () => {
        const results = [
            { ncm: '0101', tipo: 'position', descricao: 'Cavalo vivo', tier: 1, tier_label: 'Exato' }
        ];

        renderWithSettings(<TextSearchResults results={results as any} query="Cavalo" onResultClick={vi.fn()} />);

        const matches = screen.getAllByText('Cavalo');
        const highlighted = matches.find((el) =>
            el.tagName === 'SPAN' && el.className.includes('searchHighlight')
        );
        expect(highlighted).toBeTruthy();
    });

    it('renders without highlight when query is empty and handles click/tier branches', () => {
        const onResultClick = vi.fn();
        const results = [
            { ncm: '0201', tipo: 'chapter', descricao: 'Carnes e miudezas', tier: 2, tier_label: '', score: 9.7 },
            { ncm: '0202', tipo: 'position', descricao: 'Outros cortes', tier: 3, tier_label: 'Parcial', score: 0 },
        ];

        renderWithSettings(<TextSearchResults results={results as any} query="" onResultClick={onResultClick} />);

        expect(screen.getByText('Capítulo')).toBeInTheDocument();
        expect(screen.getAllByText('Parcial')).toHaveLength(2);
        expect(screen.getByText('10')).toBeInTheDocument();
        expect(screen.getByText('0')).toBeInTheDocument();
        expect(screen.getAllByTitle('Score')).toHaveLength(1);

        fireEvent.click(screen.getByText('0201'));
        expect(onResultClick).toHaveBeenCalledWith('0201');

        const hasHighlight = Array.from(document.querySelectorAll('span'))
            .some((el) => el.className.includes('searchHighlight'));
        expect(hasHighlight).toBe(false);
    });

    it('virtualizes when list is large and uses custom scroll parent when provided', () => {
        const results = Array.from({ length: 70 }).map((_, i) => ({
            ncm: `00${i}`,
            tipo: 'position',
            descricao: `Item ${i}`,
            tier: 3,
            tier_label: 'Parcial'
        }));
        const scrollParent = document.createElement('div');

        renderWithSettings(
            <TextSearchResults
                results={results as any}
                query="Item"
                onResultClick={vi.fn()}
                scrollParentRef={{ current: scrollParent }}
            />
        );

        expect(screen.getByTestId('virtuoso')).toBeTruthy();
        expect(screen.getByTestId('virtuoso-use-window')).toHaveTextContent('false');
        expect(screen.getByTestId('virtuoso-has-parent')).toHaveTextContent('true');
        expect(hoisted.virtuosoSpy).toHaveBeenCalled();
    });

    it('falls back gracefully when highlight regex creation throws', () => {
        const results = [
            { ncm: '0301', tipo: 'position', descricao: 'Explode keyword', tier: 1, tier_label: 'Exato' }
        ];

        const OriginalRegExp = RegExp;
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const ThrowingRegExp = class extends OriginalRegExp {
            constructor(pattern: string | RegExp, flags?: string) {
                if (String(pattern).includes('explode')) {
                    throw new Error('invalid regex');
                }
                super(pattern, flags);
            }
        };

        // @ts-expect-error - controlled override for branch test
        globalThis.RegExp = ThrowingRegExp;

        try {
            renderWithSettings(<TextSearchResults results={results as any} query="explode" onResultClick={vi.fn()} />);
            expect(screen.getByText('Explode keyword')).toBeInTheDocument();
            expect(errSpy).toHaveBeenCalled();
        } finally {
            globalThis.RegExp = OriginalRegExp;
            errSpy.mockRestore();
        }
    });
});
