const RE_SERVICE_CODE = /\b(\d\.\d{2}(?:\d{2})?(?:\.\d{1,2})?(?:\.\d{2})?)\b/g;

export function extractServiceCode(raw: string | null | undefined): string | null {
    if (!raw) return null;

    const match = raw.match(RE_SERVICE_CODE);
    return match?.[0] || null;
}

export function injectServiceLinks(html: string): string {
    if (!html) return '';

    const parser = new DOMParser();
    const documentNode = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = documentNode.body.firstElementChild;
    if (!root) return html;

    const walker = documentNode.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];

    let currentNode = walker.nextNode();
    while (currentNode) {
        if (currentNode instanceof Text) {
            textNodes.push(currentNode);
        }
        currentNode = walker.nextNode();
    }

    for (const textNode of textNodes) {
        const parentElement = textNode.parentElement;
        if (!parentElement) continue;

        if (
            parentElement.closest('a')
            || parentElement.closest('.service-smart-link')
        ) {
            continue;
        }

        const text = textNode.textContent ?? '';
        const matcher = new RegExp(RE_SERVICE_CODE.source, 'g');
        let lastIndex = 0;
        let match = matcher.exec(text);

        if (!match) continue;

        const fragment = documentNode.createDocumentFragment();

        do {
            const [matchedCode] = match;
            const matchIndex = match.index;

            if (matchIndex > lastIndex) {
                fragment.append(text.slice(lastIndex, matchIndex));
            }

            const span = documentNode.createElement('span');
            span.className = 'service-smart-link service-code-target';
            span.dataset.serviceCode = matchedCode;
            span.textContent = matchedCode;
            fragment.append(span);

            lastIndex = matchIndex + matchedCode.length;
            match = matcher.exec(text);
        } while (match);

        if (lastIndex < text.length) {
            fragment.append(text.slice(lastIndex));
        }

        textNode.replaceWith(fragment);
    }

    return root.innerHTML;
}
