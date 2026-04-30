import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import toast from 'react-hot-toast';

import type { LocalComment, PendingCommentEntry } from '../CommentPanel';
import { useComments } from '../../hooks/useComments';
import { useTextSelection } from '../../hooks/useTextSelection';
import type { SelectionInfo } from '../../hooks/useTextSelection';

import type { ResultData } from './types';

type CommentMutation = (commentId: string, body: string) => Promise<void>;
type CommentRemoval = (commentId: string) => Promise<void>;

type UseResultCommentsArgs = {
    containerRef: RefObject<HTMLDivElement | null>;
    canUseRestrictedUi: boolean;
    isSignedIn: boolean;
    isAuthLoading: boolean;
    userName?: string | null;
    userImageUrl?: string | null;
    data: ResultData | null;
    isContentReady: boolean;
};

export type ResultCommentsUi = {
    contentRef: RefObject<HTMLDivElement | null>;
    commentsEnabled: boolean;
    toggleComments: () => void;
    selection: SelectionInfo | null;
    onPopoverMouseDown: () => void;
    pendingComment: PendingCommentEntry | null;
    localComments: LocalComment[];
    handleOpenComment: () => void;
    handleCommentSubmit: (body: string, isPrivate: boolean) => Promise<boolean>;
    handleDismissComment: () => void;
    editComment: CommentMutation;
    removeComment: CommentRemoval;
    drawerOpen: boolean;
    toggleDrawer: () => void;
};

/**
 * Centraliza o estado de comentários, seleção de texto e sincronização dos anchors.
 */
export function useResultComments({
    containerRef,
    canUseRestrictedUi,
    isSignedIn,
    isAuthLoading,
    userName,
    userImageUrl,
    data,
    isContentReady,
}: UseResultCommentsArgs): ResultCommentsUi {
    const [commentsEnabled, setCommentsEnabled] = useState(false);
    const [pendingComment, setPendingComment] = useState<PendingCommentEntry | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const commentedAnchorsLoadedRef = useRef(false);
    const { selection, clearSelection, onPopoverMouseDown } = useTextSelection(contentRef);
    const {
        comments: localComments,
        addComment,
        editComment,
        removeComment,
        commentedAnchors,
        loadCommentedAnchors,
        loadComments,
        resetFetchedAnchors,
    } = useComments();

    const toggleComments = useCallback(() => {
        if (!canUseRestrictedUi) return;
        if (isAuthLoading) {
            toast.error('Aguarde a autenticação carregar e tente novamente.');
            return;
        }
        if (!isSignedIn) {
            toast.error('Faça login para usar comentários.');
            return;
        }
        if (import.meta.env.DEV && typeof window !== 'undefined') {
            const host = window.location.hostname;
            const isLanHost = host !== 'localhost' && host !== '127.0.0.1';
            if (isLanHost) {
                toast.error('Comentários não estão disponíveis neste ambiente agora.');
                return;
            }
        }
        setCommentsEnabled((prev) => !prev);
    }, [canUseRestrictedUi, isAuthLoading, isSignedIn]);

    const toggleDrawer = useCallback(() => setDrawerOpen((prev) => !prev), []);

    const handleOpenComment = useCallback(() => {
        if (!selection?.anchorKey) {
            if (selection) toast.error('Selecione texto dentro de um elemento NCM para comentar.');
            return;
        }
        const container = containerRef.current;
        if (!selection || !container) return;

        const containerRect = container.getBoundingClientRect();
        const anchorTop = selection.rect.top - containerRect.top + container.scrollTop;
        setPendingComment({
            anchorTop,
            anchorKey: selection.anchorKey,
            selectedText: selection.text,
        });
        clearSelection();

        if (window.matchMedia('(max-width: 1280px)').matches) {
            setDrawerOpen(true);
        }
    }, [clearSelection, containerRef, selection]);

    const handleCommentSubmit = useCallback(async (body: string, isPrivate: boolean): Promise<boolean> => {
        if (!pendingComment) return false;
        const success = await addComment(
            pendingComment,
            body,
            isPrivate,
            userName || 'Usuário',
            userImageUrl || null,
        );
        if (success) {
            setPendingComment(null);
        }
        return success;
    }, [addComment, pendingComment, userImageUrl, userName]);

    const handleDismissComment = useCallback(() => {
        setPendingComment(null);
    }, []);

    useEffect(() => {
        if (canUseRestrictedUi) return;
        setCommentsEnabled(false);
        setPendingComment(null);
        setDrawerOpen(false);
    }, [canUseRestrictedUi]);

    useEffect(() => {
        if (!canUseRestrictedUi || !commentsEnabled) {
            commentedAnchorsLoadedRef.current = false;
            return;
        }

        if (!isSignedIn || isAuthLoading) return;
        if (commentedAnchorsLoadedRef.current) return;

        commentedAnchorsLoadedRef.current = true;
        void loadCommentedAnchors();
    }, [canUseRestrictedUi, commentsEnabled, isAuthLoading, isSignedIn, loadCommentedAnchors]);

    useEffect(() => {
        const container = contentRef.current;
        if (!container) return;

        container.querySelectorAll('.has-comment').forEach((element) => {
            element.classList.remove('has-comment');
        });

        if (!canUseRestrictedUi || !commentsEnabled || commentedAnchors.length === 0) return;

        commentedAnchors.forEach((anchorKey) => {
            const element = container.querySelector(`[id="${CSS.escape(anchorKey)}"]`);
            if (element) {
                element.classList.add('has-comment');
            }
        });
    }, [canUseRestrictedUi, commentsEnabled, commentedAnchors, isContentReady]);

    useEffect(() => {
        const container = contentRef.current;
        if (!container || !canUseRestrictedUi || !commentsEnabled) return;

        const handleHasCommentClick = (event: Event) => {
            const target = (event.target as HTMLElement).closest('.has-comment');
            if (!target) return;
            const anchorKey = target.id;
            if (!anchorKey) return;

            void loadComments(anchorKey, target.getBoundingClientRect().top);
            if (window.matchMedia('(max-width: 1280px)').matches) {
                setDrawerOpen(true);
            }
        };

        container.addEventListener('click', handleHasCommentClick);
        return () => container.removeEventListener('click', handleHasCommentClick);
    }, [canUseRestrictedUi, commentsEnabled, loadComments]);

    useEffect(() => {
        resetFetchedAnchors();
        commentedAnchorsLoadedRef.current = false;
    }, [data?.markdown, data?.ncm, data?.query, resetFetchedAnchors]);

    return {
        contentRef,
        commentsEnabled,
        toggleComments,
        selection,
        onPopoverMouseDown,
        pendingComment,
        localComments,
        handleOpenComment,
        handleCommentSubmit,
        handleDismissComment,
        editComment,
        removeComment,
        drawerOpen,
        toggleDrawer,
    };
}
