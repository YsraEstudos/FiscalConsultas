/**
 * Comment API Service — chamadas REST para o backend de comentários.
 *
 * Usa o axios `api` centralizado que já injeta o JWT do Clerk.
 */
import { api } from './api';

// ── Types ─────────────────────────────────────────────────────────────────

export interface CommentCreatePayload {
    anchor_key: string;
    selected_text: string;
    body: string;
    is_private: boolean;
    user_name?: string;
    user_image_url?: string;
}

export interface CommentOut {
    id: number;
    tenant_id: string;
    user_id: string;
    anchor_key: string;
    selected_text: string;
    body: string;
    status: 'pending' | 'approved' | 'rejected' | 'private';
    created_at: string;   // ISO date string from backend
    updated_at: string;
    moderated_by: string | null;
    moderated_at: string | null;
    // Profile data (populated by backend)
    user_name: string | null;
    user_image_url: string | null;
}

// ── API calls ─────────────────────────────────────────────────────────────

/**
 * Cria um comentário no backend.
 */
export async function createComment(payload: CommentCreatePayload): Promise<CommentOut> {
    const { data } = await api.post<CommentOut>('/comments/', payload);
    return data;
}

/**
 * Busca comentários por anchor_key (aprovados + privados do usuário).
 */
export async function fetchCommentsByAnchor(anchorKey: string): Promise<CommentOut[]> {
    const { data } = await api.get<CommentOut[]>(
        `/comments/anchor/${encodeURIComponent(anchorKey)}`
    );
    return data;
}

/**
 * Busca comentários de múltiplos anchors em paralelo.
 * Retorna Map<anchorKey, CommentOut[]>.
 */
export async function fetchCommentsByAnchors(
    anchorKeys: string[],
): Promise<Map<string, CommentOut[]>> {
    const unique = [...new Set(anchorKeys)];
    const results = await Promise.allSettled(
        unique.map(key => fetchCommentsByAnchor(key)),
    );

    const map = new Map<string, CommentOut[]>();
    results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            map.set(unique[i], result.value);
        } else {
            console.warn(`[commentService] Failed to fetch comments for anchor "${unique[i]}":`, result.reason);
            map.set(unique[i], []);
        }
    });
    return map;
}

// ── Edição / Exclusão (autor) ─────────────────────────────────────────────

/**
 * Atualiza o corpo de um comentário existente (somente autor).
 * Comentários aprovados voltam para "pending" após edição.
 */
export async function updateComment(commentId: number, body: string): Promise<CommentOut> {
    const { data } = await api.patch<CommentOut>(`/comments/${commentId}`, { body });
    return data;
}

/**
 * Remove permanentemente um comentário (somente autor).
 */
export async function deleteComment(commentId: number): Promise<void> {
    await api.delete(`/comments/${commentId}`);
}

// ── Admin / Moderação ─────────────────────────────────────────────────────

/**
 * [Admin] Lista todos os comentários pendentes de moderação.
 */
export async function fetchPendingComments(): Promise<CommentOut[]> {
    const { data } = await api.get<CommentOut[]>('/comments/admin/pending');
    return data;
}

/**
 * [Admin] Aprova ou rejeita um comentário.
 */
export async function moderateComment(
    commentId: number,
    action: 'approve' | 'reject',
    note?: string,
): Promise<CommentOut> {
    const { data } = await api.patch<CommentOut>(
        `/comments/admin/${commentId}`,
        { action, note },
    );
    return data;
}

/**
 * Lista anchor_keys que possuem comentários aprovados.
 * Usado pelo frontend para aplicar a classe .has-comment.
 */
export async function fetchCommentedAnchors(): Promise<string[]> {
    const { data } = await api.get<string[]>('/comments/anchors');
    return data;
}
