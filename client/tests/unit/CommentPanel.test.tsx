import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommentPanel } from '../../src/components/CommentPanel';
import {
  type CommentComponentRenderOptions,
  makeComment,
  makePending,
  registerSharedOwnerCommentTests,
} from './commentComponentTestUtils';

function renderPanel(options: CommentComponentRenderOptions = {}) {
  return (
    <CommentPanel
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

describe('CommentPanel', () => {
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it('submits pending comments via Ctrl+Enter, toggles privacy, and clears the form on success', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);

    render(
      <CommentPanel
        pending={makePending()}
        comments={[]}
        onSubmit={onSubmit}
        onDismiss={vi.fn()}
      />,
    );

    const textarea = screen.getByLabelText('Texto do comentário');
    fireEvent.change(textarea, { target: { value: 'Comentário novo' } });
    fireEvent.click(screen.getByLabelText('Comentário privado'));
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Comentário novo', true);
    });
    expect(textarea).toHaveValue('');
    expect(screen.getByLabelText('Comentário privado')).not.toBeChecked();
  });

  it('dismisses pending comments on cancel and escape', () => {
    const onDismiss = vi.fn();

    render(
      <CommentPanel
        pending={makePending()}
        comments={[]}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onDismiss={onDismiss}
      />,
    );

    const textarea = screen.getByLabelText('Texto do comentário');
    fireEvent.keyDown(textarea, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  registerSharedOwnerCommentTests(renderPanel, 'Comentário editado');

  it('supports owner delete confirmation flows', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <CommentPanel
        pending={null}
        comments={[makeComment()]}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onDismiss={vi.fn()}
        onEdit={vi.fn()}
        onDelete={onDelete}
        currentUserId="user_test"
      />,
    );

    fireEvent.click(screen.getByLabelText('Excluir comentário'));
    expect(screen.getByText('Excluir este comentário?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Não' }));
    expect(screen.queryByText('Excluir este comentário?')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Excluir comentário'));
    fireEvent.click(screen.getByRole('button', { name: 'Sim, excluir' }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('comment-1');
    });
  });

  it('stops mouse down propagation from the panel root', () => {
    const onMouseDown = vi.fn();
    render(
      <div onMouseDown={onMouseDown}>
        <CommentPanel
          pending={null}
          comments={[makeComment()]}
          onSubmit={vi.fn().mockResolvedValue(true)}
          onDismiss={vi.fn()}
        />
      </div>,
    );

    act(() => {
      fireEvent.mouseDown(screen.getByText('Comentário original'));
    });

    expect(onMouseDown).not.toHaveBeenCalled();
  });
});
