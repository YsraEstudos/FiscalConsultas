import { describe, expect, it } from 'vitest';
import { extractServiceCode, injectServiceLinks } from './serviceCodes';

describe('serviceCodes', () => {
    it('extracts NBS codes from free text', () => {
        expect(extractServiceCode('classificam na subposição 1.0503.21.')).toBe('1.0503.21');
        expect(extractServiceCode('Serviços em 1.0602.22.00 e 1.0602.23.00')).toBe('1.0602.22.00');
    });

    it('injects clickable spans for NBS codes outside tags', () => {
        const html = '<p>6 - Serviços que se classificam na subposição 1.0503.21.</p><p><strong>1.0602</strong></p>';

        const linked = injectServiceLinks(html);
        const documentNode = new DOMParser().parseFromString(`<div>${linked}</div>`, 'text/html');

        const firstCode = documentNode.querySelector('[data-service-code="1.0503.21"]');
        expect(firstCode).not.toBeNull();
        expect(firstCode?.classList.contains('service-smart-link')).toBe(true);
        expect(firstCode?.classList.contains('service-code-target')).toBe(true);

        const strongWrappedCode = documentNode.querySelector('strong > [data-service-code="1.0602"]');
        expect(strongWrappedCode).not.toBeNull();
        expect(strongWrappedCode?.textContent).toBe('1.0602');
    });

    it('does not inject nested smart links inside anchors or existing service links', () => {
        const html = '<p><a href="#">1.0503.21</a> <span class="service-smart-link">1.0602</span></p>';

        const linked = injectServiceLinks(html);
        const documentNode = new DOMParser().parseFromString(`<div>${linked}</div>`, 'text/html');

        expect(documentNode.querySelectorAll('a .service-smart-link')).toHaveLength(0);
        expect(documentNode.querySelectorAll('.service-smart-link .service-smart-link')).toHaveLength(0);
    });
});
