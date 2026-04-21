import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';

import { generateAnchorId } from '../../utils/id_utils';

import {
    chapterHasRenderableContent,
    createFailedChapterBodiesUpdater,
    createRecoveredChapterBodiesUpdater,
    fetchChapterBodies,
    mergeHydratedChapterBodies,
} from './ResultChapterHydration';
import { resolveSectionElement } from './ResultSectionResolver';
import { findAnchorIdInChapter, getStructuredSectionIds, normalizeDigits } from './ResultScrollResolver';
import { isTipiResults } from './ResultTipiFallback';
import type { ChapterHydrationResult, ResultData, ResultRecord } from './types';

type UseResultCodeDataArgs = {
    data: ResultData | null;
    isActive: boolean;
    tabId: string;
    latestTextQuery?: string;
    onHydratedResults?: (tabId: string, results: ResultRecord) => void;
};

type UseResultCodeDataReturn = {
    renderableCodeResults: ResultRecord | null;
    shouldHydrateCodeResults: boolean;
    isHydratingCodeResults: boolean;
    missingChapterBodies: string[];
    searchHighlighterQuery: string | null;
    findAnchorIdForQuery: (resultados: ResultRecord, query: string) => string | null;
    getPosicaoAlvoFromResultados: (resultados: ResultRecord) => string | null;
    getAnchorIdsFromResultados: (resultados: ResultRecord) => string[];
    ensureSectionAnchors: (resultados: ResultRecord, container: HTMLElement) => void;
};

/**
 * Agrupa hidratação de capítulos e resolução dos anchors derivados dos resultados.
 */
export function useResultCodeData({
    data,
    isActive,
    tabId,
    latestTextQuery,
    onHydratedResults,
}: UseResultCodeDataArgs): UseResultCodeDataReturn {
    const [hydratedCodeResults, setHydratedCodeResults] = useState<ResultRecord | null>(null);
    const [isHydratingCodeResults, setIsHydratingCodeResults] = useState(false);
    const [failedChapterBodies, setFailedChapterBodies] = useState<string[]>([]);

    const codeResults = useMemo(() => {
        if (!data || data.type === 'text') return null;
        if (data.resultados && typeof data.resultados === 'object') {
            return data.resultados as ResultRecord;
        }
        if (data.results && !Array.isArray(data.results) && typeof data.results === 'object') {
            return data.results as ResultRecord;
        }
        return null;
    }, [data?.type, data?.resultados, data?.results]);

    useEffect(() => {
        startTransition(() => {
            setHydratedCodeResults(null);
            setIsHydratingCodeResults(false);
            setFailedChapterBodies([]);
        });
    }, [data?.markdown, data?.ncm, data?.query, tabId]);

    const shouldHydrateCodeResults = useMemo(() => {
        return !!codeResults
            && data?.type === 'code'
            && !data?.markdown
            && !isTipiResults(codeResults);
    }, [codeResults, data?.markdown, data?.type]);

    const renderableCodeResults = useMemo(
        () => hydratedCodeResults ?? codeResults,
        [codeResults, hydratedCodeResults],
    );

    const missingChapterBodies = useMemo(() => {
        if (!shouldHydrateCodeResults || !renderableCodeResults) return [] as string[];

        return Object.entries(renderableCodeResults)
            .filter(([, chapter]) => !chapterHasRenderableContent(chapter))
            .map(([chapterKey, chapter]) => {
                const capitulo = (chapter as { capitulo?: unknown })?.capitulo;
                return typeof capitulo === 'string' && capitulo.trim()
                    ? capitulo.trim()
                    : chapterKey;
            })
            .filter((chapter) => !failedChapterBodies.includes(chapter));
    }, [failedChapterBodies, renderableCodeResults, shouldHydrateCodeResults]);

    useEffect(() => {
        if (!isActive || !shouldHydrateCodeResults || !renderableCodeResults || missingChapterBodies.length === 0) {
            return;
        }

        let cancelled = false;
        setIsHydratingCodeResults(true);

        const applyHydrationResult = ({
            chapterBodies,
            failedChapters,
        }: ChapterHydrationResult) => {
            if (cancelled) return;

            if (failedChapters.length > 0) {
                startTransition(() => {
                    setFailedChapterBodies(createFailedChapterBodiesUpdater(failedChapters));
                });
            }

            if (chapterBodies.length === 0) return;

            const mergedResults = mergeHydratedChapterBodies(
                renderableCodeResults,
                chapterBodies,
            );

            startTransition(() => {
                setHydratedCodeResults(mergedResults);
                setFailedChapterBodies(createRecoveredChapterBodiesUpdater(chapterBodies));
                onHydratedResults?.(tabId, mergedResults);
            });
        };

        void fetchChapterBodies(missingChapterBodies)
            .then(applyHydrationResult)
            .catch((error) => {
                console.error('[ResultDisplay] Failed to hydrate chapter bodies', error);
            })
            .finally(() => {
                if (!cancelled) {
                    setIsHydratingCodeResults(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [
        isActive,
        missingChapterBodies,
        onHydratedResults,
        renderableCodeResults,
        shouldHydrateCodeResults,
        tabId,
    ]);

    const findAnchorIdForQuery = useCallback((resultados: ResultRecord, query: string) => {
        if (!resultados || typeof resultados !== 'object') return null;

        const normalizedQuery = normalizeDigits(query);
        if (!normalizedQuery) return null;

        const chapters = Object.values(resultados) as any[];
        let exactMatch: string | null = null;
        let prefixMatch: string | null = null;

        for (const chapter of chapters) {
            const match = findAnchorIdInChapter(chapter, normalizedQuery, prefixMatch);
            if (match.exactMatch) {
                exactMatch = match.exactMatch;
                break;
            }
            prefixMatch = match.prefixMatch;
        }

        return exactMatch || prefixMatch;
    }, []);

    const getPosicaoAlvoFromResultados = useCallback((resultados: ResultRecord) => {
        if (!resultados || typeof resultados !== 'object') return null;
        const chapters = Object.values(resultados) as any[];
        if (chapters.length !== 1) return null;
        const posicaoAlvo = (chapters[0]?.posicao_alvo || chapters[0]?.posicaoAlvo || '').toString().trim();
        return posicaoAlvo || null;
    }, []);

    const getSectionAnchorIdsFromResultados = useCallback((resultados: ResultRecord) => {
        if (!resultados || typeof resultados !== 'object') return [] as string[];

        const ids: string[] = [];
        const chapters = Object.values(resultados) as any[];
        for (const chapter of chapters) {
            const capitulo = (chapter?.capitulo || '').toString().trim();
            if (!capitulo) continue;

            const secoes = chapter?.secoes;
            if (secoes && typeof secoes === 'object') {
                const structuredSectionIds = getStructuredSectionIds(capitulo, secoes as Record<string, unknown>);
                ids.push(...structuredSectionIds);
                if (structuredSectionIds.length > 0) continue;
            }

            if ((chapter?.notas_gerais || '').toString().trim()) {
                ids.push(`chapter-${capitulo}-notas`);
            }
        }

        return ids;
    }, []);

    const getAnchorIdsFromResultados = useCallback((resultados: ResultRecord) => {
        if (!resultados || typeof resultados !== 'object') return [] as string[];

        const ids = getSectionAnchorIdsFromResultados(resultados);
        const chapters = Object.values(resultados) as any[];
        for (const chapter of chapters) {
            const positions = Array.isArray(chapter?.posicoes) ? chapter.posicoes : [];
            for (const pos of positions) {
                const codigo = (pos?.codigo || pos?.ncm || '').toString();
                if (!codigo) continue;
                ids.push(pos?.anchor_id || generateAnchorId(codigo));
            }
        }
        return Array.from(new Set(ids));
    }, [getSectionAnchorIdsFromResultados]);

    const ensureSectionAnchors = useCallback((resultados: ResultRecord, container: HTMLElement) => {
        const sectionIds = getSectionAnchorIdsFromResultados(resultados);
        for (const sectionId of sectionIds) {
            const existing = container.querySelector(`#${CSS.escape(sectionId)}`) as HTMLElement | null;
            if (existing) continue;
            resolveSectionElement(container, sectionId);
        }
    }, [getSectionAnchorIdsFromResultados]);

    const searchHighlighterQuery = useMemo(() => {
        const candidate = (latestTextQuery || '').trim();
        return candidate || null;
    }, [latestTextQuery]);

    return {
        renderableCodeResults,
        shouldHydrateCodeResults,
        isHydratingCodeResults,
        missingChapterBodies,
        searchHighlighterQuery,
        findAnchorIdForQuery,
        getPosicaoAlvoFromResultados,
        getAnchorIdsFromResultados,
        ensureSectionAnchors,
    };
}
