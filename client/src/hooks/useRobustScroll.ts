import { useEffect, useRef } from "react";
import { debug } from "../utils/debug";

interface UseRobustScrollProps {
  targetId: string | string[] | null;
  containerRef: React.RefObject<HTMLElement | null> | null;
  shouldScroll?: boolean;
  onComplete?: (success: boolean) => void;
  expectedTags?: string[];
}

/**
 * Hook to robustly scroll to an element by ID, handling:
 * 1. Special characters in IDs (dots, slashes)
 * 2. Dynamic content loading (MutationObserver)
 * 3. Layout reflows (Multiple attempts)
 * 4. Duplicate IDs (Smart selection based on tag priority)

/**
 * Hook to robustly scroll to an element by ID, handling:
 * 1. Special characters in IDs (dots, slashes)
 * 2. Dynamic content loading (MutationObserver)
 * 3. Layout reflows (Multiple attempts)
 * 4. Duplicate IDs (Smart selection based on tag priority)
 */
export function useRobustScroll({
  targetId,
  containerRef,
  shouldScroll = true,
  onComplete,
  expectedTags = [
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "ARTICLE",
    "SECTION",
    "DIV",
    "SPAN",
  ],
}: UseRobustScrollProps) {
  const attemptsRef = useRef(0);
  const observerRef = useRef<MutationObserver | null>(null);
  const hasScrolledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when target changes or shouldScroll re-triggers
  useEffect(() => {
    if (targetId && shouldScroll) {
      hasScrolledRef.current = false;
      attemptsRef.current = 0;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (observerRef.current) observerRef.current.disconnect();
      if (settleRef.current) clearTimeout(settleRef.current);
    }
  }, [targetId, shouldScroll]);

  const TAG_PRIORITY: Record<string, number> = {
    H6: 130,
    H5: 120,
    H4: 110,
    H3: 100,
    H2: 90,
    H1: 80,
    ARTICLE: 70,
    SECTION: 60,
    DIV: 50,
  };

  /**
   * Core scroll logic
   */
  useEffect(() => {
    // Basic validation
    if (!targetId || !containerRef?.current) return;

    // Control flag check
    if (!shouldScroll) return;

    // Single execution protection
    if (hasScrolledRef.current) return;

    const targets = Array.isArray(targetId) ? targetId : [targetId];
    const root = containerRef?.current || document.body;

    debug.log("[RobustScroll] INITIALIZING for targets:", targets);

    const findTarget = (): HTMLElement | null => {
      let bestMatch: HTMLElement | null = null;
      let bestScore = -1;

      for (const id of targets) {
        const elements = root.querySelectorAll<HTMLElement>(
          `#${CSS.escape(id)}`,
        );
        debug.log(
          `[RobustScroll] ID "${id}": ${elements.length} elements found`,
        );

        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          const tagName = el.tagName;

          if (
            expectedTags &&
            expectedTags.length > 0 &&
            !expectedTags.includes(tagName)
          ) {
            debug.log(`[RobustScroll] SKIP #${i}: tag=${tagName}`);
            continue;
          }

          const score = TAG_PRIORITY[tagName] || 1;
          debug.log(
            `[RobustScroll] CANDIDATE #${i}: tag=${tagName}, score=${score}`,
          );

          if (score > bestScore) {
            bestScore = score;
            bestMatch = el;
          }
        }
      }

      if (bestMatch) {
        debug.log(
          `[RobustScroll] WINNER: ${bestMatch.tagName}#${bestMatch.id}`,
        );
      } else {
        debug.warn(`[RobustScroll] NO TARGET for: ${targets.join(", ")}`);
      }
      return bestMatch;
    };

    const doScroll = (element: HTMLElement) => {
      if (!element) return;

      debug.log(`[RobustScroll] SCROLLING to:`, element);

      // 1. Native scrollIntoView
      try {
        element.scrollIntoView({
          block: "start",
          inline: "nearest",
          behavior: "auto", // Force instant scroll for reliability
        });
      } catch (e) {
        console.error("[RobustScroll] scrollIntoView failed:", e);
      }

      // 2. Flash Highlight (if style available)
      element.classList.add("flash-highlight");
      // Remove class after animation to allow re-trigger
      setTimeout(() => {
        element.classList.remove("flash-highlight");
      }, 3000);
    };

    const finalizeSuccess = () => {
      hasScrolledRef.current = true;
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (onComplete) onComplete(true);
    };

    const attemptScroll = () => {
      const el = findTarget();
      if (el) {
        doScroll(el);

        // Single safety re-scroll after layout settles
        settleRef.current = setTimeout(() => {
          const el2 = findTarget() || el;
          doScroll(el2);
          finalizeSuccess();
        }, 300);

        return true;
      }
      return false;
    };

    // 1. Try immediately
    if (attemptScroll()) return;

    // 2. If not found, Observe DOM changes
    debug.log("[RobustScroll] Target not found, starting MutationObserver...");

    const observerCallback = (
      mutations: MutationRecord[],
      obs: MutationObserver,
    ) => {
      if (hasScrolledRef.current) return;

      const hasAddedNodes = mutations.some((m) => m.addedNodes.length > 0);
      if (!hasAddedNodes) return;

      if (attemptScroll()) {
        debug.log("[RobustScroll] Found via MutationObserver!");
        obs.disconnect();
      }
    };

    const observer = new MutationObserver(observerCallback);
    observerRef.current = observer;

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["id", "class"],
    });

    // 3. Fallback timeout to stop observing
    timeoutRef.current = setTimeout(() => {
      if (!hasScrolledRef.current) {
        debug.warn("[RobustScroll] Timed out waiting for target.");
        observer.disconnect();
        if (onComplete) onComplete(false);
      }
    }, 5000); // 5s max wait

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (settleRef.current) clearTimeout(settleRef.current);
    };
  }, [targetId, containerRef, shouldScroll, onComplete]); // Dependencies updated
}
