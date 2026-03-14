import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommentDrawer } from '../../src/components/CommentDrawer';
import {
  type CommentComponentRenderOptions,
  makeComment,
  makePending,
  registerSharedOwnerCommentTests,
} from './commentComponentTestUtils';

function renderDrawer(options: CommentComponentRenderOptions = {}) {
  return (
    <CommentDrawer
      open={true}
      onClose={vi.fn()}
      pending={options.pending ?? null}
      comments={options.comments ?? []}
      onSubmit={options.onSubmit ?? vi.fn().mockResolvedValue(true)}
      onDismiss={options.onDismiss ?? vi.fn()}
      onEdit={options.onEdit}
      onDelete={options.onDelete}
      currentUserId={options.currentUserId}
    />
  );
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

  registerSharedOwnerCommentTests(renderDrawer, 'Drawer editado');
});
