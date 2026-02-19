import { describe, it, expect, vi } from 'vitest';
import { NeshRenderer } from './NeshRenderer';

describe('NeshRenderer', () => {
    describe('injectSmartLinks', () => {
        it('should linkify standard NCM codes (XXXX.XX.XX)', () => {
            const input = 'Ver item 8401.10.00 aqui.';
            const expected = 'Ver item <a href="#" class="smart-link" data-ncm="84011000">8401.10.00</a> aqui.';
            expect(NeshRenderer.injectSmartLinks(input)).toBe(expected);
        });

        it('should linkify NCM subheadings (XXXX.XX)', () => {
            const input = 'Ver posição 8401.20.';
            const expected = 'Ver posição <a href="#" class="smart-link" data-ncm="840120">8401.20</a>.';
            expect(NeshRenderer.injectSmartLinks(input)).toBe(expected);
        });

        it('should linkify short subpositions (XXXX.X)', () => {
            const input = 'Ver subposição 8419.8.';
            const expected = 'Ver subposição <a href="#" class="smart-link" data-ncm="84198">8419.8</a>.';
            expect(NeshRenderer.injectSmartLinks(input)).toBe(expected);
        });

        // The feature requested: Support for Headings (XX.XX)
        it('should linkify NCM Headings (XX.XX)', () => {
            const input = 'Nas posições 38.01 ou 68.15, de berílio (81.12).';

            // Expected behavior after fix
            const expectedPattern38 = '<a href="#" class="smart-link" data-ncm="3801">38.01</a>';
            const expectedPattern68 = '<a href="#" class="smart-link" data-ncm="6815">68.15</a>';
            const expectedPattern81 = '<a href="#" class="smart-link" data-ncm="8112">81.12</a>';

            const output = NeshRenderer.injectSmartLinks(input);

            expect(output).toContain(expectedPattern38);
            expect(output).toContain(expectedPattern68);
            expect(output).toContain(expectedPattern81);
        });

        it('should avoid linking inside existing HTML tags', () => {
            const input = '<h3 data-ncm="8517">Este é 8517.</h3>';
            // Should NOT double link the data-ncm attribute or the content inside if it matches robustly
            // But current implementation splits by tags and only replaces distinct text nodes.
            // basic check:
            const output = NeshRenderer.injectSmartLinks(input);
            expect(output).toContain('data-ncm="8517"');
            // The text content "8517" is just 4 digits without dots, regex current expects 4 digits + dots usually?
            // Wait, existing regex is: /\b(\d{4}\.\d{2}(\.\d{2})?)\b/g
            // So "8517" alone is NOT matched by the existing regex.
        });

        it('should not linkify unrelated numbers like dates or versions', () => {
            // "v1.0.0" -> \b checks should help.
            // "10.0.0.1" -> IP
            const input = 'Versão 2.50 não é NCM.';
            // "2.50" matches \d{1,4}\.\d{2} ? 
            // Existing regex was \d{4}. New will be \d{2,4}.
            // So "2.50" has 1 digit, should fail. "12.50" has 2 digits, might pass.
            // This is a known risk.
            const output = NeshRenderer.injectSmartLinks(input);
            expect(output).toBe(input);
        });

        it('should linkify when inside parenthesis', () => {
            const input = '(veja 8471.30)';
            const output = NeshRenderer.injectSmartLinks(input);
            expect(output).toContain('data-ncm="847130"');
        });
    });

    describe('renderChapter', () => {
        it('returns empty string when chapter content is missing', () => {
            expect(NeshRenderer.renderChapter(null)).toBe('');
            expect(NeshRenderer.renderChapter({ capitulo: '84' })).toBe('');
        });

        it('should create anchor for short subposition heading (XXXX.X)', () => {
            const html = NeshRenderer.renderChapter({
                capitulo: '84',
                conteudo: '8419.8 - Outros aparelhos e dispositivos.',
                notas_gerais: null
            });
            expect(html).toContain('id="pos-8419-8"');
            expect(html).toContain('data-ncm="84198"');
        });

        it('renders ordered/unordered lists and legacy notes block', () => {
            const html = NeshRenderer.renderChapter({
                capitulo: '84',
                conteudo: `A) Item A
B) Item B

- Item U
- Item V

84.01 - Reatores nucleares`,
                notas_gerais: 'Nota 7 do Capítulo 73.\nVer 84.01',
                secoes: null
            });

            expect(html).toContain('<ol class="nesh-list">');
            expect(html).toContain('<ul class="nesh-list">');
            expect(html).toContain('id="chapter-84-notas"');
            expect(html).toContain('data-note="7"');
            expect(html).toContain('data-chapter="73"');
            expect(html).toContain('data-ncm="8401"');
        });

        it('should render structured sections with expected anchors', () => {
            const html = NeshRenderer.renderChapter({
                capitulo: '84',
                conteudo: '84.01 - Reatores nucleares.',
                notas_gerais: null,
                secoes: {
                    titulo: 'Máquinas e aparelhos',
                    notas: 'Notas do capítulo',
                    consideracoes: 'Considerações gerais',
                    definicoes: 'Definições técnicas'
                }
            });

            expect(html).toContain('id="chapter-84-titulo"');
            expect(html).toContain('id="chapter-84-notas"');
            expect(html).toContain('id="chapter-84-consideracoes"');
            expect(html).toContain('id="chapter-84-definicoes"');
        });
    });

    describe('helpers and full rendering', () => {
        it('escapeHtml sanitizes unsafe characters', () => {
            const escaped = NeshRenderer.escapeHtml(`<script>alert("x")</script> & '`);
            expect(escaped).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
            expect(escaped).toContain('&amp;');
            expect(escaped).toContain('&#039;');
        });

        it('cleanContent removes known garbage patterns and preserves useful text', () => {
            const cleaned = NeshRenderer.cleanContent(`Página 1 de 2
XV-7324-1
84.01
- *
*
Texto útil`);

            expect(cleaned).not.toContain('Página');
            expect(cleaned).not.toContain('XV-7324-1');
            expect(cleaned).not.toContain('84.01');
            expect(cleaned).not.toContain('- *');
            expect(cleaned).toContain('Texto útil');
        });

        it('injects note links with and without chapter context', () => {
            const html = NeshRenderer.injectNoteLinks('Ver Nota 3 do Capítulo 84 e Nota 5.');

            expect(html).toContain('data-note="3"');
            expect(html).toContain('data-chapter="84"');
            expect(html).toContain('data-note="5"');
        });

        it('injects exclusion highlights outside raw text', () => {
            const html = NeshRenderer.injectHighlights('A nota não compreende este item, exceto quando indicado.');
            expect(html).toContain('<span class="highlight-exclusion">não compreende</span>');
            expect(html).toContain('<span class="highlight-exclusion">exceto</span>');
        });

        it('convertTextToHtml renders heading and bold markdown', () => {
            const html = NeshRenderer.convertTextToHtml(`84.01 - Reatores

Texto **forte**`);

            expect(html).toContain('class="nesh-section"');
            expect(html).toContain('id="pos-84-01"');
            expect(html).toContain('<strong>forte</strong>');
        });

        it('renderFullResponse sorts chapters and keeps successful render output', () => {
            const html = NeshRenderer.renderFullResponse({
                "10": { capitulo: '10', conteudo: '10.01 - Item 10', notas_gerais: null },
                "02": { capitulo: '02', conteudo: '02.01 - Item 2', notas_gerais: null }
            });

            expect(html.indexOf('Capítulo 02')).toBeLessThan(html.indexOf('Capítulo 10'));
        });

        it('renderFullResponse handles render errors per chapter', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            const brokenChapter: any = { capitulo: '99', notas_gerais: null };
            Object.defineProperty(brokenChapter, 'conteudo', {
                get() {
                    throw new Error('boom');
                }
            });

            const html = NeshRenderer.renderFullResponse({
                "01": { capitulo: '01', conteudo: '01.01 - Item 1', notas_gerais: null },
                "99": brokenChapter
            });

            expect(errorSpy).toHaveBeenCalled();
            expect(html).toContain('Erro renderizando capítulo 99');
            expect(html).toContain('Capítulo 01');

            errorSpy.mockRestore();
        });
    });
});
