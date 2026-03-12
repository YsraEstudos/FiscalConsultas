import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCommentModal } from '../../src/components/AdminCommentModal';
import { fetchPendingComments, moderateComment } from '../../src/services/commentService';
import { makePendingApiComment, unsafeJavascriptUrl } from './commentTestUtils';

const refs = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../../src/services/commentService', () => ({
  fetchPendingComments: vi.fn(),
  moderateComment: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: refs.toastSuccessMock,
    error: refs.toastErrorMock,
  },
}));

function makePendingComment(overrides: Partial<Awaited<ReturnType<typeof fetchPendingComments>>[number]> = {}) {
  return makePendingApiComment(overrides);
}

describe('AdminCommentModal moderation flows', () => {
  beforeEach(() => {
    vi.mocked(fetchPendingComments).mockReset();
    vi.mocked(moderateComment).mockReset();
    refs.toastSuccessMock.mockReset();
    refs.toastErrorMock.mockReset();
  });

  it('renders pending comments with fallback avatars and approves them with moderation notes', async () => {
    vi.mocked(fetchPendingComments).mockResolvedValue([
      makePendingComment({ user_image_url: unsafeJavascriptUrl }),
    ]);
    vi.mocked(moderateComment).mockResolvedValue(makePendingComment());

    render(<AdminCommentModal isOpen={true} onClose={vi.fn()} />);

    expect(await screen.findByText('Comentário aguardando moderação')).toBeInTheDocument();
    expect(screen.getByText('AS')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Nota de moderação/i), {
      target: { value: 'Conferido com a referência oficial' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/i }));

    await waitFor(() => {
      expect(moderateComment).toHaveBeenCalledWith(1, 'approve', 'Conferido com a referência oficial');
    });
    await waitFor(() => {
      expect(screen.queryByText('Comentário aguardando moderação')).not.toBeInTheDocument();
    });
    expect(refs.toastSuccessMock).toHaveBeenCalledWith('Comentário aprovado');
  });

  it('rejects comments and keeps the remaining queue length in sync', async () => {
    vi.mocked(fetchPendingComments).mockResolvedValue([
      makePendingComment({ id: 1, body: 'Primeiro comentário' }),
      makePendingComment({ id: 2, body: 'Segundo comentário', anchor_key: 'pos-85-17' }),
    ]);
    vi.mocked(moderateComment).mockResolvedValue(makePendingComment({ id: 1 }));

    render(<AdminCommentModal isOpen={true} onClose={vi.fn()} />);

    expect(await screen.findByText('Primeiro comentário')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Rejeitar/i })[0]);

    await waitFor(() => {
      expect(moderateComment).toHaveBeenCalledWith(1, 'reject', undefined);
    });
    await waitFor(() => {
      expect(screen.queryByText('Primeiro comentário')).not.toBeInTheDocument();
    });
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(refs.toastSuccessMock).toHaveBeenCalledWith('Comentário rejeitado');
  });

  it('shows a toast when pending comments fail to load', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.mocked(fetchPendingComments).mockRejectedValue(new Error('load failed'));

      render(<AdminCommentModal isOpen={true} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(refs.toastErrorMock).toHaveBeenCalledWith('Erro ao carregar comentários pendentes');
      });
      expect(screen.getByText('Nenhum comentário pendente de moderação')).toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('reports moderation failures and keeps the comment in the queue', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.mocked(fetchPendingComments).mockResolvedValue([makePendingComment()]);
      vi.mocked(moderateComment).mockRejectedValue(new Error('moderation failed'));

      render(<AdminCommentModal isOpen={true} onClose={vi.fn()} />);

      expect(await screen.findByText('Comentário aguardando moderação')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Aprovar/i }));

      await waitFor(() => {
        expect(refs.toastErrorMock).toHaveBeenCalledWith('Erro ao moderar comentário');
      });
      expect(screen.getByText('Comentário aguardando moderação')).toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
