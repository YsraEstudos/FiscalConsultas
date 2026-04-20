import type {
    CodeSearchResponse,
    SearchResponse,
    TextSearchResponse,
    TipiCodeSearchResponse,
    TipiTextSearchResponse,
} from '../types/api.types';
import { isCodeSearchResponse } from '../types/api.types';
import { generateAnchorId } from './id_utils';
import { NeshRenderer } from './NeshRenderer';

type SupportedDocType = 'nesh' | 'tipi';

type CodeResults = Record<string, any>;

function escapeMarkupText(value: unknown): string {
    return NeshRenderer.escapeHtml(String(value ?? ''));
}

function escapeMarkupAttr(value: unknown): string {
    return escapeMarkupText(value);
}

function normalizeTipiLevel(value: unknown): number {
    const numericLevel = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericLevel)) {
        return 1;
    }

    return Math.min(Math.max(Math.trunc(numericLevel), 1), 5);
}

function getAliquotClass(aliquota: string) {
    const normalized = (aliquota || '').toString().trim().toUpperCase();
    if (!normalized) {
        return { className: 'aliquot-unknown', tooltip: 'Nao informado', display: 'N/I' };
    }

    if (normalized === 'NT') {
        return { className: 'aliquot-nt', tooltip: 'Nao Tributavel', display: 'NT' };
    }

    const numeric = Number(normalized.replace('%', '').replace(',', '.'));
    if (!Number.isNaN(numeric)) {
        if (numeric === 0) {
            return { className: 'aliquot-zero', tooltip: 'Isento de IPI', display: '0%' };
        }
        if (numeric <= 5) {
            return { className: 'aliquot-low', tooltip: 'Aliquota Reduzida (1-5%)', display: `${numeric}%` };
        }
        if (numeric <= 10) {
            return { className: 'aliquot-med', tooltip: 'Aliquota Media (6-10%)', display: `${numeric}%` };
        }
        return { className: 'aliquot-high', tooltip: 'Aliquota Elevada (>10%)', display: `${numeric}%` };
    }

    return { className: 'aliquot-unknown', tooltip: 'Nao informado', display: 'N/I' };
}

function renderTipiPosition(pos: any): string {
    const codigo = pos?.codigo || pos?.ncm || '';
    const ncm = pos?.ncm || codigo;
    const descricao = pos?.descricao || '';
    const indentClass = `tipi-nivel-${normalizeTipiLevel(pos?.nivel)}`;
    const { className, tooltip, display } = getAliquotClass(pos?.aliquota);
    const elementId = escapeMarkupAttr(generateAnchorId(codigo));
    const safeCodigo = escapeMarkupText(codigo);
    const safeNcm = escapeMarkupAttr(ncm);
    const safeDescricao = escapeMarkupText(descricao);
    const safeTooltip = escapeMarkupAttr(tooltip);
    const safeDisplay = escapeMarkupText(display);
    const safeAriaLabel = escapeMarkupAttr(`NCM ${codigo}`);

    return `
<article class="tipi-position ${indentClass}" id="${elementId}" data-ncm="${safeNcm}" aria-label="${safeAriaLabel}">
    <span class="tipi-ncm smart-link" data-ncm="${safeNcm}" role="link" tabindex="0">${safeCodigo}</span>
    <span class="tipi-desc">${safeDescricao}</span>
    <span class="tipi-aliquota ${className}" data-tooltip="${safeTooltip}" aria-label="${safeTooltip}">${safeDisplay}</span>
</article>`;
}

function renderTipiChapter(chapter: any): string | null {
    const capitulo = chapter?.capitulo || '';
    const titulo = chapter?.titulo || (capitulo ? `Capitulo ${capitulo}` : '');
    const chapterId = escapeMarkupAttr(`cap-${capitulo}`);
    const safeCapitulo = escapeMarkupText(capitulo);
    const safeTitulo = escapeMarkupText(titulo);
    const posicoes = Array.isArray(chapter?.posicoes) ? chapter.posicoes : [];
    const positionsHtml = posicoes.map(renderTipiPosition).join('');

    if (!safeCapitulo && !safeTitulo && !positionsHtml) {
        return null;
    }

    return `
<div class="tipi-chapter" id="${chapterId}">
    <h2 class="tipi-chapter-header">
        <span class="tipi-cap-badge">${safeCapitulo}</span>
        ${safeTitulo}
    </h2>
    <div class="tipi-positions">
        ${positionsHtml}
    </div>
</div>`;
}

function renderTipiFallback(resultados: CodeResults): string | null {
    const chapters = Object.values(resultados)
        .sort((a: any, b: any) => parseInt(a?.capitulo || '0', 10) - parseInt(b?.capitulo || '0', 10));

    if (chapters.length === 0) {
        return null;
    }

    const renderedChapters = chapters
        .map(renderTipiChapter)
        .filter((chapter): chapter is string => Boolean(chapter));

    if (renderedChapters.length === 0) {
        return null;
    }

    return renderedChapters.join('\n');
}

function hasRenderableNeshContent(results: CodeResults): boolean {
    return Object.values(results).some((chapter: any) => {
        const content = chapter?.conteudo;
        return typeof content === 'string' && content.trim().length > 0;
    });
}

function renderTextSearchItem(item: any): string {
    const code = item?.ncm || item?.code || '';
    const description = item?.descricao || item?.description || item?.title || '';
    const safeCode = escapeMarkupText(code);
    const safeDescription = escapeMarkupText(description);
    const hasAliquota = item?.aliquota !== undefined && item?.aliquota !== null;
    const extra = hasAliquota ? ` <strong>${escapeMarkupText(item.aliquota)}</strong>` : '';

    return `<li><strong>${safeCode}</strong> - ${safeDescription}${extra}</li>`;
}

function renderTextSearchFallback(response: TextSearchResponse | TipiTextSearchResponse): string | null {
    if (!Array.isArray(response.results) || response.results.length === 0) {
        return null;
    }

    const itemsHtml = response.results.map(renderTextSearchItem).join('');
    return `<ul class="compare-text-results">${itemsHtml}</ul>`;
}

export function buildLocalCodeSearchResponse(
    doc: SupportedDocType,
    query: string,
    results: CodeResults,
    markdown?: string | null,
): CodeSearchResponse | TipiCodeSearchResponse {
    const safeResults = results && typeof results === 'object' ? results : {};

    if (doc === 'tipi') {
        return {
            success: true,
            type: 'code',
            query,
            results: safeResults,
            resultados: safeResults,
            total: Object.values(safeResults).reduce(
                (sum: number, chapter: any) => sum + (Array.isArray(chapter?.posicoes) ? chapter.posicoes.length : 0),
                0,
            ),
            total_capitulos: Object.keys(safeResults).length,
            markdown: markdown || undefined,
        };
    }

    return {
        success: true,
        type: 'code',
        query,
        normalized: null,
        results: safeResults,
        resultados: safeResults,
        total_capitulos: Object.keys(safeResults).length,
        markdown: markdown || undefined,
    };
}

export function resolveSearchResponseMarkup(
    doc: SupportedDocType,
    response: SearchResponse | CodeSearchResponse | TipiCodeSearchResponse | null | undefined,
): string | null {
    if (!response) return null;

    if ('markdown' in response && typeof response.markdown === 'string' && response.markdown.trim().length > 0) {
        return response.markdown;
    }

    if (isCodeSearchResponse(response)) {
        const codeResults = (response.resultados || response.results) as CodeResults | undefined;
        if (!codeResults || typeof codeResults !== 'object') {
            return null;
        }

        if (doc === 'tipi') {
            return renderTipiFallback(codeResults);
        }

        if (!hasRenderableNeshContent(codeResults)) {
            return null;
        }

        return NeshRenderer.renderFullResponse(codeResults);
    }

    if ('results' in response && Array.isArray(response.results)) {
        return renderTextSearchFallback(response as TextSearchResponse | TipiTextSearchResponse);
    }

    return null;
}
