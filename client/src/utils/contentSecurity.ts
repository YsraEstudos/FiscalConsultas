import DOMPurify from 'dompurify';

const EXTRA_ALLOWED_ATTRIBUTES = [
    'data-ncm',
    'data-note',
    'data-chapter',
    'aria-label',
    'data-tooltip',
    'role',
    'tabindex',
] as const;

const FORBIDDEN_TAGS = [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'option',
    'base',
    'meta',
    'link',
    'svg',
    'math',
    'audio',
    'video',
    'source',
    'track',
] as const;

const FORBIDDEN_ATTRIBUTES = ['style', 'srcset'] as const;
const ABSOLUTE_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:', 'blob:']);
const SAFE_DATA_IMAGE_PATTERN = /^data:image\/(?:png|gif|jpe?g|webp|bmp|svg\+xml);/i;

function normalizeUrlCandidate(value: string | null | undefined): string | null {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;
    if (/\s/.test(trimmed)) return null;

    for (let index = 0; index < trimmed.length; index += 1) {
        const codePoint = trimmed.codePointAt(index);
        if (codePoint === undefined) continue;
        if (codePoint <= 0x1F || codePoint === 0x7F) return null;
        if (codePoint > 0xFFFF) {
            index += 1;
        }
    }

    return trimmed;
}

function isRelativeUrl(candidate: string): boolean {
    return !ABSOLUTE_SCHEME_PATTERN.test(candidate) && !candidate.startsWith('//');
}

function getRuntimeOrigin(): string | null {
    // `globalThis.location` is intentionally guarded for SSR/Node, where it may not exist.
    if (typeof globalThis.location === 'undefined') { // NOSONAR (typescript:S7764): location is optional outside browser runtimes.
        return null;
    }

    return globalThis.location.origin;
}

function isExternalAbsoluteUrl(candidate: string): boolean {
    const runtimeOrigin = getRuntimeOrigin();
    if (candidate.startsWith('#') || isRelativeUrl(candidate) || !runtimeOrigin) {
        return false;
    }

    try {
        return new URL(candidate, runtimeOrigin).origin !== runtimeOrigin;
    } catch {
        return false;
    }
}

export function sanitizeNavigationUrl(value: string | null | undefined): string | null {
    const candidate = normalizeUrlCandidate(value);
    if (!candidate) return null;
    if (candidate.startsWith('//')) return null;
    if (candidate.startsWith('#')) return candidate;
    if (isRelativeUrl(candidate)) return candidate;

    try {
        const base = getRuntimeOrigin() || 'https://localhost';
        const protocol = new URL(candidate, base).protocol;
        return SAFE_LINK_PROTOCOLS.has(protocol) ? candidate : null;
    } catch {
        return null;
    }
}

export function sanitizeImageUrl(value: string | null | undefined): string | null {
    const candidate = normalizeUrlCandidate(value);
    if (!candidate) return null;
    if (candidate.startsWith('//')) return null;
    if (candidate.startsWith('data:')) {
        return SAFE_DATA_IMAGE_PATTERN.test(candidate) ? candidate : null;
    }
    if (candidate.startsWith('#')) return null;
    if (isRelativeUrl(candidate)) return candidate;

    try {
        const base = getRuntimeOrigin() || 'https://localhost';
        const protocol = new URL(candidate, base).protocol;
        return SAFE_IMAGE_PROTOCOLS.has(protocol) ? candidate : null;
    } catch {
        return null;
    }
}

function hardenAnchor(anchor: HTMLAnchorElement): void {
    const safeHref = sanitizeNavigationUrl(anchor.getAttribute('href'));
    if (!safeHref) {
        anchor.removeAttribute('href');
        anchor.removeAttribute('target');
        anchor.removeAttribute('rel');
        return;
    }

    anchor.setAttribute('href', safeHref);

    const target = (anchor.getAttribute('target') || '').toLowerCase();
    if (target && target !== '_blank' && target !== '_self') {
        anchor.removeAttribute('target');
    }

    if ((anchor.getAttribute('target') || '').toLowerCase() === '_blank' || isExternalAbsoluteUrl(safeHref)) {
        anchor.setAttribute('rel', 'noopener noreferrer');
    } else {
        anchor.removeAttribute('rel');
    }
}

function hardenImage(image: HTMLImageElement): void {
    const safeSrc = sanitizeImageUrl(image.getAttribute('src'));
    if (!safeSrc) {
        image.remove();
        return;
    }

    image.setAttribute('src', safeSrc);
    image.setAttribute('loading', image.getAttribute('loading') || 'lazy');
    image.setAttribute('decoding', 'async');
    image.setAttribute('referrerpolicy', 'no-referrer');
}

function hardenFragment(fragment: ParentNode): void {
    fragment.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
        hardenAnchor(anchor);
    });

    fragment.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
        hardenImage(image);
    });
}

function createFragmentForElement(container: Element, html: string): DocumentFragment {
    const range = document.createRange();
    range.selectNodeContents(container);
    return range.createContextualFragment(html);
}

export function sanitizeRichHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        ALLOW_DATA_ATTR: true,
        ADD_ATTR: [...EXTRA_ALLOWED_ATTRIBUTES],
        FORBID_TAGS: [...FORBIDDEN_TAGS],
        FORBID_ATTR: [...FORBIDDEN_ATTRIBUTES],
    });
}

export function replaceElementWithSanitizedHtml(container: Element, html: string): void {
    const sanitizedHtml = sanitizeRichHtml(html);
    replaceElementWithTrustedHtml(container, sanitizedHtml);
}

export function replaceElementWithTrustedHtml(container: Element, sanitizedHtml: string): void {
    const fragment = createFragmentForElement(container, sanitizedHtml);
    hardenFragment(fragment);
    container.replaceChildren(fragment);
}

export function appendTrustedHtmlToElement(container: Element, sanitizedHtml: string): void {
    const fragment = createFragmentForElement(container, sanitizedHtml);
    hardenFragment(fragment);
    container.appendChild(fragment);
}
