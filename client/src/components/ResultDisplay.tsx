import { TextSearchResults } from './TextSearchResults';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useRobustScroll } from '../hooks/useRobustScroll';
import { generateAnchorId } from '../utils/id_utils';
import { SearchResultItem } from './TextSearchResults';
import styles from './ResultDisplay.module.css';
import { debug } from '../utils/debug';
import { NeshRenderer } from '../utils/NeshRenderer';
import { useSettings } from '../context/SettingsContext';
import { Sidebar } from './Sidebar';

const sanitizeHtml = (html: string) => DOMPurify.sanitize(html, {
    ALLOW_DATA_ATTR: true,
    ADD_ATTR: ['data-ncm', 'data-note', 'data-chapter', 'aria-label', 'data-tooltip', 'role', 'tabindex']
});

const LEGACY_MARKDOWN_PATTERN = /(^|\n)\s{0,3}(?:#{1,6}\s|>\s|[-*+]\s|\d+\.\s|---+\s*$)|\*\*[^*\n]+?\*\*/m;

const isLikelyLegacyMarkdown = (value: string) => LEGACY_MARKDOWN_PATTERN.test(value);

const SHARED_MARKUP_CACHE_MAX = 12;
const sharedRawMarkupCache = new Map<string, string>();
const sharedSanitizedMarkupCache = new Map<string, string>();

function cacheGet(map: Map<string, string>, key: string): string | null {
    const value = map.get(key);
    if (value === undefined) return null;
    map.delete(key);
    map.set(key, value);
    return value;
}

function cacheSet(map: Map<string, string>, key: string, value: string) {
    if (map.has(key)) {
        map.delete(key);
    } else if (map.size >= SHARED_MARKUP_CACHE_MAX) {
        const oldestKey = map.keys().next().value as string | undefined;
        if (oldestKey !== undefined) {
            map.delete(oldestKey);
        }
    }
    map.set(key, value);
}


const getAliquotClass = (aliquota: string) => {
    const normalized = (aliquota || '').toString().trim().toUpperCase();
    if (!normalized || normalized === '0' || normalized === '0%') {
        return { className: 'aliquot-zero', tooltip: 'Isento de IPI', display: normalized || '0%' };
    }
    if (normalized === 'NT') {
        return { className: 'aliquot-nt', tooltip: 'Não Tributável', display: 'NT' };
    }

    const numeric = Number(normalized.replace('%', '').replace(',', '.'));
    if (!Number.isNaN(numeric)) {
        if (numeric <= 5) {
            return { className: 'aliquot-low', tooltip: 'Alíquota Reduzida (1-5%)', display: `${numeric}%` };
        }
        if (numeric <= 10) {
            return { className: 'aliquot-med', tooltip: 'Alíquota Média (6-10%)', display: `${numeric}%` };
        }
        return { className: 'aliquot-high', tooltip: 'Alíquota Elevada (>10%)', display: `${numeric}%` };
    }

    return { className: 'aliquot-zero', tooltip: 'Isento de IPI', display: normalized };
};

const isTipiResults = (resultados: Record<string, any> | null | undefined) => {
    if (!resultados || typeof resultados !== 'object') return false;
    const chapters = Object.values(resultados);
    return chapters.some((chapter) =>
        Array.isArray(chapter?.posicoes) && chapter.posicoes.some((pos: any) => 'aliquota' in pos || 'nivel' in pos)
    );
};

const renderTipiFallback = (resultados: Record<string, any>) => {
    const chapters = Object.values(resultados)
        .sort((a: any, b: any) => parseInt(a?.capitulo || '0', 10) - parseInt(b?.capitulo || '0', 10));

    return chapters.map((chapter: any) => {
        const capitulo = chapter?.capitulo || '';
        const titulo = chapter?.titulo || `Capítulo ${capitulo}`;
        const posicoes = Array.isArray(chapter?.posicoes) ? chapter.posicoes : [];

        const positionsHtml = posicoes.map((pos: any) => {
            const codigo = pos?.codigo || pos?.ncm || '';
            const ncm = pos?.ncm || codigo;
            const descricao = pos?.descricao || '';
            const nivel = typeof pos?.nivel === 'number' ? pos.nivel : 1;
            const indentClass = `tipi-nivel-${Math.min(nivel, 5)}`;
            const { className, tooltip, display } = getAliquotClass(pos?.aliquota);
            const elementId = generateAnchorId(codigo);

            return `
<article class="tipi-position ${indentClass}" id="${elementId}" data-ncm="${ncm}" aria-label="NCM ${codigo}">
    <span class="tipi-ncm smart-link" data-ncm="${ncm}" role="link" tabindex="0">${codigo}</span>
    <span class="tipi-desc">${descricao}</span>
    <span class="tipi-aliquota ${className}" data-tooltip="${tooltip}" aria-label="${tooltip}">${display}</span>
</article>`;
        }).join('');

        return `
<div class="tipi-chapter" id="cap-${capitulo}">
    <h2 class="tipi-chapter-header">
        <span class="tipi-cap-badge">${capitulo}</span>
        ${titulo}
    </h2>
    <div class="tipi-positions">
        ${positionsHtml}
    </div>
</div>`;
    }).join('\n');
};

interface ResultData {
    type?: 'text' | 'code';
    markdown?: string;
    ncm?: string;
    query?: string;
    results?: SearchResultItem[] | Record<string, any>;
    resultados?: any; // Complex object passed to Sidebar
}

interface ResultDisplayProps {
    data: ResultData | null;
    mobileMenuOpen: boolean;
    onCloseMobileMenu: () => void;
    isActive: boolean;
    tabId: string;
    initialScrollTop?: number;
    onPersistScroll?: (tabId: string, scrollTop: number) => void;
    /** Flag indicando nova busca - ativa auto-scroll */
    isNewSearch: boolean;
    /** Callback para consumir flag após auto-scroll, recebendo opcionalmente o scroll final */
    onConsumeNewSearch: (tabId: string, finalScrollTop?: number) => void;
    /** Callback to notify parent when content is ready (for coordinated loading) */
    onContentReady?: (tabId: string) => void;
}

export const ResultDisplay = React.memo(function ResultDisplay({
    data,
    mobileMenuOpen,
    onCloseMobileMenu,
    isActive,
    tabId,
    initialScrollTop,
    onPersistScroll,
    isNewSearch,
    onConsumeNewSearch,
    onContentReady
}: ResultDisplayProps) {
    const { sidebarPosition } = useSettings();
    const containerRef = useRef<HTMLDivElement>(null);
    const [targetId, setTargetId] = useState<string | string[] | null>(null);
    const latestScrollTopRef = useRef(0);
    const lastPersistedScrollRef = useRef<number | null>(null);
    const [isContentReady, setIsContentReady] = useState(false);
    const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
    const containerId = `results-content-${tabId}`;
    const lastMarkupRef = useRef<string | null>(null);
    const lastHtmlRef = useRef<string | null>(null);
    const renderedMarkupKeyRef = useRef<string | null>(null);
    const activeAnchorIdRef = useRef<string | null>(null);
    const anchorRafRef = useRef<number | null>(null);
    const onContentReadyRef = useRef(onContentReady);

    // Sidebar collapsed state for lateral layout
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const toggleSidebar = useCallback(() => setSidebarCollapsed(prev => !prev), []);
    const codeResults = useMemo(() => {
        if (!data || data.type === 'text') return null;
        if (data.resultados && typeof data.resultados === 'object') {
            return data.resultados as Record<string, any>;
        }
        if (data.results && !Array.isArray(data.results) && typeof data.results === 'object') {
            return data.results as Record<string, any>;
        }
        return null;
    }, [data?.type, data?.resultados, data?.results]);

    const findAnchorIdForQuery = useCallback((resultados: any, query: string) => {
        if (!resultados || typeof resultados !== 'object') return null;

        const normalizedQuery = query.replace(/\D/g, '');
        if (!normalizedQuery) return null;

        const chapters = Object.values(resultados) as any[];
        let exactMatch: string | null = null;
        let prefixMatch: string | null = null;

        for (const chapter of chapters) {
            const positions = Array.isArray(chapter?.posicoes) ? chapter.posicoes : [];
            for (const pos of positions) {
                const codigo = (pos?.codigo || pos?.ncm || '').toString();
                if (!codigo) continue;
                const normalizedCodigo = codigo.replace(/\D/g, '');

                // Exact match has priority
                if (normalizedCodigo === normalizedQuery) {
                    exactMatch = pos?.anchor_id || generateAnchorId(codigo);
                    break; // Found exact, stop searching
                }

                // Prefix match as fallback (first one wins)
                if (!prefixMatch && normalizedCodigo && normalizedCodigo.startsWith(normalizedQuery)) {
                    prefixMatch = pos?.anchor_id || generateAnchorId(codigo);
                }
            }
            if (exactMatch) break; // Exit outer loop too
        }

        return exactMatch || prefixMatch;
    }, []);

    const getPosicaoAlvoFromResultados = useCallback((resultados: any) => {
        if (!resultados || typeof resultados !== 'object') return null as string | null;
        const chapters = Object.values(resultados) as any[];
        if (chapters.length !== 1) return null;
        const posicaoAlvo = (chapters[0]?.posicao_alvo || chapters[0]?.posicaoAlvo || '').toString().trim();
        return posicaoAlvo || null;
    }, []);

    const getAnchorIdsFromResultados = useCallback((resultados: any) => {
        if (!resultados || typeof resultados !== 'object') return [] as string[];

        const ids: string[] = [];
        const chapters = Object.values(resultados) as any[];
        for (const chapter of chapters) {
            const positions = Array.isArray(chapter?.posicoes) ? chapter.posicoes : [];
            for (const pos of positions) {
                const codigo = (pos?.codigo || pos?.ncm || '').toString();
                if (!codigo) continue;
                ids.push(pos?.anchor_id || generateAnchorId(codigo));
            }
        }
        return ids;
    }, []);

    // Sidebar Navigation Handler
    const handleNavigate = useCallback((targetId: string) => {
        const container = containerRef.current;
        if (!container) return;

        // Try direct ID first (backend should provide correct anchor_id)
        let element = container.querySelector(`#${CSS.escape(targetId)}`) as HTMLElement | null;

        // Fallback: generate anchor ID from codigo (e.g., "84.13" -> "pos-84-13")
        if (!element) {
            const generatedId = generateAnchorId(targetId);
            element = container.querySelector(`#${CSS.escape(generatedId)}`) as HTMLElement | null;
        }

        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            element.classList.add('flash-highlight');
            setTimeout(() => element.classList.remove('flash-highlight'), 2000);
        } else {
            debug.warn('[Navigate] target not found:', targetId);
        }
    }, []); // Empty dependency array as it only uses refs or DOM APIs

    // Calculate Target ID for Auto-Scroll
    useEffect(() => {
        if (!data) return;

        let ncmToScroll: string | null = null;

        // 1. Explicit NCM from backend or query
        if (data.ncm || data.query) {
            ncmToScroll = data.ncm || data.query || null;
        }

        if (ncmToScroll) {
            const posicaoAlvo = codeResults ? getPosicaoAlvoFromResultados(codeResults) : null;
            const anchorFromResultados = codeResults ? findAnchorIdForQuery(codeResults, ncmToScroll) : null;
            const exactId = anchorFromResultados || (posicaoAlvo ? generateAnchorId(posicaoAlvo) : null) || generateAnchorId(ncmToScroll);
            const candidates = [exactId];

            // Secondary: If input is raw digits, also try formatted variations
            const digits = ncmToScroll.replace(/\D/g, '');
            // Always generate fallback candidates for partial matches
            if (digits.length >= 4) {
                const head4 = digits.slice(0, 4);
                // 8517 -> pos-85-17 (Common NESH anchor)
                candidates.push(`pos-${head4.slice(0, 2)}-${head4.slice(2)}`);
                // 8517 -> pos-8517 (Alternate)
                candidates.push(`pos-${head4}`);

                if (digits.length >= 6) {
                    // 851710 -> pos-8517-10
                    candidates.push(`pos-${digits.slice(0, 4)}-${digits.slice(4, 6)}`);
                }

                if (digits.length >= 8) {
                    // 85171000 -> pos-8517-10-00
                    candidates.push(`pos-${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`);
                }
            }

            // Prevent infinite loop: Only update if targets actually changed
            setTargetId(prev => {
                const prevArray = Array.isArray(prev) ? prev : (prev ? [prev] : []);
                const newArray = Array.from(new Set(candidates));

                if (prevArray.length === newArray.length &&
                    prevArray.every((val, i) => val === newArray[i])) {
                    return prev;
                }
                return newArray;
            });
        } else {
            setTargetId(prev => prev ? null : prev);
        }
    }, [codeResults, data, findAnchorIdForQuery, getPosicaoAlvoFromResultados]);

    // Stabilize onConsumeNewSearch callback to prevent AutoScroll effect loop
    const onConsumeNewSearchRef = useRef(onConsumeNewSearch);
    useEffect(() => {
        onConsumeNewSearchRef.current = onConsumeNewSearch;
    }, [onConsumeNewSearch]);

    const onPersistScrollRef = useRef(onPersistScroll);
    useEffect(() => {
        onPersistScrollRef.current = onPersistScroll;
    }, [onPersistScroll]);
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

    const handleAutoScrollComplete = useCallback((success?: boolean) => {
        if (!success) return;
        // Wrap in RAF to ensure DOM has updated/painted the scroll action
        // before we capture the final position and update app state.
        requestAnimationFrame(() => {
            const currentScroll = containerRef.current?.scrollTop || 0;
            onConsumeNewSearchRef.current(tabId, currentScroll);
        });
    }, [tabId]); // Empty deps = stable reference

    // Hook handles the heavy lifting (MutationObserver, retries, etc)
    // Only auto-scroll when:
    // 1. Tab is active
    // 2. This is a NEW search (not returning to existing tab)
    const shouldAutoScroll = !!targetId && isActive && isNewSearch && isContentReady && data?.type !== 'text';
    useRobustScroll({
        targetId,
        shouldScroll: shouldAutoScroll,
        containerRef,
        onComplete: handleAutoScrollComplete,
        expectedTags: ['H1', 'H2', 'H3', 'H4', 'ARTICLE', 'SECTION', 'DIV']
    });

    // Track scroll position for persistence
    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        const handleScroll = () => {
            latestScrollTopRef.current = element.scrollTop;
        };

        element.addEventListener('scroll', handleScroll, { passive: true });
        return () => element.removeEventListener('scroll', handleScroll);
    }, [codeResults, data?.type, data?.markdown]);

    // Persist scroll when tab becomes inactive
    useEffect(() => {
        if (isActive) return;
        const persist = onPersistScrollRef.current;
        if (!persist) return;

        const currentScroll = latestScrollTopRef.current;
        if (lastPersistedScrollRef.current === currentScroll) return;

        lastPersistedScrollRef.current = currentScroll;
        persist(tabId, currentScroll);
    }, [isActive, tabId]);



    // Restore scroll when tab becomes active (only if NOT a new search)
    useEffect(() => {
        // Skip restore if this is a new search - auto-scroll will handle positioning
        if (!isActive || isNewSearch) return;
        const element = containerRef.current;
        if (!element) return;

        if (typeof initialScrollTop !== 'number') return;
        const targetScrollTop = initialScrollTop;

        if (Math.abs(element.scrollTop - targetScrollTop) < 1) return;

        requestAnimationFrame(() => {
            if (!containerRef.current) return;
            containerRef.current.scrollTop = targetScrollTop;
            latestScrollTopRef.current = targetScrollTop;
        });
    }, [codeResults, isActive, initialScrollTop, isNewSearch, data?.type, data?.markdown]);



    // Render backend content (prefer HTML; parse markdown only as legacy fallback)
    useEffect(() => {
        if (data?.type === 'text') {
            renderedMarkupKeyRef.current = null;
            setIsContentReady(true);
            return;
        }
        if (!containerRef.current) return;

        const rawMarkdown = typeof data?.markdown === 'string' ? data.markdown.trim() : '';
        const isTipi = isTipiResults(codeResults || null);

        // Determine markup to render with fallbacks
        let markupToRender = rawMarkdown;

        if (!markupToRender) {
            if (isTipi && codeResults) {
                // TIPI fallback rendering
                markupToRender = renderTipiFallback(codeResults);
            } else if (codeResults) {
                // NESH client-side rendering
                console.warn('[ResultDisplay] Fallback NeshRenderer used - backend should send markdown');
                markupToRender = NeshRenderer.renderFullResponse(codeResults);
            }
        }

        if (!markupToRender) {
            containerRef.current.innerHTML = '';
            renderedMarkupKeyRef.current = null;
            setIsContentReady(true);
            return;
        }

        try {
            const shouldParseMarkdown = !!rawMarkdown && isLikelyLegacyMarkdown(markupToRender);
            const cacheKey = `${shouldParseMarkdown ? 'md' : 'html'}:${markupToRender}`;
            const container = containerRef.current;
            const isAlreadyRendered = renderedMarkupKeyRef.current === cacheKey && container.childNodes.length > 0;

            if (isAlreadyRendered) {
                if (!isContentReady) {
                    setIsContentReady(true);
                }
                return;
            }

            if (!isActive && !isAlreadyRendered) {
                // Clear stale markup for this tab until it is activated.
                container.innerHTML = '';
                setIsContentReady(false);
                return;
            }

            setIsContentReady(false);

            let rawMarkup = cacheGet(sharedRawMarkupCache, cacheKey);
            if (!rawMarkup) {
                if (lastMarkupRef.current === cacheKey && lastHtmlRef.current) {
                    rawMarkup = lastHtmlRef.current;
                } else {
                    // Legacy compatibility: parse markdown only when markdown tokens are detected.
                    // Primary path expects backend pure HTML.
                    // @ts-ignore - marked types might mismatch slightly depending on version
                    rawMarkup = shouldParseMarkdown ? (marked.parse(markupToRender) as string) : markupToRender;
                }
                // Legacy compatibility: parse markdown only when markdown tokens are detected.
                // Primary path expects backend pure HTML.
                cacheSet(sharedRawMarkupCache, cacheKey, rawMarkup);
            }
            lastMarkupRef.current = cacheKey;
            lastHtmlRef.current = rawMarkup;

            // Performance: Skip DOMPurify for trusted backend HTML (saves ~800ms on large NESH chapters).
            // Only sanitize for fallback client-rendered content (NeshRenderer / renderTipiFallback).
            let finalMarkup: string;
            if (rawMarkdown) {
                // Backend-served HTML: already safe from HtmlRenderer/TipiRenderer
                finalMarkup = rawMarkup;
            } else {
                // Fallback client-rendered: sanitize for safety
                let sanitizedMarkup = cacheGet(sharedSanitizedMarkupCache, cacheKey);
                if (!sanitizedMarkup) {
                    sanitizedMarkup = sanitizeHtml(rawMarkup);
                    cacheSet(sharedSanitizedMarkupCache, cacheKey, sanitizedMarkup);
                }
                finalMarkup = sanitizedMarkup;
            }

            // ---------------------------------------------------------------
            // Chunked rendering: split HTML at <hr> boundaries (chapter-level)
            // to avoid a single massive DOM insertion that causes forced reflow.
            // First chunk is rendered immediately for fast first paint; remaining
            // chunks are queued via requestIdleCallback / setTimeout fallback.
            // ---------------------------------------------------------------
            const CHUNK_SIZE_THRESHOLD = 50_000; // Only chunk if > 50KB
            const htmlLength = finalMarkup.length;

            if (htmlLength <= CHUNK_SIZE_THRESHOLD) {
                // Small payload: render in one shot (TIPI, small chapters)
                const frameId = requestAnimationFrame(() => {
                    if (!containerRef.current || containerRef.current !== container) return;
                    const template = document.createElement('template');
                    template.innerHTML = finalMarkup;
                    containerRef.current.replaceChildren(template.content);
                    renderedMarkupKeyRef.current = cacheKey;
                    setIsContentReady(true);
                });
                return () => cancelAnimationFrame(frameId);
            }

            // Large payload: split at <hr> tags (chapter boundaries)
            const chunks = finalMarkup.split(/(?=<hr\s*\/?>)/i);
            const pendingIdleIds: number[] = [];
            let cancelled = false;

            const frameId = requestAnimationFrame(() => {
                if (cancelled || !containerRef.current || containerRef.current !== container) return;

                // Clear previous content and insert first chunk immediately
                container.textContent = '';
                if (chunks.length > 0) {
                    const template = document.createElement('template');
                    template.innerHTML = chunks[0];
                    container.appendChild(template.content);
                }

                renderedMarkupKeyRef.current = cacheKey;
                // Signal contentReady after the first chunk so auto-scroll can begin
                setIsContentReady(true);

                // Queue remaining chunks via requestIdleCallback
                const enqueueChunk = (index: number) => {
                    if (index >= chunks.length) return;

                    const scheduleFn = typeof requestIdleCallback === 'function'
                        ? (cb: () => void) => requestIdleCallback(cb, { timeout: 100 })
                        : (cb: () => void) => setTimeout(cb, 16) as unknown as number;

                    const idleId = scheduleFn(() => {
                        if (cancelled || !containerRef.current || containerRef.current !== container) return;
                        const template = document.createElement('template');
                        template.innerHTML = chunks[index];
                        containerRef.current.appendChild(template.content);
                        enqueueChunk(index + 1);
                    });
                    pendingIdleIds.push(idleId as number);
                };

                enqueueChunk(1);
            });

            return () => {
                cancelled = true;
                cancelAnimationFrame(frameId);
                const cancelIdle = typeof cancelIdleCallback === 'function'
                    ? cancelIdleCallback
                    : (id: number) => clearTimeout(id);
                pendingIdleIds.forEach(id => cancelIdle(id));
            };


        } catch (e) {
            console.error("Content render error:", e);
            containerRef.current.innerText = "Error rendering content.";
            renderedMarkupKeyRef.current = null;
            setIsContentReady(true);
        }
    }, [codeResults, data?.type, data?.markdown, isActive]);

    // Ensure target anchor exists by using data-ncm as fallback
    useEffect(() => {
        if (!isContentReady || !containerRef.current || !targetId) return;

        const targets = Array.isArray(targetId) ? targetId : [targetId];
        const existing = targets.some(id => containerRef.current?.querySelector(`#${CSS.escape(id)}`));
        if (existing) return;

        const posicaoAlvo = codeResults ? getPosicaoAlvoFromResultados(codeResults) : null;
        const candidateNcm = posicaoAlvo || (data?.ncm || data?.query || '');
        if (!candidateNcm) return;

        const normalizedPos = candidateNcm.replace(/\D/g, '');
        const formattedPos = normalizedPos.length >= 4
            ? `${normalizedPos.slice(0, 2)}.${normalizedPos.slice(2, 4)}`
            : candidateNcm;

        const byDataNcm = containerRef.current.querySelector(`[data-ncm="${formattedPos}"]`) as HTMLElement | null;
        if (byDataNcm) {
            const id = generateAnchorId(formattedPos);
            if (!byDataNcm.id) {
                byDataNcm.id = id;
            }
            setTargetId(id);
        }
    }, [codeResults, data?.ncm, data?.query, getPosicaoAlvoFromResultados, isContentReady, targetId]);

    // Sync Sidebar to current visible anchor
    useEffect(() => {
        if (!isActive || !isContentReady || !codeResults || !containerRef.current) return;

        const ids = getAnchorIdsFromResultados(codeResults);
        if (ids.length === 0) return;

        const elements = ids
            .map(id => containerRef.current?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null)
            .filter(Boolean) as HTMLElement[];

        if (elements.length === 0) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter(entry => entry.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

                const nextAnchorId = visible[0]?.target?.id;
                if (!nextAnchorId || nextAnchorId === activeAnchorIdRef.current) {
                    return;
                }

                if (anchorRafRef.current !== null) {
                    cancelAnimationFrame(anchorRafRef.current);
                }
                anchorRafRef.current = requestAnimationFrame(() => {
                    anchorRafRef.current = null;
                    setActiveAnchorId(prev => (prev === nextAnchorId ? prev : nextAnchorId));
                });
            },
            {
                root: containerRef.current,
                rootMargin: '0px 0px -60% 0px',
                threshold: 0.1
            }
        );

        elements.forEach(el => observer.observe(el));

        return () => observer.disconnect();
    }, [codeResults, getAnchorIdsFromResultados, isActive, isContentReady]);


    if (!data) {
        return <p className={styles.emptyMessage}>Sem resultados para exibir.</p>;
    }

    // Text Search Rendering
    if (data.type === 'text') {
        return (
            <div className={styles.content} ref={containerRef} id={containerId}>
                <TextSearchResults
                    results={(data.results as SearchResultItem[]) || null}
                    query={data.query || ""}
                    onResultClick={(ncm: string) => window.nesh.smartLinkSearch(ncm)}
                    scrollParentRef={containerRef}
                />
            </div>
        );
    }

    // Default: Code View (Markdown + Sidebar)
    // Layout: Grid with content and sidebar (position from settings)
    const wrapperClasses = [
        styles.wrapper,
        sidebarCollapsed ? styles.sidebarCollapsed : '',
        mobileMenuOpen ? styles.sidebarOpen : '',
        sidebarPosition === 'left' ? styles.sidebarLeft : ''
    ].filter(Boolean).join(' ');
    const shouldRenderSidebar = isContentReady && isActive && !!codeResults;

    return (
        <div className={wrapperClasses}>
            {/* Toggle Button */}
            <button
                className={styles.sidebarToggle}
                onClick={toggleSidebar}
                aria-label={sidebarCollapsed ? 'Expandir navegação' : 'Recolher navegação'}
            >
                {sidebarPosition === 'left'
                    ? (sidebarCollapsed ? '▶' : '◀')
                    : (sidebarCollapsed ? '◀' : '▶')}
            </button>

            {/* Content - Coluna 1 */}
            <div
                className={`${styles.content} ${isContentReady ? styles.contentVisible : styles.contentHidden} markdown-body`}
                ref={containerRef}
                id={containerId}
            >
                {!data.markdown && !isTipiResults(codeResults || null) && <p>Sem resultados para exibir.</p>}
            </div>

            {/* Sidebar Container - Coluna 2 */}
            {shouldRenderSidebar && (
                <div className={styles.sidebarContainer}>
                    <Sidebar
                        results={codeResults}
                        onNavigate={handleNavigate}
                        isOpen={mobileMenuOpen}
                        onClose={onCloseMobileMenu}
                        searchQuery={data.query || data.ncm}
                        activeAnchorId={activeAnchorId}
                    />
                </div>
            )}
        </div>
    );
});
