import { useEffect, useRef, RefObject } from 'react';
import { debug } from '../utils/debug';

/**
 * Hook to auto-scroll to an element once it appears in the DOM.
 * Uses MutationObserver to detect async rendering (e.g., Markdown).
 * Prefers direct container scroll for reliable nested scroll behavior.
 * 
 * @param targetId - Target ID or list of IDs (without #)
 * @param shouldScroll - Flag to enable/disable scroll
 * @param containerRef - Ref to scrollable container (optional, default: document)
 * @param onComplete - Callback when scroll completes (success: boolean)
 */
export function useAutoScroll(
    targetId: string | string[] | null,
    shouldScroll: boolean = true,
    containerRef: RefObject<HTMLElement | null> | null = null,
    onComplete?: (success: boolean) => void
) {
    const observerRef = useRef<MutationObserver | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    // Track the last scrolled target to prevent re-scroll on tab switch
    const lastScrolledRef = useRef<string | null>(null);

    // Normalize targetId to array
    const targets = Array.isArray(targetId) ? targetId : (targetId ? [targetId] : []);
    const targetKey = targets.join(',');

    useEffect(() => {
        // Clean up observers when target changes or component unmounts
        return () => {
            if (observerRef.current) observerRef.current.disconnect();
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [targetKey]);

    useEffect(() => {
        if (!shouldScroll || targets.length === 0) {
            debug.log('[AutoScroll] Skipping: shouldScroll=', shouldScroll, 'targets=', targets);
            return;
        }

        debug.log('[AutoScroll] Starting. Targets:', targets);

        const rootNode = containerRef?.current || document;
        const container = containerRef?.current;
        let successfulScrollCount = 0;

        // Check if container is actually scrollable
        const isContainerScrollable = container
            ? container.scrollHeight > container.clientHeight
            : false;

        debug.log('[AutoScroll] Container scrollable:', isContainerScrollable,
            container ? `(scrollHeight: ${container.scrollHeight}, clientHeight: ${container.clientHeight})` : '(no container)');

        const attemptScroll = (source: string): boolean => {
            // Try to find ANY of the targets
            for (const id of targets) {
                const selector = '#' + CSS.escape(id);
                const element = rootNode.querySelector(selector) as HTMLElement;

                if (element) {
                    debug.log(`[AutoScroll] Trigger: ${source} -> Found element with id="${id}"`);

                    // Prefer scrolling the container directly when available (more reliable on nested scroll)
                    const scrollParent = container && container.contains(element) ? container : null;
                    if (scrollParent) {
                        const containerRect = scrollParent.getBoundingClientRect();
                        const elementRect = element.getBoundingClientRect();
                        const scrollPaddingTop = parseFloat(getComputedStyle(scrollParent).scrollPaddingTop || '0');
                        const targetTop = elementRect.top - containerRect.top + scrollParent.scrollTop - scrollPaddingTop;

                        if (typeof scrollParent.scrollTo === 'function') {
                            scrollParent.scrollTo({ top: Math.max(targetTop, 0), behavior: 'auto' });
                        } else {
                            scrollParent.scrollTop = Math.max(targetTop, 0);
                        }
                    } else {
                        // Fallback to native scrollIntoView (window scroll)
                        element.scrollIntoView({ behavior: 'auto', block: 'start' });
                    }

                    // Highlight logic (idempotent)
                    let highlightTarget: HTMLElement = element;
                    if (element.classList.contains('scroll-anchor') && element.nextElementSibling) {
                        highlightTarget = element.nextElementSibling as HTMLElement;
                    }
                    if (!highlightTarget.classList.contains('flash-highlight')) {
                        requestAnimationFrame(() => highlightTarget.classList.add('flash-highlight'));
                        setTimeout(() => highlightTarget.classList.remove('flash-highlight'), 3500);
                    }

                    successfulScrollCount++;
                    lastScrolledRef.current = targetKey;

                    // Immediately notify success so parent can consume the flag (e.g. isNewSearch = false)
                    if (successfulScrollCount >= 1) {
                        debug.log('[AutoScroll] Success! Notifying completion.');
                        if (onComplete) onComplete(true);
                    }
                    return true;
                }
            }
            debug.log(`[AutoScroll] Trigger: ${source} -> No targets found in DOM yet.`);
            return false;
        };

        // 1. Initial Attempt
        attemptScroll('initial');

        // Simple debounce function
        const debounce = (func: Function, wait: number) => {
            let timeout: NodeJS.Timeout;
            return (...args: any[]) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => func(...args), wait);
            };
        };

        const debouncedAttempt = debounce(() => attemptScroll('observer'), 50);

        // 2. ResizeObserver: Reacts to Sidebar opening, Images loading, etc.
        const resizeObserver = new ResizeObserver(() => {
            // Re-apply scroll if layout shifts occur while we are still "focused" on this search
            // We only do this for a short window (e.g. 2 seconds) or until user interacts
            debouncedAttempt();
        });

        // 3. MutationObserver: Reacts to new nodes (lazy loading)
        const mutationObserver = new MutationObserver(() => {
            debouncedAttempt();
        });

        if (container) {
            resizeObserver.observe(container);
            mutationObserver.observe(container, { childList: true, subtree: true });
        } else {
            debug.log('[AutoScroll] No container provided. Skipping global observer.');
        }

        observerRef.current = mutationObserver;

        // Cleanup / Fail-safe
        // Stop reacting to layout shifts after 3 seconds (assume UI is stable)
        // This prevents the page from "fighting" the user if they try to scroll away
        const stopEnforcementTimeout = setTimeout(() => {
            resizeObserver.disconnect();
            mutationObserver.disconnect();
            if (onComplete) {
                // Only report failure if we NEVER scrolled. If we scrolled at least once, it was a success.
                // We check lastScrolledRef vs targetKey to imply success.
                onComplete(lastScrolledRef.current === targetKey);
            }
        }, 3000);

        return () => {
            resizeObserver.disconnect();
            mutationObserver.disconnect();
            clearTimeout(stopEnforcementTimeout);
        };

    }, [targetKey, shouldScroll, containerRef, onComplete]);
}
