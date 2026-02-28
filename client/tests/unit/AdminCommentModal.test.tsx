import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCommentModal } from '../../src/components/AdminCommentModal';
import { fetchPendingComments, moderateComment } from '../../src/services/commentService';

vi.mock('../../src/services/commentService', () => ({
    fetchPendingComments: vi.fn(),
    moderateComment: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

describe('AdminCommentModal', () => {
    beforeEach(() => {
        vi.mocked(fetchPendingComments).mockReset();
        vi.mocked(moderateComment).mockReset();
        vi.mocked(fetchPendingComments).mockResolvedValue([]);
    });

    it('renders with dialog semantics and loads pending comments when open', async () => {
        render(<AdminCommentModal isOpen={true} onClose={vi.fn()} />);

        expect(await screen.findByRole('dialog', { name: /moderar comentários/i })).toBeInTheDocument();
        await waitFor(() => {
            expect(fetchPendingComments).toHaveBeenCalledTimes(1);
        });
        expect(screen.getByText('Nenhum comentário pendente de moderação')).toBeInTheDocument();
    });

    it('closes on overlay click but not when clicking inside the modal', async () => {
        const onClose = vi.fn();
        const { container } = render(<AdminCommentModal isOpen={true} onClose={onClose} />);

        const overlay = container.firstElementChild as HTMLElement;
        const backdrop = screen.getByRole('button', { name: /fechar moderação de comentários/i });
        expect(await screen.findByRole('dialog', { name: /moderar comentários/i })).toBeInTheDocument();
        expect(backdrop).toHaveAttribute('tabindex', '-1');

        fireEvent.click(screen.getByRole('dialog', { name: /moderar comentários/i }));
        expect(onClose).not.toHaveBeenCalled();

        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(overlay).toContainElement(backdrop);
    });

    it('closes when Escape is pressed', async () => {
        const onClose = vi.fn();
        render(<AdminCommentModal isOpen={true} onClose={onClose} />);

        expect(await screen.findByRole('dialog', { name: /moderar comentários/i })).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });

        await waitFor(() => {
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });
});
