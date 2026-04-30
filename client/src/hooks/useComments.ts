/**
 * useComments — hook para gerenciar comentários com integração API.
 *
 * Combina estado local (otimista) com persistência no backend.
 * Mapeia CommentOut (API) → LocalComment (UI) incluindo dados de perfil.
 */
import { useState, useCallback, useRef } from 'react';
import {
    createComment,
    fetchCommentsByAnchor,
    updateComment as apiUpdateComment,
    deleteComment as apiDeleteComment,
    fetchCommentedAnchors,
} from '../services/commentService';
import type { CommentOut, CommentCreatePayload } from '../services/commentService';
import type { LocalComment, PendingCommentEntry } from '../components/CommentPanel';
import toast from 'react-hot-toast';
import axios from 'axios';
import { getApiErrorDetail, isLanHostInDev } from '../utils/apiError';

const COMMENTED_ANCHORS_TTL_MS = 60_000;
let commentedAnchorsCache: { value: string[]; expiresAt: number } | null = null;
let commentedAnchorsInFlightPromise: Promise<string[]> | null = null;

/** Converte CommentOut (snake_case, ISO strings) → LocalComment (camelCase, Date). */
function apiToLocal(c: CommentOut, fallbackAnchorTop: number): LocalComment {
    return {
        id: String(c.id),
        anchorTop: fallbackAnchorTop,
        anchorKey: c.anchor_key,
        selectedText: c.selected_text,
        body: c.body,
        isPrivate: c.status === 'private',
        createdAt: new Date(c.created_at),
        userName: c.user_name || 'Usuário',
        userImageUrl: c.user_image_url || null,
        userId: c.user_id,
    };
}

export interface UseCommentsReturn {
    /** Lista unificada de comentários (API + local otimista). */
    comments: LocalComment[];
    /** Flag de carregamento. */
    loading: boolean;
    /** Busca comentários do backend para um anchor. */
    loadComments: (anchorKey: string, anchorTop?: number) => Promise<void>;
    /** Cria comentário via API (otimista: adiciona localmente primeiro). */
    addComment: (
        pending: PendingCommentEntry,
        body: string,
        isPrivate: boolean,
        userName: string,
        userImageUrl: string | null,
    ) => Promise<boolean>;
    /** Edita o corpo de um comentário existente (somente autor). */
    editComment: (commentId: string, newBody: string) => Promise<void>;
    /** Remove um comentário (somente autor). */
    removeComment: (commentId: string) => Promise<void>;
    /** Lista de anchor_keys com comentários aprovados. */
    commentedAnchors: string[];
    /** Busca anchor_keys com comentários aprovados do backend. */
    loadCommentedAnchors: (force?: boolean) => Promise<string[]>;
    /** Limpa cache de anchors já buscados para permitir reload */
    resetFetchedAnchors: () => void;
}

export function useComments(): UseCommentsReturn {
    const [comments, setComments] = useState<LocalComment[]>([]);
    const [loading, setLoading] = useState(false);
    const [commentedAnchors, setCommentedAnchors] = useState<string[]>([]);
    const skippedLanAnchorFetchRef = useRef(false);
    // Track fetched anchors to avoid duplicate requests
    const fetchedAnchors = useRef(new Set<string>());

    const loadComments = useCallback(async (anchorKey: string, anchorTop = 0) => {
        if (fetchedAnchors.current.has(anchorKey)) return;
        fetchedAnchors.current.add(anchorKey);

        try {
            setLoading(true);
            const apiComments = await fetchCommentsByAnchor(anchorKey);
            const mapped = apiComments.map(c => apiToLocal(c, anchorTop));
            setComments(prev => {
                // Merge: remove any existing for this anchor, then append
                const filtered = prev.filter(c => c.anchorKey !== anchorKey);
                return [...filtered, ...mapped];
            });
        } catch (error) {
            if (import.meta.env.DEV) {
                console.error('[useComments] Failed to load comments:', error);
            }
            // Don't toast on load failure — silent fallback
        } finally {
            setLoading(false);
        }
    }, []);

    const addComment = useCallback(async (
        pending: PendingCommentEntry,
        body: string,
        isPrivate: boolean,
        userName: string,
        userImageUrl: string | null,
    ): Promise<boolean> => {
        // 1. Optimistic local insert
        const tempId = `temp-${Date.now()}`;
        const optimistic: LocalComment = {
            id: tempId,
            anchorTop: pending.anchorTop,
            anchorKey: pending.anchorKey,
            selectedText: pending.selectedText,
            body,
            isPrivate,
            createdAt: new Date(),
            userName,
            userImageUrl,
        };
        setComments(prev => [...prev, optimistic]);

        // 2. API call
        const payload: CommentCreatePayload = {
            anchor_key: pending.anchorKey,
            selected_text: pending.selectedText,
            body,
            is_private: isPrivate,
        };

        try {
            const created = await createComment(payload);
            // Replace optimistic entry with real one
            setComments(prev =>
                prev.map(c =>
                    c.id === tempId ? apiToLocal(created, pending.anchorTop) : c,
                ),
            );
            toast.success('Comentário salvo');
            return true;
        } catch (error) {
            if (import.meta.env.DEV) {
                console.error('[useComments] Failed to create comment:', error);
            }
            // Remove optimistic entry on failure
            setComments(prev => prev.filter(c => c.id !== tempId));
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                const detail = getApiErrorDetail(error);
                const sessionMessage = isLanHostInDev() || detail
                    ? 'Não foi possível validar sua sessão de comentários. Faça login novamente e tente de novo.'
                    : 'Sua sessão expirou. Faça login novamente para comentar.';
                toast.error(sessionMessage);
                return false;
            }
            toast.error('Erro ao salvar comentário. Tente novamente.');
            return false;
        }
    }, []);

    const editComment = useCallback(async (commentId: string, newBody: string) => {
        const numericId = Number(commentId);
        if (isNaN(numericId)) {
            toast.error('ID de comentário inválido');
            return;
        }

        // Optimistic update
        const original = comments.find(c => c.id === commentId);
        setComments(prev =>
            prev.map(c => c.id === commentId ? { ...c, body: newBody } : c),
        );

        try {
            const updated = await apiUpdateComment(numericId, newBody);
            setComments(prev =>
                prev.map(c =>
                    c.id === commentId
                        ? apiToLocal(updated, original?.anchorTop ?? 0)
                        : c,
                ),
            );
            toast.success('Comentário editado');
        } catch (error) {
            // Rollback
            if (original) {
                setComments(prev =>
                    prev.map(c => c.id === commentId ? original : c),
                );
            }
            if (import.meta.env.DEV) {
                console.error('[useComments] Failed to edit comment:', error);
            }
            if (axios.isAxiosError(error) && error.response?.status === 403) {
                toast.error('Sem permissão para editar este comentário.');
                return;
            }
            toast.error('Erro ao editar comentário.');
        }
    }, [comments]);

    const removeComment = useCallback(async (commentId: string) => {
        const numericId = Number(commentId);
        if (isNaN(numericId)) {
            toast.error('ID de comentário inválido');
            return;
        }

        // Optimistic delete
        const original = comments.find(c => c.id === commentId);
        setComments(prev => prev.filter(c => c.id !== commentId));

        try {
            await apiDeleteComment(numericId);
            toast.success('Comentário removido');
        } catch (error) {
            // Rollback
            if (original) {
                setComments(prev => [...prev, original]);
            }
            if (import.meta.env.DEV) {
                console.error('[useComments] Failed to delete comment:', error);
            }
            if (axios.isAxiosError(error) && error.response?.status === 403) {
                toast.error('Sem permissão para remover este comentário.');
                return;
            }
            toast.error('Erro ao remover comentário.');
        }
    }, [comments]);

    const loadCommentedAnchors = useCallback(async (force = false): Promise<string[]> => {
        if (isLanHostInDev()) {
            if (!skippedLanAnchorFetchRef.current) {
                if (import.meta.env.DEV) {
                    console.warn('[useComments] Skipping /comments/anchors on LAN host in development.');
                }
                skippedLanAnchorFetchRef.current = true;
            }
            setCommentedAnchors([]);
            return [];
        }

        const now = Date.now();
        if (!force && commentedAnchorsCache && commentedAnchorsCache.expiresAt > now) {
            setCommentedAnchors(commentedAnchorsCache.value);
            return commentedAnchorsCache.value;
        }

        if (!force && commentedAnchorsInFlightPromise) {
            try {
                const anchors = await commentedAnchorsInFlightPromise;
                setCommentedAnchors(anchors);
                return anchors;
            } catch (error) {
                if (import.meta.env.DEV) {
                    console.error('[useComments] Failed to await in-flight commented anchors request:', error);
                }
                return [];
            }
        }

        const requestPromise = (async () => {
            const anchors = await fetchCommentedAnchors();
            commentedAnchorsCache = {
                value: anchors,
                expiresAt: Date.now() + COMMENTED_ANCHORS_TTL_MS,
            };
            return anchors;
        })();
        commentedAnchorsInFlightPromise = requestPromise;

        try {
            const anchors = await requestPromise;
            setCommentedAnchors(anchors);
            return anchors;
        } catch (error) {
            if (import.meta.env.DEV) {
                console.error('[useComments] Failed to load commented anchors:', error);
            }
            return [];
        } finally {
            if (commentedAnchorsInFlightPromise === requestPromise) {
                commentedAnchorsInFlightPromise = null;
            }
        }
    }, []);

    const resetFetchedAnchors = useCallback(() => {
        fetchedAnchors.current.clear();
    }, []);

    return {
        comments,
        loading,
        loadComments,
        addComment,
        editComment,
        removeComment,
        commentedAnchors,
        loadCommentedAnchors,
        resetFetchedAnchors,
    };
}
