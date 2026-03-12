import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createComment,
  deleteComment,
  fetchCommentedAnchors,
  fetchCommentsByAnchor,
  fetchCommentsByAnchors,
  fetchPendingComments,
  moderateComment,
  updateComment,
  type CommentOut,
} from '../../src/services/commentService';

const refs = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  patchMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('../../src/services/api', () => ({
  api: {
    get: refs.getMock,
    post: refs.postMock,
    patch: refs.patchMock,
    delete: refs.deleteMock,
  },
}));

function makeComment(id: number, anchorKey = 'pos-84-13'): CommentOut {
  return {
    id,
    tenant_id: 'org_test',
    user_id: 'user_test',
    anchor_key: anchorKey,
    selected_text: 'Trecho selecionado',
    body: `Comentário ${id}`,
    status: 'pending',
    created_at: '2026-03-01T12:00:00Z',
    updated_at: '2026-03-01T12:00:00Z',
    moderated_by: null,
    moderated_at: null,
    user_name: 'Usuário Teste',
    user_image_url: null,
  };
}

describe('commentService', () => {
  beforeEach(() => {
    refs.getMock.mockReset();
    refs.postMock.mockReset();
    refs.patchMock.mockReset();
    refs.deleteMock.mockReset();
  });

  it('creates comments with the expected payload', async () => {
    const payload = {
      anchor_key: 'pos-84-13',
      selected_text: 'Motores',
      body: 'Precisa revisar a descrição',
      is_private: true,
      user_name: 'Alice',
      user_image_url: 'https://cdn.example/avatar.png',
    };
    refs.postMock.mockResolvedValue({ data: makeComment(1) });

    const result = await createComment(payload);

    expect(refs.postMock).toHaveBeenCalledWith('/comments/', payload);
    expect(result).toEqual(makeComment(1));
  });

  it('loads comments for an encoded anchor key', async () => {
    refs.getMock.mockResolvedValue({ data: [makeComment(2, 'chapter 84/13')] });

    const result = await fetchCommentsByAnchor('chapter 84/13');

    expect(refs.getMock).toHaveBeenCalledWith('/comments/anchor/chapter%2084%2F13');
    expect(result).toEqual([makeComment(2, 'chapter 84/13')]);
  });

  it('deduplicates anchor requests and tolerates partial failures when loading many anchors', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      refs.getMock
        .mockResolvedValueOnce({ data: [makeComment(3, 'pos-84-13')] })
        .mockRejectedValueOnce(new Error('backend down'));

      const map = await fetchCommentsByAnchors(['pos-84-13', 'pos-84-13', 'pos-85-17']);

      expect(refs.getMock).toHaveBeenCalledTimes(2);
      expect(map.get('pos-84-13')).toEqual([makeComment(3, 'pos-84-13')]);
      expect(map.get('pos-85-17')).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('updates and deletes author-owned comments', async () => {
    refs.patchMock.mockResolvedValue({ data: makeComment(4) });

    const updated = await updateComment(4, 'Corpo atualizado');
    await deleteComment(4);

    expect(refs.patchMock).toHaveBeenCalledWith('/comments/4', { body: 'Corpo atualizado' });
    expect(refs.deleteMock).toHaveBeenCalledWith('/comments/4');
    expect(updated).toEqual(makeComment(4));
  });

  it('loads moderation endpoints and commented anchors', async () => {
    refs.getMock
      .mockResolvedValueOnce({ data: [makeComment(5)] })
      .mockResolvedValueOnce({ data: ['pos-84-13', 'pos-85-17'] });
    refs.patchMock.mockResolvedValue({ data: makeComment(5) });

    const pending = await fetchPendingComments();
    const moderated = await moderateComment(5, 'reject', 'Sem fonte');
    const anchors = await fetchCommentedAnchors();

    expect(refs.getMock).toHaveBeenNthCalledWith(1, '/comments/admin/pending');
    expect(refs.patchMock).toHaveBeenCalledWith('/comments/admin/5', {
      action: 'reject',
      note: 'Sem fonte',
    });
    expect(refs.getMock).toHaveBeenNthCalledWith(2, '/comments/anchors');
    expect(pending).toEqual([makeComment(5)]);
    expect(moderated).toEqual(makeComment(5));
    expect(anchors).toEqual(['pos-84-13', 'pos-85-17']);
  });
});
