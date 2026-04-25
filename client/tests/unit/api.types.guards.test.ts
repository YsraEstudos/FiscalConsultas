import { describe, expect, it } from 'vitest';

import {
  isApiErrorResponse,
  isCodeSearchApiResponse,
  isNbsCatalogSearchApiResponse,
  isNebsExplanatorySearchApiResponse,
  isTextSearchApiResponse,
} from '../../src/services/apiResponseGuards';

describe('api type guards', () => {
  it('detects text responses', () => {
    expect(
      isTextSearchApiResponse({
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
      isTextSearchApiResponse({
        success: true,
        type: 'code',
      } as any),
    ).toBe(false);
  });

  it('detects code responses', () => {
    expect(
      isCodeSearchApiResponse({
        success: true,
        type: 'code',
        query: '8517',
        normalized: null,
        results: {},
        total_capitulos: 0,
      } as any),
    ).toBe(true);

    expect(
      isCodeSearchApiResponse({
        success: true,
        type: 'text',
      } as any),
    ).toBe(false);
  });

  it('validates api error payload shape', () => {
    expect(isApiErrorResponse(null)).toBe(false);
    expect(isApiErrorResponse('erro')).toBe(false);
    expect(isApiErrorResponse(123)).toBe(false);
    expect(isApiErrorResponse({ success: false, error: null })).toBe(false);
    expect(
      isApiErrorResponse({
        success: false,
        error: {
          code: 'bad_request',
          message: 'Erro de validação',
          details: { field: 'query' },
        },
      }),
    ).toBe(true);
  });

  it('detects NBS and NEBS service payloads with explicit guards', () => {
    expect(
      isNbsCatalogSearchApiResponse({
        success: true,
        query: '1.0101',
        normalized: '1.0101',
        total: 1,
        results: [{ code: '1.0101.11.00', code_clean: '101011100', description: 'Servico', parent_code: null, level: 1, has_nebs: true }],
      }),
    ).toBe(true);

    expect(
      isNebsExplanatorySearchApiResponse({
        success: true,
        query: 'nota',
        normalized: 'nota',
        total: 1,
        results: [{ code: '1.0101.11.00', title: 'Entrada', excerpt: 'Trecho', page_start: 1, page_end: 2, section_title: null }],
      }),
    ).toBe(true);
  });
});
