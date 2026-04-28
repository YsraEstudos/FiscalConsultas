const TERM_MARK_ATTR = 'data-text-query-highlight';
const TERM_MARK_SELECTOR = `mark[${TERM_MARK_ATTR}="true"]`;
const TERM_HIGHLIGHT_MAX_MATCHES = 250;
const TERM_HIGHLIGHT_MIN_LENGTH = 2;
const SKIP_HIGHLIGHT_TAGS = new Set(['SCRIPT', 'STYLE', 'MARK', 'NOSCRIPT', 'TEXTAREA']);

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function unwrapQueryHighlights(container: HTMLElement) {
    const marks = Array.from(container.querySelectorAll<HTMLElement>(TERM_MARK_SELECTOR));
    marks.forEach((mark) => {
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

export function highlightTermInContainer(container: HTMLElement, term: string): number {
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
