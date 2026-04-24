export type SearchHighlighterMatchQuality = 'ALTO' | 'PEQUENO' | 'NENHUM';
export type SearchHighlighterCoOccurrenceScope = 'subposition' | 'block';

export interface SearchHighlighterMatchInstance {
    node: HTMLElement;
    term: string;
    index: number;
}

export interface SearchHighlighterQualityInsights {
    matchQuality: SearchHighlighterMatchQuality;
    coOccurrenceCount: number;
    coOccurrenceScope: SearchHighlighterCoOccurrenceScope;
    highSubpositionKeys: string[];
}

const BLOCK_ELEMENTS = new Set([
    'P',
    'LI',
    'DIV',
    'TD',
    'TH',
    'BLOCKQUOTE',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
]);

function getNoMatchResult(): SearchHighlighterQualityInsights {
    return {
        matchQuality: 'NENHUM',
        coOccurrenceCount: 0,
        coOccurrenceScope: 'subposition',
        highSubpositionKeys: [],
    };
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
    return (
        element.id?.startsWith('cap-')
        || element.id?.startsWith('chapter-')
        || element.classList.contains('tipi-chapter')
    );
}

function findClosestContext(
    node: HTMLElement,
    rootContainer: HTMLElement,
): { closestBlock: HTMLElement | null; closestChapter: HTMLElement | null } {
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

function resolveSubpositionKey(
    node: HTMLElement,
    container: HTMLElement,
): string | null {
    const tipiPosition = node.closest<HTMLElement>('article.tipi-position[id]');
    if (tipiPosition?.id) return tipiPosition.id;

    const directPosAnchor = node.closest<HTMLElement>('[id^="pos-"]');
    if (directPosAnchor?.id) return directPosAnchor.id;

    const neshAnchors = container.querySelectorAll<HTMLElement>(
        'h3[id^="pos-"], h4[id^="pos-"], h3.nesh-section[id], h4.nesh-subsection[id]',
    );
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
}

function buildTermMaps(
    currentMatches: Record<string, SearchHighlighterMatchInstance[]>,
    allTerms: string[],
    container: HTMLElement,
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

function getEntriesWithAllTerms<K>(map: Map<K, Set<string>>, requiredTermCount: number): K[] {
    const result: K[] = [];
    for (const [key, terms] of map.entries()) {
        if (terms.size === requiredTermCount) {
            result.push(key);
        }
    }
    return result;
}

function analyzeBlockCoOccurrence(
    blockTermMap: Map<HTMLElement, Set<string>>,
    requiredTermCount: number,
    container: HTMLElement,
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

function hasChapterLevelCoOccurrence(
    chapterTermMap: Map<HTMLElement, Set<string>>,
    requiredTermCount: number,
): boolean {
    for (const termsInChapter of chapterTermMap.values()) {
        if (termsInChapter.size === requiredTermCount) {
            return true;
        }
    }
    return false;
}

export function stripDiacritics(text: string): string {
    return text.normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '');
}

export function buildAccentInsensitivePattern(term: string): string {
    const accentMap: Record<string, string> = {
        a: '[aáàâãäå]',
        e: '[eéèêë]',
        i: '[iíìîï]',
        o: '[oóòôõö]',
        u: '[uúùûü]',
        c: '[cç]',
        n: '[nñ]',
    };

    return term
        .split('')
        .map((character) => {
            const escaped = character.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
            return accentMap[character] || escaped;
        })
        .join('');
}

export function clearSearchHighlights(container: HTMLElement): void {
    const marks = container.querySelectorAll('mark[data-sh-term]');
    marks.forEach((mark) => {
        const parent = mark.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
    });

    const wrappers = container.querySelectorAll('span[data-sh-wrapper]');
    wrappers.forEach((wrapper) => {
        const parent = wrapper.parentNode;
        if (!parent) return;

        while (wrapper.firstChild) {
            parent.insertBefore(wrapper.firstChild, wrapper);
        }
        wrapper.remove();
        parent.normalize();
    });
}

export function resolveScrollContainer(contentContainer: HTMLElement): HTMLElement {
    const parent = contentContainer.parentElement;
    return parent instanceof HTMLElement ? parent : contentContainer;
}

export function getNodeTopWithinScrollContainer(
    node: HTMLElement,
    scrollContainer: HTMLElement,
): number {
    const nodeRect = node.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    return (nodeRect.top - containerRect.top) + scrollContainer.scrollTop;
}

export function notifyAfterScrollSettles(
    scrollContainer: HTMLElement,
    onComplete?: (scrollTop: number) => void,
): () => void {
    if (!onComplete) {
        return () => undefined;
    }

    let finished = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
        if (finished) return;
        finished = true;
        scrollContainer.removeEventListener('scroll', handleScroll);
        if (settleTimer !== null) {
            clearTimeout(settleTimer);
        }
        onComplete(scrollContainer.scrollTop);
    };

    const scheduleFinish = () => {
        if (settleTimer !== null) {
            clearTimeout(settleTimer);
        }
        settleTimer = setTimeout(finish, 120);
    };

    const handleScroll = () => {
        scheduleFinish();
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    scheduleFinish();
    return finish;
}

export function collectSearchHighlighterQuality(
    currentMatches: Record<string, SearchHighlighterMatchInstance[]>,
    allTerms: string[],
    container: HTMLElement,
): SearchHighlighterQualityInsights {
    if (allTerms.length < 2) {
        return getNoMatchResult();
    }

    const {
        subpositionTermMap,
        blockTermMap,
        chapterTermMap,
    } = buildTermMaps(currentMatches, allTerms, container);
    const requiredTermCount = allTerms.length;
    const highSubpositionKeys = getEntriesWithAllTerms(
        subpositionTermMap,
        requiredTermCount,
    );
    const highSubpositionsCount = highSubpositionKeys.length;
    const {
        highBlocksWithoutSubposition,
        hasFallbackHighBlock,
    } = analyzeBlockCoOccurrence(blockTermMap, requiredTermCount, container);
    const coOccurrenceCount =
        highSubpositionsCount > 0 ? highSubpositionsCount : highBlocksWithoutSubposition;
    const coOccurrenceScope: SearchHighlighterCoOccurrenceScope =
        highSubpositionsCount > 0 ? 'subposition' : 'block';

    if (highSubpositionsCount > 0 || hasFallbackHighBlock) {
        return {
            matchQuality: 'ALTO',
            coOccurrenceCount,
            coOccurrenceScope,
            highSubpositionKeys,
        };
    }

    if (hasChapterLevelCoOccurrence(chapterTermMap, requiredTermCount)) {
        return {
            matchQuality: 'PEQUENO',
            coOccurrenceCount,
            coOccurrenceScope,
            highSubpositionKeys: [],
        };
    }

    return getNoMatchResult();
}
