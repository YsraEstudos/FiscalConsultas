import { generateAnchorId } from '../../utils/id_utils';

import type { ResultRecord } from './types';

const LEGACY_MARKDOWN_PATTERN = /(^|\n)\s{0,3}(?:#{1,6}\s|>\s|[-*+]\s|\d+\.\s|---+\s*$)|\*\*[^*\n]+?\*\*/m;

export const isLikelyLegacyMarkdown = (value: string) => LEGACY_MARKDOWN_PATTERN.test(value);

const getAliquotClass = (aliquota: string) => {
    const normalized = (aliquota || '').toString().trim().toUpperCase();
    if (!normalized || normalized === '0' || normalized === '0%') {
        return { className: 'aliquot-zero', tooltip: 'Isento de IPI', display: normalized || '0%' };
    }
    if (normalized === 'NT') {
        return { className: 'aliquot-nt', tooltip: 'Não Tributável', display: 'NT' };
    }

    const numeric = Number(normalized.replace('%', '').replace(',', '.'));
    if (!Number.isNaN(numeric)) {
        if (numeric <= 5) {
            return { className: 'aliquot-low', tooltip: 'Alíquota Reduzida (1-5%)', display: `${numeric}%` };
        }
        if (numeric <= 10) {
            return { className: 'aliquot-med', tooltip: 'Alíquota Média (6-10%)', display: `${numeric}%` };
        }
        return { className: 'aliquot-high', tooltip: 'Alíquota Elevada (>10%)', display: `${numeric}%` };
    }

    return { className: 'aliquot-zero', tooltip: 'Isento de IPI', display: normalized };
};

export const isTipiResults = (resultados: ResultRecord | null | undefined) => {
    if (!resultados || typeof resultados !== 'object') return false;
    const chapters = Object.values(resultados);
    return chapters.some((chapter) =>
        Array.isArray(chapter?.posicoes) && chapter.posicoes.some((pos: any) => 'aliquota' in pos || 'nivel' in pos),
    );
};

export const renderTipiFallback = (resultados: ResultRecord) => {
    const chapters = Object.values(resultados)
        .sort((a: any, b: any) => parseInt(a?.capitulo || '0', 10) - parseInt(b?.capitulo || '0', 10));

    return chapters.map((chapter: any) => {
        const capitulo = chapter?.capitulo || '';
        const titulo = chapter?.titulo || `Capítulo ${capitulo}`;
        const posicoes = Array.isArray(chapter?.posicoes) ? chapter.posicoes : [];

        const positionsHtml = posicoes.map((pos: any) => {
            const codigo = pos?.codigo || pos?.ncm || '';
            const ncm = pos?.ncm || codigo;
            const descricao = pos?.descricao || '';
            const nivel = typeof pos?.nivel === 'number' ? pos.nivel : 1;
            const indentClass = `tipi-nivel-${Math.min(nivel, 5)}`;
            const { className, tooltip, display } = getAliquotClass(pos?.aliquota);
            const elementId = pos?.anchor_id || generateAnchorId(codigo);

            return `
<article class="tipi-position ${indentClass}" id="${elementId}" data-ncm="${ncm}" aria-label="NCM ${codigo}">
    <span class="tipi-ncm smart-link" data-ncm="${ncm}" role="link" tabindex="0">${codigo}</span>
    <span class="tipi-desc">${descricao}</span>
    <span class="tipi-aliquota ${className}" data-tooltip="${tooltip}" aria-label="${tooltip}">${display}</span>
</article>`;
        }).join('');

        return `
<div class="tipi-chapter" id="cap-${capitulo}">
    <h2 class="tipi-chapter-header">
        <span class="tipi-cap-badge">${capitulo}</span>
        ${titulo}
    </h2>
    <div class="tipi-positions">
        ${positionsHtml}
    </div>
</div>`;
    }).join('\n');
};
