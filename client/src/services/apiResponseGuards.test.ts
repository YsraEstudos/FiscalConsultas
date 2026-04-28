import { describe, expect, it } from 'vitest';

import {
    isApiError,
    isApiErrorResponse,
    isCodeSearchApiResponse,
    isNbsCatalogSearchApiResponse,
    isNbsSearchResponse,
    isTextSearchApiResponse,
} from './apiResponseGuards';

describe('apiResponseGuards', () => {
    it('detects canonical text-search responses', () => {
        expect(isTextSearchApiResponse({
            success: true,
            type: 'text',
            query: 'banana',
            normalized: 'banana',
            match_type: 'all_words',
            warning: null,
            total_capitulos: 1,
            results: [],
        })).toBe(true);

        expect(isTextSearchApiResponse({
            success: true,
            type: 'code',
            results: {},
        })).toBe(false);
    });

    it('detects canonical code-search responses', () => {
        expect(isCodeSearchApiResponse({
            success: true,
            type: 'code',
            query: '0101',
            normalized: null,
            results: {},
            total_capitulos: 0,
        })).toBe(true);

        expect(isCodeSearchApiResponse({
            success: true,
            type: 'text',
            results: [],
        })).toBe(false);
    });

    it('detects NBS catalog search payloads', () => {
        const nbsPayload = {
            success: true,
            query: 'apoio',
            normalized: 'apoio',
            results: [{
                code: '1.0101.00.00',
                code_clean: '101010000',
                description: 'Servico',
                parent_code: null,
                level: 1,
            }],
            total: 1,
        };

        expect(isNbsCatalogSearchApiResponse(nbsPayload)).toBe(true);
        expect(isNbsSearchResponse(nbsPayload)).toBe(true);
    });

    it('detects API error envelopes and keeps deprecated alias working', () => {
        const apiErrorPayload = {
            success: false,
            error: {
                code: 'invalid_request',
                message: 'Bad request',
            },
        };

        expect(isApiErrorResponse(apiErrorPayload)).toBe(true);
        expect(isApiError(apiErrorPayload)).toBe(true);
        expect(isApiErrorResponse({ success: true })).toBe(false);
    });
});
