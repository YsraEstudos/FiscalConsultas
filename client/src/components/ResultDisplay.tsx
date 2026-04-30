import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useRobustScroll } from '../hooks/useRobustScroll';
import { debug } from '../utils/debug';
import styles from './ResultDisplay.module.css';
import type { SearchResultItem } from './TextSearchResults';
import { highlightTermInContainer, unwrapQueryHighlights } from './ResultDisplay/ResultHighlighter';
import { renderMarkupContent, resolveMarkupToRender } from './ResultDisplay/ResultMarkupRenderer';
import { ResultCodeView } from './ResultDisplay/ResultCodeView';
import { getNextVisibleAnchorId, navigateToResultTarget, resolveAutoScrollTargetReadiness, resolveAutoScrollCandidates, resolveNcmToScroll, scheduleActiveAnchorUpdate } from './ResultDisplay/ResultScrollResolver';
import { ResultTextView } from './ResultDisplay/ResultTextView';
import type { ResultDisplayProps } from './ResultDisplay/types';
import { useResultComments } from './ResultDisplay/useResultComments';
import { useResultCodeData } from './ResultDisplay/useResultCodeData';

export const ResultDisplay = React.memo(function ResultDisplay({
    data,
    mobileMenuOpen,
    onCloseMobileMenu,
    onToggleMobileMenu,
    isActive,
    tabId,
    initialScrollTop,
    onPersistScroll,
    latestTextQuery,
    isNewSearch,
    onConsumeNewSearch,
    onContentReady,
    onHydratedResults,
}: ResultDisplayProps) {
    const { sidebarPosition } = useSettings();
    const {
        userName,
        userImageUrl,
        isSignedIn,
        isLoading: isAuthLoading,
        userId,
        canUseRestrictedUi,
    } = useAuth();
    const containerRef = useRef<HTMLDivElement>(null);
    const latestScrollTopRef = useRef(initialScrollTop ?? 0);
    const hasScrollSnapshotRef = useRef(typeof initialScrollTop === 'number');
    const lastPersistedScrollRef = useRef<number | null>(null);
    const [isContentReady, setIsContentReady] = useState(false);
    const [isFullyRendered, setIsFullyRendered] = useState(false);
    const [isTargetReady, setIsTargetReady] = useState(false);
    const [activeTerm, setActiveTerm] = useState('');
    const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const containerId = `results-content-${tabId}`;
    const lastMarkupRef = useRef<string | null>(null);
    const lastHtmlRef = useRef<string | null>(null);
    const renderedMarkupKeyRef = useRef<string | null>(null);
    const activeAnchorIdRef = useRef<string | null>(null);
    const anchorRafRef = useRef<number | null>(null);
    const manualNavigationLockRef = useRef<{ anchorId: string; expiresAt: number } | null>(null);
    const onContentReadyRef = useRef(onContentReady);
    const onConsumeNewSearchRef = useRef(onConsumeNewSearch);
    const onPersistScrollRef = useRef(onPersistScroll);
    const hasConsumedNewSearchRef = useRef(false);
    const isActiveRef = useRef(isActive);
    const isNewSearchRef = useRef(isNewSearch);
    const hasRestoredInitialScrollRef = useRef(false);
    const toggleSidebar = useCallback(() => {
        if (window.innerWidth <= 1024) {
            if (onToggleMobileMenu) {
                onToggleMobileMenu();
            } else if (onCloseMobileMenu && mobileMenuOpen) {
                onCloseMobileMenu();
            }
            return;
        }
        setSidebarCollapsed((prev) => !prev);
    }, [mobileMenuOpen, onCloseMobileMenu, onToggleMobileMenu]);
    const commentsUi = useResultComments({
        containerRef,
        canUseRestrictedUi,
        isSignedIn,
        isAuthLoading,
        userName,
        userImageUrl,
        data,
        isContentReady,
    });
    const contentRef = commentsUi.contentRef;
    const {
        renderableCodeResults,
        shouldHydrateCodeResults,
        isHydratingCodeResults,
        missingChapterBodies,
        searchHighlighterQuery,
        findAnchorIdForQuery,
        getPosicaoAlvoFromResultados,
        getAnchorIdsFromResultados,
        ensureSectionAnchors,
    } = useResultCodeData({
        data,
        isActive,
        tabId,
        latestTextQuery,
        onHydratedResults,
    });
    const searchHighlighterOwnsScroll = data?.type === 'text' && !!searchHighlighterQuery;
    const consumeNewSearchKey = useMemo(
        () => `${tabId}|${isNewSearch ? '1' : '0'}|${data?.query ?? ''}|${data?.ncm ?? ''}|${latestTextQuery ?? ''}`,
        [data?.ncm, data?.query, isNewSearch, latestTextQuery, tabId],
    );

    const handleNavigate = useCallback((targetId: string) => {
        const container = containerRef.current;
        if (!container) return;

        if (navigateToResultTarget({
            container,
            targetId,
            manualNavigationLockRef,
            setActiveAnchorId,
        })) {
            return;
        }

        debug.warn('[Navigate] target not found:', targetId);
    }, []);

    const targetCandidates = useMemo(() => {
        if (!data) return null;

        const ncmToScroll = resolveNcmToScroll(data);
        if (!ncmToScroll) return null;

        return resolveAutoScrollCandidates(
            ncmToScroll,
            renderableCodeResults,
            findAnchorIdForQuery,
            getPosicaoAlvoFromResultados,
        );
    }, [data, findAnchorIdForQuery, getPosicaoAlvoFromResultados, renderableCodeResults]);

    const resolveTargetReadiness = useCallback((container: HTMLElement) => resolveAutoScrollTargetReadiness({
        container,
        renderableCodeResults,
        ensureSectionAnchors,
        getPosicaoAlvoFromResultados,
        dataNcm: data?.ncm,
        dataQuery: data?.query,
        targetCandidates: targetCandidates ?? [],
    }), [
        data?.ncm,
        data?.query,
        ensureSectionAnchors,
        getPosicaoAlvoFromResultados,
        renderableCodeResults,
        targetCandidates,
    ]);

    useEffect(() => {
        onConsumeNewSearchRef.current = onConsumeNewSearch;
    }, [onConsumeNewSearch]);
    useEffect(() => {
        onPersistScrollRef.current = onPersistScroll;
    }, [onPersistScroll]);
    useEffect(() => {
        hasConsumedNewSearchRef.current = false;
    }, [consumeNewSearchKey]);
    useEffect(() => {
        isActiveRef.current = isActive;
    }, [isActive]);
    useEffect(() => {
        isNewSearchRef.current = isNewSearch;
    }, [isNewSearch]);
    useEffect(() => {
        onContentReadyRef.current = onContentReady;
    }, [onContentReady]);
    useEffect(() => {
        activeAnchorIdRef.current = activeAnchorId;
    }, [activeAnchorId]);
    useEffect(() => {
        return () => {
            if (anchorRafRef.current !== null) {
                cancelAnimationFrame(anchorRafRef.current);
            }
        };
    }, []);
    useEffect(() => {
        if (isContentReady) {
            onContentReadyRef.current?.(tabId);
        }
    }, [isContentReady, tabId]);
    useEffect(() => {
        const normalizedLatestTextQuery = (latestTextQuery || '').trim();
        setActiveTerm((prev) => (prev === normalizedLatestTextQuery ? prev : normalizedLatestTextQuery));
    }, [latestTextQuery, data?.query, tabId]);

    const consumeNewSearchScroll = useCallback((scrollTop?: number, force = false) => {
        if (hasConsumedNewSearchRef.current) return;
        if (!force && (!isActiveRef.current || !isNewSearchRef.current)) return;
        hasConsumedNewSearchRef.current = true;
        onConsumeNewSearchRef.current(tabId, scrollTop);
    }, [tabId]);

    const handleAutoScrollComplete = useCallback((success?: boolean) => {
        if (!success) return;
        requestAnimationFrame(() => {
            if (!isActiveRef.current || !isNewSearchRef.current) return;
            const currentScroll = containerRef.current?.scrollTop || 0;
            consumeNewSearchScroll(currentScroll);
        });
    }, [consumeNewSearchScroll]);

    const handleHighlightScrollComplete = useCallback((scrollTop: number) => {
        if (!isActiveRef.current || !isNewSearchRef.current) return;
        consumeNewSearchScroll(scrollTop);
    }, [consumeNewSearchScroll]);

    const shouldAutoScroll = !!targetCandidates?.length
        && isActive
        && isNewSearch
        && isContentReady
        && !searchHighlighterOwnsScroll
        && isTargetReady;
    useRobustScroll({
        targetId: targetCandidates,
        shouldScroll: shouldAutoScroll,
        containerRef,
        onComplete: handleAutoScrollComplete,
        expectedTags: ['H1', 'H2', 'H3', 'H4', 'ARTICLE', 'SECTION', 'DIV'],
    });

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        const handleScroll = () => {
            const currentScroll = element.scrollTop;
            latestScrollTopRef.current = currentScroll;
            hasScrollSnapshotRef.current = true;

            if (!isActive) return;

            const persist = onPersistScrollRef.current;
            if (!persist) return;
            if (lastPersistedScrollRef.current === currentScroll) return;

            lastPersistedScrollRef.current = currentScroll;
            persist(tabId, currentScroll);
        };

        element.addEventListener('scroll', handleScroll, { passive: true });
        return () => element.removeEventListener('scroll', handleScroll);
    }, [data?.markdown, data?.type, isActive, renderableCodeResults, tabId]);

    useEffect(() => {
        if (isActive) return;

        const persist = onPersistScrollRef.current;
        if (!persist) return;
        if (!hasScrollSnapshotRef.current) return;

        const currentScroll = latestScrollTopRef.current;
        if (isNewSearchRef.current && !hasConsumedNewSearchRef.current) {
            consumeNewSearchScroll(currentScroll, true);
            return;
        }
        if (lastPersistedScrollRef.current === currentScroll) return;

        lastPersistedScrollRef.current = currentScroll;
        persist(tabId, currentScroll);
    }, [consumeNewSearchScroll, isActive, tabId]);

    useEffect(() => {
        if (!isActive || isNewSearch || !isContentReady) return;
        const element = containerRef.current;
        if (!element || typeof initialScrollTop !== 'number') return;

        const targetScrollTop = initialScrollTop;
        if (hasRestoredInitialScrollRef.current) return;
        if (Math.abs(element.scrollTop - targetScrollTop) < 1) return;

        let cancelled = false;
        let attempts = 0;
        let frameId = 0;
        const maxAttempts = 20;

        const tryRestore = () => {
            if (cancelled) return;

            const currentContainer = containerRef.current;
            if (!currentContainer) return;

            if (Math.abs(currentContainer.scrollTop - targetScrollTop) < 1) {
                latestScrollTopRef.current = targetScrollTop;
                hasScrollSnapshotRef.current = true;
                lastPersistedScrollRef.current = targetScrollTop;
                hasRestoredInitialScrollRef.current = true;
                return;
            }

            const hasScrollableContent = currentContainer.scrollHeight > currentContainer.clientHeight;
            if (!hasScrollableContent && attempts < maxAttempts) {
                attempts += 1;
                frameId = requestAnimationFrame(tryRestore);
                return;
            }

            currentContainer.scrollTop = targetScrollTop;
            latestScrollTopRef.current = targetScrollTop;
            hasScrollSnapshotRef.current = true;
            lastPersistedScrollRef.current = targetScrollTop;

            if (Math.abs(currentContainer.scrollTop - targetScrollTop) < 1) {
                hasRestoredInitialScrollRef.current = true;
                return;
            }

            if (attempts < maxAttempts) {
                attempts += 1;
                frameId = requestAnimationFrame(tryRestore);
                return;
            }

            hasRestoredInitialScrollRef.current = true;
        };

        frameId = requestAnimationFrame(tryRestore);

        return () => {
            cancelled = true;
            cancelAnimationFrame(frameId);
        };
    }, [initialScrollTop, isActive, isContentReady, isNewSearch]);

    useEffect(() => {
        if (!isActive) {
            hasRestoredInitialScrollRef.current = false;
        }
    }, [isActive]);

    useEffect(() => {
        if (data?.type === 'text') {
            renderedMarkupKeyRef.current = null;
            setIsContentReady(true);
            setIsFullyRendered(true);
            return;
        }
        if (!contentRef.current) return;

        const rawMarkdown = typeof data?.markdown === 'string' ? data.markdown.trim() : '';
        const markupToRender = resolveMarkupToRender(rawMarkdown, renderableCodeResults);

        if (!markupToRender) {
            if (shouldHydrateCodeResults && missingChapterBodies.length > 0) {
                renderedMarkupKeyRef.current = null;
                setIsContentReady(true);
                setIsFullyRendered(false);
                return;
            }
            contentRef.current.textContent = '';
            renderedMarkupKeyRef.current = null;
            setIsContentReady(true);
            setIsFullyRendered(true);
            return;
        }

        try {
            return renderMarkupContent({
                rawMarkdown,
                markupToRender,
                isActive,
                isContentReady,
                refs: {
                    contentRef,
                    renderedMarkupKeyRef,
                    lastMarkupRef,
                    lastHtmlRef,
                },
                setIsContentReady,
                setIsFullyRendered,
            });
        } catch (error) {
            console.error('Content render error:', error);
            if (contentRef.current) contentRef.current.textContent = 'Error rendering content.';
            renderedMarkupKeyRef.current = null;
            setIsContentReady(true);
            setIsFullyRendered(true);
        }
    }, [
        data?.markdown,
        data?.type,
        isActive,
        missingChapterBodies.length,
        renderableCodeResults,
        shouldHydrateCodeResults,
    ]);

    useEffect(() => {
        if (!isContentReady || !containerRef.current || !targetCandidates?.length) {
            setIsTargetReady(false);
            return;
        }

        let cancelled = false;
        let observer: MutationObserver | null = null;
        const container = containerRef.current;

        const syncReadiness = () => {
            const ready = resolveTargetReadiness(container);
            if (!cancelled) {
                setIsTargetReady(ready);
            }
            return ready;
        };

        if (syncReadiness()) {
            return () => {
                cancelled = true;
            };
        }

        if (!isFullyRendered) {
            observer = new MutationObserver(() => {
                if (syncReadiness()) {
                    observer?.disconnect();
                    observer = null;
                }
            });
            observer.observe(container, {
                childList: true,
                subtree: true,
            });
        }

        return () => {
            cancelled = true;
            observer?.disconnect();
        };
    }, [
        isContentReady,
        isFullyRendered,
        resolveTargetReadiness,
        targetCandidates,
    ]);

    useEffect(() => {
        if (!isContentReady || !renderableCodeResults || !containerRef.current) return;
        ensureSectionAnchors(renderableCodeResults, containerRef.current);
    }, [ensureSectionAnchors, isContentReady, renderableCodeResults]);

    useEffect(() => {
        const contentContainer = contentRef.current;
        if (!contentContainer || data?.type === 'text') return;

        unwrapQueryHighlights(contentContainer);

        if (!isActive || !isContentReady || !activeTerm || searchHighlighterQuery) {
            return () => {
                const current = contentRef.current;
                if (current) unwrapQueryHighlights(current);
            };
        }

        highlightTermInContainer(contentContainer, activeTerm);

        return () => {
            const current = contentRef.current;
            if (current) unwrapQueryHighlights(current);
        };
    }, [activeTerm, contentRef, data?.markdown, data?.type, isActive, isContentReady, searchHighlighterQuery, tabId]);

    useEffect(() => {
        if (!isActive || !isContentReady || !renderableCodeResults || !containerRef.current) return;

        const ids = getAnchorIdsFromResultados(renderableCodeResults);
        if (ids.length === 0) return;

        const elements = ids
            .map((id) => containerRef.current?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null)
            .filter(Boolean) as HTMLElement[];
        if (elements.length === 0) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const nextAnchorId = getNextVisibleAnchorId(entries);
                if (!nextAnchorId) return;

                const manualNavigationLock = manualNavigationLockRef.current;
                if (manualNavigationLock) {
                    const now = Date.now();
                    if (now < manualNavigationLock.expiresAt) {
                        if (nextAnchorId !== manualNavigationLock.anchorId) {
                            return;
                        }
                        manualNavigationLockRef.current = null;
                    } else {
                        manualNavigationLockRef.current = null;
                    }
                }

                scheduleActiveAnchorUpdate(nextAnchorId, activeAnchorIdRef, anchorRafRef, setActiveAnchorId);
            },
            {
                root: containerRef.current,
                rootMargin: '0px 0px -60% 0px',
                threshold: 0.1,
            },
        );

        elements.forEach((element) => observer.observe(element));
        return () => observer.disconnect();
    }, [getAnchorIdsFromResultados, isActive, isContentReady, renderableCodeResults]);

    if (!data) {
        return <p className={styles.emptyMessage}>Sem resultados para exibir.</p>;
    }

    if (data.type === 'text') {
        return (
            <ResultTextView
                containerId={containerId}
                containerRef={containerRef}
                results={(data.results as SearchResultItem[]) || null}
                query={latestTextQuery || data.query || ''}
            />
        );
    }

    return (
        <ResultCodeView
            containerId={containerId}
            containerRef={containerRef}
            mobileMenuOpen={mobileMenuOpen}
            onCloseMobileMenu={onCloseMobileMenu}
            isActive={isActive}
            latestQuery={latestTextQuery || data.query || data.ncm || ''}
            rawMarkdown={data.markdown}
            renderableCodeResults={renderableCodeResults}
            shouldHydrateCodeResults={shouldHydrateCodeResults}
            isHydratingCodeResults={isHydratingCodeResults}
            missingChapterBodies={missingChapterBodies}
            isContentReady={isContentReady}
            isFullyRendered={isFullyRendered}
            searchHighlighterQuery={searchHighlighterQuery}
            sidebarPosition={sidebarPosition}
            sidebarCollapsed={sidebarCollapsed}
            toggleSidebar={toggleSidebar}
            activeAnchorId={activeAnchorId}
            onNavigate={handleNavigate}
            onHighlightScrollComplete={handleHighlightScrollComplete}
            canUseRestrictedUi={canUseRestrictedUi}
            userId={userId}
            commentsUi={commentsUi}
        />
    );
});
