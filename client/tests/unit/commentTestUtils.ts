import { vi } from 'vitest';

import type { LocalComment, PendingCommentEntry } from '../../src/components/CommentPanel';
import type { CommentCreatePayload, CommentOut } from '../../src/services/commentService';

export const unsafeJavascriptUrl = `javascript${':alert(1)'}`;

export function makeLocalComment(overrides: Partial<LocalComment> = {}): LocalComment {
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

export function makePendingCommentEntry(
  overrides: Partial<PendingCommentEntry> = {},
): PendingCommentEntry {
  return {
    anchorTop: 24,
    anchorKey: 'pos-84-13',
    selectedText: 'Trecho pendente para comentar com bastante conteúdo',
    ...overrides,
  };
}

export function makeApiComment(overrides: Partial<CommentOut> = {}): CommentOut {
  return {
    id: 1,
    tenant_id: 'org_test',
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

export function makePendingApiComment(overrides: Partial<CommentOut> = {}): CommentOut {
  return makeApiComment({
    status: 'pending',
    body: 'Comentário aguardando moderação',
    anchor_key: 'pos-84-13-long-anchor-key',
    selected_text: 'Trecho selecionado que pode ser longo para truncamento visual no modal',
    user_name: 'Alice Silva',
    ...overrides,
  });
}

export function makeCommentCreatePayload(
  overrides: Partial<CommentCreatePayload> = {},
): CommentCreatePayload {
  return {
    anchor_key: 'pos-84-13',
    selected_text: 'Motores elétricos',
    body: 'Novo comentário',
    is_private: true,
    user_name: 'Alice',
    user_image_url: undefined,
    ...overrides,
  };
}

export function makeAxiosError(status: number, detail?: string) {
  return Object.assign(new Error(detail || `HTTP ${status}`), {
    isAxiosError: true,
    response: {
      status,
      data: detail ? { detail } : {},
    },
  });
}

export function makeLanHostLocation(hostname: string): URL {
  return new URL(`https://${hostname}/`);
}

export async function loadUseComments() {
  vi.resetModules();
  return (await import('../../src/hooks/useComments')).useComments;
}
