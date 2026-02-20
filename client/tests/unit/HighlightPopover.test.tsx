import { fireEvent, render, screen } from '@testing-library/react';
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
        const onRequestComment = vi.fn();
        render(
            <HighlightPopover
                selection={makeSelection() as any}
                onRequestComment={onRequestComment}
                onPopoverMouseDown={onPopoverMouseDown}
            />
        );

        const bubble = screen.getByRole('button', { name: /adicionar comentário ao trecho selecionado/i });
        const wrapper = bubble.parentElement as HTMLElement;

        expect(wrapper.style.getPropertyValue('--popover-top')).toBe('152px');
        expect(wrapper.style.getPropertyValue('--popover-left')).toBe('140px');

        fireEvent.mouseDown(wrapper);
        expect(onPopoverMouseDown).toHaveBeenCalledTimes(1);
        fireEvent.click(bubble);
        expect(onRequestComment).toHaveBeenCalledTimes(1);
    });

    it('renders accessible trigger label', () => {
        render(
            <HighlightPopover
                selection={makeSelection() as any}
                onRequestComment={vi.fn()}
            />
        );

        expect(
            screen.getByRole('button', { name: /adicionar comentário ao trecho selecionado/i })
        ).toBeInTheDocument();
    });
});
