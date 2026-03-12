import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadUseComments,
  makeApiComment,
  makeAxiosError,
  makeCommentCreatePayload,
  makeLanHostLocation,
  makePendingCommentEntry,
} from './commentTestUtils';

const refs = vi.hoisted(() => ({
  createCommentMock: vi.fn(),
  fetchCommentsByAnchorMock: vi.fn(),
  updateCommentMock: vi.fn(),
  deleteCommentMock: vi.fn(),
  fetchCommentedAnchorsMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../../src/services/commentService', () => ({
  createComment: refs.createCommentMock,
  fetchCommentsByAnchor: refs.fetchCommentsByAnchorMock,
  updateComment: refs.updateCommentMock,
  deleteComment: refs.deleteCommentMock,
  fetchCommentedAnchors: refs.fetchCommentedAnchorsMock,
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: refs.toastSuccessMock,
    error: refs.toastErrorMock,
  },
}));

const hookPending = () => makePendingCommentEntry({ anchorTop: 32, selectedText: 'Motores elétricos' });

async function renderUseCommentsHook() {
  const useComments = await loadUseComments();
  return renderHook(() => useComments());
}

async function withSilencedConsole<T>(
  method: 'error' | 'warn',
  callback: () => Promise<T>,
): Promise<T> {
  const consoleSpy = vi.spyOn(console, method).mockImplementation(() => {});
  try {
    return await callback();
  } finally {
    consoleSpy.mockRestore();
  }
}

async function withMockedLocation<T>(location: URL, callback: () => Promise<T>): Promise<T> {
  const originalLocation = globalThis.location;
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: location,
  });

  try {
    return await callback();
  } finally {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: originalLocation,
    });
  }
}

describe('useComments behavior', () => {
  beforeEach(() => {
    refs.createCommentMock.mockReset();
    refs.fetchCommentsByAnchorMock.mockReset();
    refs.updateCommentMock.mockReset();
    refs.deleteCommentMock.mockReset();
    refs.fetchCommentedAnchorsMock.mockReset();
    refs.toastSuccessMock.mockReset();
    refs.toastErrorMock.mockReset();
  });

  it('loads comments for an anchor, maps API fields, and avoids duplicate loads until reset', async () => {
    refs.fetchCommentsByAnchorMock.mockResolvedValue([makeApiComment()]);

    const { result } = await renderUseCommentsHook();

    await act(async () => {
      await result.current.loadComments('pos-84-13', 64);
    });

    expect(refs.fetchCommentsByAnchorMock).toHaveBeenCalledTimes(1);
    expect(result.current.comments).toEqual([
      expect.objectContaining({
        id: '1',
        anchorTop: 64,
        anchorKey: 'pos-84-13',
        body: 'Comentário inicial',
        userId: 'user_test',
      }),
    ]);

    await act(async () => {
      await result.current.loadComments('pos-84-13', 99);
    });
    expect(refs.fetchCommentsByAnchorMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.resetFetchedAnchors();
    });

    await act(async () => {
      await result.current.loadComments('pos-84-13', 99);
    });
    expect(refs.fetchCommentsByAnchorMock).toHaveBeenCalledTimes(2);
  });

  it('handles loadComments failures silently and clears the loading flag', async () => {
    await withSilencedConsole('error', async () => {
      refs.fetchCommentsByAnchorMock.mockRejectedValue(new Error('network'));

      const { result } = await renderUseCommentsHook();

      await act(async () => {
        await result.current.loadComments('pos-84-13');
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.comments).toEqual([]);
      expect(refs.toastErrorMock).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });
  });

  it('optimistically adds comments, replaces the temp item on success, and shows a success toast', async () => {
    let resolveCreate: ((value: ReturnType<typeof makeApiComment>) => void) | null = null;
    refs.createCommentMock.mockReturnValue(
      new Promise<ReturnType<typeof makeApiComment>>((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const { result } = await renderUseCommentsHook();
    const pending = hookPending();
    let addPromise: Promise<boolean> | undefined;

    await act(async () => {
      addPromise = result.current.addComment(
        pending,
        'Novo comentário',
        true,
        'Alice',
        null,
      );
    });

    expect(result.current.comments).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^temp-/),
        body: 'Novo comentário',
        isPrivate: true,
      }),
    ]);

    await act(async () => {
      resolveCreate?.(makeApiComment({
        id: 2,
        body: 'Novo comentário',
        status: 'private',
        user_name: 'Alice',
      }));
      await addPromise;
    });

    expect(refs.createCommentMock).toHaveBeenCalledWith(makeCommentCreatePayload());
    expect(result.current.comments).toEqual([
      expect.objectContaining({
        id: '2',
        body: 'Novo comentário',
        isPrivate: true,
        userName: 'Alice',
      }),
    ]);
    expect(refs.toastSuccessMock).toHaveBeenCalledWith('Comentário salvo');
  });

  it('removes optimistic comments and reports LAN-host Clerk token issues on 401 create failures', async () => {
    refs.createCommentMock.mockRejectedValue(makeAxiosError(401, 'Token ausente'));

    await withSilencedConsole('error', async () => {
      await withMockedLocation(makeLanHostLocation('lan-host.test'), async () => {
        const { result } = await renderUseCommentsHook();

        await act(async () => {
          const ok = await result.current.addComment(
            hookPending(),
            'Comentário LAN',
            false,
            'Alice',
            null,
          );
          expect(ok).toBe(false);
        });

        expect(result.current.comments).toEqual([]);
        expect(refs.toastErrorMock).toHaveBeenCalledWith(
          'Token do Clerk indisponível neste host de rede. Abra em http://localhost:5173 para comentar.',
        );
      });
    });
  });

  it('rolls back optimistic comments and reports generic failures when createComment fails', async () => {
    await withSilencedConsole('error', async () => {
      refs.createCommentMock.mockRejectedValue(new Error('save failed'));

      const { result } = await renderUseCommentsHook();

      await act(async () => {
        const ok = await result.current.addComment(
          hookPending(),
          'Comentário falhou',
          false,
          'Alice',
          null,
        );
        expect(ok).toBe(false);
      });

      expect(result.current.comments).toEqual([]);
      expect(refs.toastErrorMock).toHaveBeenCalledWith('Erro ao salvar comentário. Tente novamente.');
    });
  });

  it('validates IDs before editing and deleting', async () => {
    const { result } = await renderUseCommentsHook();

    await act(async () => {
      await result.current.editComment('abc', 'novo corpo');
      await result.current.removeComment('xyz');
    });

    expect(refs.toastErrorMock).toHaveBeenCalledTimes(2);
    expect(refs.toastErrorMock).toHaveBeenNthCalledWith(1, 'ID de comentário inválido');
    expect(refs.toastErrorMock).toHaveBeenNthCalledWith(2, 'ID de comentário inválido');
    expect(refs.updateCommentMock).not.toHaveBeenCalled();
    expect(refs.deleteCommentMock).not.toHaveBeenCalled();
  });

  it('edits comments, refreshes them from the API shape, and reports permission failures with rollback', async () => {
    refs.fetchCommentsByAnchorMock.mockResolvedValue([makeApiComment()]);
    refs.updateCommentMock
      .mockResolvedValueOnce(makeApiComment({ body: 'Comentário editado' }))
      .mockRejectedValueOnce(makeAxiosError(403));

    await withSilencedConsole('error', async () => {
      const { result } = await renderUseCommentsHook();

      await act(async () => {
        result.current.resetFetchedAnchors();
        await result.current.loadComments('pos-84-13', 64);
      });

      await act(async () => {
        await result.current.editComment('1', 'Comentário editado');
      });

      expect(result.current.comments[0]).toEqual(expect.objectContaining({
        id: '1',
        body: 'Comentário editado',
      }));
      expect(refs.toastSuccessMock).toHaveBeenCalledWith('Comentário editado');

      await act(async () => {
        await result.current.editComment('1', 'Sem permissão');
      });

      expect(result.current.comments[0]).toEqual(expect.objectContaining({
        id: '1',
        body: 'Comentário editado',
      }));
      expect(refs.toastErrorMock).toHaveBeenCalledWith('Sem permissão para editar este comentário.');
    });
  });

  it('removes comments, keeps deletions on success, and rolls back forbidden deletes', async () => {
    refs.fetchCommentsByAnchorMock
      .mockResolvedValueOnce([makeApiComment()])
      .mockResolvedValueOnce([makeApiComment({ id: 2, body: 'Comentário protegido' })]);
    refs.deleteCommentMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(makeAxiosError(403));

    await withSilencedConsole('error', async () => {
      const { result } = await renderUseCommentsHook();

      await act(async () => {
        await result.current.loadComments('pos-84-13', 64);
      });

      await act(async () => {
        await result.current.removeComment('1');
      });

      expect(result.current.comments).toEqual([]);
      expect(refs.toastSuccessMock).toHaveBeenCalledWith('Comentário removido');

      act(() => {
        result.current.resetFetchedAnchors();
      });

      await act(async () => {
        await result.current.loadComments('pos-84-13', 64);
      });

      expect(result.current.comments).toEqual([
        expect.objectContaining({ id: '2' }),
      ]);

      await act(async () => {
        await result.current.removeComment('2');
      });

      expect(result.current.comments).toEqual([
        expect.objectContaining({
          id: '2',
          body: 'Comentário protegido',
        }),
      ]);
      expect(refs.toastErrorMock).toHaveBeenCalledWith('Sem permissão para remover este comentário.');
    });
  });

  it('skips commented-anchor lookups on LAN hosts during development', async () => {
    await withSilencedConsole('warn', async () => {
      await withMockedLocation(makeLanHostLocation('dev-lan-host.test'), async () => {
        const { result } = await renderUseCommentsHook();

        await act(async () => {
          const anchors = await result.current.loadCommentedAnchors();
          expect(anchors).toEqual([]);
        });

        expect(refs.fetchCommentedAnchorsMock).not.toHaveBeenCalled();
        expect(result.current.commentedAnchors).toEqual([]);
        expect(console.warn).toHaveBeenCalledTimes(1);
      });
    });
  });

  it('shows the specific 401 Clerk messages for missing and expired tokens on localhost', async () => {
    await withSilencedConsole('error', async () => {
      await withMockedLocation(new URL('http://localhost:5173/'), async () => {
        refs.createCommentMock
          .mockRejectedValueOnce(makeAxiosError(401, 'Token ausente'))
          .mockRejectedValueOnce(makeAxiosError(401, 'Token inválido ou expirado: session expired'))
          .mockRejectedValueOnce(makeAxiosError(401, 'Outra resposta 401'));

        const { result } = await renderUseCommentsHook();
        const pending = hookPending();

        await act(async () => {
          expect(await result.current.addComment(pending, 'Primeiro', false, 'Alice', null)).toBe(false);
          expect(await result.current.addComment(pending, 'Segundo', false, 'Alice', null)).toBe(false);
          expect(await result.current.addComment(pending, 'Terceiro', false, 'Alice', null)).toBe(false);
        });

        expect(refs.toastErrorMock).toHaveBeenNthCalledWith(
          1,
          'Token não enviado pelo Clerk. Faça logout/login e tente novamente.',
        );
        expect(refs.toastErrorMock).toHaveBeenNthCalledWith(
          2,
          'Token inválido/expirado. Faça login novamente.',
        );
        expect(refs.toastErrorMock).toHaveBeenNthCalledWith(
          3,
          'Sessão expirada. Faça login novamente para comentar.',
        );
      });
    });
  });

  it('rolls back edits and deletes with generic errors when the API does not return 403', async () => {
    refs.fetchCommentsByAnchorMock.mockResolvedValue([makeApiComment()]);
    refs.updateCommentMock.mockRejectedValueOnce(new Error('edit broke'));
    refs.deleteCommentMock.mockRejectedValueOnce(new Error('delete broke'));

    await withSilencedConsole('error', async () => {
      const { result } = await renderUseCommentsHook();

      await act(async () => {
        await result.current.loadComments('pos-84-13', 64);
      });

      await act(async () => {
        await result.current.editComment('1', 'Novo corpo');
      });

      expect(result.current.comments[0]).toEqual(expect.objectContaining({
        id: '1',
        body: 'Comentário inicial',
      }));
      expect(refs.toastErrorMock).toHaveBeenCalledWith('Erro ao editar comentário.');

      await act(async () => {
        await result.current.removeComment('1');
      });

      expect(result.current.comments).toEqual([
        expect.objectContaining({
          id: '1',
          body: 'Comentário inicial',
        }),
      ]);
      expect(refs.toastErrorMock).toHaveBeenCalledWith('Erro ao remover comentário.');
    });
  });
});
