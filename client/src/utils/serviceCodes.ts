const RE_SERVICE_CODE = /\b(\d\.\d{2}(?:\d{2})?(?:\.\d{1,2})?(?:\.\d{2})?)\b/g;

export function extractServiceCode(raw: string | null | undefined): string | null {
    if (!raw) return null;

    const match = raw.match(RE_SERVICE_CODE);
    return match?.[0] || null;
}

export function injectServiceLinks(html: string): string {
    if (!html) return '';

    const parts = html.split(/(<[^>]+>)/g);

    return parts.map((part) => {
        if (part.startsWith('<')) return part;

        return part.replace(
            RE_SERVICE_CODE,
            (match) => `<span class="service-smart-link service-code-target" data-service-code="${match}">${match}</span>`,
        );
    }).join('');
}
