import { describe, expect, it } from 'vitest';

import { isApiError, isCodeSearchResponse, isTextSearchResponse } from '../../src/types/api.types';

describe('api type guards', () => {
  it('detects text responses', () => {
    expect(
      isTextSearchResponse({
        success: true,
        type: 'text',
        query: 'motor',
        normalized: 'motor',
        match_type: 'exact',
        warning: null,
        results: [],
        total_capitulos: 0,
      } as any),
    ).toBe(true);

    expect(
      isTextSearchResponse({
        success: true,
        type: 'code',
      } as any),
    ).toBe(false);
  });

  it('detects code responses', () => {
    expect(
      isCodeSearchResponse({
        success: true,
        type: 'code',
        query: '8517',
        normalized: null,
        results: {},
        total_capitulos: 0,
      } as any),
    ).toBe(true);

    expect(
      isCodeSearchResponse({
        success: true,
        type: 'text',
      } as any),
    ).toBe(false);
  });

  it('validates api error payload shape', () => {
    expect(isApiError(null)).toBe(false);
    expect(isApiError('erro')).toBe(false);
    expect(isApiError(123)).toBe(false);
    expect(isApiError({ success: false, error: null })).toBe(false);
    expect(
      isApiError({
        success: false,
        error: {
          code: 'bad_request',
          message: 'Erro de validação',
          details: { field: 'query' },
        },
      }),
    ).toBe(true);
  });
});
