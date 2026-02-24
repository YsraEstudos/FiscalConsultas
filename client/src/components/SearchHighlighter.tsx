import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { ChevronUp, ChevronDown, X, Target } from 'lucide-react';
import styles from './SearchHighlighter.module.css';

interface MatchInstance {
    node: HTMLElement;
    term: string;
    index: number;
}

type MatchQuality = 'ALTO' | 'PEQUENO' | 'NENHUM';
type CoOccurrenceScope = 'subposition' | 'block';

interface MatchQualityResult {
    matchQuality: MatchQuality;
    coOccurrenceCount: number;
    coOccurrenceScope: CoOccurrenceScope;
}

interface SearchHighlighterProps {
    query?: string | null;
    contentContainerRef: React.RefObject<HTMLElement | null>;
    isContentReady: boolean;
}

// Block elements that usually denote a "paragraph" or chunk of meaning
const BLOCK_ELEMENTS = new Set(['P', 'LI', 'DIV', 'TD', 'TH', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

function escapeHtmlAttribute(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

/**
 * Strip diacritics/accents from a string.
 * e.g. "centrífuga" → "centrifuga", "ação" → "acao"
 */
function stripDiacritics(text: string): string {
    return text.normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '');
}

/**
 * Build a regex pattern where each letter also matches its accented variants.
 * e.g. "centrif" → "c[eéèêë]ntr[iíìîï]f" so it matches "centríf" in the DOM.
 */
function buildAccentInsensitivePattern(term: string): string {
    const ACCENT_MAP: Record<string, string> = {
        a: '[aáàâãäå]', e: '[eéèêë]', i: '[iíìîï]',
        o: '[oóòôõö]', u: '[uúùûü]', c: '[cç]', n: '[nñ]',
    };
    return term
        .split('')
        .map(ch => {
            const escaped = ch.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
            return ACCENT_MAP[ch] || escaped;
        })
        .join('');
}

type ResolveSubpositionKeyFn = (node: HTMLElement, container: HTMLElement) => string | null;

function getNoMatchResult(): MatchQualityResult {
    return { matchQuality: 'NENHUM', coOccurrenceCount: 0, coOccurrenceScope: 'subposition' };
}

function addTermToMap<K>(map: Map<K, Set<string>>, key: K, term: string): void {
    const existing = map.get(key);
    if (existing) {
        existing.add(term);
        return;
    }
    map.set(key, new Set([term]));
}

function isChapterElement(element: HTMLElement): boolean {
    return element.id?.startsWith('cap-') || element.id?.startsWith('chapter-') || element.classList.contains('tipi-chapter');
}

function findClosestContext(node: HTMLElement, rootContainer: HTMLElement): { closestBlock: HTMLElement | null; closestChapter: HTMLElement | null } {
    let current: HTMLElement | null = node;
    let closestBlock: HTMLElement | null = null;
    let closestChapter: HTMLElement | null = null;

    while (current && current !== rootContainer) {
        if (!closestBlock && BLOCK_ELEMENTS.has(current.tagName)) {
            closestBlock = current;
        }
        if (isChapterElement(current)) {
            closestChapter = current;
        }
        current = current.parentElement;
    }

    return { closestBlock, closestChapter };
}

function buildTermMaps(
    currentMatches: Record<string, MatchInstance[]>,
    allTerms: string[],
    container: HTMLElement,
    resolveSubpositionKey: ResolveSubpositionKeyFn
): {
    subpositionTermMap: Map<string, Set<string>>;
    blockTermMap: Map<HTMLElement, Set<string>>;
    chapterTermMap: Map<HTMLElement, Set<string>>;
} {
    const subpositionTermMap = new Map<string, Set<string>>();
    const blockTermMap = new Map<HTMLElement, Set<string>>();
    const chapterTermMap = new Map<HTMLElement, Set<string>>();

    for (const term of allTerms) {
        const matchesForTerm = currentMatches[term] ?? [];
        for (const match of matchesForTerm) {
            const subpositionKey = resolveSubpositionKey(match.node, container);
            if (subpositionKey) {
                addTermToMap(subpositionTermMap, subpositionKey, term);
            }

            const { closestBlock, closestChapter } = findClosestContext(match.node, container);
            if (closestBlock) {
                addTermToMap(blockTermMap, closestBlock, term);
            }
            if (closestChapter) {
                addTermToMap(chapterTermMap, closestChapter, term);
            }
        }
    }

    return { subpositionTermMap, blockTermMap, chapterTermMap };
}

function countEntriesWithAllTerms<K>(map: Map<K, Set<string>>, requiredTermCount: number): number {
    let count = 0;
    for (const terms of map.values()) {
        if (terms.size === requiredTermCount) {
            count += 1;
        }
    }
    return count;
}

function analyzeBlockCoOccurrence(
    blockTermMap: Map<HTMLElement, Set<string>>,
    requiredTermCount: number,
    container: HTMLElement,
    resolveSubpositionKey: ResolveSubpositionKeyFn
): { highBlocksWithoutSubposition: number; hasFallbackHighBlock: boolean } {
    let highBlocksWithoutSubposition = 0;
    let hasFallbackHighBlock = false;

    for (const [block, termsInBlock] of blockTermMap.entries()) {
        if (termsInBlock.size !== requiredTermCount) {
            continue;
        }
        if (resolveSubpositionKey(block, container)) {
            continue;
        }
        highBlocksWithoutSubposition += 1;
        hasFallbackHighBlock = true;
    }

    return { highBlocksWithoutSubposition, hasFallbackHighBlock };
}

function hasChapterLevelCoOccurrence(chapterTermMap: Map<HTMLElement, Set<string>>, requiredTermCount: number): boolean {
    for (const termsInChapter of chapterTermMap.values()) {
        if (termsInChapter.size === requiredTermCount) {
            return true;
        }
    }
    return false;
}

export const SearchHighlighter: React.FC<SearchHighlighterProps> = ({ query, contentContainerRef, isContentReady }) => {
    const [matches, setMatches] = useState<Record<string, MatchInstance[]>>({});
    const [terms, setTerms] = useState<string[]>([]);
    const [activeTerm, setActiveTerm] = useState<string | null>(null);
    const [activeIndices, setActiveIndices] = useState<Record<string, number>>({});
    const [matchQuality, setMatchQuality] = useState<MatchQuality>('NENHUM');
    const [coOccurrenceCount, setCoOccurrenceCount] = useState(0);
    const [coOccurrenceScope, setCoOccurrenceScope] = useState<CoOccurrenceScope>('subposition');
    const [isVisible, setIsVisible] = useState(true);

    const normalizedTerms = useMemo(() => {
        const trimmedQuery = query?.trim() ?? '';
        if (!trimmedQuery) return [];

        // Split by spaces, strip punctuation, strip accents, filter short words
        const words = stripDiacritics(trimmedQuery.toLowerCase())
            .replaceAll(/[.,;:[\](){}]/g, ' ')
            .split(/\s+/)
            .filter(token => token.length > 0)
            .filter(token => token.length > 2 || trimmedQuery.length <= 2);

        return Array.from(new Set(words)); // Unique accent-free terms
    }, [query]);

    // DOM Manipulation to highlight terms using TreeWalker
    useEffect(() => {
        if (!isContentReady || !contentContainerRef.current || normalizedTerms.length === 0) {
            setMatches({});
            setTerms([]);
            setActiveTerm(null);
            setActiveIndices({});
            setMatchQuality('NENHUM');
            setCoOccurrenceCount(0);
            setCoOccurrenceScope('subposition');
            return;
        }

        const container = contentContainerRef.current;
        const newMatches: Record<string, MatchInstance[]> = {};
        normalizedTerms.forEach(t => {
            newMatches[t] = [];
        });

        // Function to clean up previous custom highlights ONLY
        const cleanup = () => {
            const marks = container.querySelectorAll('mark[data-sh-term]');
            marks.forEach(mark => {
                const parent = mark.parentNode;
                if (!parent) return;
                // Replace the mark with its text content
                parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
                // Normalize to merge adjacent text nodes
                parent.normalize();
            });

            const wrappers = container.querySelectorAll('span[data-sh-wrapper]');
            wrappers.forEach(wrapper => {
                const parent = wrapper.parentNode;
                if (!parent) return;

                while (wrapper.firstChild) {
                    parent.insertBefore(wrapper.firstChild, wrapper);
                }
                wrapper.remove();
                parent.normalize();
            });
        };

        cleanup();

        // 1. Walk the tree and find text nodes matching our terms
        const treeWalker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    // Ignore text inside scripts, styles, or our own marks
                    const parent = node.parentElement;
                    if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.dataset.shTerm !== undefined || parent.dataset.shWrapper !== undefined)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;

                    const lowerText = stripDiacritics(node.nodeValue.toLowerCase());
                    if (normalizedTerms.some(term => lowerText.includes(term))) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_REJECT;
                }
            }
        );

        const nodesToProcess: Text[] = [];
        let currentNode = treeWalker.nextNode();
        while (currentNode) {
            nodesToProcess.push(currentNode as Text);
            currentNode = treeWalker.nextNode();
        }

        // 2. Process nodes backwards to avoid disrupting ranges
        [...nodesToProcess].reverse().forEach(textNode => {
            let parent = textNode.parentNode;
            if (!parent) return;

            const originalText = textNode.nodeValue || '';
            if (!originalText) return;

            type MatchRange = { start: number; end: number; term: string; priority: number };
            const allRanges: MatchRange[] = [];

            normalizedTerms.forEach((term, priority) => {
                const accentPattern = buildAccentInsensitivePattern(term);
                if (!accentPattern) return;

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
                        priority
                    });
                    match = regex.exec(originalText);
                }
            });

            if (allRanges.length === 0) return;

            const rankedRanges = [...allRanges].sort((a, b) => {
                const lengthDiff = (b.end - b.start) - (a.end - a.start);
                if (lengthDiff !== 0) return lengthDiff;
                const priorityDiff = a.priority - b.priority;
                if (priorityDiff !== 0) return priorityDiff;
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
                if (overlaps) continue;

                for (let i = range.start; i < range.end; i += 1) {
                    occupied[i] = true;
                }
                selectedRanges.push(range);
            }

            if (selectedRanges.length === 0) return;

            selectedRanges.sort((a, b) => a.start - b.start);

            const htmlParts: string[] = [];
            let cursor = 0;
            for (const range of selectedRanges) {
                if (range.start > cursor) {
                    htmlParts.push(escapeHtmlAttribute(originalText.slice(cursor, range.start)));
                }
                const safeTerm = escapeHtmlAttribute(range.term);
                const matchedText = escapeHtmlAttribute(originalText.slice(range.start, range.end));
                htmlParts.push(`<mark data-sh-term="${safeTerm}" class="search-highlight search-highlight-partial">${matchedText}</mark>`);
                cursor = range.end;
            }
            if (cursor < originalText.length) {
                htmlParts.push(escapeHtmlAttribute(originalText.slice(cursor)));
            }

            const wrapper = document.createElement('span');
            wrapper.dataset.shWrapper = '1';
            wrapper.innerHTML = htmlParts.join('');
            textNode.replaceWith(wrapper);

            // Now collect the newly inserted marks
            const marks = wrapper.querySelectorAll('mark[data-sh-term]');
            marks.forEach(mark => {
                const matchedTerm = (mark as HTMLElement).dataset.shTerm;
                if (matchedTerm && newMatches[matchedTerm]) {
                    newMatches[matchedTerm].push({
                        node: mark as HTMLElement,
                        term: matchedTerm,
                        index: newMatches[matchedTerm].length
                    });
                }
            });
        });

        // Restore correct forward order since we processed backwards
        normalizedTerms.forEach(term => {
            newMatches[term].reverse();
            newMatches[term].forEach((match, idx) => {
                match.index = idx;
            });
        });

        setTerms(normalizedTerms);
        setMatches(newMatches);

        // Initialize active indices
        const indices: Record<string, number> = {};
        let activeT = (
            activeTerm &&
            normalizedTerms.includes(activeTerm) &&
            (newMatches[activeTerm]?.length ?? 0) > 0
        ) ? activeTerm : null;

        normalizedTerms.forEach(term => {
            indices[term] = 0;
            if (newMatches[term].length > 0 && !activeT) {
                activeT = term;
            }
        });

        setActiveIndices(indices);
        if (activeT) {
            setActiveTerm(activeT);
        } else {
            setActiveTerm(null);
        }

        // 3. Calculate Match Quality + Co-occurrence intelligence
        const qualityInsights = calculateMatchQuality(newMatches, normalizedTerms);
        setMatchQuality(qualityInsights.matchQuality);
        setCoOccurrenceCount(qualityInsights.coOccurrenceCount);
        setCoOccurrenceScope(qualityInsights.coOccurrenceScope);
        setIsVisible(true);

        return cleanup;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isContentReady, query, contentContainerRef]);

    const resolveSubpositionKey = (node: HTMLElement, container: HTMLElement): string | null => {
        const tipiPosition = node.closest<HTMLElement>('article.tipi-position[id]');
        if (tipiPosition?.id) return tipiPosition.id;

        const directPosAnchor = node.closest<HTMLElement>('[id^="pos-"]');
        if (directPosAnchor?.id) return directPosAnchor.id;

        const neshAnchors = container.querySelectorAll<HTMLElement>('h3[id^="pos-"], h4[id^="pos-"], h3.nesh-section[id], h4.nesh-subsection[id]');
        let nearestBefore: HTMLElement | null = null;

        for (const anchor of neshAnchors) {
            if (!anchor.id) continue;
            if (anchor === node || anchor.contains(node)) return anchor.id;

            const relation = anchor.compareDocumentPosition(node);
            if (relation & Node.DOCUMENT_POSITION_FOLLOWING) {
                nearestBefore = anchor;
                continue;
            }
            if (relation & Node.DOCUMENT_POSITION_PRECEDING) {
                break;
            }
        }

        return nearestBefore?.id || null;
    };

    const calculateMatchQuality = (currentMatches: Record<string, MatchInstance[]>, allTerms: string[]): MatchQualityResult => {
        if (allTerms.length < 2) {
            return getNoMatchResult();
        }

        const container = contentContainerRef.current;
        if (!container) {
            return getNoMatchResult();
        }

        const { subpositionTermMap, blockTermMap, chapterTermMap } = buildTermMaps(
            currentMatches,
            allTerms,
            container,
            resolveSubpositionKey
        );

        const requiredTermCount = allTerms.length;
        const highSubpositionsCount = countEntriesWithAllTerms(subpositionTermMap, requiredTermCount);
        const { highBlocksWithoutSubposition, hasFallbackHighBlock } = analyzeBlockCoOccurrence(
            blockTermMap,
            requiredTermCount,
            container,
            resolveSubpositionKey
        );

        const coOccurrenceCount = highSubpositionsCount > 0 ? highSubpositionsCount : highBlocksWithoutSubposition;
        const coOccurrenceScope: CoOccurrenceScope = highSubpositionsCount > 0 ? 'subposition' : 'block';

        if (highSubpositionsCount > 0 || hasFallbackHighBlock) {
            return { matchQuality: 'ALTO', coOccurrenceCount, coOccurrenceScope };
        }

        if (hasChapterLevelCoOccurrence(chapterTermMap, requiredTermCount)) {
            return { matchQuality: 'PEQUENO', coOccurrenceCount, coOccurrenceScope };
        }

        return { matchQuality: 'NENHUM', coOccurrenceCount, coOccurrenceScope };
    };

    // Handle scroll to active match
    useEffect(() => {
        if (!activeTerm || (matches[activeTerm]?.length ?? 0) === 0) return;

        const currentIndex = activeIndices[activeTerm] || 0;
        const match = matches[activeTerm][currentIndex];

        if (match?.node) {
            // Remove active class from all
            const container = contentContainerRef.current;
            if (container) {
                container.querySelectorAll('mark[data-sh-term].active').forEach(n => {
                    n.classList.remove('active');
                });
            }
            // Add to current
            match.node.classList.add('active');

            // Scroll into view gently
            match.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [activeTerm, activeIndices, matches]);

    const handleNext = useCallback(() => {
        if (!activeTerm) return;
        setActiveIndices(prev => {
            const max = matches?.[activeTerm]?.length ?? 0;
            if (max === 0) return prev;
            const current = Number.isFinite(prev?.[activeTerm]) ? prev[activeTerm] : 0;
            return {
                ...prev,
                [activeTerm]: (current + 1) % max
            };
        });
    }, [activeTerm, matches]);

    const handlePrev = useCallback(() => {
        if (!activeTerm) return;
        setActiveIndices(prev => {
            const max = matches?.[activeTerm]?.length ?? 0;
            if (max === 0) return prev;
            const current = Number.isFinite(prev?.[activeTerm]) ? prev[activeTerm] : 0;
            return {
                ...prev,
                [activeTerm]: (current - 1 + max) % max
            };
        });
    }, [activeTerm, matches]);

    if (!isVisible || terms.length === 0) return null;

    const totalMatches = Object.values(matches).reduce((sum, arr) => sum + arr.length, 0);
    if (totalMatches === 0) return null;

    let qualityIcon;
    let qualityLabel;
    let qualityClass;

    if (matchQuality === 'ALTO') {
        qualityIcon = <Target size={16} className={styles.qualityAlto} />;
        qualityLabel = 'Match Alto';
        qualityClass = styles.qualityAlto;
    } else if (matchQuality === 'PEQUENO') {
        qualityIcon = <Target size={16} className={styles.qualityPequeno} />;
        qualityLabel = 'Match Pequeno';
        qualityClass = styles.qualityPequeno;
    } else {
        qualityIcon = <Target size={16} className={styles.qualityNenhum} />;
        qualityLabel = 'Matches Distantes';
        qualityClass = styles.qualityNenhum;
    }

    const coOccurrenceUnitSingular = coOccurrenceScope === 'subposition' ? 'subposição' : 'bloco';
    const coOccurrenceUnitPlural = coOccurrenceScope === 'subposition' ? 'subposições' : 'blocos';
    const coOccurrenceLabel = coOccurrenceCount === 1
        ? `1 ${coOccurrenceUnitSingular} com alta correspondência`
        : `${coOccurrenceCount} ${coOccurrenceUnitPlural} com alta correspondência`;

    return (
        <div className={styles.container}>
            {terms.length > 1 && (
                <div className={styles.matchQuality}>
                    {qualityIcon}
                    <span className={qualityClass}>
                        {qualityLabel}
                    </span>
                    <span className={styles.coOccurrenceLabel}>
                        {coOccurrenceLabel}
                    </span>
                </div>
            )}

            <div className={styles.termsContainer}>
                {terms.map(term => (
                    <button
                        type="button"
                        key={term}
                        className={`${styles.termPill} ${activeTerm === term ? styles.active : ''}`}
                        onClick={() => setActiveTerm(term)}
                    >
                        {term}
                        <span className={styles.termCount}>{matches[term]?.length || 0}</span>
                    </button>
                ))}
            </div>

            {activeTerm && matches[activeTerm]?.length > 0 && (
                <div className={styles.navigation}>
                    <span className={styles.navProgress}>
                        {(activeIndices[activeTerm] || 0) + 1} / {matches[activeTerm].length}
                    </span>
                    <button type="button" className={styles.navButton} onClick={handlePrev} disabled={matches[activeTerm].length <= 1} aria-label="Navegar para a ocorrência anterior">
                        <ChevronUp size={18} />
                    </button>
                    <button type="button" className={styles.navButton} onClick={handleNext} disabled={matches[activeTerm].length <= 1} aria-label="Navegar para a próxima ocorrência">
                        <ChevronDown size={18} />
                    </button>
                </div>
            )}

            <button type="button" className={styles.closeButton} onClick={() => setIsVisible(false)} aria-label="Fechar busca de página">
                <X size={18} />
            </button>
        </div>
    );
};
