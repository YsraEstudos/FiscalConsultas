import { describe, expect, it } from 'vitest';
import {
    replaceElementWithSanitizedHtml,
    sanitizeImageUrl,
    sanitizeNavigationUrl,
    sanitizeRichHtml,
} from './contentSecurity';

const unsafeJavascriptUrl = `javascript${':alert(1)'}`;

describe('contentSecurity', () => {
    it('removes active content from rich HTML while preserving safe data attributes', () => {
        const container = document.createElement('div');

        replaceElementWithSanitizedHtml(
            container,
            `<p data-ncm="8401" onclick="alert(1)">ok</p><a href="${unsafeJavascriptUrl}">x</a><img src="${unsafeJavascriptUrl}" onerror="alert(1)"><script>alert(1)</script>`,
        );

        expect(container.querySelector('[data-ncm="8401"]')).not.toBeNull();
        expect(container.querySelector('script')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('a')?.getAttribute('href')).toBeNull();
    });

    it('hardens safe external links with rel noopener noreferrer', () => {
        const container = document.createElement('div');

        replaceElementWithSanitizedHtml(
            container,
            '<a href="https://example.com/docs" target="_blank">docs</a>',
        );

        const anchor = container.querySelector('a');
        expect(anchor?.getAttribute('href')).toBe('https://example.com/docs');
        expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('sanitizes raw html strings before rendering markdown/html payloads', () => {
        const sanitized = sanitizeRichHtml('<div><iframe src="https://evil.test"></iframe><strong>safe</strong></div>');

        expect(sanitized).not.toContain('iframe');
        expect(sanitized).toContain('<strong>safe</strong>');
    });

    it('accepts only safe navigation and image URLs', () => {
        expect(sanitizeNavigationUrl('https://example.com')).toBe('https://example.com');
        expect(sanitizeNavigationUrl('/interno')).toBe('/interno');
        expect(sanitizeNavigationUrl(unsafeJavascriptUrl)).toBeNull();
        expect(sanitizeNavigationUrl('//evil.test')).toBeNull();

        expect(sanitizeImageUrl('https://example.com/avatar.png')).toBe('https://example.com/avatar.png');
        expect(sanitizeImageUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
        expect(sanitizeImageUrl('data:text/html;base64,abc')).toBeNull();
        expect(sanitizeImageUrl(unsafeJavascriptUrl)).toBeNull();
    });

    it('rejects URL candidates with control characters', () => {
        const controlCharacter = String.fromCharCode(0x1F);
        const deleteCharacter = String.fromCharCode(0x7F);

        expect(sanitizeNavigationUrl(`https://example.com/${controlCharacter}`)).toBeNull();
        expect(sanitizeImageUrl(`https://example.com/avatar${deleteCharacter}.png`)).toBeNull();
    });
});
