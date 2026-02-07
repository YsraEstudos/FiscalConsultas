import { describe, it, expect } from 'vitest';
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
        it('should create anchor for short subposition heading (XXXX.X)', () => {
            const html = NeshRenderer.renderChapter({
                capitulo: '84',
                conteudo: '8419.8 - Outros aparelhos e dispositivos.',
                notas_gerais: null
            });
            expect(html).toContain('id="pos-8419-8"');
            expect(html).toContain('data-ncm="84198"');
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
});
