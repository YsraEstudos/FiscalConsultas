import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import type { LocalComment, PendingCommentEntry } from '../../src/components/CommentPanel';

export function makeComment(overrides: Partial<LocalComment> = {}): LocalComment {
  return {
    id: 'comment-1',
    anchorTop: 16,
    anchorKey: 'pos-84-13',
    selectedText: 'Motores elétricos monofásicos com descrição longa',
    body: 'Comentário original',
    isPrivate: false,
    createdAt: new Date('2026-03-01T10:00:00Z'),
    userName: 'Alice Silva',
    userImageUrl: null,
    userId: 'user_test',
    ...overrides,
  };
}

export function makePending(): PendingCommentEntry {
  return {
    anchorTop: 24,
    anchorKey: 'pos-84-13',
    selectedText: 'Trecho pendente com conteúdo suficiente para truncar se necessário',
  };
}

export interface CommentComponentRenderOptions {
  pending?: PendingCommentEntry | null;
  comments?: LocalComment[];
  onSubmit?: ReturnType<typeof vi.fn>;
  onDismiss?: ReturnType<typeof vi.fn>;
  onEdit?: ReturnType<typeof vi.fn>;
  onDelete?: ReturnType<typeof vi.fn>;
  currentUserId?: string | null;
}

type RenderCommentComponent = (options?: CommentComponentRenderOptions) => ReactElement;

function getEditTextarea() {
  const textarea = screen
    .getAllByLabelText('Editar comentário')
    .find((element) => element.tagName === 'TEXTAREA');

  if (!textarea) {
    throw new Error('Edit textarea not found');
  }

  return textarea;
}

function queryEditTextarea() {
  return screen
    .queryAllByLabelText('Editar comentário')
    .find((element) => element.tagName === 'TEXTAREA') ?? null;
}

export function renderCommentComponent(
  renderUi: RenderCommentComponent,
  options: CommentComponentRenderOptions = {},
) {
  const {
    pending = null,
    comments = [],
    onSubmit = vi.fn().mockResolvedValue(true),
    onDismiss = vi.fn(),
    onEdit,
    onDelete,
    currentUserId,
  } = options;

  return render(
    renderUi({
      pending,
      comments,
      onSubmit,
      onDismiss,
      onEdit,
      onDelete,
      currentUserId,
    }),
  );
}

export function registerSharedOwnerCommentTests(
  renderUi: RenderCommentComponent,
  editedBody: string,
) {
  it('renders fallback avatars and supports owner edit/delete flows', async () => {
    renderCommentComponent(renderUi, {
      comments: [makeComment({ userImageUrl: 'data:text/html;base64,abc', userId: 'another-user' })],
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      currentUserId: 'user_test',
    });

    expect(screen.getByText('AS')).toBeInTheDocument();
    expect(screen.queryByTitle('Editar')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Excluir')).not.toBeInTheDocument();
    cleanup();

    const onEdit = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);

    renderCommentComponent(renderUi, {
      comments: [makeComment()],
      onEdit,
      onDelete,
      currentUserId: 'user_test',
    });

    fireEvent.click(screen.getByTitle('Editar'));
    const editTextarea = getEditTextarea();

    fireEvent.change(editTextarea, { target: { value: editedBody } });
    fireEvent.keyDown(editTextarea, { key: 'Escape' });
    expect(queryEditTextarea()).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Editar'));
    fireEvent.change(getEditTextarea(), { target: { value: editedBody } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => {
      expect(onEdit).toHaveBeenCalledWith('comment-1', editedBody);
    });

    fireEvent.click(screen.getByTitle('Excluir'));
    expect(screen.getByText('Excluir este comentário?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sim, excluir'));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('comment-1');
    });
  });
}
