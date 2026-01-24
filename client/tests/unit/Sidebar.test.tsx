import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../../src/../src/components/Sidebar';
import { describe, it, expect, vi } from 'vitest';

describe('Sidebar Component', () => {
    const mockResults = {
        "84": {
            capitulo: "84",
            posicoes: [
                { codigo: "84.01", descricao: "Reatores nucleares" },
                { codigo: "84.02", descricao: "Caldeiras de vapor" }
            ]
        }
    };

    // Props padrão para todos os testes
    const defaultProps = {
        onNavigate: () => { },
        isOpen: false,
        onClose: () => { }
    };

    it('renders nothing when no results provided', () => {
        const { container } = render(
            <Sidebar results={null} {...defaultProps} />
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders chapters and positions correctly', () => {
        render(
            <Sidebar results={mockResults} {...defaultProps} />
        );

        expect(screen.getByText('Capítulo 84')).toBeInTheDocument();
        expect(screen.getByText('84.01')).toBeInTheDocument();
        expect(screen.getByText('Reatores nucleares')).toBeInTheDocument();
        expect(screen.getByText('84.02')).toBeInTheDocument();
    });

    it('calls onNavigate when a position is clicked', () => {
        const onNavigate = vi.fn();
        render(
            <Sidebar
                results={mockResults}
                onNavigate={onNavigate}
                isOpen={false}
                onClose={() => { }}
            />
        );

        const item = screen.getByText('84.02').closest('button');
        if (item) {
            fireEvent.click(item);
        }

        // generateAnchorId transforma "84.02" em "pos-84-02"
        expect(onNavigate).toHaveBeenCalledWith('pos-84-02');
    });

    it('sorts chapters numerically', () => {
        const unsortedResults = {
            "85": { capitulo: "85", posicoes: [] },
            "01": { capitulo: "01", posicoes: [] },
            "10": { capitulo: "10", posicoes: [] }
        };

        render(
            <Sidebar results={unsortedResults} {...defaultProps} />
        );

        const chapters = screen.getAllByText(/Capítulo \d+/);
        expect(chapters[0]).toHaveTextContent('Capítulo 01');
        expect(chapters[1]).toHaveTextContent('Capítulo 10');
        expect(chapters[2]).toHaveTextContent('Capítulo 85');
    });
});
