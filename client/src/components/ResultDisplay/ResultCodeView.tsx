import type React from 'react';

import { CommentDrawer } from '../CommentDrawer';
import { CommentPanel } from '../CommentPanel';
import { HighlightPopover } from '../HighlightPopover';
import styles from '../ResultDisplay.module.css';
import { SearchHighlighter } from '../SearchHighlighter';
import { Sidebar } from '../Sidebar';

import { isTipiResults } from './ResultTipiFallback';
import {
    getCommentToggleClassName,
    getCommentToggleLabel,
    getContentVisibilityClass,
    getSidebarToggleIcon,
    getSidebarToggleLabel,
    getWrapperClasses,
} from './ResultScrollResolver';
import type { ResultRecord } from './types';
import type { ResultCommentsUi } from './useResultComments';

const CONTENT_STACK_STYLE = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
} as const;

type ResultCodeViewProps = {
    containerId: string;
    containerRef: React.RefObject<HTMLDivElement | null>;
    mobileMenuOpen: boolean;
    onCloseMobileMenu: () => void;
    isActive: boolean;
    latestQuery: string;
    rawMarkdown?: string;
    renderableCodeResults: ResultRecord | null;
    shouldHydrateCodeResults: boolean;
    isHydratingCodeResults: boolean;
    missingChapterBodies: string[];
    isContentReady: boolean;
    isFullyRendered: boolean;
    searchHighlighterQuery: string | null;
    sidebarPosition: 'left' | 'right';
    sidebarCollapsed: boolean;
    toggleSidebar: () => void;
    activeAnchorId: string | null;
    onNavigate: (targetId: string) => void;
    onHighlightScrollComplete: (scrollTop: number) => void;
    canUseRestrictedUi: boolean;
    userId?: string | null;
    commentsUi: ResultCommentsUi;
};

export function ResultCodeView({
    containerId,
    containerRef,
    mobileMenuOpen,
    onCloseMobileMenu,
    isActive,
    latestQuery,
    rawMarkdown,
    renderableCodeResults,
    shouldHydrateCodeResults,
    isHydratingCodeResults,
    missingChapterBodies,
    isContentReady,
    isFullyRendered,
    searchHighlighterQuery,
    sidebarPosition,
    sidebarCollapsed,
    toggleSidebar,
    activeAnchorId,
    onNavigate,
    onHighlightScrollComplete,
    canUseRestrictedUi,
    userId,
    commentsUi,
}: ResultCodeViewProps) {
    const wrapperClasses = getWrapperClasses(styles, sidebarCollapsed, mobileMenuOpen, sidebarPosition);
    const sidebarToggleLabel = getSidebarToggleLabel(sidebarCollapsed);
    const sidebarToggleIcon = getSidebarToggleIcon(sidebarPosition, sidebarCollapsed);
    const contentVisibilityClass = getContentVisibilityClass(styles, isContentReady);
    const commentToggleLabel = getCommentToggleLabel(commentsUi.commentsEnabled);
    const commentToggleClasses = getCommentToggleClassName(styles, commentsUi.commentsEnabled);
    const shouldRenderSidebar = isActive && !!renderableCodeResults;

    return (
        <div className={wrapperClasses}>
            <button
                className={styles.sidebarToggle}
                onClick={toggleSidebar}
                aria-label={sidebarToggleLabel}
            >
                {sidebarToggleIcon}
            </button>

            <div
                className={`${styles.content} ${contentVisibilityClass} markdown-body`}
                ref={containerRef}
                id={containerId}
            >
                <div style={CONTENT_STACK_STYLE}>
                    {shouldHydrateCodeResults && (isHydratingCodeResults || missingChapterBodies.length > 0) && (
                        <div className={styles.loadingSpinnerContainer}>
                            <svg className={styles.spinner} viewBox="0 0 50 50">
                                <circle className={styles.spinnerPath} cx="25" cy="25" r="20" fill="none" strokeWidth="5" />
                            </svg>
                            <p className={styles.loadingText}>Carregando conteúdo detalhado...</p>
                        </div>
                    )}
                    {!shouldHydrateCodeResults && !rawMarkdown && !isTipiResults(renderableCodeResults || null) && (
                        <p>Sem resultados para exibir.</p>
                    )}
                    <div className={styles.contentText} ref={commentsUi.contentRef} />
                </div>

                {canUseRestrictedUi && commentsUi.commentsEnabled && (
                    <CommentPanel
                        pending={commentsUi.pendingComment}
                        comments={commentsUi.localComments}
                        onSubmit={commentsUi.handleCommentSubmit}
                        onDismiss={commentsUi.handleDismissComment}
                        onEdit={commentsUi.editComment}
                        onDelete={commentsUi.removeComment}
                        currentUserId={userId}
                    />
                )}
            </div>

            {searchHighlighterQuery && (
                <SearchHighlighter
                    query={searchHighlighterQuery}
                    contentContainerRef={commentsUi.contentRef}
                    isContentReady={isContentReady}
                    isFullyRendered={isFullyRendered}
                    onHighlightScrollComplete={onHighlightScrollComplete}
                />
            )}

            {canUseRestrictedUi && (
                <button
                    className={commentToggleClasses}
                    onClick={commentsUi.toggleComments}
                    aria-label={commentToggleLabel}
                    title={commentToggleLabel}
                >
                    💬
                </button>
            )}

            {canUseRestrictedUi && commentsUi.commentsEnabled && commentsUi.selection && (
                <HighlightPopover
                    selection={commentsUi.selection}
                    onRequestComment={commentsUi.handleOpenComment}
                    onPopoverMouseDown={commentsUi.onPopoverMouseDown}
                />
            )}

            {canUseRestrictedUi && commentsUi.commentsEnabled && (
                <CommentDrawer
                    open={commentsUi.drawerOpen}
                    onClose={commentsUi.toggleDrawer}
                    pending={commentsUi.pendingComment}
                    comments={commentsUi.localComments}
                    onSubmit={commentsUi.handleCommentSubmit}
                    onDismiss={commentsUi.handleDismissComment}
                    onEdit={commentsUi.editComment}
                    onDelete={commentsUi.removeComment}
                    currentUserId={userId}
                />
            )}

            {shouldRenderSidebar && (
                <div
                    className={`${styles.mobileOverlay || ''} ${mobileMenuOpen ? (styles.mobileOverlayOpen || '') : ''}`}
                    onClick={onCloseMobileMenu}
                    aria-hidden="true"
                />
            )}

            {shouldRenderSidebar && (
                <div className={styles.sidebarContainer}>
                    <Sidebar
                        results={renderableCodeResults}
                        onNavigate={onNavigate}
                        onClose={onCloseMobileMenu}
                        searchQuery={latestQuery}
                        activeAnchorId={activeAnchorId}
                    />
                </div>
            )}
        </div>
    );
}
