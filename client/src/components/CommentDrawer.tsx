import { useState, useCallback, useRef, useEffect } from 'react';
import styles from './CommentDrawer.module.css';
import type { LocalComment, PendingCommentEntry } from './CommentPanel';
import { sanitizeImageUrl } from '../utils/contentSecurity';

interface CommentDrawerProps {
    /** Drawer visível? */
    open: boolean;
    /** Fechar o drawer. */
    onClose: () => void;
    /** Entrada pendente (formulário aberto). */
    pending: PendingCommentEntry | null;
    /** Comentários existentes. */
    comments: LocalComment[];
    /** Enviar novo comentário. */
    onSubmit: (body: string, isPrivate: boolean) => Promise<boolean>;
    /** Cancelar formulário. */
    onDismiss: () => void;
    /** Edita o corpo de um comentário existente. */
    onEdit?: (commentId: string, newBody: string) => Promise<void>;
    /** Remove um comentário. */
    onDelete?: (commentId: string) => Promise<void>;
    /** ID do usuário logado. */
    currentUserId?: string | null;
}

/** Formata data para "dd MMM yyyy, HH:mm" em pt-BR. */
function formatDate(date: Date): string {
    return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/** Iniciais do nome. */
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

/**
 * Drawer lateral para comentários — usado em telas < 1280px
 * (substituição responsiva do CommentPanel).
 *
 * Layout vertical com scroll próprio (sem posicionamento absoluto).
 * Formulário aparece no topo, seguido pela lista de comentários.
 */
export function CommentDrawer({
    open,
    onClose,
    pending,
    comments,
    onSubmit,
    onDismiss,
    onEdit,
    onDelete,
    currentUserId,
}: CommentDrawerProps) {
    const [body, setBody] = useState('');
    const [isPrivate, setIsPrivate] = useState(false);
    const [loading, setLoading] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // ── Estado de edição inline ────────────────────────────────────────────
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editBody, setEditBody] = useState('');
    const [editLoading, setEditLoading] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    // Auto-focus textarea quando o formulário aparece
    useEffect(() => {
        if (open && pending && textareaRef.current) {
            setTimeout(() => textareaRef.current?.focus(), 150);
        }
    }, [open, pending]);

    // Escape fecha o drawer
    useEffect(() => {
        if (!open) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [open, onClose]);

    const handleSubmit = useCallback(async () => {
        if (!body.trim()) return;
        setLoading(true);
        try {
            const success = await onSubmit(body.trim(), isPrivate);
            if (success) {
                setBody('');
                setIsPrivate(false);
            }
        } finally {
            setLoading(false);
        }
    }, [body, isPrivate, onSubmit]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
        }
    }, [handleSubmit]);

    const handleDismiss = useCallback(() => {
        setBody('');
        setIsPrivate(false);
        onDismiss();
    }, [onDismiss]);

    const count = comments.length + (pending ? 1 : 0);

    return (
        <>
            {/* FAB: abre o drawer */}
            {!open && (
                <button
                    className={styles.fab}
                    onClick={onClose} // toggle — controlado pelo pai
                    aria-label={`Abrir comentários (${count})`}
                    title="Comentários"
                >
                    💬
                    {count > 0 && <span className={styles.fabBadge}>{count}</span>}
                </button>
            )}

            {/* Backdrop */}
            {open && (
                <button
                    type="button"
                    className={styles.backdrop}
                    onClick={onClose}
                    aria-label="Fechar comentários"
                />
            )}

            {/* Drawer */}
            <div className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}>
                {/* Header */}
                <div className={styles.drawerHeader}>
                    <h3 className={styles.drawerTitle}>
                        Comentários
                        {comments.length > 0 && (
                            <span className={styles.drawerCount}>{comments.length}</span>
                        )}
                    </h3>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
                        ✕
                    </button>
                </div>

                {/* Scroll body */}
                <div className={styles.drawerBody}>
                    {/* Formulário de novo comentário */}
                    {pending && (
                        <div className={styles.formSection}>
                            <div className={styles.quotePreview}>
                                <span className={styles.quoteBar} />
                                <p className={styles.quoteText} title={pending.selectedText}>
                                    {pending.selectedText.length > 120
                                        ? `${pending.selectedText.slice(0, 120)}…`
                                        : pending.selectedText}
                                </p>
                            </div>
                            <textarea
                                ref={textareaRef}
                                className={styles.textarea}
                                placeholder="Adicione um comentário… (Ctrl+Enter para enviar)"
                                value={body}
                                onChange={e => setBody(e.target.value)}
                                onKeyDown={handleKeyDown}
                                rows={3}
                                maxLength={4000}
                                aria-label="Texto do comentário"
                            />
                            <div className={styles.formFooter}>
                                <label className={styles.toggle}>
                                    <input
                                        type="checkbox"
                                        checked={isPrivate}
                                        onChange={e => setIsPrivate(e.target.checked)}
                                        aria-label="Comentário privado"
                                    />{' '}
                                    Privado
                                </label>
                                <div className={styles.formActions}>
                                    <button
                                        className={styles.cancelBtn}
                                        onClick={handleDismiss}
                                        type="button"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        className={styles.submitBtn}
                                        onClick={handleSubmit}
                                        disabled={loading || !body.trim()}
                                        type="button"
                                    >
                                        {loading ? '…' : 'Comentar'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Lista de comentários */}
                    {comments.length === 0 && !pending && (
                        <div className={styles.emptyState}>
                            <span className={styles.emptyIcon}>💬</span>
                            <p>Nenhum comentário ainda</p>
                            <p className={styles.emptyHint}>
                                Selecione um trecho de texto e clique em 💬 para comentar
                            </p>
                        </div>
                    )}

                    {comments.map(comment => {
                        const isOwner = currentUserId && comment.userId === currentUserId;
                        const isEditing = editingId === comment.id;
                        const isConfirmingDelete = confirmDeleteId === comment.id;
                        const safeUserImageUrl = sanitizeImageUrl(comment.userImageUrl);

                        return (
                        <div
                            key={comment.id}
                            className={`${styles.commentCard} ${comment.isPrivate ? styles.private : ''}`}
                        >
                            {/* Header: Avatar + Nome + Data + Ações */}
                            <div className={styles.commentHeader}>
                                <div className={styles.authorInfo}>
                                    {safeUserImageUrl ? (
                                        <img
                                            className={styles.avatar}
                                            src={safeUserImageUrl}
                                            alt={comment.userName}
                                            loading="lazy"
                                            decoding="async"
                                            referrerPolicy="no-referrer"
                                        />
                                    ) : (
                                        <span
                                            className={styles.avatarFallback}
                                            style={{ backgroundColor: stringToColor(comment.userName || comment.id) }}
                                        >
                                            {getInitials(comment.userName || '?')}
                                        </span>
                                    )}
                                    <div className={styles.authorMeta}>
                                        <span className={styles.authorName}>
                                            {comment.userName || 'Usuário'}
                                        </span>
                                        <span className={styles.commentDate}>
                                            {formatDate(comment.createdAt)}
                                        </span>
                                    </div>
                                </div>
                                <div className={styles.headerActions}>
                                    <span className={styles.badge}>
                                        {comment.isPrivate ? '🔒' : '💬'}
                                    </span>
                                    {isOwner && onEdit && onDelete && (
                                        <div className={styles.actionMenu}>
                                            <button
                                                className={styles.actionBtn}
                                                onClick={() => {
                                                    setEditingId(comment.id);
                                                    setEditBody(comment.body);
                                                }}
                                                title="Editar"
                                            >
                                                ✏️
                                            </button>
                                            <button
                                                className={styles.actionBtn}
                                                onClick={() => setConfirmDeleteId(comment.id)}
                                                title="Excluir"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Citação */}
                            <div className={styles.quotePreview}>
                                <span className={styles.quoteBar} />
                                <p className={styles.quoteText} title={comment.selectedText}>
                                    {comment.selectedText.length > 80
                                        ? `${comment.selectedText.slice(0, 80)}…`
                                        : comment.selectedText}
                                </p>
                            </div>

                            {/* Corpo — modo edição ou leitura */}
                            {isEditing ? (
                                <div className={styles.editSection}>
                                    <textarea
                                        className={styles.textarea}
                                        value={editBody}
                                        onChange={e => setEditBody(e.target.value)}
                                        onKeyDown={e => {
                                            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                                e.preventDefault();
                                                if (editBody.trim() && onEdit) {
                                                    setEditLoading(true);
                                                    void onEdit(comment.id, editBody.trim()).finally(() => {
                                                        setEditLoading(false);
                                                        setEditingId(null);
                                                    });
                                                }
                                            }
                                            if (e.key === 'Escape') {
                                                setEditingId(null);
                                            }
                                        }}
                                        rows={3}
                                        maxLength={4000}
                                        aria-label="Editar comentário"
                                        autoFocus
                                    />
                                    <div className={styles.formActions}>
                                        <button
                                            className={styles.cancelBtn}
                                            onClick={() => setEditingId(null)}
                                            type="button"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            className={styles.submitBtn}
                                            onClick={() => {
                                                if (editBody.trim() && onEdit) {
                                                    setEditLoading(true);
                                                    void onEdit(comment.id, editBody.trim()).finally(() => {
                                                        setEditLoading(false);
                                                        setEditingId(null);
                                                    });
                                                }
                                            }}
                                            disabled={editLoading || !editBody.trim()}
                                            type="button"
                                        >
                                            {editLoading ? '…' : 'Salvar'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <p className={styles.commentBody}>{comment.body}</p>
                            )}

                            {/* Confirmação de exclusão */}
                            {isConfirmingDelete && (
                                <div className={styles.deleteConfirm}>
                                    <p>Excluir este comentário?</p>
                                    <div className={styles.formActions}>
                                        <button
                                            className={styles.cancelBtn}
                                            onClick={() => setConfirmDeleteId(null)}
                                            type="button"
                                        >
                                            Não
                                        </button>
                                        <button
                                            className={styles.deleteBtn}
                                            onClick={() => {
                                                if (onDelete) void onDelete(comment.id);
                                                setConfirmDeleteId(null);
                                            }}
                                            type="button"
                                        >
                                            Sim, excluir
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                        );
                    })}
                </div>
            </div>
        </>
    );
}
