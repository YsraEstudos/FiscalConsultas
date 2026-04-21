import type { TipiSearchApiResponse } from '../../types/api.types';

import {
    getCached,
    normalizeCodeResponseAliases,
    setCache,
    withInFlightDedup,
} from './cache';
import { api, withDevCacheBust } from './httpClient';

export const searchTipi = async (
    query: string,
    viewMode: 'chapter' | 'family' = 'family',
): Promise<TipiSearchApiResponse> => {
    const cacheKey = `tipi:${query}:${viewMode}`;
    const cached = getCached<TipiSearchApiResponse>(cacheKey);
    if (cached) return cached;

    return withInFlightDedup(`tipi:${query}:${viewMode}`, async () => {
        const response = await api.get<TipiSearchApiResponse>(
            withDevCacheBust(`/tipi/search?ncm=${encodeURIComponent(query)}&view_mode=${viewMode}`),
        );
        const data = normalizeCodeResponseAliases(response.data);

        if (data?.type === 'code' && data?.success) {
            setCache(cacheKey, data);
        }
        return data;
    });
};
