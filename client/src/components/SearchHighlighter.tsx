import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { ChevronUp, ChevronDown, X, Target } from 'lucide-react';
import styles from './SearchHighlighter.module.css';

interface MatchInstance {
    node: HTMLElement;
    term: string;
    index: number;
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
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Strip diacritics/accents from a string.
 * e.g. "centrífuga" → "centrifuga", "ação" → "acao"
 */
function stripDiacritics(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
            const escaped = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return ACCENT_MAP[ch] || escaped;
        })
        .join('');
}

export const SearchHighlighter: React.FC<SearchHighlighterProps> = ({ query, contentContainerRef, isContentReady }) => {
    const [matches, setMatches] = useState<Record<string, MatchInstance[]>>({});
    const [terms, setTerms] = useState<string[]>([]);
    const [activeTerm, setActiveTerm] = useState<string | null>(null);
    const [activeIndices, setActiveIndices] = useState<Record<string, number>>({});
    const [matchQuality, setMatchQuality] = useState<'ALTO' | 'PEQUENO' | 'NENHUM'>('NENHUM');
    const [coOccurrenceCount, setCoOccurrenceCount] = useState(0);
    const [coOccurrenceScope, setCoOccurrenceScope] = useState<'subposition' | 'block'>('subposition');
    const [isVisible, setIsVisible] = useState(true);

    const normalizedTerms = useMemo(() => {
        if (!query) return [];
        // Split by spaces, strip punctuation, strip accents, filter short words
        const words = stripDiacritics(query.toLowerCase())
            .replace(/[.,;:[\](){}]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 || query.length <= 2);

        return Array.from(new Set(words)); // Unique accent-free terms
    }, [query]);

    // DOM Manipulation to highlight terms using TreeWalker
    useEffect(() => {
        if (!isContentReady || !contentContainerRef.current || normalizedTerms.length === 0) {
            setMatches({});
            setTerms([]);
            setCoOccurrenceCount(0);
            return;
        }

        const container = contentContainerRef.current;
        const newMatches: Record<string, MatchInstance[]> = {};
        normalizedTerms.forEach(t => newMatches[t] = []);

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
                parent.removeChild(wrapper);
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
                    if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.hasAttribute('data-sh-term') || parent.hasAttribute('data-sh-wrapper'))) {
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

            // Simple highlighting: we process each term over the text content
            // To handle multiple terms per node properly, we create a wrapper and innerHTML replace
            const originalText = textNode.nodeValue || '';
            let htmlToInject = originalText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

            let termFoundInNode = false;

            normalizedTerms.forEach(term => {
                // Build accent-insensitive regex so "centrif" matches "centríf"
                const accentPattern = buildAccentInsensitivePattern(term);
                const regex = new RegExp(`(${accentPattern})`, 'gi');
                if (regex.test(originalText)) {
                    termFoundInNode = true;
                    const safeTerm = escapeHtmlAttribute(term);
                    // Use $& to insert the matched text, avoiding issues with $1 in some environments
                    htmlToInject = htmlToInject.replace(regex, `<mark data-sh-term="${safeTerm}" class="search-highlight search-highlight-partial">$&</mark>`);
                }
            });

            if (termFoundInNode) {
                const wrapper = document.createElement('span');
                wrapper.setAttribute('data-sh-wrapper', '1');
                wrapper.innerHTML = htmlToInject;
                parent.replaceChild(wrapper, textNode);

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
            }
        });

        // Restore correct forward order since we processed backwards
        normalizedTerms.forEach(term => {
            newMatches[term].reverse();
            newMatches[term].forEach((match, idx) => match.index = idx);
        });

        setTerms(normalizedTerms);
        setMatches(newMatches);

        // Initialize active indices
        const indices: Record<string, number> = {};
        let activeT = activeTerm;

        normalizedTerms.forEach(term => {
            indices[term] = 0;
            if (newMatches[term].length > 0 && !activeT) {
                activeT = term;
            }
        });

        setActiveIndices(indices);
        if (activeT) setActiveTerm(activeT);

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
        const tipiPosition = node.closest('article.tipi-position[id]') as HTMLElement | null;
        if (tipiPosition?.id) return tipiPosition.id;

        const directPosAnchor = node.closest('[id^="pos-"]') as HTMLElement | null;
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

    const calculateMatchQuality = (currentMatches: Record<string, MatchInstance[]>, allTerms: string[]) => {
        if (allTerms.length < 2) {
            return { matchQuality: 'NENHUM' as const, coOccurrenceCount: 0, coOccurrenceScope: 'subposition' as const };
        }

        const container = contentContainerRef.current;
        if (!container) {
            return { matchQuality: 'NENHUM' as const, coOccurrenceCount: 0, coOccurrenceScope: 'subposition' as const };
        }

        // Map NCM subpositions to the set of terms found inside them.
        // This is the primary signal for "alta correspondência".
        const subpositionTermMap = new Map<string, Set<string>>();

        // Fallback maps for content where we cannot resolve a subposition anchor.
        const blockTermMap = new Map<HTMLElement, Set<string>>();
        const chapterTermMap = new Map<HTMLElement, Set<string>>();

        allTerms.forEach(term => {
            currentMatches[term]?.forEach(match => {
                const subpositionKey = resolveSubpositionKey(match.node, container);
                if (subpositionKey) {
                    if (!subpositionTermMap.has(subpositionKey)) {
                        subpositionTermMap.set(subpositionKey, new Set());
                    }
                    subpositionTermMap.get(subpositionKey)!.add(term);
                }

                // Find closest paragraph/block and chapter (fallback/secondary signals)
                let current: HTMLElement | null = match.node;
                let closestBlock: HTMLElement | null = null;
                let closestChapter: HTMLElement | null = null;

                while (current && current !== contentContainerRef.current) {
                    if (!closestBlock && BLOCK_ELEMENTS.has(current.tagName)) {
                        closestBlock = current;
                    }
                    if (current.id?.startsWith('cap-') || current.id?.startsWith('chapter-') || current.classList.contains('tipi-chapter')) {
                        closestChapter = current;
                    }
                    current = current.parentElement;
                }

                if (closestBlock) {
                    if (!blockTermMap.has(closestBlock)) blockTermMap.set(closestBlock, new Set());
                    blockTermMap.get(closestBlock)!.add(term);
                }

                if (closestChapter) {
                    if (!chapterTermMap.has(closestChapter)) chapterTermMap.set(closestChapter, new Set());
                    chapterTermMap.get(closestChapter)!.add(term);
                }
            });
        });

        const highSubpositions = new Set<string>();
        let highBlocksWithoutSubposition = 0;

        for (const [subpositionKey, termsInSubposition] of subpositionTermMap.entries()) {
            if (termsInSubposition.size === allTerms.length) {
                highSubpositions.add(subpositionKey);
            }
        }

        for (const [block, termsInBlock] of blockTermMap.entries()) {
            if (termsInBlock.size === allTerms.length) {
                const blockSubposition = resolveSubpositionKey(block, container);
                if (!blockSubposition) {
                    // Legacy/fallback scenario with no subposition anchors.
                    // Count block-level co-occurrence to avoid losing signal completely.
                    highBlocksWithoutSubposition += 1;
                }
            }
        }

        const coOccurrenceCount = highSubpositions.size > 0 ? highSubpositions.size : highBlocksWithoutSubposition;
        const coOccurrenceScope = highSubpositions.size > 0 ? 'subposition' as const : 'block' as const;

        // ALTO: all terms coexist in at least one NCM subposition.
        if (highSubpositions.size > 0) {
            return { matchQuality: 'ALTO' as const, coOccurrenceCount, coOccurrenceScope };
        }

        // Fallback ALTO: all terms in same block when no subposition can be resolved.
        for (const [block, termsInBlock] of blockTermMap.entries()) {
            if (termsInBlock.size === allTerms.length) {
                const blockSubposition = resolveSubpositionKey(block, container);
                if (!blockSubposition) {
                    return { matchQuality: 'ALTO' as const, coOccurrenceCount, coOccurrenceScope };
                }
            }
        }

        // PEQUENO: terms coexist only at chapter level.
        for (const termsInChapter of chapterTermMap.values()) {
            if (termsInChapter.size === allTerms.length) {
                return { matchQuality: 'PEQUENO' as const, coOccurrenceCount, coOccurrenceScope };
            }
        }

        return { matchQuality: 'NENHUM' as const, coOccurrenceCount, coOccurrenceScope };
    };

    // Handle scroll to active match
    useEffect(() => {
        if (!activeTerm || matches[activeTerm]?.length === 0) return;

        const currentIndex = activeIndices[activeTerm] || 0;
        const match = matches[activeTerm][currentIndex];

        if (match && match.node) {
            // Remove active class from all
            document.querySelectorAll('mark[data-sh-term].active').forEach(n => n.classList.remove('active'));
            // Add to current
            match.node.classList.add('active');

            // Scroll into view gently
            match.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [activeTerm, activeIndices, matches]);

    const handleNext = useCallback(() => {
        if (!activeTerm) return;
        setActiveIndices(prev => {
            const max = matches[activeTerm].length;
            if (max === 0) return prev;
            return {
                ...prev,
                [activeTerm]: (prev[activeTerm] + 1) % max
            };
        });
    }, [activeTerm, matches]);

    const handlePrev = useCallback(() => {
        if (!activeTerm) return;
        setActiveIndices(prev => {
            const max = matches[activeTerm].length;
            if (max === 0) return prev;
            return {
                ...prev,
                [activeTerm]: (prev[activeTerm] - 1 + max) % max
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
                    <button className={styles.navButton} onClick={handlePrev} disabled={matches[activeTerm].length <= 1} title="Navegar para a ocorrência anterior">
                        <ChevronUp size={18} />
                    </button>
                    <button className={styles.navButton} onClick={handleNext} disabled={matches[activeTerm].length <= 1} title="Navegar para a próxima ocorrência">
                        <ChevronDown size={18} />
                    </button>
                </div>
            )}

            <button className={styles.closeButton} onClick={() => setIsVisible(false)} aria-label="Fechar busca de página">
                <X size={18} />
            </button>
        </div>
    );
};
