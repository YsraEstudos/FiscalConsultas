import React, { useState, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import styles from './CommentPanel.module.css';

// ── Interfaces ────────────────────────────────────────────────────────────

export interface LocalComment {
    id: string;
    anchorTop: number;
    anchorKey: string;
    selectedText: string;
    body: string;
    isPrivate: boolean;
    createdAt: Date;
    /** Nome do autor (Clerk fullName). */
    userName: string;
    /** URL do avatar (Clerk imageUrl). Null → exibe iniciais. */
    userImageUrl: string | null;
    /** ID do autor (Clerk sub). */
    userId?: string;
}

export interface PendingCommentEntry {
    anchorTop: number;
    anchorKey: string;
    selectedText: string;
}

interface CommentPanelProps {
    /** Entrada pendente (formulário aberto). Null = nenhum formulário ativo. */
    pending: PendingCommentEntry | null;
    /** Comentários já criados. */
    comments: LocalComment[];
    /** Chamado ao confirmar um comentário. */
    onSubmit: (body: string, isPrivate: boolean) => Promise<boolean>;
    /** Chamado ao cancelar o formulário. */
    onDismiss: () => void;
    /** Edita o corpo de um comentário existente. */
    onEdit?: (commentId: string, newBody: string) => Promise<void>;
    /** Remove um comentário. */
    onDelete?: (commentId: string) => Promise<void>;
    /** ID do usuário logado (para exibir ações só nos próprios). */
    currentUserId?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Gap mínimo (px) entre cards para evitar sobreposição. */
const MIN_GAP = 60;
/** Altura estimada de um card antes de ser medido pelo DOM. */
const ESTIMATED_CARD_HEIGHT = 130;

interface CardEntry {
    id: string;
    anchorTop: number;     // posição original (âncora)
    resolvedTop: number;   // posição após anti-colisão
    displaced: boolean;    // true quando resolvedTop !== anchorTop
}

/**
 * Calcula posições sem sobreposição para todos os cards.
 * Usa push-down: se um card colide com o anterior, é deslocado para baixo.
 */
function resolvePositions(
    items: { id: string; anchorTop: number }[],
    heights: Map<string, number>,
): CardEntry[] {
    if (items.length === 0) return [];
    // Ordena por anchorTop crescente
    const sorted = [...items].sort((a, b) => a.anchorTop - b.anchorTop);
    const result: CardEntry[] = [];

    for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        const idealTop = item.anchorTop;

        if (i === 0) {
            result.push({ id: item.id, anchorTop: idealTop, resolvedTop: idealTop, displaced: false });
            continue;
        }

        const prev = result[i - 1];
        const prevHeight = heights.get(prev.id) || ESTIMATED_CARD_HEIGHT;
        const minTop = prev.resolvedTop + prevHeight + MIN_GAP;

        const resolvedTop = Math.max(idealTop, minTop);
        result.push({
            id: item.id,
            anchorTop: idealTop,
            resolvedTop,
            displaced: Math.abs(resolvedTop - idealTop) > 2,
        });
    }
    return result;
}

/** Retorna iniciais de um nome (ex: "João Silva" → "JS"). */
function getInitials(name: string): string {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(w => w[0].toUpperCase())
        .join('');
}

/** Gera uma cor HSL determinística a partir de uma string. */
function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 55%, 45%)`;
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

function hasHeightMapChanged(
    prevHeights: Map<string, number>,
    nextHeights: Map<string, number>,
): boolean {
    if (prevHeights.size !== nextHeights.size) return true;

    for (const [id, height] of nextHeights) {
        if (prevHeights.get(id) !== height) {
            return true;
        }
    }

    return false;
}

// ── Componente ────────────────────────────────────────────────────────────

/**
 * Painel de comentários ao estilo Google Docs.
 *
 * Fica à direita do conteúdo NESH (dentro do mesmo scroll container).
 * Implementa algoritmo de anti-colisão: cards próximos são empurrados
 * para baixo com gap mínimo de 60px, mantendo uma linha conectora
 * até a posição original da âncora quando deslocados.
 */
export function CommentPanel({ pending, comments, onSubmit, onDismiss, onEdit, onDelete, currentUserId }: CommentPanelProps) {
    const [body, setBody] = useState('');
    const [isPrivate, setIsPrivate] = useState(false);
    const [loading, setLoading] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const [cardHeights, setCardHeights] = useState<Map<string, number>>(new Map());

    // ── Estado de edição inline ────────────────────────────────────────────
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editBody, setEditBody] = useState('');
    const [editLoading, setEditLoading] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    // Constrói lista unificada (pending + comments) e resolve posições
    const allItems = useMemo(() => {
        const items: { id: string; anchorTop: number }[] = [];
        if (pending) {
            items.push({ id: '__pending__', anchorTop: pending.anchorTop });
        }
        for (const c of comments) {
            items.push({ id: c.id, anchorTop: c.anchorTop });
        }
        return items;
    }, [pending, comments]);

    const measurementFingerprint = useMemo(() => {
        const ids = allItems.map(item => item.id).join('|');
        return `${ids}|editing:${editingId || ''}|delete:${confirmDeleteId || ''}`;
    }, [allItems, editingId, confirmDeleteId]);

    // Mede alturas reais dos cards apenas quando a estrutura relevante muda.
    useLayoutEffect(() => {
        let frameId = requestAnimationFrame(() => {
            const newHeights = new Map<string, number>();
            for (const [id, el] of cardRefs.current) {
                if (el) newHeights.set(id, el.offsetHeight);
            }
            // Só atualiza se mudou para evitar loop.
            setCardHeights(prev => (hasHeightMapChanged(prev, newHeights) ? newHeights : prev));
        });

        return () => {
            cancelAnimationFrame(frameId);
        };
    }, [measurementFingerprint]);

    const positions = useMemo(
        () => resolvePositions(allItems, cardHeights),
        [allItems, cardHeights],
    );

    const positionMap = useMemo(() => {
        const m = new Map<string, CardEntry>();
        for (const p of positions) m.set(p.id, p);
        return m;
    }, [positions]);

    // Ref callback para registrar cards
    const setCardRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
        if (el) {
            cardRefs.current.set(id, el);
        } else {
            cardRefs.current.delete(id);
        }
    }, []);

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
        if (e.key === 'Escape') {
            onDismiss();
        }
    }, [handleSubmit, onDismiss]);

    const handlePanelMouseDown = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
    }, []);

    const pendingPos = positionMap.get('__pending__');
    const commentPositions = comments.map(c => positionMap.get(c.id));

    return (
        <div className={styles.panel} onMouseDown={handlePanelMouseDown}>
            {/* Linhas conectoras para cards deslocados */}
            {positions.filter(p => p.displaced).map(p => (
                <div
                    key={`conn-${p.id}`}
                    className={styles.connector}
                    style={{
                        top: `${p.anchorTop}px`,
                        height: `${p.resolvedTop - p.anchorTop}px`,
                    }}
                />
            ))}

            {/* Formulário de novo comentário */}
            {pending && pendingPos && (
                <div
                    ref={setCardRef('__pending__')}
                    data-comment-card-id="__pending__"
                    className={`${styles.formCard} ${pendingPos.displaced ? styles.displaced : ''}`}
                    style={{ top: `${pendingPos.resolvedTop}px` }}
                >
                    <div className={styles.selectedPreview}>
                        <span className={styles.quoteBar} />
                        <p className={styles.quoteText} title={pending.selectedText}>
                            {pending.selectedText.length > 100
                                ? `${pending.selectedText.slice(0, 100)}…`
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
                        autoFocus
                        rows={3}
                        maxLength={4000}
                        aria-label="Texto do comentário"
                    />

                    <div className={styles.footer}>
                        <label className={styles.toggle}>
                            <input
                                type="checkbox"
                                checked={isPrivate}
                                onChange={e => setIsPrivate(e.target.checked)}
                                aria-label="Comentário privado"
                            />{' '}
                            Privado
                        </label>
                        <div className={styles.actions}>
                            <button className={styles.cancelBtn} onClick={onDismiss} type="button">
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

            {/* Comentários existentes */}
            {comments.map((comment, i) => {
                const pos = commentPositions[i];
                if (!pos) return null;

                const isOwner = currentUserId && comment.userId === currentUserId;
                const isEditing = editingId === comment.id;
                const isConfirmingDelete = confirmDeleteId === comment.id;

                return (
                    <div
                        key={comment.id}
                        ref={setCardRef(comment.id)}
                        data-comment-card-id={comment.id}
                        className={`${styles.commentCard} ${comment.isPrivate ? styles.private : ''} ${pos.displaced ? styles.displaced : ''}`}
                        style={{ top: `${pos.resolvedTop}px` }}
                        title={comment.isPrivate ? 'Comentário privado' : undefined}
                    >
                        {/* Header: Avatar + Nome + Data + Badge + Ações */}
                        <div className={styles.commentHeader}>
                            <div className={styles.authorInfo}>
                                {comment.userImageUrl ? (
                                    <img
                                        className={styles.avatar}
                                        src={comment.userImageUrl}
                                        alt={comment.userName}
                                        loading="lazy"
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
                                    <span className={styles.authorName}>{comment.userName || 'Usuário'}</span>
                                    <span className={styles.commentDate}>{formatDate(comment.createdAt)}</span>
                                </div>
                            </div>
                            <div className={styles.headerActions}>
                                <span className={styles.commentBadge}>
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
                                            aria-label="Editar comentário"
                                        >
                                            ✏️
                                        </button>
                                        <button
                                            className={styles.actionBtn}
                                            onClick={() => setConfirmDeleteId(comment.id)}
                                            title="Excluir"
                                            aria-label="Excluir comentário"
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Citação do trecho selecionado */}
                        <div className={styles.selectedPreview}>
                            <span className={styles.quoteBar} />
                            <p className={styles.quoteText} title={comment.selectedText}>
                                {comment.selectedText.length > 60
                                    ? `${comment.selectedText.slice(0, 60)}…`
                                    : comment.selectedText}
                            </p>
                        </div>

                        {/* Corpo do comentário — modo edição ou leitura */}
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
                                <div className={styles.actions}>
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
                                <div className={styles.actions}>
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
                                            if (onDelete) {
                                                void onDelete(comment.id);
                                            }
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
    );
}
