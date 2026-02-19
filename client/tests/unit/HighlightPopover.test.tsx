import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HighlightPopover } from '../../src/components/HighlightPopover';

function makeSelection(text = 'Trecho selecionado') {
    return {
        text,
        anchorKey: 'anchor-99',
        rect: new DOMRect(100, 200, 80, 16),
    };
}

describe('HighlightPopover', () => {
    it('renders bubble with viewport-based coordinates and forwards mousedown', () => {
        const onPopoverMouseDown = vi.fn();
        render(
            <HighlightPopover
                selection={makeSelection() as any}
                onSubmit={vi.fn().mockResolvedValue(undefined)}
                onDismiss={vi.fn()}
                onPopoverMouseDown={onPopoverMouseDown}
            />
        );

        const bubble = screen.getByRole('button', { name: /adicionar comentário ao trecho selecionado/i });
        const wrapper = bubble.parentElement as HTMLElement;

        expect(wrapper.style.getPropertyValue('--popover-top')).toBe('152px');
        expect(wrapper.style.getPropertyValue('--popover-left')).toBe('140px');

        fireEvent.mouseDown(wrapper);
        expect(onPopoverMouseDown).toHaveBeenCalledTimes(1);
    });

    it('opens dialog and truncates long preview text', () => {
        const longText = `${'A'.repeat(90)} fim`;
        render(
            <HighlightPopover
                selection={makeSelection(longText) as any}
                onSubmit={vi.fn().mockResolvedValue(undefined)}
                onDismiss={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /adicionar comentário/i }));
        expect(screen.getByLabelText('Formulário de comentário')).toBeInTheDocument();

        const preview = screen.getByTitle(longText);
        expect(preview.textContent).toContain('…');
    });

    it('does not submit empty body and dismisses on escape/cancel', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        const onDismiss = vi.fn();

        render(
            <HighlightPopover
                selection={makeSelection() as any}
                onSubmit={onSubmit}
                onDismiss={onDismiss}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /adicionar comentário/i }));
        const submitBtn = screen.getByRole('button', { name: /enviar comentário/i });
        const textArea = screen.getByLabelText('Texto do comentário');

        expect(submitBtn).toBeDisabled();
        fireEvent.click(submitBtn);
        expect(onSubmit).not.toHaveBeenCalled();

        fireEvent.keyDown(textArea, { key: 'Escape' });
        expect(onDismiss).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(2));
    });

    it('submits trimmed text, toggles private flag and handles loading state', async () => {
        let resolveSubmit: (() => void) | null = null;
        const submitPromise = new Promise<void>((resolve) => {
            resolveSubmit = resolve;
        });

        const onSubmit = vi.fn().mockReturnValue(submitPromise);
        const onDismiss = vi.fn();

        render(
            <HighlightPopover
                selection={makeSelection('Comentário de teste') as any}
                onSubmit={onSubmit}
                onDismiss={onDismiss}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /adicionar comentário/i }));
        const textArea = screen.getByLabelText('Texto do comentário');

        fireEvent.change(textArea, { target: { value: '  observação interna  ' } });
        fireEvent.click(screen.getByLabelText('Comentário privado'));
        fireEvent.keyDown(textArea, { key: 'Enter', ctrlKey: true });

        expect(onSubmit).toHaveBeenCalledWith({
            body: 'observação interna',
            anchorKey: 'anchor-99',
            selectedText: 'Comentário de teste',
            isPrivate: true,
        });

        const submitBtn = screen.getByRole('button', { name: /enviar comentário/i });
        expect(submitBtn).toHaveTextContent('…');

        resolveSubmit?.();
        await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    });
});
