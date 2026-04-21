import type { ChapterSectionType } from './types';

const SECTION_TARGET_PATTERN = /^chapter-([^-]+)-(titulo|notas|consideracoes|definicoes)$/i;

const SECTION_SELECTOR_FALLBACKS: Record<ChapterSectionType, string[]> = {
    titulo: ['.section-titulo'],
    notas: ['.section-notas', '.regras-gerais'],
    consideracoes: ['.section-consideracoes'],
    definicoes: ['.section-definicoes'],
};

const SECTION_TEXT_FALLBACKS: Record<ChapterSectionType, RegExp> = {
    titulo: /t[ií]tulo do cap[ií]tulo/i,
    notas: /notas do cap[ií]tulo|regras gerais do cap[ií]tulo/i,
    consideracoes: /considera[cç][oõ]es gerais/i,
    definicoes: /defini[cç][oõ]es t[eé]cnicas/i,
};

export const SECTION_TYPES: ChapterSectionType[] = ['titulo', 'notas', 'consideracoes', 'definicoes'];

export function getSectionContent(sectionValue: unknown): string {
    if (typeof sectionValue === 'string') {
        return sectionValue.trim();
    }
    if (typeof sectionValue === 'number') {
        return String(sectionValue).trim();
    }
    return '';
}

function getSectionTargetMeta(targetId: string): { capitulo: string; sectionType: ChapterSectionType } | null {
    const match = targetId.match(SECTION_TARGET_PATTERN);
    if (!match) return null;
    return { capitulo: match[1], sectionType: match[2].toLowerCase() as ChapterSectionType };
}

function getChapterAnchors(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll('[id]'))
        .filter((node) => /^(?:cap|chapter)-\d{1,2}$/.test((node as HTMLElement).id)) as HTMLElement[];
}

function getChapterBounds(container: HTMLElement, capitulo: string): { start: HTMLElement | null; next: HTMLElement | null } {
    const startByCap = container.querySelector(`#${CSS.escape(`cap-${capitulo}`)}`) as HTMLElement | null;
    const startByChapter = container.querySelector(`#${CSS.escape(`chapter-${capitulo}`)}`) as HTMLElement | null;
    const start = startByCap || startByChapter;
    if (!start) return { start: null, next: null };

    const anchors = getChapterAnchors(container);
    const idx = anchors.findIndex((el) => el === start);
    if (idx < 0) return { start, next: null };

    return { start, next: anchors[idx + 1] || null };
}

function isElementWithinBounds(element: HTMLElement, start: HTMLElement, next: HTMLElement | null): boolean {
    const isAfterStart = start === element
        || Boolean(start.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!isAfterStart) return false;
    if (!next) return true;
    return Boolean(element.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING);
}

export function resolveSectionElement(container: HTMLElement, targetId: string): HTMLElement | null {
    const sectionMeta = getSectionTargetMeta(targetId);
    if (!sectionMeta) return null;

    const { capitulo, sectionType } = sectionMeta;
    const { start, next } = getChapterBounds(container, capitulo);
    const isInChapter = (candidate: HTMLElement) => !start || isElementWithinBounds(candidate, start, next);

    for (const selector of SECTION_SELECTOR_FALLBACKS[sectionType]) {
        const candidate = Array.from(container.querySelectorAll(selector))
            .find((node) => node instanceof HTMLElement && isInChapter(node as HTMLElement)) as HTMLElement | undefined;

        if (candidate) {
            if (!candidate.id) candidate.id = targetId;
            return candidate;
        }
    }

    const headingRegex = SECTION_TEXT_FALLBACKS[sectionType];
    const heading = Array.from(container.querySelectorAll('h2, h3, h4, p, strong'))
        .find((node) =>
            node instanceof HTMLElement
            && isInChapter(node as HTMLElement)
            && headingRegex.test((node.textContent || '').trim()),
        ) as HTMLElement | undefined;

    if (!heading) return null;

    const sectionRoot = heading.closest('div, section, article, blockquote') as HTMLElement | null;
    const resolved = sectionRoot || heading;
    if (!resolved.id) resolved.id = targetId;
    return resolved;
}
