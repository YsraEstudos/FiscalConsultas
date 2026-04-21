import { marked } from 'marked';

import { NeshRenderer } from '../../utils/NeshRenderer';
import {
    appendTrustedHtmlToElement,
    replaceElementWithTrustedHtml,
    sanitizeRichHtml,
} from '../../utils/contentSecurity';

import { isLikelyLegacyMarkdown, isTipiResults, renderTipiFallback } from './ResultTipiFallback';
import type { MarkupRenderOptions, ResultRecord } from './types';

const SHARED_MARKUP_CACHE_MAX = 12;
const CHUNK_SIZE_THRESHOLD = 50_000;
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

export function resolveMarkupToRender(
    rawMarkdown: string,
    codeResults: ResultRecord | null,
): string {
    if (rawMarkdown) return rawMarkdown;
    if (!codeResults) return '';
    if (isTipiResults(codeResults)) {
        return renderTipiFallback(codeResults);
    }

    console.warn('[ResultDisplay] Fallback NeshRenderer used - backend should send markdown');
    return NeshRenderer.renderFullResponse(codeResults);
}

function getCachedRawMarkup(
    cacheKey: string,
    shouldParseMarkdown: boolean,
    markupToRender: string,
    lastMarkupRef: MarkupRenderOptions['refs']['lastMarkupRef'],
    lastHtmlRef: MarkupRenderOptions['refs']['lastHtmlRef'],
): string {
    const reusableMarkup = lastMarkupRef.current === cacheKey ? lastHtmlRef.current : null;
    if (reusableMarkup) {
        cacheSet(sharedRawMarkupCache, cacheKey, reusableMarkup);
        return reusableMarkup;
    }

    const cachedRawMarkup = cacheGet(sharedRawMarkupCache, cacheKey);
    if (cachedRawMarkup) return cachedRawMarkup;

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
    contentRef: MarkupRenderOptions['refs']['contentRef'],
    finalMarkup: string,
    cacheKey: string,
    renderedMarkupKeyRef: MarkupRenderOptions['refs']['renderedMarkupKeyRef'],
    setIsContentReady: MarkupRenderOptions['setIsContentReady'],
    setIsFullyRendered: MarkupRenderOptions['setIsFullyRendered'],
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
    contentRef: MarkupRenderOptions['refs']['contentRef'],
    finalMarkup: string,
    cacheKey: string,
    renderedMarkupKeyRef: MarkupRenderOptions['refs']['renderedMarkupKeyRef'],
    setIsContentReady: MarkupRenderOptions['setIsContentReady'],
    setIsFullyRendered: MarkupRenderOptions['setIsFullyRendered'],
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

export function renderMarkupContent(options: MarkupRenderOptions): (() => void) | undefined {
    const { rawMarkdown, markupToRender, isActive, isContentReady, refs, setIsContentReady, setIsFullyRendered } = options;
    const container = refs.contentRef.current;
    if (!container) return undefined;

    const shouldParseMarkdown = !!rawMarkdown && isLikelyLegacyMarkdown(markupToRender);
    const cacheKey = `${shouldParseMarkdown ? 'md' : 'html'}:${markupToRender}`;

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
        return renderSmallMarkup(
            refs.contentRef,
            finalMarkup,
            cacheKey,
            refs.renderedMarkupKeyRef,
            setIsContentReady,
            setIsFullyRendered,
        );
    }

    return renderChunkedMarkup(
        refs.contentRef,
        finalMarkup,
        cacheKey,
        refs.renderedMarkupKeyRef,
        setIsContentReady,
        setIsFullyRendered,
    );
}
