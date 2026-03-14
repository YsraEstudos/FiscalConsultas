import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentOut } from '../../src/services/commentService';

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

function makeApiComment(overrides: Partial<CommentOut> = {}): CommentOut {
  return {
    id: 1,
    tenant_id: 'tenant_test',
    user_id: 'user_test',
    anchor_key: 'pos-84-13',
    selected_text: 'Motores elétricos',
    body: 'Comentário inicial',
    status: 'approved',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    moderated_by: null,
    moderated_at: null,
    user_name: 'Usuário Teste',
    user_image_url: null,
    ...overrides,
  };
}

function makePending() {
  return {
    anchorTop: 32,
    anchorKey: 'pos-84-13',
    selectedText: 'Motores elétricos',
  };
}

function makeAxiosError(status: number, detail?: string) {
  return Object.assign(new Error(detail || `HTTP ${status}`), {
    isAxiosError: true,
    response: {
      status,
      data: detail ? { detail } : {},
    },
  });
}

async function loadUseComments() {
  vi.resetModules();
  return (await import('../../src/hooks/useComments')).useComments;
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

    const useComments = await loadUseComments();
    const { result } = renderHook(() => useComments());

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
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      refs.fetchCommentsByAnchorMock.mockRejectedValue(new Error('network'));

      const useComments = await loadUseComments();
      const { result } = renderHook(() => useComments());

      await act(async () => {
        await result.current.loadComments('pos-84-13');
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.comments).toEqual([]);
      expect(refs.toastErrorMock).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('optimistically adds comments, replaces the temp item on success, and shows a success toast', async () => {
    let resolveCreate: ((value: CommentOut) => void) | null = null;
    refs.createCommentMock.mockReturnValue(
      new Promise<CommentOut>((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const useComments = await loadUseComments();
    const { result } = renderHook(() => useComments());
    let addPromise: Promise<boolean> | undefined;

    await act(async () => {
      addPromise = result.current.addComment(
        makePending(),
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

    expect(refs.createCommentMock).toHaveBeenCalledWith({
      anchor_key: 'pos-84-13',
      selected_text: 'Motores elétricos',
      body: 'Novo comentário',
      is_private: true,
      user_name: 'Alice',
      user_image_url: undefined,
    });
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

    const originalLocation = window.location;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: new URL('https://192.168.0.23/'),
      });

      const useComments = await loadUseComments();
      const { result } = renderHook(() => useComments());

      await act(async () => {
        const ok = await result.current.addComment(
          makePending(),
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
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
      consoleErrorSpy.mockRestore();
    }
  });

  it('rolls back optimistic comments and reports generic failures when createComment fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      refs.createCommentMock.mockRejectedValue(new Error('save failed'));

      const useComments = await loadUseComments();
      const { result } = renderHook(() => useComments());

      await act(async () => {
        const ok = await result.current.addComment(
          makePending(),
          'Comentário falhou',
          false,
          'Alice',
          null,
        );
        expect(ok).toBe(false);
      });

      expect(result.current.comments).toEqual([]);
      expect(refs.toastErrorMock).toHaveBeenCalledWith('Erro ao salvar comentário. Tente novamente.');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('validates IDs before editing and deleting', async () => {
    const useComments = await loadUseComments();
    const { result } = renderHook(() => useComments());

    await act(async () => {
      await result.current.editComment('abc', 'novo corpo');
    });

    expect(refs.toastErrorMock).toHaveBeenCalledWith('ID de comentário inválido');
    expect(refs.toastErrorMock).toHaveBeenCalledTimes(1);
    expect(refs.updateCommentMock).not.toHaveBeenCalled();
    expect(refs.deleteCommentMock).not.toHaveBeenCalled();

    refs.toastErrorMock.mockReset();

    await act(async () => {
      await result.current.removeComment('xyz');
    });

    expect(refs.toastErrorMock).toHaveBeenCalledWith('ID de comentário inválido');
    expect(refs.toastErrorMock).toHaveBeenCalledTimes(1);
    expect(refs.updateCommentMock).not.toHaveBeenCalled();
    expect(refs.deleteCommentMock).not.toHaveBeenCalled();
  });

  it('edits comments, refreshes them from the API shape, and reports permission failures with rollback', async () => {
    refs.fetchCommentsByAnchorMock.mockResolvedValue([makeApiComment()]);
    refs.updateCommentMock
      .mockResolvedValueOnce(makeApiComment({ body: 'Comentário editado' }))
      .mockRejectedValueOnce(makeAxiosError(403));

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const useComments = await loadUseComments();
      const { result } = renderHook(() => useComments());

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
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('removes comments, keeps deletions on success, and rolls back forbidden deletes', async () => {
    refs.fetchCommentsByAnchorMock
      .mockResolvedValueOnce([makeApiComment()])
      .mockResolvedValueOnce([makeApiComment({ id: 2, body: 'Comentário protegido' })]);
    refs.deleteCommentMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(makeAxiosError(403));

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const useComments = await loadUseComments();
      const { result } = renderHook(() => useComments());

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
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('skips commented-anchor lookups on LAN hosts during development', async () => {
    const originalLocation = window.location;
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: new URL('https://192.168.0.11/'),
      });

      const useComments = await loadUseComments();
      const { result } = renderHook(() => useComments());

      await act(async () => {
        const anchors = await result.current.loadCommentedAnchors();
        expect(anchors).toEqual([]);
      });

      expect(refs.fetchCommentedAnchorsMock).not.toHaveBeenCalled();
      expect(result.current.commentedAnchors).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
      consoleWarnSpy.mockRestore();
    }
  });

  it('shows the specific 401 Clerk messages for missing and expired tokens on localhost', async () => {
    const originalLocation = window.location;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: new URL('http://localhost:5173/'),
      });

      refs.createCommentMock
        .mockRejectedValueOnce(makeAxiosError(401, 'Token ausente'))
        .mockRejectedValueOnce(makeAxiosError(401, 'Token inválido ou expirado: session expired'))
        .mockRejectedValueOnce(makeAxiosError(401, 'Outra resposta 401'));

      const useComments = await loadUseComments();
      const { result } = renderHook(() => useComments());

      await act(async () => {
        expect(await result.current.addComment(makePending(), 'Primeiro', false, 'Alice', null)).toBe(false);
        expect(await result.current.addComment(makePending(), 'Segundo', false, 'Alice', null)).toBe(false);
        expect(await result.current.addComment(makePending(), 'Terceiro', false, 'Alice', null)).toBe(false);
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
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
      consoleErrorSpy.mockRestore();
    }
  });

  it('rolls back edits and deletes with generic errors when the API does not return 403', async () => {
    refs.fetchCommentsByAnchorMock.mockResolvedValue([makeApiComment()]);
    refs.updateCommentMock.mockRejectedValueOnce(new Error('edit broke'));
    refs.deleteCommentMock.mockRejectedValueOnce(new Error('delete broke'));

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const useComments = await loadUseComments();
      const { result } = renderHook(() => useComments());

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
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
