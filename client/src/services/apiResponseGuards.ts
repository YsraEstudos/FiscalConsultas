import type { ApiErrorResponse } from '../types/apiCommon.types';
import type {
    NbsCatalogSearchApiResponse,
    NebsExplanatorySearchApiResponse,
} from '../types/apiServices.types';
import type {
    NeshCodeSearchApiResponse,
    NeshTextSearchApiResponse,
    TipiCodeSearchApiResponse,
    TipiTextSearchApiResponse,
} from '../types/apiSearch.types';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}

export function isTextSearchApiResponse(
    response: unknown,
): response is NeshTextSearchApiResponse | TipiTextSearchApiResponse {
    return isObjectRecord(response) && response.type === 'text';
}

export function isCodeSearchApiResponse(
    response: unknown,
): response is NeshCodeSearchApiResponse | TipiCodeSearchApiResponse {
    return isObjectRecord(response) && response.type === 'code';
}

export function isNbsCatalogSearchApiResponse(
    response: unknown,
): response is NbsCatalogSearchApiResponse {
    if (!isObjectRecord(response) || !Array.isArray(response.results) || typeof response.total !== 'number') {
        return false;
    }

    return (
        response.results.length === 0
        || isObjectRecord(response.results[0]) && 'code_clean' in response.results[0]
    );
}

export function isNebsExplanatorySearchApiResponse(
    response: unknown,
): response is NebsExplanatorySearchApiResponse {
    if (!isObjectRecord(response) || !Array.isArray(response.results) || typeof response.total !== 'number') {
        return false;
    }

    return (
        response.results.length === 0
        || isObjectRecord(response.results[0]) && 'excerpt' in response.results[0]
    );
}

export function isApiErrorResponse(response: unknown): response is ApiErrorResponse {
    if (!isObjectRecord(response)) return false;

    const candidate = response as Partial<ApiErrorResponse>;
    return candidate.success === false && candidate.error != null;
}

/** @deprecated Use `isNbsCatalogSearchApiResponse`. */
export const isNbsSearchResponse = isNbsCatalogSearchApiResponse;

/** @deprecated Use `isNebsExplanatorySearchApiResponse`. */
export const isNebsSearchResponse = isNebsExplanatorySearchApiResponse;

/** @deprecated Use `isApiErrorResponse`. */
export const isApiError = isApiErrorResponse;
