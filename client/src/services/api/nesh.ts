import type {
    NeshChapterBodyApiResponse,
    NeshChapterNotesApiResponse,
    NeshSearchApiResponse,
} from '../../types/api.types';

import {
    getCached,
    normalizeCodeResponseAliases,
    setCache,
    withInFlightDedup,
} from './cache';
import { api, withDevCacheBust } from './httpClient';

export const searchNCM = async (query: string): Promise<NeshSearchApiResponse> => {
    const cacheKey = `nesh:v2:${query}:summary`;
    const cached = getCached<NeshSearchApiResponse>(cacheKey);
    if (cached) return cached;

    return withInFlightDedup(`ncm:${query}:summary`, async () => {
        const response = await api.get<NeshSearchApiResponse>(
            withDevCacheBust(`/search?ncm=${encodeURIComponent(query)}&shape=summary`),
        );
        const data = normalizeCodeResponseAliases(response.data);

        if (data?.type === 'code' && data?.success) {
            setCache(cacheKey, data);
        }
        return data;
    });
};

export const searchNCMFull = async (query: string): Promise<NeshSearchApiResponse> => {
    return withInFlightDedup(`ncm:${query}:full`, async () => {
        const response = await api.get<NeshSearchApiResponse>(
            withDevCacheBust(`/search?ncm=${encodeURIComponent(query)}&shape=full`),
        );
        return normalizeCodeResponseAliases(response.data);
    });
};

export const getNeshChapterBody = async (chapter: string): Promise<NeshChapterBodyApiResponse> => {
    const cacheKey = `nesh:chapter-body:${chapter}`;
    const cached = getCached<NeshChapterBodyApiResponse>(cacheKey);
    if (cached) return cached;

    return withInFlightDedup(`nesh:chapter-body:${chapter}`, async () => {
        const response = await api.get<NeshChapterBodyApiResponse>(
            withDevCacheBust(`/search/chapter/${encodeURIComponent(chapter)}/body`),
        );
        setCache(cacheKey, response.data);
        return response.data;
    });
};

export const fetchChapterNotes = async (chapter: string): Promise<NeshChapterNotesApiResponse> => {
    const response = await api.get<NeshChapterNotesApiResponse>(
        withDevCacheBust(`/nesh/chapter/${encodeURIComponent(chapter)}/notes`),
    );
    return response.data;
};
