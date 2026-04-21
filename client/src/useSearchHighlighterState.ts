import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    buildAccentInsensitivePattern,
    clearSearchHighlights,
    collectSearchHighlighterQuality,
    getNodeTopWithinScrollContainer,
    notifyAfterScrollSettles,
    resolveScrollContainer,
    type SearchHighlighterCoOccurrenceScope,
    type SearchHighlighterMatchInstance,
    type SearchHighlighterMatchQuality,
    stripDiacritics,
} from './components/SearchHighlighterMatchAnalysis';

export interface SearchHighlighterProps {
    query?: string | null;
    contentContainerRef: RefObject<HTMLElement | null>;
    isContentReady: boolean;
    isFullyRendered?: boolean;
    onHighlightScrollComplete?: (scrollTop: number) => void;
}

export interface SearchHighlighterState {
    matches: Record<string, SearchHighlighterMatchInstance[]>;
    terms: string[];
    activeTerm: string | null;
    setActiveTerm: Dispatch<SetStateAction<string | null>>;
    activeIndices: Record<string, number>;
    matchQuality: SearchHighlighterMatchQuality;
    coOccurrenceCount: number;
    coOccurrenceScope: SearchHighlighterCoOccurrenceScope;
    highSubpositionKeys: string[];
    isVisible: boolean;
    handleNext: () => void;
    handlePrev: () => void;
    handleManualJump: (event: ChangeEvent<HTMLSelectElement>) => void;
    handleClose: () => void;
}

export function useSearchHighlighterState({
    query,
    contentContainerRef,
    isContentReady,
    isFullyRendered,
    onHighlightScrollComplete,
}: SearchHighlighterProps): SearchHighlighterState {
    const [matches, setMatches] = useState<Record<string, SearchHighlighterMatchInstance[]>>({});
    const [terms, setTerms] = useState<string[]>([]);
    const [activeTerm, setActiveTerm] = useState<string | null>(null);
    const [activeIndices, setActiveIndices] = useState<Record<string, number>>({});
    const [matchQuality, setMatchQuality] = useState<SearchHighlighterMatchQuality>('NENHUM');
    const [coOccurrenceCount, setCoOccurrenceCount] = useState(0);
    const [coOccurrenceScope, setCoOccurrenceScope] = useState<SearchHighlighterCoOccurrenceScope>('subposition');
    const [highSubpositionKeys, setHighSubpositionKeys] = useState<string[]>([]);
    const [isVisible, setIsVisible] = useState(true);
    const hasAutoJumpedRef = useRef(false);
    const activeTermRef = useRef<string | null>(null);
    const pendingScrollCompletionCleanupRef = useRef<(() => void) | null>(null);

    const clearPendingScrollCompletion = useCallback(() => {
        pendingScrollCompletionCleanupRef.current?.();
        pendingScrollCompletionCleanupRef.current = null;
    }, []);

    const reportHighlightScrollCompletion = useCallback(() => {
        const contentContainer = contentContainerRef.current;
        if (!contentContainer) {
            onHighlightScrollComplete?.(0);
            return;
        }

        clearPendingScrollCompletion();
        const scrollContainer = resolveScrollContainer(contentContainer);
        pendingScrollCompletionCleanupRef.current = notifyAfterScrollSettles(
            scrollContainer,
            onHighlightScrollComplete,
        );
    }, [clearPendingScrollCompletion, contentContainerRef, onHighlightScrollComplete]);

    useEffect(() => {
        hasAutoJumpedRef.current = false;
        clearPendingScrollCompletion();
    }, [clearPendingScrollCompletion, query]);

    useEffect(() => {
        activeTermRef.current = activeTerm;
    }, [activeTerm]);

    useEffect(() => () => clearPendingScrollCompletion(), [clearPendingScrollCompletion]);

    const normalizedTerms = useMemo(() => {
        const trimmedQuery = query?.trim() ?? '';
        if (!trimmedQuery) {
            return [];
        }

        const words = stripDiacritics(trimmedQuery.toLowerCase())
            .replaceAll(/[.,;:[\](){}]/g, ' ')
            .split(/\s+/)
            .filter((token) => token.length > 0)
            .filter((token) => token.length > 2 || trimmedQuery.length <= 2);

        return Array.from(new Set(words));
    }, [query]);

    useEffect(() => {
        if (!isContentReady || !isFullyRendered || !contentContainerRef.current || normalizedTerms.length === 0) {
            setMatches({});
            setTerms([]);
            setActiveTerm(null);
            setActiveIndices({});
            setMatchQuality('NENHUM');
            setCoOccurrenceCount(0);
            setCoOccurrenceScope('subposition');
            setHighSubpositionKeys([]);
            return;
        }

        const container = contentContainerRef.current;
        const newMatches: Record<string, SearchHighlighterMatchInstance[]> = {};
        normalizedTerms.forEach((term) => {
            newMatches[term] = [];
        });

        clearSearchHighlights(container);

        const termRegexes = normalizedTerms.map((term) => {
            const pattern = buildAccentInsensitivePattern(term);
            return new RegExp(pattern, 'i');
        });

        const treeWalker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    const parent = node.parentElement;
                    if (
                        parent
                        && (
                            parent.tagName === 'SCRIPT'
                            || parent.tagName === 'STYLE'
                            || parent.dataset.shTerm !== undefined
                            || parent.dataset.shWrapper !== undefined
                        )
                    ) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    const value = node.nodeValue;
                    if (!value?.trim()) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    if (termRegexes.some((regex) => regex.test(value))) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_REJECT;
                },
            },
        );

        const nodesToProcess: Text[] = [];
        let currentNode = treeWalker.nextNode();
        while (currentNode) {
            nodesToProcess.push(currentNode as Text);
            currentNode = treeWalker.nextNode();
        }

        [...nodesToProcess].reverse().forEach((textNode) => {
            const parent = textNode.parentNode;
            if (!parent) {
                return;
            }

            const originalText = textNode.nodeValue || '';
            if (!originalText) {
                return;
            }

            type MatchRange = { start: number; end: number; term: string; priority: number };
            const allRanges: MatchRange[] = [];

            normalizedTerms.forEach((term, priority) => {
                const accentPattern = buildAccentInsensitivePattern(term);
                if (!accentPattern) {
                    return;
                }

                const regex = new RegExp(accentPattern, 'gi');
                let match = regex.exec(originalText);
                while (match) {
                    const matchedText = match[0];
                    if (!matchedText) {
                        regex.lastIndex += 1;
                        match = regex.exec(originalText);
                        continue;
                    }

                    allRanges.push({
                        start: match.index,
                        end: match.index + matchedText.length,
                        term,
                        priority,
                    });
                    match = regex.exec(originalText);
                }
            });

            if (allRanges.length === 0) {
                return;
            }

            const rankedRanges = [...allRanges].sort((a, b) => {
                const lengthDiff = (b.end - b.start) - (a.end - a.start);
                if (lengthDiff !== 0) {
                    return lengthDiff;
                }
                const priorityDiff = a.priority - b.priority;
                if (priorityDiff !== 0) {
                    return priorityDiff;
                }
                return a.start - b.start;
            });

            const occupied = new Array(originalText.length).fill(false);
            const selectedRanges: MatchRange[] = [];

            for (const range of rankedRanges) {
                let overlaps = false;
                for (let i = range.start; i < range.end; i += 1) {
                    if (occupied[i]) {
                        overlaps = true;
                        break;
                    }
                }
                if (overlaps) {
                    continue;
                }

                for (let i = range.start; i < range.end; i += 1) {
                    occupied[i] = true;
                }
                selectedRanges.push(range);
            }

            if (selectedRanges.length === 0) {
                return;
            }

            selectedRanges.sort((a, b) => a.start - b.start);

            const wrapper = document.createElement('span');
            wrapper.dataset.shWrapper = '1';
            let cursor = 0;
            for (const range of selectedRanges) {
                if (range.start > cursor) {
                    wrapper.appendChild(document.createTextNode(originalText.slice(cursor, range.start)));
                }
                const mark = document.createElement('mark');
                mark.dataset.shTerm = range.term;
                mark.className = 'search-highlight search-highlight-partial';
                mark.textContent = originalText.slice(range.start, range.end);
                wrapper.appendChild(mark);
                cursor = range.end;
            }
            if (cursor < originalText.length) {
                wrapper.appendChild(document.createTextNode(originalText.slice(cursor)));
            }

            textNode.replaceWith(wrapper);

            const marks = wrapper.querySelectorAll('mark[data-sh-term]');
            marks.forEach((mark) => {
                const matchedTerm = (mark as HTMLElement).dataset.shTerm;
                if (matchedTerm && newMatches[matchedTerm]) {
                    newMatches[matchedTerm].push({
                        node: mark as HTMLElement,
                        term: matchedTerm,
                        index: newMatches[matchedTerm].length,
                    });
                }
            });
        });

        normalizedTerms.forEach((term) => {
            newMatches[term].reverse();
            newMatches[term].forEach((match, idx) => {
                match.index = idx;
            });
        });

        setTerms(normalizedTerms);
        setMatches(newMatches);

        const indices: Record<string, number> = {};
        const currentActiveTerm = activeTermRef.current;
        let nextActiveTerm = (
            currentActiveTerm
            && normalizedTerms.includes(currentActiveTerm)
            && (newMatches[currentActiveTerm]?.length ?? 0) > 0
        ) ? currentActiveTerm : null;

        const scrollContainer = resolveScrollContainer(container);
        const containerScrollTop = scrollContainer.scrollTop || 0;

        normalizedTerms.forEach((term) => {
            indices[term] = 0;
            if (newMatches[term].length > 0) {
                if (!nextActiveTerm) {
                    nextActiveTerm = term;
                }

                let closestIndex = 0;
                let minDiff = Infinity;
                newMatches[term].forEach((match, idx) => {
                    const relativeTop = getNodeTopWithinScrollContainer(match.node, scrollContainer);
                    const diff = Math.abs(relativeTop - containerScrollTop);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestIndex = idx;
                    }
                });
                indices[term] = closestIndex;
            }
        });

        setActiveIndices(indices);
        setActiveTerm(nextActiveTerm);

        const qualityInsights = collectSearchHighlighterQuality(newMatches, normalizedTerms, container);
        setMatchQuality(qualityInsights.matchQuality);
        setCoOccurrenceCount(qualityInsights.coOccurrenceCount);
        setCoOccurrenceScope(qualityInsights.coOccurrenceScope);
        setHighSubpositionKeys(qualityInsights.highSubpositionKeys);
        setIsVisible(true);

        return () => clearSearchHighlights(container);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isContentReady, isFullyRendered, query, contentContainerRef, normalizedTerms]);

    useEffect(() => {
        if (!isFullyRendered || !contentContainerRef.current) {
            return;
        }

        const container = contentContainerRef.current;

        container.querySelectorAll('.high-correspondence-zone').forEach((el) => el.classList.remove('high-correspondence-zone'));
        container.querySelectorAll('.search-highlight-high').forEach((el) => {
            el.classList.remove('search-highlight-high');
            el.classList.add('search-highlight-partial');
        });

        const hasHighSubpositionTargets = highSubpositionKeys.length > 0;

        if (hasHighSubpositionTargets) {
            highSubpositionKeys.forEach((id) => {
                const section = container.querySelector(`[id="${CSS.escape(id)}"]`);
                if (section) {
                    section.classList.add('high-correspondence-zone');
                    section.querySelectorAll('mark.search-highlight').forEach((mark) => {
                        mark.classList.remove('search-highlight-partial');
                        mark.classList.add('search-highlight-high');
                    });
                }
            });
        }

        if (normalizedTerms.length > 1 && hasHighSubpositionTargets && !hasAutoJumpedRef.current) {
            hasAutoJumpedRef.current = true;
            const jumpCandidates = highSubpositionKeys.filter((id) => {
                const section = container.querySelector(`[id="${CSS.escape(id)}"]`);
                if (!section) {
                    return true;
                }
                const text = (section.textContent || '').toLowerCase();
                return !text.includes(' - partes');
            });

            const bestCandidateId = jumpCandidates.length > 0 ? jumpCandidates[0] : highSubpositionKeys[0];
            if (bestCandidateId) {
                const element = container.querySelector(`[id="${CSS.escape(bestCandidateId)}"]`);
                if (element) {
                    setTimeout(() => {
                        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        reportHighlightScrollCompletion();
                    }, 50);
                }
            }
        } else if (normalizedTerms.length === 1 && !hasAutoJumpedRef.current && (matches[activeTerm ?? '']?.length ?? 0) > 0) {
            hasAutoJumpedRef.current = true;
            const match = matches[activeTerm ?? '']?.[0];
            if (match?.node) {
                setTimeout(() => {
                    match.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    reportHighlightScrollCompletion();
                }, 50);
            }
        }
    }, [activeTerm, contentContainerRef, highSubpositionKeys, isFullyRendered, matches, normalizedTerms.length, reportHighlightScrollCompletion]);

    useEffect(() => {
        if (!activeTerm || (matches[activeTerm]?.length ?? 0) === 0) {
            return;
        }

        if (!hasAutoJumpedRef.current) {
            return;
        }

        const currentIndex = activeIndices[activeTerm] || 0;
        const match = matches[activeTerm][currentIndex];

        if (match?.node) {
            const container = contentContainerRef.current;
            if (container) {
                container.querySelectorAll('mark[data-sh-term].active').forEach((node) => {
                    node.classList.remove('active');
                });
            }

            match.node.classList.add('active');
            match.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [activeTerm, activeIndices, matches, contentContainerRef]);

    const handleNext = useCallback(() => {
        if (!activeTerm) {
            return;
        }

        setActiveIndices((previous) => {
            const max = matches?.[activeTerm]?.length ?? 0;
            if (max === 0) {
                return previous;
            }
            const current = Number.isFinite(previous?.[activeTerm]) ? previous[activeTerm] : 0;
            return {
                ...previous,
                [activeTerm]: (current + 1) % max,
            };
        });
    }, [activeTerm, matches]);

    const handlePrev = useCallback(() => {
        if (!activeTerm) {
            return;
        }

        setActiveIndices((previous) => {
            const max = matches?.[activeTerm]?.length ?? 0;
            if (max === 0) {
                return previous;
            }
            const current = Number.isFinite(previous?.[activeTerm]) ? previous[activeTerm] : 0;
            return {
                ...previous,
                [activeTerm]: (current - 1 + max) % max,
            };
        });
    }, [activeTerm, matches]);

    const handleManualJump = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
        const id = event.target.value;
        if (!id || !contentContainerRef.current) {
            return;
        }

        const element = contentContainerRef.current.querySelector(`[id="${CSS.escape(id)}"]`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [contentContainerRef]);

    const handleClose = useCallback(() => {
        setIsVisible(false);
    }, []);

    return {
        matches,
        terms,
        activeTerm,
        setActiveTerm,
        activeIndices,
        matchQuality,
        coOccurrenceCount,
        coOccurrenceScope,
        highSubpositionKeys,
        isVisible,
        handleNext,
        handlePrev,
        handleManualJump,
        handleClose,
    };
}
