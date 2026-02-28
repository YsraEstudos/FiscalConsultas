/**
 * AdminCommentModal — Modal de moderação de comentários (admin-only).
 *
 * Exibe lista de comentários pendentes com ações de aprovar/rejeitar.
 * Usa o padrão de modal do projeto (React.lazy + Suspense no ModalManager).
 */
import { useState, useEffect, useCallback } from 'react';
import {
    fetchPendingComments,
    moderateComment,
    type CommentOut,
} from '../services/commentService';
import toast from 'react-hot-toast';
import styles from './AdminCommentModal.module.css';

interface AdminCommentModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/** Formata data ISO para "dd MMM yyyy, HH:mm" em pt-BR. */
function formatDate(isoStr: string): string {
    return new Date(isoStr).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/** Iniciais do nome (ex: "João Silva" → "JS"). */
function getInitials(name: string): string {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(w => w[0].toUpperCase())
        .join('');
}

/** Cor determinística a partir de uma string. */
function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}

export function AdminCommentModal({ isOpen, onClose }: AdminCommentModalProps) {
    const [comments, setComments] = useState<CommentOut[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<number | null>(null);
    const [notes, setNotes] = useState<Record<number, string>>({});
    const runNonBlockingTask = useCallback((task: Promise<unknown>, context: string) => {
        task.catch((error) => {
            console.error(`[AdminCommentModal] ${context}:`, error);
        });
    }, []);

    const loadPending = useCallback(async () => {
        setLoading(true);
        try {
            const pending = await fetchPendingComments();
            setComments(pending);
        } catch (error) {
            console.error('[AdminCommentModal] Failed to load pending:', error);
            toast.error('Erro ao carregar comentários pendentes');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            runNonBlockingTask(loadPending(), 'loadPending');
        }
    }, [isOpen, loadPending, runNonBlockingTask]);

    const handleModerate = useCallback(async (
        commentId: number,
        action: 'approve' | 'reject',
    ) => {
        setActionLoading(commentId);
        try {
            await moderateComment(commentId, action, notes[commentId]);
            setComments(prev => prev.filter(c => c.id !== commentId));
            toast.success(action === 'approve' ? 'Comentário aprovado' : 'Comentário rejeitado');
        } catch (error) {
            console.error('[AdminCommentModal] Moderation error:', error);
            toast.error('Erro ao moderar comentário');
        } finally {
            setActionLoading(null);
        }
    }, [notes]);

    // Escape fecha o modal
    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className={styles.overlay}>
            <button
                type="button"
                className={styles.backdrop}
                onClick={onClose}
                aria-label="Fechar moderação de comentários"
            />
            <div className={styles.modal}>
                {/* Header */}
                <div className={styles.header}>
                    <h2 className={styles.title}>
                        🛡️ Moderar Comentários
                        {comments.length > 0 && (
                            <span className={styles.count}>{comments.length}</span>
                        )}
                    </h2>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className={styles.body}>
                    {loading && (
                        <div className={styles.loadingState}>
                            <div className={styles.spinner} />
                            <p>Carregando comentários pendentes…</p>
                        </div>
                    )}

                    {!loading && comments.length === 0 && (
                        <div className={styles.emptyState}>
                            <span className={styles.emptyIcon}>✅</span>
                            <p>Nenhum comentário pendente de moderação</p>
                        </div>
                    )}

                    {!loading && comments.map(comment => (
                        <div key={comment.id} className={styles.card}>
                            {/* Author info */}
                            <div className={styles.cardHeader}>
                                <div className={styles.authorInfo}>
                                    {comment.user_image_url ? (
                                        <img
                                            className={styles.avatar}
                                            src={comment.user_image_url}
                                            alt={comment.user_name || 'Usuário'}
                                            loading="lazy"
                                        />
                                    ) : (
                                        <span
                                            className={styles.avatarFallback}
                                            style={{ backgroundColor: stringToColor(comment.user_name || String(comment.id)) }}
                                        >
                                            {getInitials(comment.user_name || '?')}
                                        </span>
                                    )}
                                    <div className={styles.authorMeta}>
                                        <span className={styles.authorName}>
                                            {comment.user_name || 'Usuário'}
                                        </span>
                                        <span className={styles.commentDate}>
                                            {formatDate(comment.created_at)}
                                        </span>
                                    </div>
                                </div>
                                <span className={styles.anchorBadge} title={comment.anchor_key}>
                                    📍 {comment.anchor_key.length > 20
                                        ? `${comment.anchor_key.slice(0, 20)}…`
                                        : comment.anchor_key}
                                </span>
                            </div>

                            {/* Selected text quote */}
                            <div className={styles.quotePreview}>
                                <span className={styles.quoteBar} />
                                <p className={styles.quoteText} title={comment.selected_text}>
                                    {comment.selected_text.length > 120
                                        ? `${comment.selected_text.slice(0, 120)}…`
                                        : comment.selected_text}
                                </p>
                            </div>

                            {/* Comment body */}
                            <p className={styles.commentBody}>{comment.body}</p>

                            {/* Note input + actions */}
                            <div className={styles.moderationFooter}>
                                <input
                                    className={styles.noteInput}
                                    type="text"
                                    placeholder="Nota de moderação (opcional)…"
                                    value={notes[comment.id] || ''}
                                    onChange={e => setNotes(prev => ({
                                        ...prev,
                                        [comment.id]: e.target.value,
                                    }))}
                                    maxLength={1000}
                                />
                                <div className={styles.moderationActions}>
                                    <button
                                        className={styles.rejectBtn}
                                        onClick={() => runNonBlockingTask(
                                            handleModerate(comment.id, 'reject'),
                                            'handleModerate reject'
                                        )}
                                        disabled={actionLoading === comment.id}
                                        type="button"
                                    >
                                        {actionLoading === comment.id ? '…' : '❌ Rejeitar'}
                                    </button>
                                    <button
                                        className={styles.approveBtn}
                                        onClick={() => runNonBlockingTask(
                                            handleModerate(comment.id, 'approve'),
                                            'handleModerate approve'
                                        )}
                                        disabled={actionLoading === comment.id}
                                        type="button"
                                    >
                                        {actionLoading === comment.id ? '…' : '✅ Aprovar'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
