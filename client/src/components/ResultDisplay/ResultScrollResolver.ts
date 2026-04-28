import type React from 'react';

import { generateAnchorId } from '../../utils/id_utils';

import { getAnchorCodeFromNcmValue } from './ResultChapterHydration';
import { getSectionContent, resolveSectionElement, SECTION_TYPES } from './ResultSectionResolver';
import type { ResultData, ResultRecord } from './types';

export const MANUAL_NAVIGATION_HIGHLIGHT_LOCK_MS = 900;

export function normalizeDigits(value: string): string {
    return value.replace(/\D/g, '');
}

function buildAnchorCandidatesFromDigits(digits: string): string[] {
    if (digits.length < 4) return [];

    const head4 = digits.slice(0, 4);
    const candidates = [`pos-${head4.slice(0, 2)}-${head4.slice(2)}`, `pos-${head4}`];
    if (digits.length >= 6) {
        candidates.push(`pos-${digits.slice(0, 4)}-${digits.slice(4, 6)}`);
    }
    if (digits.length >= 8) {
        candidates.push(`pos-${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`);
    }
    return candidates;
}

export function resolveNcmToScroll(data: ResultData | null): string | null {
    if (!data) return null;
    return data.ncm || data.query || null;
}

export function findAnchorIdInChapter(
    chapter: any,
    normalizedQuery: string,
    existingPrefix: string | null,
): { exactMatch: string | null; prefixMatch: string | null } {
    const positions = Array.isArray(chapter?.posicoes) ? chapter.posicoes : [];
    let prefixMatch = existingPrefix;

    for (const pos of positions) {
        const codigo = (pos?.codigo || pos?.ncm || '').toString();
        if (!codigo) continue;

        const normalizedCodigo = normalizeDigits(codigo);
        if (normalizedCodigo === normalizedQuery) {
            return {
                exactMatch: pos?.anchor_id || generateAnchorId(codigo),
                prefixMatch,
            };
        }

        if (!prefixMatch && normalizedCodigo.startsWith(normalizedQuery)) {
            prefixMatch = pos?.anchor_id || generateAnchorId(codigo);
        }
    }

    return { exactMatch: null, prefixMatch };
}

export function getStructuredSectionIds(capitulo: string, secoes: Record<string, unknown>): string[] {
    if (!capitulo) return [];

    const ids: string[] = [];
    for (const sectionType of SECTION_TYPES) {
        const sectionValue = secoes[sectionType];
        const sectionContent = getSectionContent(sectionValue);
        if (!sectionContent) continue;
        ids.push(`chapter-${capitulo}-${sectionType}`);
    }
    return ids;
}

export function resolveAutoScrollCandidates(
    ncmToScroll: string,
    codeResults: ResultRecord | null,
    findAnchorIdForQuery: (resultados: ResultRecord, query: string) => string | null,
    getPosicaoAlvoFromResultados: (resultados: ResultRecord) => string | null,
): string[] {
    const posicaoAlvo = codeResults ? getPosicaoAlvoFromResultados(codeResults) : null;
    const anchorFromResultados = codeResults ? findAnchorIdForQuery(codeResults, ncmToScroll) : null;
    const exactId = anchorFromResultados
        || (posicaoAlvo ? generateAnchorId(posicaoAlvo) : null)
        || generateAnchorId(ncmToScroll);

    const candidates = [exactId];
    candidates.push(...buildAnchorCandidatesFromDigits(normalizeDigits(ncmToScroll)));
    return Array.from(new Set(candidates));
}

export function findExistingTargetElement(container: HTMLElement, targets: string[]): HTMLElement | null {
    for (const id of targets) {
        const element = container.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
        if (element) return element;
    }
    return null;
}

function buildDataNcmTargetValues(candidateNcm: string): string[] {
    const normalized = normalizeDigits(candidateNcm);
    if (!normalized) return [];

    const values = new Set<string>([normalized]);
    if (normalized.length >= 6) {
        values.add(`${normalized.slice(0, 4)}.${normalized.slice(4, 6)}`);
    }
    if (normalized.length >= 8) {
        values.add(`${normalized.slice(0, 4)}.${normalized.slice(4, 6)}.${normalized.slice(6, 8)}`);
    }
    if (normalized.length >= 4) {
        const positionDigits = normalized.slice(0, 4);
        values.add(positionDigits);
        values.add(`${positionDigits.slice(0, 2)}.${positionDigits.slice(2, 4)}`);
    }

    return Array.from(values).sort((left, right) => right.length - left.length);
}

export function ensureTargetAnchorFromDataNcm(
    container: HTMLElement,
    candidateNcm: string,
): HTMLElement | null {
    for (const value of buildDataNcmTargetValues(candidateNcm)) {
        const element = container.querySelector(`[data-ncm="${value}"]`) as HTMLElement | null;
        if (!element) continue;

        const anchorCode = getAnchorCodeFromNcmValue(value);
        if (!element.id) {
            element.id = generateAnchorId(anchorCode);
        }
        return element;
    }

    return null;
}

export function getWrapperClasses(
    stylesMap: Record<string, string>,
    sidebarCollapsed: boolean,
    mobileMenuOpen: boolean,
    sidebarPosition: 'left' | 'right',
): string {
    return [
        stylesMap.wrapper,
        sidebarCollapsed ? stylesMap.sidebarCollapsed : '',
        mobileMenuOpen ? stylesMap.sidebarOpen : '',
        sidebarPosition === 'left' ? stylesMap.sidebarLeft : '',
    ].filter(Boolean).join(' ');
}

export function getSidebarToggleIcon(sidebarPosition: 'left' | 'right', sidebarCollapsed: boolean): string {
    if (sidebarPosition === 'left') {
        return sidebarCollapsed ? '▶' : '◀';
    }
    return sidebarCollapsed ? '◀' : '▶';
}

export function getSidebarToggleLabel(sidebarCollapsed: boolean): string {
    return sidebarCollapsed ? 'Expandir navegação' : 'Recolher navegação';
}

export function getContentVisibilityClass(stylesMap: Record<string, string>, isContentReady: boolean): string {
    return isContentReady ? stylesMap.contentVisible : stylesMap.contentHidden;
}

export function getCommentToggleClassName(stylesMap: Record<string, string>, commentsEnabled: boolean): string {
    if (!commentsEnabled) return stylesMap.commentToggle;
    return `${stylesMap.commentToggle} ${stylesMap.commentToggleActive}`;
}

export function getCommentToggleLabel(commentsEnabled: boolean): string {
    return commentsEnabled ? 'Desativar comentários' : 'Ativar comentários';
}

export function getNextVisibleAnchorId(entries: IntersectionObserverEntry[]): string | null {
    const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
    return visible[0]?.target?.id || null;
}

export function scheduleActiveAnchorUpdate(
    nextAnchorId: string,
    activeAnchorIdRef: React.MutableRefObject<string | null>,
    anchorRafRef: React.MutableRefObject<number | null>,
    setActiveAnchorId: React.Dispatch<React.SetStateAction<string | null>>,
) {
    if (nextAnchorId === activeAnchorIdRef.current) return;

    if (anchorRafRef.current !== null) {
        cancelAnimationFrame(anchorRafRef.current);
    }

    anchorRafRef.current = requestAnimationFrame(() => {
        anchorRafRef.current = null;
        setActiveAnchorId((prev) => (prev === nextAnchorId ? prev : nextAnchorId));
    });
}

type NavigateToResultTargetArgs = {
    container: HTMLElement;
    targetId: string;
    manualNavigationLockRef: React.MutableRefObject<{ anchorId: string; expiresAt: number } | null>;
    setActiveAnchorId: React.Dispatch<React.SetStateAction<string | null>>;
};

export function navigateToResultTarget({
    container,
    targetId,
    manualNavigationLockRef,
    setActiveAnchorId,
}: NavigateToResultTargetArgs): boolean {
    let element = container.querySelector(`#${CSS.escape(targetId)}`) as HTMLElement | null;
    if (!element) {
        const generatedId = generateAnchorId(targetId);
        element = container.querySelector(`#${CSS.escape(generatedId)}`) as HTMLElement | null;
    }
    if (!element) {
        element = resolveSectionElement(container, targetId);
    }
    if (!element) return false;

    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element.classList.add('flash-highlight');
    setTimeout(() => element.classList.remove('flash-highlight'), 2000);
    const nextAnchor = element.id || targetId;
    manualNavigationLockRef.current = {
        anchorId: nextAnchor,
        expiresAt: Date.now() + MANUAL_NAVIGATION_HIGHLIGHT_LOCK_MS,
    };
    setActiveAnchorId((prev) => (prev === nextAnchor ? prev : nextAnchor));
    return true;
}

type ResolveAutoScrollTargetReadinessArgs = {
    container: HTMLElement;
    renderableCodeResults: ResultRecord | null;
    ensureSectionAnchors: (resultados: ResultRecord, container: HTMLElement) => void;
    getPosicaoAlvoFromResultados: (resultados: ResultRecord) => string | null;
    dataNcm?: string;
    dataQuery?: string;
    targetCandidates: string[];
};

export function resolveAutoScrollTargetReadiness({
    container,
    renderableCodeResults,
    ensureSectionAnchors,
    getPosicaoAlvoFromResultados,
    dataNcm,
    dataQuery,
    targetCandidates,
}: ResolveAutoScrollTargetReadinessArgs): boolean {
    if (renderableCodeResults) {
        ensureSectionAnchors(renderableCodeResults, container);
    }

    if (findExistingTargetElement(container, targetCandidates)) {
        return true;
    }

    const posicaoAlvo = renderableCodeResults ? getPosicaoAlvoFromResultados(renderableCodeResults) : null;
    const candidateNcm = posicaoAlvo || dataNcm || dataQuery || '';
    if (!candidateNcm.trim()) {
        return false;
    }

    const fallback = ensureTargetAnchorFromDataNcm(container, candidateNcm);
    if (!fallback) {
        return false;
    }

    return !!findExistingTargetElement(container, targetCandidates);
}

export { resolveSectionElement };
