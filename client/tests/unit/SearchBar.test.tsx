import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchBar } from '../../src/components/SearchBar';

describe('SearchBar Component', () => {
    const mockOnSearch = vi.fn();
    const mockOnClearHistory = vi.fn();
    const mockOnRemoveHistory = vi.fn();
    const mockHistory = [
        { term: '0101' },
        { term: '8471' }
    ];

    const baseProps = {
        onSearch: mockOnSearch,
        history: [],
        onClearHistory: mockOnClearHistory,
        onRemoveHistory: mockOnRemoveHistory
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders correctly', () => {
        render(<SearchBar {...baseProps} />);
        expect(screen.getByPlaceholderText(/Digite os NCMs/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /buscar/i })).toBeInTheDocument();
    });

    it('updates input value on change', () => {
        render(<SearchBar {...baseProps} />);
        const input = screen.getByPlaceholderText(/Digite os NCMs/i);
        fireEvent.change(input, { target: { value: '1234' } });
        expect(input.value).toBe('1234');
    });

    it('calls onSearch when button is clicked', () => {
        render(<SearchBar {...baseProps} />);
        const input = screen.getByPlaceholderText(/Digite os NCMs/i);
        fireEvent.change(input, { target: { value: '1234' } });

        const button = screen.getByRole('button', { name: /buscar/i });
        fireEvent.click(button);

        expect(mockOnSearch).toHaveBeenCalledWith('1234');
    });

    it('calls onSearch when Enter is pressed', () => {
        render(<SearchBar {...baseProps} />);
        const input = screen.getByPlaceholderText(/Digite os NCMs/i);
        fireEvent.change(input, { target: { value: '5678' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        expect(mockOnSearch).toHaveBeenCalledWith('5678');
    });

    it('shows history dropdown when focused and history exists', () => {
        render(<SearchBar {...baseProps} history={mockHistory} />);
        const input = screen.getByPlaceholderText(/Digite os NCMs/i);

        act(() => {
            fireEvent.pointerDown(input, { button: 0 });
            fireEvent.focus(input);
        });

        expect(screen.getByText('Buscas Recentes')).toBeInTheDocument();
        expect(screen.getByText('0101')).toBeInTheDocument();
    });

    it('hides history dropdown on blur after delay', async () => {
        vi.useFakeTimers();
        render(<SearchBar {...baseProps} history={mockHistory} />);
        const input = screen.getByPlaceholderText(/Digite os NCMs/i);

        act(() => {
            fireEvent.pointerDown(input, { button: 0 });
            fireEvent.focus(input);
        });
        expect(screen.getByText('Buscas Recentes')).toBeInTheDocument();

        act(() => {
            fireEvent.blur(input);
        });

        // Should still be visible immediately due to delay
        expect(screen.getByText('Buscas Recentes')).toBeInTheDocument();

        // Fast-forward time
        act(() => {
            vi.advanceTimersByTime(250);
        });

        expect(screen.queryByText('Buscas Recentes')).not.toBeInTheDocument();
        vi.useRealTimers();
    });

    it('selecting history item updates query and searches', () => {
        render(<SearchBar {...baseProps} history={mockHistory} />);
        const input = screen.getByPlaceholderText(/Digite os NCMs/i);

        act(() => {
            fireEvent.pointerDown(input, { button: 0 });
            fireEvent.focus(input);
        });

        const historyItem = screen.getByText('0101');
        fireEvent.mouseDown(historyItem); // Component uses onMouseDown on row (event bubbles)

        expect(mockOnSearch).toHaveBeenCalledWith('0101');
    });

    it('clears history', () => {
        render(<SearchBar {...baseProps} history={mockHistory} />);
        const input = screen.getByPlaceholderText(/Digite os NCMs/i);

        act(() => {
            fireEvent.pointerDown(input, { button: 0 });
            fireEvent.focus(input);
        });

        const clearBtn = screen.getByText('Limpar');
        fireEvent.mouseDown(clearBtn);

        expect(mockOnClearHistory).toHaveBeenCalled();
    });

    it('removes single history item', () => {
        render(<SearchBar {...baseProps} history={mockHistory} />);
        const input = screen.getByPlaceholderText(/Digite os NCMs/i);

        act(() => {
            fireEvent.pointerDown(input, { button: 0 });
            fireEvent.focus(input);
        });

        const removeBtns = screen.getAllByText('×');
        fireEvent.mouseDown(removeBtns[0]);

        expect(mockOnRemoveHistory).toHaveBeenCalledWith('0101');
    });

    it('opens dropdown when focus is preceded by keyboard interaction', () => {
        render(<SearchBar {...baseProps} history={mockHistory} />);
        const input = screen.getByPlaceholderText(/Digite os NCMs/i);

        fireEvent.keyDown(document, { key: 'Tab' });
        fireEvent.focus(input);

        expect(screen.getByText('Buscas Recentes')).toBeInTheDocument();
    });

    it('keeps dropdown closed after right-click interaction', () => {
        render(<SearchBar {...baseProps} history={mockHistory} />);
        const input = screen.getByPlaceholderText(/Digite os NCMs/i);

        fireEvent.pointerDown(input, { button: 2 });
        fireEvent.focus(input);

        expect(screen.queryByText('Buscas Recentes')).not.toBeInTheDocument();
    });

    it('closes dropdown on contextmenu events', () => {
        render(<SearchBar {...baseProps} history={mockHistory} />);
        const input = screen.getByPlaceholderText(/Digite os NCMs/i);

        act(() => {
            fireEvent.pointerDown(input, { button: 0 });
            fireEvent.focus(input);
        });
        expect(screen.getByText('Buscas Recentes')).toBeInTheDocument();

        fireEvent.contextMenu(input);
        expect(screen.queryByText('Buscas Recentes')).not.toBeInTheDocument();

        act(() => {
            fireEvent.pointerDown(input, { button: 0 });
            fireEvent.focus(input);
        });
        expect(screen.getByText('Buscas Recentes')).toBeInTheDocument();

        fireEvent.contextMenu(document);
        expect(screen.queryByText('Buscas Recentes')).not.toBeInTheDocument();
    });

    it('does not trigger search while loading', () => {
        render(<SearchBar {...baseProps} isLoading={true} />);
        const input = screen.getByPlaceholderText(/Digite os NCMs/i);
        const button = screen.getByRole('button', { name: /buscar/i });

        fireEvent.change(input, { target: { value: '9999' } });
        fireEvent.click(button);
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        expect(button).toBeDisabled();
        expect(mockOnSearch).not.toHaveBeenCalled();
    });
});
