import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

async function loadUseComments() {
  vi.resetModules();
  return (await import('../../src/hooks/useComments')).useComments;
}

describe('useComments loadCommentedAnchors', () => {
  beforeEach(() => {
    refs.createCommentMock.mockReset();
    refs.fetchCommentsByAnchorMock.mockReset();
    refs.updateCommentMock.mockReset();
    refs.deleteCommentMock.mockReset();
    refs.fetchCommentedAnchorsMock.mockReset();
    refs.toastSuccessMock.mockReset();
    refs.toastErrorMock.mockReset();
  });

  it('deduplicates in-flight requests', async () => {
    let resolveFetch: ((value: string[]) => void) | null = null;
    refs.fetchCommentedAnchorsMock.mockReturnValue(
      new Promise<string[]>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const useComments = await loadUseComments();
    const { result } = renderHook(() => useComments());

    const p1 = result.current.loadCommentedAnchors();
    const p2 = result.current.loadCommentedAnchors();

    expect(refs.fetchCommentedAnchorsMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(['pos-84-13']);
    await act(async () => {
      const [a1, a2] = await Promise.all([p1, p2]);
      expect(a1).toEqual(['pos-84-13']);
      expect(a2).toEqual(['pos-84-13']);
    });

    expect(result.current.commentedAnchors).toEqual(['pos-84-13']);
  });

  it('uses cache on repeated calls and bypasses cache when force=true', async () => {
    refs.fetchCommentedAnchorsMock
      .mockResolvedValueOnce(['pos-85-17'])
      .mockResolvedValueOnce(['pos-90-01']);

    const useComments = await loadUseComments();
    const { result } = renderHook(() => useComments());

    await act(async () => {
      const anchors = await result.current.loadCommentedAnchors();
      expect(anchors).toEqual(['pos-85-17']);
    });

    await act(async () => {
      const cached = await result.current.loadCommentedAnchors();
      expect(cached).toEqual(['pos-85-17']);
    });

    expect(refs.fetchCommentedAnchorsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      const forced = await result.current.loadCommentedAnchors(true);
      expect(forced).toEqual(['pos-90-01']);
    });

    expect(refs.fetchCommentedAnchorsMock).toHaveBeenCalledTimes(2);
    expect(result.current.commentedAnchors).toEqual(['pos-90-01']);
  });
});
