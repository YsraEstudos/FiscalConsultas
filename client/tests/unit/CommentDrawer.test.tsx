import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommentDrawer } from '../../src/components/CommentDrawer';
import { makeLocalComment, makePendingCommentEntry, unsafeJavascriptUrl } from './commentTestUtils';

function makeComment(overrides: Parameters<typeof makeLocalComment>[0] = {}) {
  return makeLocalComment({ body: 'Comentário do drawer', ...overrides });
}

function makePending() {
  return makePendingCommentEntry({
    selectedText: 'Trecho pendente com conteúdo suficiente para truncar se necessário',
  });
}

describe('CommentDrawer', () => {
  it('renders a FAB while closed and reports the combined pending/comment count', () => {
    const onClose = vi.fn();

    render(
      <CommentDrawer
        open={false}
        onClose={onClose}
        pending={makePending()}
        comments={[makeComment()]}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('Abrir comentários (2)'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows the empty state and closes on backdrop, close button, and escape', () => {
    const onClose = vi.fn();

    render(
      <CommentDrawer
        open={true}
        onClose={onClose}
        pending={null}
        comments={[]}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('Nenhum comentário ainda')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByLabelText('Fechar comentários'));
    fireEvent.click(screen.getByLabelText('Fechar'));

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('submits pending comments, toggles privacy, and resets local form state on dismiss', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onDismiss = vi.fn();

    render(
      <CommentDrawer
        open={true}
        onClose={vi.fn()}
        pending={makePending()}
        comments={[]}
        onSubmit={onSubmit}
        onDismiss={onDismiss}
      />,
    );

    const textarea = screen.getByLabelText('Texto do comentário');
    fireEvent.change(textarea, { target: { value: 'Comentário novo' } });
    fireEvent.click(screen.getByLabelText('Comentário privado'));
    fireEvent.click(screen.getByText('Comentar'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Comentário novo', true);
    });

    fireEvent.change(textarea, { target: { value: 'Limpar ao cancelar' } });
    fireEvent.click(screen.getByText('Cancelar'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(textarea).toHaveValue('');
    expect(screen.getByLabelText('Comentário privado')).not.toBeChecked();
  });

  it('renders fallback avatars and hides owner actions for non-owners', () => {
    render(
        <CommentDrawer
        open={true}
        onClose={vi.fn()}
        pending={null}
        comments={[makeComment({ userImageUrl: unsafeJavascriptUrl, userId: 'another-user' })]}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onDismiss={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        currentUserId="user_test"
      />,
    );

    expect(screen.getByText('AS')).toBeInTheDocument();
    expect(screen.queryByTitle('Editar')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Excluir')).not.toBeInTheDocument();
  });

  it('supports owner edit and delete flows', async () => {
    const onEdit = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <CommentDrawer
        open={true}
        onClose={vi.fn()}
        pending={null}
        comments={[makeComment()]}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onDismiss={vi.fn()}
        onEdit={onEdit}
        onDelete={onDelete}
        currentUserId="user_test"
      />,
    );

    fireEvent.click(screen.getByTitle('Editar'));
    const editTextarea = screen.getByLabelText('Editar comentário');

    fireEvent.change(editTextarea, { target: { value: 'Drawer editado' } });
    fireEvent.keyDown(editTextarea, { key: 'Escape' });
    expect(screen.queryByLabelText('Editar comentário')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Editar'));
    fireEvent.change(screen.getByLabelText('Editar comentário'), { target: { value: 'Drawer editado' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => {
      expect(onEdit).toHaveBeenCalledWith('comment-1', 'Drawer editado');
    });

    fireEvent.click(screen.getByTitle('Excluir'));
    expect(screen.getByText('Excluir este comentário?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sim, excluir'));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('comment-1');
    });
  });
});
