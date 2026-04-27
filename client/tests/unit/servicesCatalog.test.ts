import { describe, expect, it, vi } from 'vitest';

import {
  buildServiceCatalogSnapshot,
  getServiceCatalogErrorInfo,
  getServiceCatalogErrorMessage,
  getServicesCatalogOfflineMessage,
  isServiceCatalogDoc,
  reportServiceCatalogError,
} from '../../src/utils/servicesCatalog';
import type { SystemStatusResponse } from '../../src/types/api.types';

function makeStatusResponse(
  overrides: Partial<SystemStatusResponse> = {},
): SystemStatusResponse {
  return {
    status: 'online',
    database: { status: 'online' },
    tipi: { status: 'online' },
    nbs: { status: 'online' },
    catalogs: {
      nesh: { status: 'online' },
      tipi: { status: 'online' },
      nbs: { status: 'online' },
    },
    ...overrides,
  };
}

function makeAxiosError({
  status,
  code,
  detail,
  requestId,
  url = '/api/services/status',
  useGetterHeaders = false,
}: {
  status?: number;
  code?: string;
  detail?: string;
  requestId?: string;
  url?: string;
  useGetterHeaders?: boolean;
} = {}) {
  let headers:
    | { get(name: string): string | undefined | null }
    | { 'x-request-id': string }
    | undefined;
  if (useGetterHeaders) {
    headers = {
      get(name: string) {
        return name.toLowerCase() === 'x-request-id' ? requestId : null;
      },
    };
  } else if (requestId) {
    headers = { 'x-request-id': requestId };
  }

  return {
    isAxiosError: true,
    code,
    config: { url },
    response: status
      ? {
          status,
          headers,
          data: detail ? { detail } : undefined,
        }
      : undefined,
  };
}

describe('servicesCatalog utils', () => {
  it('builds offline messages for the NBS catalog and the generic fallback', () => {
    expect(
      getServicesCatalogOfflineMessage(
        makeStatusResponse({
          nbs: { status: 'error' },
        }),
      ),
    ).toBe('Catálogo NBS indisponível no momento.');

    expect(
      getServicesCatalogOfflineMessage(
        makeStatusResponse({
          nbs: { status: 'error' },
        }),
      ),
    ).toBe('Catálogo NBS indisponível no momento.');

    expect(getServicesCatalogOfflineMessage(undefined)).toBe(
      'Catálogo de serviços indisponível no momento.',
    );
  });

  it('builds online, offline, and unknown snapshots with a timestamp', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_234_567);

    try {
      expect(buildServiceCatalogSnapshot(makeStatusResponse())).toEqual({
        availability: 'online',
        checkedAt: 1_234_567,
        message: null,
      });

      expect(
        buildServiceCatalogSnapshot(
          makeStatusResponse({
            nbs: undefined,
            catalogs: {
              nesh: { status: 'online' },
              tipi: { status: 'online' },
              nbs: { status: 'error' },
            },
          }),
        ),
      ).toEqual({
        availability: 'offline',
        checkedAt: 1_234_567,
        message: 'Catálogo NBS indisponível no momento.',
      });

      expect(
        buildServiceCatalogSnapshot(
          makeStatusResponse({
            nbs: undefined,
            catalogs: undefined,
          }),
        ),
      ).toEqual({
        availability: 'unknown',
        checkedAt: 1_234_567,
        message: null,
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('detects valid service catalog documents', () => {
    expect(isServiceCatalogDoc('nbs')).toBe(true);
    expect(isServiceCatalogDoc('nebs')).toBe(false);
    expect(isServiceCatalogDoc('nesh')).toBe(false);
  });

  it('maps axios responses into user-facing catalog errors with support IDs', () => {
    const rateLimited = getServiceCatalogErrorInfo(
      makeAxiosError({
        status: 429,
        detail: 'slow down',
        requestId: 'req-rate-limit',
        useGetterHeaders: true,
      }),
      'nbs',
    );

    expect(rateLimited).toEqual({
      message:
        'Muitas tentativas no catálogo de serviços. Aguarde um instante e tente novamente. Codigo de suporte: req-rate-limit.',
      status: 429,
      requestId: 'req-rate-limit',
      detail: 'slow down',
    });

    const unauthorized = getServiceCatalogErrorInfo(
      makeAxiosError({
        status: 401,
        requestId: 'req-auth',
      }),
      'nbs',
    );

    expect(unauthorized.message).toContain(
      'Catálogo de serviços indisponível no momento. Tente novamente em instantes.',
    );
    expect(unauthorized.requestId).toBe('req-auth');

    const network = getServiceCatalogErrorInfo(
      makeAxiosError({
        code: 'ERR_NETWORK',
      }),
      'nbs',
    );

    expect(network).toEqual({
      message:
        'Catálogo de serviços indisponível no momento. Tente novamente em instantes.',
      status: null,
      requestId: null,
      detail: null,
    });
  });

  it('falls back to the document-specific default message for non-axios errors', () => {
    expect(getServiceCatalogErrorMessage(new Error('boom'), 'nbs')).toBe(
      'Erro ao carregar o catálogo NBS.',
    );
  });

  it('reports dev warnings only when axios errors carry the required context', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      reportServiceCatalogError(
        makeAxiosError({
          status: 403,
          requestId: 'req-forbidden',
          detail: 'blocked',
          url: '/api/services/denied',
        }),
        'nbs',
      );

      reportServiceCatalogError(
        makeAxiosError({
          status: 503,
          requestId: 'req-server-error',
          detail: 'upstream down',
          url: '/api/services/failure',
        }),
        'nbs',
      );

      reportServiceCatalogError(
        makeAxiosError({
          status: 503,
        }),
        'nbs',
      );

      reportServiceCatalogError(new Error('plain error'), 'nbs');

      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenNthCalledWith(
        1,
        '[servicesCatalog] Public catalog route failed',
        expect.objectContaining({
          doc: 'nbs',
          status: 403,
          requestId: 'req-forbidden',
          detail: 'blocked',
          url: '/api/services/denied',
        }),
      );
      expect(warnSpy).toHaveBeenNthCalledWith(
        2,
        '[servicesCatalog] Catalog request failed',
        expect.objectContaining({
          doc: 'nbs',
          status: 503,
          requestId: 'req-server-error',
          detail: 'upstream down',
          url: '/api/services/failure',
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
