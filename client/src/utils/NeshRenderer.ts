import { generateAnchorId, generateChapterId } from './id_utils';

/**
 * NeshRenderer - Port of backend/presentation/renderer.py
 * Responsible for transforming raw NESH text into rich HTML.
 */
export const NeshRenderer = {
    // Regex Patterns
    RE_CLEAN_PAGE: /Página\s+\d+\s+de\s+\d+/gi,
    RE_CLEAN_SPACES: /\s{3,}/g, // Approx clean spaces
    RE_NOTE_REF: /(Nota|Notas)\s+(\d+)(\s+do\s+Capítulo\s+(\d+))?/gi,
    // Accept short subpositions like 8418.9 (1 digit after the dot)
    RE_NCM_LINK: /\b(\d{2,4}\.\d{1,2}(\.\d{2})?)\b/g,
    RE_EXCLUSION: /\b(não\s+compreende|exclui|exceto)\b/gi,
    RE_UNIT: /\b(\d+(?:[\.,]\d+)?\s*(?:kg|m²|m³|litros|unidades|par|pares|milheiro))\b/gi,

    // Heading: capture 85.17 - Title or short subpositions like 8419.8 - Title
    RE_NCM_HEADING: /^\s*(?:\*\*|\*)?(\d{2}\.\d{2}(?:\.\d{2})?|\d{4}\.\d{1,2})(?:\*\*|\*)?\s*-\s*(.+?)(?:\*\*|\*)?\s*$/gm,

    // Lists
    RE_LETTER_LIST: /^([a-z]\))\s+(.+)$/gm,
    RE_NUMBER_LIST: /^(\d+[\.\)])\s+(.+)$/gm,
    RE_ROMAN_LIST: /^([IVX]+[\.\)])\s+(.+)$/gm,

    RE_BOLD_MARKDOWN: /\*\*(.+?)\*\*/g,

    /**
     * Escapes unsafe HTML characters to prevent XSS.
     * Must be called BEFORE any HTML injection (bold, headers, links).
     */
    escapeHtml(unsafe: string): string {
        if (!unsafe) return "";
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    },

    cleanContent(content: string): string {
        if (!content) return "";
        // 1. Sanitize FIRST (security fix)
        let text = this.escapeHtml(content);

        // 2. Remove Garbage
        text = text.replace(this.RE_CLEAN_PAGE, '');
        // Remove internal refs like XV-7324-1 (simple approximation)
        text = text.replace(/^\s*XV-\d{4}-\d+\s*$/gm, '');
        // Remove standalone NCM lines
        text = text.replace(/^\s*\d{2}\.\d{2}(?:\.\d{2})?\s*$/gm, '');
        // Remove stray list markers like "-" or "- *" or "*"
        text = text.replace(/^\s*-\s*\*?\s*$/gm, '');
        text = text.replace(/^\s*\*\s*$/gm, '');

        // Normalize double newlines
        return text.split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n');
    },

    /**
     * Replaces matches only outside of HTML tags.
     */
    replaceSafe(text: string, regex: RegExp, replacer: (match: RegExpExecArray) => string): string {
        // Simple parser: split by tags
        // This is a naive implementation but sufficient for our specific controlled output
        // A better approach iterates matches and checks indices against tag ranges.
        // For complexity reasons, we'll try a regex that matches tags OR targets.

        // However, JS regex global execution is tricky. 
        // Let's use a simpler heuristic: we assume we haven't introduced complex nested tags yet except spans/anchors.
        return text.replace(regex, (match, ...args) => {
            // Check if we are inside a tag? This method doesn't know context.
            // PROPER WAY: Tokenize.
            return replacer([match, ...args] as any);
        });
    },

    injectNoteLinks(text: string): string {
        return text.replace(this.RE_NOTE_REF, (...args) => {
            const match = String(args[0] ?? '');
            const num = String(args[2] ?? '');
            const chap = args[4] ? String(args[4]) : '';
            if (chap) {
                return `<span class="note-ref" data-note="${num}" data-chapter="${chap}">${match}</span>`;
            }
            return `<span class="note-ref" data-note="${num}">${match}</span>`;
        });
    },

    injectSmartLinks(text: string): string {
        // Avoid replacing inside existing tags (like <h3 data-ncm="8517">)
        const parts = text.split(/(<[^>]+>)/g);
        return parts.map((part) => {
            if (part.startsWith('<')) return part;
            return part.replace(this.RE_NCM_LINK, (match) => {
                const clean = match.replace(/\./g, '');
                return `<a href="#" class="smart-link" data-ncm="${clean}">${match}</a>`;
            });
        }).join('');
    },

    injectHighlights(text: string): string {
        let out = text;
        const parts = out.split(/(<[^>]+>)/g);
        return parts.map((part) => {
            if (part.startsWith('<')) return part;
            let p = part.replace(this.RE_EXCLUSION, (m) => `<span class="highlight-exclusion">${m}</span>`);
            // p = p.replace(this.RE_UNIT, (m) => `<span class="highlight-unit">${m}</span>`); // Units often clash with numbers, careful
            return p;
        }).join('');
    },

    convertTextToHtml(text: string): string {
        if (!text) return "";
        const blocks = text.split(/\n\n+/);
        const htmlParts: string[] = [];

        for (let block of blocks) {
            block = block.trim();
            if (!block) continue;

            // Heading match
            // Reset regex state if global
            this.RE_NCM_HEADING.lastIndex = 0;
            const headingMatch = this.RE_NCM_HEADING.exec(block);
            if (headingMatch) {
                const [, ncmCode, title] = headingMatch;
                const cleanNcm = ncmCode.replace(/\./g, '');
                const anchorId = generateAnchorId(ncmCode);
                const isShortSubpos = /^\d{4}\.\d{1,2}$/.test(ncmCode);
                const tag = isShortSubpos ? 'h4' : 'h3';
                const cls = isShortSubpos ? 'nesh-subsection' : 'nesh-section';

                htmlParts.push(
                    `<${tag} class="${cls}" id="${anchorId}" data-ncm="${cleanNcm}">` +
                    `<strong>${ncmCode}</strong> - ${title}</${tag}>`
                );
                continue;
            }

            // Lists logic would go here (omitted for brevity, assume paragraphs for now mostly)
            // But let's handle bold markdown at least
            let content = block.replace(/\n/g, '<br>\n');
            content = content.replace(this.RE_BOLD_MARKDOWN, '<strong>$1</strong>');

            htmlParts.push(`<p class="nesh-paragraph">${content}</p>`);
        }
        return htmlParts.join('\n\n');
    },

    renderChapter(data: any): string {
        if (!data || !data.conteudo) return "";

        let content = this.cleanContent(data.conteudo);

        // Inject structure
        // Since convertTextToHtml splits by blocks, it handles the H3 generation
        // But the backend renderer did replace on the WHOLE content first.
        // Let's mimic backend: structure H3s first using replace on full text.

        // 1. Structure headings (H3 for positions, H4 for short subpositions like 8419.8)
        content = content.replace(this.RE_NCM_HEADING, (_match, code, desc) => {
            const anchorId = generateAnchorId(code);
            const cleanNcm = code.replace(/\./g, '');
            const isShortSubpos = /^\d{4}\.\d{1,2}$/.test(code);
            const tag = isShortSubpos ? 'h4' : 'h3';
            const cls = isShortSubpos ? 'nesh-subsection' : 'nesh-section';
            return `<${tag} class="${cls}" id="${anchorId}" data-ncm="${cleanNcm}"><strong>${code}</strong> - ${desc}</${tag}>`;
        });

        // Helper to process inline markdown (Bold, Italic)
        const processInlineMarkdown = (text: string) => {
            let processed = text.replace(/\n/g, '<br>\n');
            processed = processed.replace(this.RE_BOLD_MARKDOWN, '<strong>$1</strong>');
            return processed;
        };

        // 2. Wrap non-html blocks in paragraphs
        const blocks = content.split(/\n\n+/);
        const processedBlocks = blocks.map(block => {
            block = block.trim();
            if (block.startsWith('<h3') || block.startsWith('<h4')) return block;

            // Handle lists (Expanded regex to support Uppercase A) B) and Bullets - *)
            // Added [A-Z] for "A)" and [-\*] for bullets
            if (block.match(/^[A-Za-z]\)/m) || block.match(/^\d+[\.\)]/m) || block.match(/^[\-\*]\s+/m)) {
                // Convert list items
                const lines = block.split('\n');
                const items = lines.map(line => {
                    // Check if list item (Ordered or Unordered)
                    const m = line.match(/^([A-Za-z]\)|[\dIVX]+[\.\)]|[\-\*])\s+(.+)$/);
                    if (m) {
                        return `<li>${processInlineMarkdown(m[2])}</li>`;
                    }
                    return processInlineMarkdown(line); // Fallback for multiline list items
                });

                // Decide list type: <ol> for ordered, <ul> for bullets
                const isUnordered = block.trim().match(/^[\-\*]\s+/);
                const tag = isUnordered ? 'ul' : 'ol';
                return `<${tag} class="nesh-list">${items.join('')}</${tag}>`;
            }

            // Paragraph
            return `<p class="nesh-paragraph">${processInlineMarkdown(block)}</p>`;
        });

        content = processedBlocks.join('\n\n');

        // 3. Inject Links (Note: only on text parts ideally, but regex normally handles this if patterns are distinct)
        content = this.injectNoteLinks(content);
        content = this.injectSmartLinks(content);
        content = this.injectHighlights(content);

        // Header and Footer items in PURE HTML
        let htmlContent = `
            <hr class="nesh-divider">
            <span id="${generateChapterId(data.capitulo)}"></span>
            <h2 class="nesh-chapter-title">Capítulo ${data.capitulo}</h2>
        `;

        // Render structured sections if available
        const secoes = data.secoes;
        if (secoes) {
            // 1. Título do Capítulo
            if (secoes.titulo) {
                const tituloHtml = this.escapeHtml(secoes.titulo);
                htmlContent += `
                    <div class="section-titulo" id="chapter-${data.capitulo}-titulo">
                        <h3 class="section-header titulo-header">📖 ${tituloHtml}</h3>
                    </div>
                `;
            }

            // 2. Notas do Capítulo
            if (secoes.notas) {
                let notas = this.escapeHtml(secoes.notas);
                notas = this.injectNoteLinks(notas);
                notas = this.injectSmartLinks(notas);
                const notasHtml = notas.replace(/\n/g, '<br>');
                htmlContent += `
                    <div class="section-notas" id="chapter-${data.capitulo}-notas">
                        <h3 class="section-header notas-header">📝 Notas do Capítulo</h3>
                        <blockquote class="nesh-blockquote">${notasHtml}</blockquote>
                    </div>
                `;
            }

            // 3. Considerações Gerais
            if (secoes.consideracoes) {
                let cg = this.escapeHtml(secoes.consideracoes);
                cg = this.injectNoteLinks(cg);
                cg = this.injectSmartLinks(cg);
                const cgHtml = cg.replace(/\n/g, '<br>');
                htmlContent += `
                    <div class="section-consideracoes" id="chapter-${data.capitulo}-consideracoes">
                        <h3 class="section-header consideracoes-header">📚 Considerações Gerais</h3>
                        <div class="consideracoes-content">${cgHtml}</div>
                    </div>
                `;
            }

            // 4. Definições Técnicas
            if (secoes.definicoes) {
                let def = this.escapeHtml(secoes.definicoes);
                def = this.injectNoteLinks(def);
                def = this.injectSmartLinks(def);
                const defHtml = def.replace(/\n/g, '<br>');
                htmlContent += `
                    <div class="section-definicoes" id="chapter-${data.capitulo}-definicoes">
                        <h3 class="section-header definicoes-header">📋 Definições Técnicas</h3>
                        <div class="definicoes-content">${defHtml}</div>
                    </div>
                `;
            }
        } else if (data.notas_gerais) {
            // Legacy: single notes block
            let notas = this.escapeHtml(data.notas_gerais);
            notas = this.injectNoteLinks(notas);
            notas = this.injectSmartLinks(notas);
            const notasHtml = notas.replace(/\n/g, '<br>');
            const notesAnchorId = `chapter-${data.capitulo}-notas`;
            htmlContent += `
                <div class="regras-gerais" id="${notesAnchorId}">
                    <h3>📝 Notas do Capítulo</h3>
                    <blockquote class="nesh-blockquote">${notasHtml}</blockquote>
                </div>
            `;
        }

        htmlContent += `<div class="nesh-chapter-body">${content}</div>`;
        return htmlContent;
    },

    renderFullResponse(results: Record<string, any>): string {
        const chapters = Object.values(results).sort((a: any, b: any) =>
            parseInt(a.capitulo) - parseInt(b.capitulo)
        );

        return chapters.map(ch => {
            try {
                return this.renderChapter(ch);
            } catch (e) {
                console.error("Render error", e);
                return `<p>Erro renderizando capítulo ${ch.capitulo}</p>`;
            }
        }).join('\n');
    }
};
