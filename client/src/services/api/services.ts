import type {
    NbsCatalogDetailApiResponse,
    NbsCatalogSearchApiResponse,
} from '../../types/api.types';

import { getCached, setCache, withInFlightDedup } from './cache';
import { api, withDevCacheBust } from './httpClient';

type NbsTreePageApiResponse = {
    success: true;
    item: NbsCatalogDetailApiResponse['item'];
    chapter_root?: NbsCatalogDetailApiResponse['chapter_root'];
    chapter_page: NonNullable<NbsCatalogDetailApiResponse['chapter_page']>;
};

export const searchNbsServices = async (query: string): Promise<NbsCatalogSearchApiResponse> => {
    const cacheKey = `nbs:search:${query}`;
    const cached = getCached<NbsCatalogSearchApiResponse>(cacheKey);
    if (cached) return cached;

    return withInFlightDedup(`nbs:search:${query}`, async () => {
        const response = await api.get<NbsCatalogSearchApiResponse>(
            withDevCacheBust(`/services/nbs/search?q=${encodeURIComponent(query)}`),
        );
        const data = response.data;
        if (data?.success) {
            setCache(cacheKey, data);
        }
        return data;
    });
};

export const getNbsServiceDetail = async (code: string): Promise<NbsCatalogDetailApiResponse> => {
    const response = await api.get<NbsCatalogDetailApiResponse>(
        withDevCacheBust(`/services/nbs/${encodeURIComponent(code)}`),
    );
    return response.data;
};

export const getNbsServiceDetailPage = async (
    code: string,
    options: {
        includeTree?: boolean;
        page?: number;
        pageSize?: number;
    } = {},
): Promise<NbsCatalogDetailApiResponse> => {
    const {
        includeTree = true,
        page = 1,
        pageSize = 50,
    } = options;

    const params = new URLSearchParams({
        include_tree: String(includeTree),
        page: String(page),
        page_size: String(pageSize),
    });

    const response = await api.get<NbsCatalogDetailApiResponse>(
        withDevCacheBust(`/services/nbs/${encodeURIComponent(code)}?${params.toString()}`),
    );
    return response.data;
};

export const getNbsServiceTreePage = async (
    code: string,
    page = 1,
    pageSize = 50,
): Promise<NbsTreePageApiResponse> => {
    const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
    });

    const response = await api.get<NbsTreePageApiResponse>(
        withDevCacheBust(`/services/nbs/${encodeURIComponent(code)}/tree?${params.toString()}`),
    );
    return response.data;
};
