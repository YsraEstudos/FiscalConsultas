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

        expect(linked).toContain('data-service-code="1.0503.21"');
        expect(linked).toContain('class="service-smart-link service-code-target"');
        expect(linked).toContain('<strong><span class="service-smart-link service-code-target" data-service-code="1.0602">1.0602</span></strong>');
    });
});
