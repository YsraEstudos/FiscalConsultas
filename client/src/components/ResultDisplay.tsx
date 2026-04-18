import { TextSearchResults } from './TextSearchResults';
import React, { startTransition, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { marked } from 'marked';
import { useRobustScroll } from '../hooks/useRobustScroll';
import { generateAnchorId } from '../utils/id_utils';
import { SearchResultItem } from './TextSearchResults';
import styles from './ResultDisplay.module.css';
import { debug } from '../utils/debug';
import { NeshRenderer } from '../utils/NeshRenderer';
import { useSettings } from '../context/SettingsContext';
import { Sidebar } from './Sidebar';
import { SearchHighlighter } from './SearchHighlighter';
import { useTextSelection } from '../hooks/useTextSelection';
import { HighlightPopover } from './HighlightPopover';
import { CommentPanel } from './CommentPanel';
import { CommentDrawer } from './CommentDrawer';
import type { PendingCommentEntry } from './CommentPanel';
import { useAuth } from '../context/AuthContext';
import { useComments } from '../hooks/useComments';
import toast from 'react-hot-toast';
import {
    appendTrustedHtmlToElement,
    replaceElementWithTrustedHtml,
    sanitizeRichHtml,
} from '../utils/contentSecurity';
import { getNeshChapterBody } from '../services/api';
import type { ChapterBodyResponse } from '../types/api.types';

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

type ChapterSectionType = 'titulo' | 'notas' | 'consideracoes' | 'definicoes';

const SECTION_TARGET_PATTERN = /^chapter-([^-]+)-(titulo|notas|consideracoes|definicoes)$/i;

const SECTION_SELECTOR_FALLBACKS: Record<ChapterSectionType, string[]> = {
    titulo: ['.section-titulo'],
    notas: ['.section-notas', '.regras-gerais'],
    consideracoes: ['.section-consideracoes'],
    definicoes: ['.section-definicoes']
};

const SECTION_TEXT_FALLBACKS: Record<ChapterSectionType, RegExp> = {
    titulo: /t[ií]tulo do cap[ií]tulo/i,
    notas: /notas do cap[ií]tulo|regras gerais do cap[ií]tulo/i,
    consideracoes: /considera[cç][oõ]es gerais/i,
    definicoes: /defini[cç][oõ]es t[eé]cnicas/i
};

function getSectionTargetMeta(targetId: string): { capitulo: string; sectionType: ChapterSectionType } | null {
    const match = targetId.match(SECTION_TARGET_PATTERN);
    if (!match) return null;
    return { capitulo: match[1], sectionType: match[2].toLowerCase() as ChapterSectionType };
}

function getChapterAnchors(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll('[id]'))
        .filter((node) => /^(?:cap|chapter)-\d{1,2}$/.test((node as HTMLElement).id)) as HTMLElement[];
}

function getChapterBounds(container: HTMLElement, capitulo: string): { start: HTMLElement | null; next: HTMLElement | null } {
    const startByCap = container.querySelector(`#${CSS.escape(`cap-${capitulo}`)}`) as HTMLElement | null;
    const startByChapter = container.querySelector(`#${CSS.escape(`chapter-${capitulo}`)}`) as HTMLElement | null;
    const start = startByCap || startByChapter;
    if (!start) return { start: null, next: null };

    const anchors = getChapterAnchors(container);
    const idx = anchors.findIndex((el) => el === start);
    if (idx < 0) return { start, next: null };

    return { start, next: anchors[idx + 1] || null };
}

function isElementWithinBounds(element: HTMLElement, start: HTMLElement, next: HTMLElement | null): boolean {
    const isAfterStart = start === element
        || Boolean(start.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!isAfterStart) return false;
    if (!next) return true;
    return Boolean(element.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function resolveSectionElement(container: HTMLElement, targetId: string): HTMLElement | null {
    const sectionMeta = getSectionTargetMeta(targetId);
    if (!sectionMeta) return null;

    const { capitulo, sectionType } = sectionMeta;
    const { start, next } = getChapterBounds(container, capitulo);
    const isInChapter = (candidate: HTMLElement) =>
        !start || isElementWithinBounds(candidate, start, next);

    for (const selector of SECTION_SELECTOR_FALLBACKS[sectionType]) {
        const candidate = Array.from(container.querySelectorAll(selector))
            .find((node) => node instanceof HTMLElement && isInChapter(node as HTMLElement)) as HTMLElement | undefined;

        if (candidate) {
            if (!candidate.id) candidate.id = targetId;
            return candidate;
        }
    }

    const headingRegex = SECTION_TEXT_FALLBACKS[sectionType];
    const heading = Array.from(container.querySelectorAll('h2, h3, h4, p, strong'))
        .find((node) =>
            node instanceof HTMLElement
            && isInChapter(node as HTMLElement)
            && headingRegex.test((node.textContent || '').trim())
        ) as HTMLElement | undefined;

    if (!heading) return null;

    const sectionRoot = heading.closest('div, section, article, blockquote') as HTMLElement | null;
    const resolved = sectionRoot || heading;
    if (!resolved.id) resolved.id = targetId;
    return resolved;
}

const TERM_MARK_ATTR = 'data-text-query-highlight';
const TERM_MARK_SELECTOR = `mark[${TERM_MARK_ATTR}="true"]`;
const TERM_HIGHLIGHT_MAX_MATCHES = 250;
const TERM_HIGHLIGHT_MIN_LENGTH = 2;
const MANUAL_NAVIGATION_HIGHLIGHT_LOCK_MS = 900;
const SKIP_HIGHLIGHT_TAGS = new Set(['SCRIPT', 'STYLE', 'MARK', 'NOSCRIPT', 'TEXTAREA']);

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unwrapQueryHighlights(container: HTMLElement) {
    const marks = Array.from(container.querySelectorAll<HTMLElement>(TERM_MARK_SELECTOR));
    marks.forEach(mark => {
        const parent = mark.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        if (parent instanceof HTMLElement) {
            parent.normalize();
        }
    });
}

function collectHighlightableTextNodes(container: HTMLElement, matcher: RegExp): Text[] {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const value = node.nodeValue || '';
            if (!value.trim()) return NodeFilter.FILTER_REJECT;

            const parentElement = (node as Text).parentElement;
            if (!parentElement) return NodeFilter.FILTER_REJECT;
            if (SKIP_HIGHLIGHT_TAGS.has(parentElement.tagName)) return NodeFilter.FILTER_REJECT;
            if (parentElement.closest(TERM_MARK_SELECTOR)) return NodeFilter.FILTER_REJECT;
            if (!matcher.test(value)) return NodeFilter.FILTER_REJECT;

            return NodeFilter.FILTER_ACCEPT;
        },
    });

    let currentNode = walker.nextNode();
    while (currentNode) {
        textNodes.push(currentNode as Text);
        currentNode = walker.nextNode();
    }

    return textNodes;
}

function buildHighlightedFragment(
    parts: string[],
    normalizedLowerTerm: string,
    highlightedCount: number,
): { fragment: DocumentFragment; replaced: boolean; highlightedCount: number } {
    const fragment = document.createDocumentFragment();
    let replaced = false;
    let nextCount = highlightedCount;

    for (const part of parts) {
        if (!part) continue;

        const canHighlight = nextCount < TERM_HIGHLIGHT_MAX_MATCHES
            && part.toLowerCase() === normalizedLowerTerm;
        if (!canHighlight) {
            fragment.appendChild(document.createTextNode(part));
            continue;
        }

        const mark = document.createElement('mark');
        mark.setAttribute(TERM_MARK_ATTR, 'true');
        mark.className = 'search-highlight search-highlight-partial';
        mark.textContent = part;
        fragment.appendChild(mark);
        nextCount += 1;
        replaced = true;
    }

    return { fragment, replaced, highlightedCount: nextCount };
}

function highlightTermInContainer(container: HTMLElement, term: string): number {
    const normalizedTerm = term.trim();
    if (normalizedTerm.length < TERM_HIGHLIGHT_MIN_LENGTH) return 0;

    const matcher = new RegExp(escapeRegex(normalizedTerm), 'i');
    const splitRegex = new RegExp(`(${escapeRegex(normalizedTerm)})`, 'gi');
    const textNodes = collectHighlightableTextNodes(container, matcher);

    let highlightedCount = 0;
    const normalizedLowerTerm = normalizedTerm.toLowerCase();

    for (const node of textNodes) {
        if (highlightedCount >= TERM_HIGHLIGHT_MAX_MATCHES) break;

        const text = node.nodeValue || '';
        const parts = text.split(splitRegex);
        if (parts.length < 3) continue;

        const { fragment, replaced, highlightedCount: nextCount } = buildHighlightedFragment(
            parts,
            normalizedLowerTerm,
            highlightedCount,
        );
        highlightedCount = nextCount;

        if (!replaced || !node.parentNode) continue;
        node.parentNode.replaceChild(fragment, node);
    }

    return highlightedCount;
}

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
    onToggleMobileMenu?: () => void;
    isActive: boolean;
    tabId: string;
    initialScrollTop?: number;
    onPersistScroll?: (tabId: string, scrollTop: number) => void;
    latestTextQuery?: string;
    /** Flag indicando nova busca - ativa auto-scroll */
    isNewSearch: boolean;
    /** Callback para consumir flag após auto-scroll, recebendo opcionalmente o scroll final */
    onConsumeNewSearch: (tabId: string, finalScrollTop?: number) => void;
    /** Callback to notify parent when content is ready (for coordinated loading) */
    onContentReady?: (tabId: string) => void;
    /** Callback to sync hydrated code results back to the owning tab */
    onHydratedResults?: (tabId: string, results: Record<string, any>) => void;
}

type MarkupRenderRefs = {
    contentRef: React.RefObject<HTMLDivElement | null>;
    renderedMarkupKeyRef: React.MutableRefObject<string | null>;
    lastMarkupRef: React.MutableRefObject<string | null>;
    lastHtmlRef: React.MutableRefObject<string | null>;
};

type MarkupRenderOptions = {
    rawMarkdown: string;
    markupToRender: string;
    isActive: boolean;
    isContentReady: boolean;
    refs: MarkupRenderRefs;
    setIsContentReady: React.Dispatch<React.SetStateAction<boolean>>;
    setIsFullyRendered: React.Dispatch<React.SetStateAction<boolean>>;
};

const SECTION_TYPES: ChapterSectionType[] = ['titulo', 'notas', 'consideracoes', 'definicoes'];
const CHUNK_SIZE_THRESHOLD = 50_000;

function scheduleIdleTask(callback: () => void): number {
    if (typeof requestIdleCallback === 'function') {
        return requestIdleCallback(callback, { timeout: 100 });
    }
    return setTimeout(callback, 16) as unknown as number;
}

function cancelIdleTask(taskId: number) {
    if (typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(taskId);
        return;
    }
    clearTimeout(taskId);
}

function appendMarkupChunk(container: HTMLElement, htmlChunk: string) {
    appendTrustedHtmlToElement(container, htmlChunk);
}

function normalizeDigits(value: string): string {
    return value.replace(/\D/g, '');
}

function buildAnchorCandidatesFromDigits(digits: string): string[] {
    if (digits.length < 4) return [];

    const head4 = digits.slice(0, 4);
    const candidates = [`pos-${head4.slice(0, 2)}-${head4.slice(2)}`, `pos-${head4}`];
    if (digits.length >= 6) {
        candidates.push(`pos-${digits.slice(0, 4)}-${digits.slice(4, 6)}`);
    }
    if (digits.length >= 8) {
        candidates.push(`pos-${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`);
    }
    return candidates;
}

function resolveNcmToScroll(data: ResultData | null): string | null {
    if (!data) return null;
    return data.ncm || data.query || null;
}

function resolveMarkupToRender(
    rawMarkdown: string,
    codeResults: Record<string, any> | null,
): string {
    if (rawMarkdown) return rawMarkdown;
    if (!codeResults) return '';
    if (isTipiResults(codeResults)) {
        return renderTipiFallback(codeResults);
    }

    console.warn('[ResultDisplay] Fallback NeshRenderer used - backend should send markdown');
    return NeshRenderer.renderFullResponse(codeResults);
}

function chapterHasRenderableContent(chapter: any): boolean {
    const content = chapter?.conteudo;
    return typeof content === 'string' && content.trim().length > 0;
}

function getSectionContent(sectionValue: unknown): string {
    if (typeof sectionValue === 'string') {
        return sectionValue.trim();
    }
    if (typeof sectionValue === 'number') {
        return String(sectionValue).trim();
    }
    return '';
}

function getAnchorCodeFromNcmValue(value: string): string {
    if (value.includes('.') || value.length !== 4) {
        return value;
    }
    return `${value.slice(0, 2)}.${value.slice(2, 4)}`;
}

function resolveChapterResultKey(
    results: Record<string, any>,
    chapterNumber: string,
): string {
    return Object.keys(results).find((key) => {
        const existingChapter = results[key];
        return existingChapter?.capitulo === chapterNumber;
    }) ?? chapterNumber;
}

function mergeHydratedChapterBodies(
    baseResults: Record<string, any>,
    chapterBodies: ChapterBodyResponse[],
): Record<string, any> {
    const nextResults = { ...baseResults };

    for (const chapterBody of chapterBodies) {
        const chapterKey = resolveChapterResultKey(nextResults, chapterBody.capitulo);
        const existingChapter = nextResults[chapterKey];
        if (!existingChapter || typeof existingChapter !== 'object') {
            continue;
        }

        nextResults[chapterKey] = {
            ...existingChapter,
            conteudo: chapterBody.conteudo,
            notas_parseadas: chapterBody.notas_parseadas ?? existingChapter.notas_parseadas ?? {},
            notas_gerais: chapterBody.notas_gerais ?? existingChapter.notas_gerais ?? null,
            secoes: chapterBody.secoes ?? existingChapter.secoes,
        };
    }

    return nextResults;
}

type ChapterHydrationResult = {
    chapterBodies: ChapterBodyResponse[];
    failedChapters: string[];
};

function createFailedChapterBodiesUpdater(failedChapters: string[]) {
    return (current: string[]) => Array.from(new Set([...current, ...failedChapters]));
}

function createRecoveredChapterBodiesUpdater(chapterBodies: ChapterBodyResponse[]) {
    const recoveredChapters = new Set(chapterBodies.map((body) => body.capitulo));
    return (current: string[]) => current.filter((chapter) => !recoveredChapters.has(chapter));
}

async function fetchChapterBodies(chapters: string[]): Promise<ChapterHydrationResult> {
    const settledBodies = await Promise.allSettled(
        chapters.map((chapter) => getNeshChapterBody(chapter)),
    );
    const fulfilledBodies: ChapterBodyResponse[] = [];
    const failedChapters: string[] = [];

    settledBodies.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            fulfilledBodies.push(result.value);
            return;
        }

        failedChapters.push(chapters[index]);
        console.error('[ResultDisplay] Failed to fetch chapter body', {
            chapter: chapters[index],
            error: result.reason,
        });
    });

    return {
        chapterBodies: fulfilledBodies,
        failedChapters,
    };
}

function getCachedRawMarkup(
    cacheKey: string,
    shouldParseMarkdown: boolean,
    markupToRender: string,
    lastMarkupRef: React.MutableRefObject<string | null>,
    lastHtmlRef: React.MutableRefObject<string | null>,
): string {
    const cachedRawMarkup = cacheGet(sharedRawMarkupCache, cacheKey);
    if (cachedRawMarkup) return cachedRawMarkup;

    const reusableMarkup = lastMarkupRef.current === cacheKey ? lastHtmlRef.current : null;
    if (reusableMarkup) {
        cacheSet(sharedRawMarkupCache, cacheKey, reusableMarkup);
        return reusableMarkup;
    }

    let nextRawMarkup = markupToRender;
    if (shouldParseMarkdown) {
        // @ts-ignore - marked types might mismatch slightly depending on version
        nextRawMarkup = marked.parse(markupToRender) as string;
    }

    cacheSet(sharedRawMarkupCache, cacheKey, nextRawMarkup);
    return nextRawMarkup;
}

function getFinalMarkup(rawMarkup: string, cacheKey: string): string {
    const cachedSanitizedMarkup = cacheGet(sharedSanitizedMarkupCache, cacheKey);
    if (cachedSanitizedMarkup) return cachedSanitizedMarkup;

    const sanitizedMarkup = sanitizeRichHtml(rawMarkup);
    cacheSet(sharedSanitizedMarkupCache, cacheKey, sanitizedMarkup);
    return sanitizedMarkup;
}

function renderSmallMarkup(
    contentRef: React.RefObject<HTMLDivElement | null>,
    finalMarkup: string,
    cacheKey: string,
    renderedMarkupKeyRef: React.MutableRefObject<string | null>,
    setIsContentReady: React.Dispatch<React.SetStateAction<boolean>>,
    setIsFullyRendered: React.Dispatch<React.SetStateAction<boolean>>,
): () => void {
    const frameId = requestAnimationFrame(() => {
        if (!contentRef.current) return;
        replaceElementWithTrustedHtml(contentRef.current, finalMarkup);
        renderedMarkupKeyRef.current = cacheKey;
        setIsContentReady(true);
        setIsFullyRendered(true);
    });

    return () => cancelAnimationFrame(frameId);
}

function renderChunkedMarkup(
    contentRef: React.RefObject<HTMLDivElement | null>,
    finalMarkup: string,
    cacheKey: string,
    renderedMarkupKeyRef: React.MutableRefObject<string | null>,
    setIsContentReady: React.Dispatch<React.SetStateAction<boolean>>,
    setIsFullyRendered: React.Dispatch<React.SetStateAction<boolean>>,
): () => void {
    const chunks = finalMarkup.split(/(?=<hr\s*\/?>)/i);
    const pendingIdleIds: number[] = [];
    let cancelled = false;

    const frameId = requestAnimationFrame(() => {
        if (cancelled || !contentRef.current) return;

        contentRef.current.textContent = '';
        if (chunks.length > 0) {
            appendMarkupChunk(contentRef.current, chunks[0]);
        }

        // Marca o conteúdo como pronto após o primeiro chunk para liberar auto-scroll cedo.
        renderedMarkupKeyRef.current = cacheKey;
        setIsContentReady(true);

        const enqueueChunk = (index: number) => {
            if (index >= chunks.length) {
                setIsFullyRendered(true);
                return;
            }

            const idleId = scheduleIdleTask(() => {
                if (cancelled || !contentRef.current) return;
                appendMarkupChunk(contentRef.current, chunks[index]);
                enqueueChunk(index + 1);
            });
            pendingIdleIds.push(idleId);
        };

        enqueueChunk(1);
    });

    return () => {
        cancelled = true;
        cancelAnimationFrame(frameId);
        pendingIdleIds.forEach(cancelIdleTask);
    };
}

function renderMarkupContent(options: MarkupRenderOptions): (() => void) | undefined {
    const { rawMarkdown, markupToRender, isActive, isContentReady, refs, setIsContentReady, setIsFullyRendered } = options;
    const container = refs.contentRef.current;
    if (!container) return undefined;

    const shouldParseMarkdown = !!rawMarkdown && isLikelyLegacyMarkdown(markupToRender);
    const cacheKey = `${shouldParseMarkdown ? 'md' : 'html'}:${markupToRender}`;

    // Aba inativa: preservar o DOM existente para restauração de scroll.
    // TabPanel já esconde com display:none; não precisa limpar.
    if (!isActive) {
        return undefined;
    }

    const isAlreadyRendered = refs.renderedMarkupKeyRef.current === cacheKey && container.childNodes.length > 0;
    if (isAlreadyRendered) {
        if (!isContentReady) setIsContentReady(true);
        setIsFullyRendered(true);
        return undefined;
    }

    setIsContentReady(false);
    setIsFullyRendered(false);
    const rawMarkup = getCachedRawMarkup(
        cacheKey,
        shouldParseMarkdown,
        markupToRender,
        refs.lastMarkupRef,
        refs.lastHtmlRef,
    );
    refs.lastMarkupRef.current = cacheKey;
    refs.lastHtmlRef.current = rawMarkup;

    const finalMarkup = getFinalMarkup(rawMarkup, cacheKey);
    if (finalMarkup.length <= CHUNK_SIZE_THRESHOLD) {
        return renderSmallMarkup(refs.contentRef, finalMarkup, cacheKey, refs.renderedMarkupKeyRef, setIsContentReady, setIsFullyRendered);
    }

    return renderChunkedMarkup(refs.contentRef, finalMarkup, cacheKey, refs.renderedMarkupKeyRef, setIsContentReady, setIsFullyRendered);
}

function getWrapperClasses(
    stylesMap: typeof styles,
    sidebarCollapsed: boolean,
    mobileMenuOpen: boolean,
    sidebarPosition: 'left' | 'right',
): string {
    return [
        stylesMap.wrapper,
        sidebarCollapsed ? stylesMap.sidebarCollapsed : '',
        mobileMenuOpen ? stylesMap.sidebarOpen : '',
        sidebarPosition === 'left' ? stylesMap.sidebarLeft : '',
    ].filter(Boolean).join(' ');
}

function getSidebarToggleIcon(sidebarPosition: 'left' | 'right', sidebarCollapsed: boolean): string {
    if (sidebarPosition === 'left') {
        return sidebarCollapsed ? '▶' : '◀';
    }
    return sidebarCollapsed ? '◀' : '▶';
}

function getSidebarToggleLabel(sidebarCollapsed: boolean): string {
    return sidebarCollapsed ? 'Expandir navegação' : 'Recolher navegação';
}

function getContentVisibilityClass(stylesMap: typeof styles, isContentReady: boolean): string {
    return isContentReady ? stylesMap.contentVisible : stylesMap.contentHidden;
}

function getCommentToggleClassName(stylesMap: typeof styles, commentsEnabled: boolean): string {
    if (!commentsEnabled) return stylesMap.commentToggle;
    return `${stylesMap.commentToggle} ${stylesMap.commentToggleActive}`;
}

function getCommentToggleLabel(commentsEnabled: boolean): string {
    return commentsEnabled ? 'Desativar comentários' : 'Ativar comentários';
}

function findAnchorIdInChapter(
    chapter: any,
    normalizedQuery: string,
    existingPrefix: string | null,
): { exactMatch: string | null; prefixMatch: string | null } {
    const positions = Array.isArray(chapter?.posicoes) ? chapter.posicoes : [];
    let prefixMatch = existingPrefix;

    for (const pos of positions) {
        const codigo = (pos?.codigo || pos?.ncm || '').toString();
        if (!codigo) continue;

        const normalizedCodigo = normalizeDigits(codigo);
        if (normalizedCodigo === normalizedQuery) {
            return {
                exactMatch: pos?.anchor_id || generateAnchorId(codigo),
                prefixMatch,
            };
        }

        if (!prefixMatch && normalizedCodigo.startsWith(normalizedQuery)) {
            prefixMatch = pos?.anchor_id || generateAnchorId(codigo);
        }
    }

    return { exactMatch: null, prefixMatch };
}

function getStructuredSectionIds(capitulo: string, secoes: Record<string, unknown>): string[] {
    const ids: string[] = [];
    for (const sectionType of SECTION_TYPES) {
        const sectionValue = secoes[sectionType];
        const sectionContent = getSectionContent(sectionValue);
        if (!sectionContent) continue;
        ids.push(`chapter-${capitulo}-${sectionType}`);
    }
    return ids;
}

function resolveAutoScrollCandidates(
    ncmToScroll: string,
    codeResults: Record<string, any> | null,
    findAnchorIdForQuery: (resultados: any, query: string) => string | null,
    getPosicaoAlvoFromResultados: (resultados: any) => string | null,
): string[] {
    const posicaoAlvo = codeResults ? getPosicaoAlvoFromResultados(codeResults) : null;
    const anchorFromResultados = codeResults ? findAnchorIdForQuery(codeResults, ncmToScroll) : null;
    const exactId = anchorFromResultados
        || (posicaoAlvo ? generateAnchorId(posicaoAlvo) : null)
        || generateAnchorId(ncmToScroll);

    const candidates = [exactId];
    candidates.push(...buildAnchorCandidatesFromDigits(normalizeDigits(ncmToScroll)));
    return Array.from(new Set(candidates));
}

function findExistingTargetElement(container: HTMLElement, targets: string[]): HTMLElement | null {
    for (const id of targets) {
        const element = container.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
        if (element) return element;
    }
    return null;
}

function buildDataNcmTargetValues(candidateNcm: string): string[] {
    const normalized = normalizeDigits(candidateNcm);
    if (!normalized) return [];

    const values = new Set<string>([normalized]);
    if (normalized.length >= 6) {
        values.add(`${normalized.slice(0, 4)}.${normalized.slice(4, 6)}`);
    }
    if (normalized.length >= 8) {
        values.add(`${normalized.slice(0, 4)}.${normalized.slice(4, 6)}.${normalized.slice(6, 8)}`);
    }
    if (normalized.length >= 4) {
        const positionDigits = normalized.slice(0, 4);
        values.add(positionDigits);
        values.add(`${positionDigits.slice(0, 2)}.${positionDigits.slice(2, 4)}`);
    }

    return Array.from(values);
}

function ensureTargetAnchorFromDataNcm(
    container: HTMLElement,
    candidateNcm: string | null | undefined,
): HTMLElement | null {
    for (const value of buildDataNcmTargetValues(candidateNcm || '')) {
        const element = container.querySelector(`[data-ncm="${value}"]`) as HTMLElement | null;
        if (!element) continue;

        const anchorCode = getAnchorCodeFromNcmValue(value);
        if (!element.id) {
            element.id = generateAnchorId(anchorCode);
        }
        return element;
    }

    return null;
}

function getNextVisibleAnchorId(entries: IntersectionObserverEntry[]): string | null {
    const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
    return visible[0]?.target?.id || null;
}

function scheduleActiveAnchorUpdate(
    nextAnchorId: string,
    activeAnchorIdRef: React.MutableRefObject<string | null>,
    anchorRafRef: React.MutableRefObject<number | null>,
    setActiveAnchorId: React.Dispatch<React.SetStateAction<string | null>>,
) {
    if (nextAnchorId === activeAnchorIdRef.current) return;

    if (anchorRafRef.current !== null) {
        cancelAnimationFrame(anchorRafRef.current);
    }

    anchorRafRef.current = requestAnimationFrame(() => {
        anchorRafRef.current = null;
        setActiveAnchorId(prev => (prev === nextAnchorId ? prev : nextAnchorId));
    });
}

export const ResultDisplay = React.memo(function ResultDisplay({
    data,
    mobileMenuOpen,
    onCloseMobileMenu,
    onToggleMobileMenu: _onToggleMobileMenu,
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
    const latestScrollTopRef = useRef(0);
    const lastPersistedScrollRef = useRef<number | null>(null);
    const [isContentReady, setIsContentReady] = useState(false);
    const [isFullyRendered, setIsFullyRendered] = useState(false);
    const [isTargetReady, setIsTargetReady] = useState(false);
    const [activeTerm, setActiveTerm] = useState('');
    const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
    const containerId = `results-content-${tabId}`;
    const lastMarkupRef = useRef<string | null>(null);
    const lastHtmlRef = useRef<string | null>(null);
    const renderedMarkupKeyRef = useRef<string | null>(null);
    const activeAnchorIdRef = useRef<string | null>(null);
    const anchorRafRef = useRef<number | null>(null);
    const manualNavigationLockRef = useRef<{ anchorId: string; expiresAt: number } | null>(null);
    const onContentReadyRef = useRef(onContentReady);

    // Sidebar collapsed state for lateral layout
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const toggleSidebar = useCallback(() => setSidebarCollapsed(prev => !prev), []);

    // ── Sistema de Comentários (Google Docs Style) ─────────────────────────
    const [commentsEnabled, setCommentsEnabled] = useState(false);
    const toggleComments = useCallback(() => {
        if (isAuthLoading) {
            toast.error('Aguarde a autenticação carregar e tente novamente.');
            return;
        }
        if (!isSignedIn) {
            toast.error('Faça login para usar comentários.');
            return;
        }
        if (!canUseRestrictedUi) {
            toast.error('Seu usuário não tem acesso a comentários.');
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
        setCommentsEnabled(prev => !prev);
    }, [canUseRestrictedUi, isSignedIn, isAuthLoading]);

    const contentRef = useRef<HTMLDivElement>(null);
    const { selection, clearSelection, onPopoverMouseDown } = useTextSelection(contentRef);

    const [pendingComment, setPendingComment] = useState<PendingCommentEntry | null>(null);
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
    const commentedAnchorsLoadedRef = useRef(false);

    // Drawer state for responsive screens < 1280px
    const [drawerOpen, setDrawerOpen] = useState(false);
    const toggleDrawer = useCallback(() => setDrawerOpen(prev => !prev), []);
    const [hydratedCodeResults, setHydratedCodeResults] = useState<Record<string, any> | null>(null);
    const [isHydratingCodeResults, setIsHydratingCodeResults] = useState(false);
    const [failedChapterBodies, setFailedChapterBodies] = useState<string[]>([]);

    /** Abre o formulário no painel direito ancorado ao trecho selecionado. */
    const handleOpenComment = useCallback(() => {
        if (!selection?.anchorKey) {
            if (selection) toast.error('Selecione texto dentro de um elemento NCM para comentar.');
            return;
        }
        if (!selection) return;
        const container = containerRef.current;
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        // anchorTop = posição Y relativa ao topo do scroll container
        const anchorTop = selection.rect.top - containerRect.top + container.scrollTop;
        setPendingComment({
            anchorTop,
            anchorKey: selection.anchorKey,
            selectedText: selection.text,
        });
        clearSelection();
        // Em telas estreitas, abre o drawer automaticamente
        if (window.matchMedia('(max-width: 1280px)').matches) {
            setDrawerOpen(true);
        }
    }, [selection, containerRef, clearSelection]);

    /** Confirma o comentário via API (otimista). */
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
    }, [pendingComment, userName, userImageUrl, addComment]);

    const handleDismissComment = useCallback(() => {
        setPendingComment(null);
    }, []);

    useEffect(() => {
        if (canUseRestrictedUi) return;
        setCommentsEnabled(false);
        setPendingComment(null);
        setDrawerOpen(false);
    }, [canUseRestrictedUi]);

    // ── Carregar anchors com comentários quando ativado ────────────────────
    useEffect(() => {
        if (!canUseRestrictedUi || !commentsEnabled) {
            commentedAnchorsLoadedRef.current = false;
            return;
        }

        if (!isSignedIn || isAuthLoading) return;
        if (commentedAnchorsLoadedRef.current) return;

        commentedAnchorsLoadedRef.current = true;
        void loadCommentedAnchors();
    }, [canUseRestrictedUi, commentsEnabled, loadCommentedAnchors, isSignedIn, isAuthLoading]);

    // ── Aplicar/remover classe .has-comment nos elementos do DOM ──────────
    useEffect(() => {
        const container = contentRef.current;
        if (!container) return;

        // Sempre limpa marcações anteriores
        container.querySelectorAll('.has-comment').forEach(el => {
            el.classList.remove('has-comment');
        });

        // Só aplica quando comments estão ativos e há anchors
        if (!canUseRestrictedUi || !commentsEnabled || commentedAnchors.length === 0) return;

        commentedAnchors.forEach(anchorKey => {
            const el = container.querySelector(`[id="${CSS.escape(anchorKey)}"]`);
            if (el) {
                el.classList.add('has-comment');
            }
        });
    }, [canUseRestrictedUi, commentsEnabled, commentedAnchors, isContentReady]);

    // ── Carregar comentários ao clicar em elemento com .has-comment ───────
    useEffect(() => {
        const container = contentRef.current;
        if (!container || !canUseRestrictedUi || !commentsEnabled) return;

        const handleHasCommentClick = (e: Event) => {
            const target = (e.target as HTMLElement).closest('.has-comment');
            if (!target) return;
            const anchorKey = target.id;
            if (!anchorKey) return;

            // Busca os comentários deste anchor
            void loadComments(anchorKey, target.getBoundingClientRect().top);

            // Em telas estreitas, abre o drawer
            if (window.matchMedia('(max-width: 1280px)').matches) {
                setDrawerOpen(true);
            }
        };

        container.addEventListener('click', handleHasCommentClick);
        return () => container.removeEventListener('click', handleHasCommentClick);
    }, [canUseRestrictedUi, commentsEnabled, loadComments]);

    // ── Reset ao mudar de conteúdo ────────────────────────────────────────
    useEffect(() => {
        resetFetchedAnchors();
    }, [data?.markdown, data?.ncm, data?.query, resetFetchedAnchors]);

    // ───────────────────────────────────────────────────────────────────────
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

    useEffect(() => {
        startTransition(() => {
            setHydratedCodeResults(null);
            setIsHydratingCodeResults(false);
            setFailedChapterBodies([]);
        });
    }, [data?.markdown, data?.ncm, data?.query, tabId]);

    const shouldHydrateCodeResults = useMemo(() => {
        return !!codeResults
            && data?.type === 'code'
            && !data?.markdown
            && !isTipiResults(codeResults);
    }, [codeResults, data?.markdown, data?.type]);

    const renderableCodeResults = useMemo(() => {
        return hydratedCodeResults ?? codeResults;
    }, [codeResults, hydratedCodeResults]);

    const missingChapterBodies = useMemo(() => {
        if (!shouldHydrateCodeResults || !renderableCodeResults) return [] as string[];

        return Object.entries(renderableCodeResults)
            .filter(([, chapter]) => !chapterHasRenderableContent(chapter))
            .map(([chapterKey, chapter]) => {
                const capitulo = (chapter as { capitulo?: unknown })?.capitulo;
                return typeof capitulo === 'string' && capitulo.trim()
                    ? capitulo.trim()
                    : chapterKey;
            })
            .filter((chapter) => !failedChapterBodies.includes(chapter));
    }, [failedChapterBodies, renderableCodeResults, shouldHydrateCodeResults]);

    useEffect(() => {
        if (!isActive || !shouldHydrateCodeResults || !codeResults || missingChapterBodies.length === 0) {
            return;
        }

        let cancelled = false;
        setIsHydratingCodeResults(true);

        const applyHydrationResult = ({
            chapterBodies,
            failedChapters,
        }: ChapterHydrationResult) => {
            if (cancelled) return;

            if (failedChapters.length > 0) {
                startTransition(() => {
                    setFailedChapterBodies(createFailedChapterBodiesUpdater(failedChapters));
                });
            }

            if (chapterBodies.length === 0) return;

            const mergedResults = mergeHydratedChapterBodies(
                renderableCodeResults ?? codeResults,
                chapterBodies,
            );

            startTransition(() => {
                setHydratedCodeResults(mergedResults);
                setFailedChapterBodies(
                    createRecoveredChapterBodiesUpdater(chapterBodies),
                );
                onHydratedResults?.(tabId, mergedResults);
            });
        };

        void fetchChapterBodies(missingChapterBodies)
            .then(applyHydrationResult)
            .catch((error) => {
                console.error('[ResultDisplay] Failed to hydrate chapter bodies', error);
            })
            .finally(() => {
                if (!cancelled) {
                    setIsHydratingCodeResults(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [
        codeResults,
        isActive,
        missingChapterBodies,
        onHydratedResults,
        renderableCodeResults,
        shouldHydrateCodeResults,
        tabId,
    ]);

    const findAnchorIdForQuery = useCallback((resultados: any, query: string) => {
        if (!resultados || typeof resultados !== 'object') return null;

        const normalizedQuery = normalizeDigits(query);
        if (!normalizedQuery) return null;

        const chapters = Object.values(resultados) as any[];
        let exactMatch: string | null = null;
        let prefixMatch: string | null = null;

        for (const chapter of chapters) {
            const match = findAnchorIdInChapter(chapter, normalizedQuery, prefixMatch);
            if (match.exactMatch) {
                exactMatch = match.exactMatch;
                break;
            }
            prefixMatch = match.prefixMatch;
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

    const getSectionAnchorIdsFromResultados = useCallback((resultados: any) => {
        if (!resultados || typeof resultados !== 'object') return [] as string[];

        const ids: string[] = [];
        const chapters = Object.values(resultados) as any[];
        for (const chapter of chapters) {
            const capitulo = (chapter?.capitulo || '').toString().trim();
            if (!capitulo) continue;

            const secoes = chapter?.secoes;
            if (secoes && typeof secoes === 'object') {
                const structuredSectionIds = getStructuredSectionIds(capitulo, secoes as Record<string, unknown>);
                ids.push(...structuredSectionIds);
                if (structuredSectionIds.length > 0) continue;
            }

            if ((chapter?.notas_gerais || '').toString().trim()) {
                ids.push(`chapter-${capitulo}-notas`);
            }
        }

        return ids;
    }, []);

    const getAnchorIdsFromResultados = useCallback((resultados: any) => {
        if (!resultados || typeof resultados !== 'object') return [] as string[];

        const ids = getSectionAnchorIdsFromResultados(resultados);
        const chapters = Object.values(resultados) as any[];
        for (const chapter of chapters) {
            const positions = Array.isArray(chapter?.posicoes) ? chapter.posicoes : [];
            for (const pos of positions) {
                const codigo = (pos?.codigo || pos?.ncm || '').toString();
                if (!codigo) continue;
                ids.push(pos?.anchor_id || generateAnchorId(codigo));
            }
        }
        return Array.from(new Set(ids));
    }, [getSectionAnchorIdsFromResultados]);

    const ensureSectionAnchors = useCallback((resultados: any, container: HTMLElement) => {
        const sectionIds = getSectionAnchorIdsFromResultados(resultados);
        for (const sectionId of sectionIds) {
            const existing = container.querySelector(`#${CSS.escape(sectionId)}`) as HTMLElement | null;
            if (existing) continue;
            resolveSectionElement(container, sectionId);
        }
    }, [getSectionAnchorIdsFromResultados]);

    const searchHighlighterQuery = useMemo(() => {
        const candidate = (latestTextQuery || '').trim();
        return candidate || null;
    }, [latestTextQuery]);
    const searchHighlighterOwnsScroll = data?.type === 'text' && !!searchHighlighterQuery;
    const consumeNewSearchKey = useMemo(
        () => `${tabId}|${isNewSearch ? '1' : '0'}|${data?.query ?? ''}|${data?.ncm ?? ''}|${latestTextQuery ?? ''}`,
        [data?.ncm, data?.query, isNewSearch, latestTextQuery, tabId],
    );

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

        // Section fallback: backend HTML may provide section classes without stable IDs.
        if (!element) {
            element = resolveSectionElement(container, targetId);
        }

        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            element.classList.add('flash-highlight');
            setTimeout(() => element.classList.remove('flash-highlight'), 2000);
            const nextAnchor = element.id || targetId;
            manualNavigationLockRef.current = {
                anchorId: nextAnchor,
                expiresAt: Date.now() + MANUAL_NAVIGATION_HIGHLIGHT_LOCK_MS,
            };
            setActiveAnchorId(prev => (prev === nextAnchor ? prev : nextAnchor));
        } else {
            debug.warn('[Navigate] target not found:', targetId);
        }
    }, []); // Empty dependency array as it only uses refs or DOM APIs

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

    const resolveAutoScrollTargetReadiness = useCallback((container: HTMLElement) => {
        if (renderableCodeResults) {
            ensureSectionAnchors(renderableCodeResults, container);
        }

        if (!targetCandidates || targetCandidates.length === 0) {
            return false;
        }

        if (findExistingTargetElement(container, targetCandidates)) {
            return true;
        }

        const posicaoAlvo = renderableCodeResults ? getPosicaoAlvoFromResultados(renderableCodeResults) : null;
        const candidateNcm = posicaoAlvo || (data?.ncm || data?.query || '');
        if (!candidateNcm) {
            return false;
        }

        const fallback = ensureTargetAnchorFromDataNcm(container, candidateNcm);
        if (!fallback) {
            return false;
        }

        return !!findExistingTargetElement(container, targetCandidates);
    }, [
        renderableCodeResults,
        data?.ncm,
        data?.query,
        ensureSectionAnchors,
        getPosicaoAlvoFromResultados,
        targetCandidates,
    ]);

    // Stabilize onConsumeNewSearch callback to prevent AutoScroll effect loop
    const onConsumeNewSearchRef = useRef(onConsumeNewSearch);
    useEffect(() => {
        onConsumeNewSearchRef.current = onConsumeNewSearch;
    }, [onConsumeNewSearch]);

    const onPersistScrollRef = useRef(onPersistScroll);
    const hasConsumedNewSearchRef = useRef(false);
    useEffect(() => {
        onPersistScrollRef.current = onPersistScroll;
    }, [onPersistScroll]);
    useEffect(() => {
        hasConsumedNewSearchRef.current = false;
    }, [consumeNewSearchKey]);
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

    // Keep active term in sync with the latest text query for this tab.
    useEffect(() => {
        const normalizedLatestTextQuery = (latestTextQuery || '').trim();
        setActiveTerm(prev => (prev === normalizedLatestTextQuery ? prev : normalizedLatestTextQuery));
    }, [latestTextQuery, data?.query, tabId]);

    const consumeNewSearchScroll = useCallback((scrollTop?: number) => {
        if (hasConsumedNewSearchRef.current) return;
        hasConsumedNewSearchRef.current = true;
        onConsumeNewSearchRef.current(tabId, scrollTop);
    }, [tabId]);

    const handleAutoScrollComplete = useCallback((success?: boolean) => {
        if (!success) return;
        // Wrap in RAF to ensure DOM has updated/painted the scroll action
        // before we capture the final position and update app state.
        requestAnimationFrame(() => {
            const currentScroll = containerRef.current?.scrollTop || 0;
            consumeNewSearchScroll(currentScroll);
        });
    }, [consumeNewSearchScroll]);

    const handleHighlightScrollComplete = useCallback((scrollTop: number) => {
        if (!isActive || !isNewSearch) return;
        consumeNewSearchScroll(scrollTop);
    }, [consumeNewSearchScroll, isActive, isNewSearch]);

    // `isContentReady` means the tab can render, but auto-scroll only starts
    // once at least one candidate anchor is actually present in the DOM.
    // Only auto-scroll when:
    // 1. Tab is active
    // 2. This is a NEW search (not returning to existing tab)
    // 3. Let SearchHighlighter take precedence for text-result tabs, but keep anchor scroll as fallback elsewhere
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
    }, [data?.type, data?.markdown, renderableCodeResults]);

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
    const hasRestoredInitialScrollRef = useRef(false);
    useEffect(() => {
        // Skip restore if this is a new search - auto-scroll will handle positioning
        if (!isActive || isNewSearch) return;
        // Wait until content is rendered before restoring scroll
        if (!isContentReady) return;
        const element = containerRef.current;
        if (!element) return;

        if (typeof initialScrollTop !== 'number') return;
        const targetScrollTop = initialScrollTop;

        if (hasRestoredInitialScrollRef.current) return;
        if (Math.abs(element.scrollTop - targetScrollTop) < 1) return;

        requestAnimationFrame(() => {
            if (!containerRef.current) return;
            containerRef.current.scrollTop = targetScrollTop;
            latestScrollTopRef.current = targetScrollTop;
            hasRestoredInitialScrollRef.current = true;
        });
    }, [isActive, initialScrollTop, isNewSearch, isContentReady]);

    // Reset restored flag when inactive so it can restore again when returning
    useEffect(() => {
        if (!isActive) {
            hasRestoredInitialScrollRef.current = false;
        }
    }, [isActive]);



    // Render backend content (prefer HTML; parse markdown only as legacy fallback)
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
        } catch (e) {
            console.error("Content render error:", e);
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
            const ready = resolveAutoScrollTargetReadiness(container);
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
        resolveAutoScrollTargetReadiness,
        targetCandidates,
    ]);

    // Ensure structured section anchors exist for sidebar navigation/highlight syncing.
    useEffect(() => {
        if (!isContentReady || !renderableCodeResults || !containerRef.current) return;
        ensureSectionAnchors(renderableCodeResults, containerRef.current);
    }, [ensureSectionAnchors, isContentReady, renderableCodeResults]);

    // Query-term highlighting for code results.
    // Always clean previous wrappers first to avoid nested/duplicated marks after query changes.
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
    }, [activeTerm, isActive, isContentReady, searchHighlighterQuery, tabId, data?.type, data?.markdown]);

    // Sync Sidebar to current visible anchor
    useEffect(() => {
        if (!isActive || !isContentReady || !renderableCodeResults || !containerRef.current) return;

        const ids = getAnchorIdsFromResultados(renderableCodeResults);
        if (ids.length === 0) return;

        const elements = ids
            .map(id => containerRef.current?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null)
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
                threshold: 0.1
            }
        );

        elements.forEach(el => observer.observe(el));

        return () => observer.disconnect();
    }, [getAnchorIdsFromResultados, isActive, isContentReady, renderableCodeResults]);


    if (!data) {
        return <p className={styles.emptyMessage}>Sem resultados para exibir.</p>;
    }

    // Text Search Rendering
    if (data.type === 'text') {
        return (
            <div className={`${styles.content} ${styles.textSearchContent}`} ref={containerRef} id={containerId}>
                <TextSearchResults
                    results={(data.results as SearchResultItem[]) || null}
                    query={latestTextQuery || data.query || ""}
                    onResultClick={(ncm: string) => globalThis.nesh.openTextResultInNewTab(ncm, latestTextQuery || data.query || '')}
                    scrollParentRef={containerRef}
                />
            </div>
        );
    }

    // Default: Code View (Markdown + Sidebar)
    // Layout: Grid with content and sidebar (position from settings)
    const wrapperClasses = getWrapperClasses(styles, sidebarCollapsed, mobileMenuOpen, sidebarPosition);
    const sidebarToggleLabel = getSidebarToggleLabel(sidebarCollapsed);
    const sidebarToggleIcon = getSidebarToggleIcon(sidebarPosition, sidebarCollapsed);
    const contentVisibilityClass = getContentVisibilityClass(styles, isContentReady);
    const commentToggleLabel = getCommentToggleLabel(commentsEnabled);
    const commentToggleClasses = getCommentToggleClassName(styles, commentsEnabled);
    const shouldRenderSidebar = isActive && !!renderableCodeResults;

    return (
        <div className={wrapperClasses}>
            {/* Toggle Button */}
            <button
                className={styles.sidebarToggle}
                onClick={toggleSidebar}
                aria-label={sidebarToggleLabel}
            >
                {sidebarToggleIcon}
            </button>

            {/* Content scroll container - Coluna 1 */}
            <div
                className={`${styles.content} ${contentVisibilityClass} markdown-body`}
                ref={(el) => {
                    // containerRef = scroll container (para scroll tracking e texto selection)
                    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                }}
                id={containerId}
            >
                {/* O container interno organiza o conteúdo da esquerda verticalmente (mensagens + texto) */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    {shouldHydrateCodeResults && (isHydratingCodeResults || missingChapterBodies.length > 0) && (
                        <div className={styles.loadingSpinnerContainer}>
                            <svg className={styles.spinner} viewBox="0 0 50 50">
                                <circle className={styles.spinnerPath} cx="25" cy="25" r="20" fill="none" strokeWidth="5"></circle>
                            </svg>
                            <p className={styles.loadingText}>Carregando conteúdo detalhado...</p>
                        </div>
                    )}
                    {!shouldHydrateCodeResults && !data.markdown && !isTipiResults(renderableCodeResults || null) && (
                        <p>Sem resultados para exibir.</p>
                    )}
                    
                    {/* Texto renderizado via fragmentos HTML sanitizados */}
                    <div
                        className={styles.contentText}
                        ref={(el) => {
                            (contentRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                        }}
                    />
                </div>

                {/* Painel de Comentários (Google Docs style) — só exibido quando ativado */}
                {canUseRestrictedUi && commentsEnabled && (
                    <CommentPanel
                        pending={pendingComment}
                        comments={localComments}
                        onSubmit={handleCommentSubmit}
                        onDismiss={handleDismissComment}
                        onEdit={editComment}
                        onDelete={removeComment}
                        currentUserId={userId}
                    />
                )}
            </div>

            {searchHighlighterQuery && (
                <SearchHighlighter
                    query={searchHighlighterQuery}
                    contentContainerRef={contentRef}
                    isContentReady={isContentReady}
                    isFullyRendered={isFullyRendered}
                    onHighlightScrollComplete={handleHighlightScrollComplete}
                />
            )}

            {/* Toggle de Comentários */}
            {canUseRestrictedUi && (
                <button
                    className={commentToggleClasses}
                    onClick={toggleComments}
                    aria-label={commentToggleLabel}
                    title={commentToggleLabel}
                >
                    💬
                </button>
            )}

            {/* Botão bolha flutuante (aparece ao selecionar texto, se comentários ativos) */}
            {canUseRestrictedUi && commentsEnabled && selection && (
                <HighlightPopover
                    selection={selection}
                    onRequestComment={handleOpenComment}
                    onPopoverMouseDown={onPopoverMouseDown}
                />
            )}

            {/* Drawer de Comentários — responsivo < 1280px */}
            {canUseRestrictedUi && commentsEnabled && (
                <CommentDrawer
                    open={drawerOpen}
                    onClose={toggleDrawer}
                    pending={pendingComment}
                    comments={localComments}
                    onSubmit={handleCommentSubmit}
                    onDismiss={handleDismissComment}
                    onEdit={editComment}
                    onDelete={removeComment}
                    currentUserId={userId}
                />
            )}

            {/* Sidebar Container - Coluna 2 */}
            {shouldRenderSidebar && (
                <div className={styles.sidebarContainer}>
                    <Sidebar
                        results={renderableCodeResults}
                        onNavigate={handleNavigate}
                        isOpen={mobileMenuOpen}
                        onClose={onCloseMobileMenu}
                        searchQuery={latestTextQuery || data.query || data.ncm}
                        activeAnchorId={activeAnchorId}
                    />
                </div>
            )}
        </div>
    );
});


