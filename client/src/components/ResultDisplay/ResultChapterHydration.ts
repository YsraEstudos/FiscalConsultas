import { getNeshChapterBody } from '../../services/api';
import type { ChapterBodyResponse } from '../../types/api.types';

import type { ChapterHydrationResult, ResultRecord } from './types';

function hasRenderableValue(value: unknown): boolean {
    if (typeof value === 'string') {
        return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
        return value.some(hasRenderableValue);
    }
    if (value && typeof value === 'object') {
        return Object.values(value).some(hasRenderableValue);
    }
    return false;
}

export function chapterHasRenderableContent(chapter: any): boolean {
    return hasRenderableValue(chapter?.conteudo)
        || hasRenderableValue(chapter?.secoes)
        || hasRenderableValue(chapter?.notas_gerais)
        || hasRenderableValue(chapter?.notas_parseadas);
}

export function getAnchorCodeFromNcmValue(value: string): string {
    if (value.includes('.') || value.length !== 4) {
        return value;
    }
    return `${value.slice(0, 2)}.${value.slice(2, 4)}`;
}

function resolveChapterResultKey(results: ResultRecord, chapterNumber: string): string {
    return Object.keys(results).find((key) => {
        const existingChapter = results[key];
        return existingChapter?.capitulo === chapterNumber;
    }) ?? chapterNumber;
}

export function mergeHydratedChapterBodies(
    baseResults: ResultRecord,
    chapterBodies: ChapterBodyResponse[],
): ResultRecord {
    const nextResults = { ...baseResults };

    for (const chapterBody of chapterBodies) {
        const chapterKey = resolveChapterResultKey(nextResults, chapterBody.capitulo);
        const existingChapter = nextResults[chapterKey];
        if (!existingChapter || typeof existingChapter !== 'object') {
            continue;
        }

        nextResults[chapterKey] = {
            ...existingChapter,
            conteudo: chapterBody.conteudo,
            notas_parseadas: chapterBody.notas_parseadas ?? existingChapter.notas_parseadas ?? {},
            notas_gerais: chapterBody.notas_gerais ?? existingChapter.notas_gerais ?? null,
            secoes: chapterBody.secoes ?? existingChapter.secoes,
        };
    }

    return nextResults;
}

export function createFailedChapterBodiesUpdater(failedChapters: string[]) {
    return (current: string[]) => Array.from(new Set([...current, ...failedChapters]));
}

export function createRecoveredChapterBodiesUpdater(chapterBodies: ChapterBodyResponse[]) {
    const recoveredChapters = new Set(chapterBodies.map((body) => body.capitulo));
    return (current: string[]) => current.filter((chapter) => !recoveredChapters.has(chapter));
}

export async function fetchChapterBodies(chapters: string[]): Promise<ChapterHydrationResult> {
    const settledBodies = await Promise.allSettled(
        chapters.map((chapter) => getNeshChapterBody(chapter)),
    );
    const fulfilledBodies: ChapterBodyResponse[] = [];
    const failedChapters: string[] = [];

    settledBodies.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            fulfilledBodies.push(result.value);
            return;
        }

        failedChapters.push(chapters[index]);
        console.error('[ResultDisplay] Failed to fetch chapter body', {
            chapter: chapters[index],
            error: result.reason,
        });
    });

    return {
        chapterBodies: fulfilledBodies,
        failedChapters,
    };
}
