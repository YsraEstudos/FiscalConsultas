import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetErrorMonitoringForTests,
  CLIENT_ERROR_EVENT_NAME,
  type ClientErrorReport,
} from '../../src/utils/errorMonitoring';

type InterceptorHandler = ((value: any) => any) | undefined;

const mockAxios = vi.hoisted(() => {
  const handlers: {
    requestFulfilled: InterceptorHandler;
    requestRejected: InterceptorHandler;
    responseFulfilled: InterceptorHandler;
    responseRejected: InterceptorHandler;
  } = {
    requestFulfilled: undefined,
    requestRejected: undefined,
    responseFulfilled: undefined,
    responseRejected: undefined,
  };

  const instance = {
    interceptors: {
      request: {
        use: vi.fn((fulfilled, rejected) => {
          handlers.requestFulfilled = fulfilled;
          handlers.requestRejected = rejected;
          return 0;
        }),
      },
      response: {
        use: vi.fn((fulfilled, rejected) => {
          handlers.responseFulfilled = fulfilled;
          handlers.responseRejected = rejected;
          return 0;
        }),
      },
    },
    get: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  };

  const create = vi.fn(() => instance);

  const reset = () => {
    handlers.requestFulfilled = undefined;
    handlers.requestRejected = undefined;
    handlers.responseFulfilled = undefined;
    handlers.responseRejected = undefined;
    create.mockClear();
    instance.get.mockReset();
    instance.patch.mockReset();
    instance.delete.mockReset();
    instance.request.mockReset();
    instance.interceptors.request.use.mockClear();
    instance.interceptors.response.use.mockClear();
  };

  return { handlers, instance, create, reset };
});

vi.mock('axios', () => ({
  default: {
    create: mockAxios.create,
    isAxiosError: vi.fn(
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            ('config' in error ||
              'response' in error ||
              'code' in error ||
              'isAxiosError' in error),
        ),
    ),
    isCancel: vi.fn(
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            ((error as { code?: unknown }).code === 'ERR_CANCELED' ||
              (error as { name?: unknown }).name === 'CanceledError'),
        ),
    ),
  },
}));

async function loadApiModule() {
  vi.resetModules();
  mockAxios.reset();
  localStorage.clear();
  return import('../../src/services/api');
}

function escapeForRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectDevCacheBustedPath(path: string) {
  return expect.stringMatching(
    new RegExp(`^${escapeForRegex(path)}(?:[?&]_dev_bust=\\d+)?$`),
  );
}

function swapLocation(url: string) {
  const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL(url),
  });

  return () => {
    if (originalLocationDescriptor) {
      Object.defineProperty(globalThis, 'location', originalLocationDescriptor);
    }
  };
}

describe('api service', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    __resetErrorMonitoringForTests();
  });

  afterEach(() => {
    __resetErrorMonitoringForTests();
  });

  it('creates axios instance and registers interceptors on import', async () => {
    await loadApiModule();

    expect(mockAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: expect.stringMatching(/\/api$/),
        timeout: 60000,
        withCredentials: false,
      }),
    );
    expect(mockAxios.instance.interceptors.request.use).toHaveBeenCalledTimes(1);
    expect(mockAxios.instance.interceptors.response.use).toHaveBeenCalledTimes(1);
  });

  it('prefers the Vite /api proxy for local backends during development', async () => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:8000');
    const restoreLocation = swapLocation('http://127.0.0.1:5173/');

    try {
      await loadApiModule();

      expect(mockAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: '/api',
        }),
      );
    } finally {
      restoreLocation();
    }
  });

  it('injects auth token for protected routes and skips public routes', async () => {
    const apiModule = await loadApiModule();
    const getter = vi.fn().mockResolvedValue('jwt-token');
    const headers = { set: vi.fn() };

    apiModule.registerClerkTokenGetter(getter);

    await mockAxios.handlers.requestFulfilled?.({ url: '/search?ncm=8517', headers });
    expect(getter).toHaveBeenCalledTimes(1);
    expect(headers.set).toHaveBeenCalledWith('Authorization', 'Bearer jwt-token');

    getter.mockClear();
    headers.set.mockClear();

    await mockAxios.handlers.requestFulfilled?.({ url: 'https://example.com/status', headers });
    expect(getter).not.toHaveBeenCalled();
    expect(headers.set).not.toHaveBeenCalledWith('Authorization', 'Bearer jwt-token');

    getter.mockClear();
    headers.set.mockClear();

    await mockAxios.handlers.requestFulfilled?.({ url: '/services/nbs/search?q=construcao', headers });
    expect(getter).not.toHaveBeenCalled();
    expect(headers.set).not.toHaveBeenCalledWith('Authorization', 'Bearer jwt-token');

    apiModule.unregisterClerkTokenGetter();
  });

  it('handles token getter failures and malformed absolute URLs without crashing', async () => {
    vi.stubEnv('VITE_AUTH_DEBUG', 'true');
    const apiModule = await loadApiModule();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getter = vi.fn().mockRejectedValue(new Error('token failed'));
    const headers = { set: vi.fn() };

    apiModule.registerClerkTokenGetter(getter);

    const config = { url: 'http://[::1', headers };
    const out = await mockAxios.handlers.requestFulfilled?.(config);

    expect(out).toBe(config);
    expect(warnSpy).toHaveBeenCalled();
    expect(headers.set).not.toHaveBeenCalledWith('Authorization', expect.any(String));
    apiModule.unregisterClerkTokenGetter();
  });

  it('warns in dev when no auth token is available after the fallback refresh attempt', async () => {
    vi.stubEnv('VITE_AUTH_DEBUG', 'true');
    const apiModule = await loadApiModule();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getter = vi.fn().mockResolvedValue(null);
    const headers = { set: vi.fn() };

    apiModule.registerClerkTokenGetter(getter);

    await mockAxios.handlers.requestFulfilled?.({ url: '/profile/me', headers });

    expect(getter).toHaveBeenCalledTimes(2);
    expect(getter).toHaveBeenNthCalledWith(2, expect.objectContaining({ skipCache: true }));
    expect(headers.set).not.toHaveBeenCalledWith('Authorization', expect.any(String));
    expect(warnSpy).toHaveBeenCalledWith(
      '[API] No Clerk token available for authenticated request:',
      '/profile/me',
      expect.objectContaining({
        requestId: expect.any(String),
      }),
    );

    apiModule.unregisterClerkTokenGetter();
    warnSpy.mockRestore();
  });

  it('propagates request and response interceptor errors and logs 401', async () => {
    vi.stubEnv('VITE_AUTH_DEBUG', 'true');
    await loadApiModule();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reqError = new Error('request-failure');
    const unauthorizedError = { response: { status: 401 } };
    const serverError = { response: { status: 500 } };

    await expect(mockAxios.handlers.requestRejected?.(reqError)).rejects.toBe(reqError);
    await expect(mockAxios.handlers.responseRejected?.(unauthorizedError)).rejects.toBe(unauthorizedError);
    await expect(mockAxios.handlers.responseRejected?.(serverError)).rejects.toBe(serverError);

    expect(warnSpy).toHaveBeenCalledWith(
      '[API] 401 Unauthorized - Token missing, expired, or invalid',
      expect.objectContaining({
        path: undefined,
        detail: undefined,
      }),
    );
  });

  it('deduplicates forced token refresh across concurrent 401 retries', async () => {
    const apiModule = await loadApiModule();
    const getter = vi.fn().mockResolvedValue('fresh-token');
    const headers1 = { set: vi.fn() };
    const headers2 = { set: vi.fn() };
    const req1 = { url: '/comments/anchors', headers: headers1 } as any;
    const req2 = { url: '/comments/', headers: headers2 } as any;
    const err1 = { response: { status: 401, data: { detail: 'Token inválido ou expirado' } }, config: req1 } as any;
    const err2 = { response: { status: 401, data: { detail: 'Token inválido ou expirado' } }, config: req2 } as any;

    apiModule.registerClerkTokenGetter(getter);
    mockAxios.instance.request.mockResolvedValue({ ok: true });

    const [out1, out2] = await Promise.all([
      mockAxios.handlers.responseRejected?.(err1),
      mockAxios.handlers.responseRejected?.(err2),
    ]);

    expect(out1).toEqual({ ok: true });
    expect(out2).toEqual({ ok: true });
    expect(getter).toHaveBeenCalledTimes(1);
    expect(getter).toHaveBeenCalledWith(expect.objectContaining({ skipCache: true }));
    expect(headers1.set).toHaveBeenCalledWith('Authorization', 'Bearer fresh-token');
    expect(headers2.set).toHaveBeenCalledWith('Authorization', 'Bearer fresh-token');
    expect(mockAxios.instance.request).toHaveBeenCalledTimes(2);
  });

  it('applies cooldown to forced refresh to avoid token storm', async () => {
    vi.stubEnv('VITE_AUTH_DEBUG', 'true');
    const apiModule = await loadApiModule();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getter = vi.fn().mockResolvedValue('fresh-token');
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000).mockReturnValue(2000);

    apiModule.registerClerkTokenGetter(getter);
    mockAxios.instance.request.mockResolvedValue({ ok: true });

    const firstHeaders = { set: vi.fn() };
    const secondHeaders = { set: vi.fn() };
    const firstErr = {
      response: { status: 401, data: { detail: 'Token inválido ou expirado' } },
      config: { url: '/comments/anchors', headers: firstHeaders },
    } as any;
    const secondErr = {
      response: { status: 401, data: { detail: 'Token inválido ou expirado' } },
      config: { url: '/comments/', headers: secondHeaders },
    } as any;

    await expect(mockAxios.handlers.responseRejected?.(firstErr)).resolves.toEqual({ ok: true });
    await expect(mockAxios.handlers.responseRejected?.(secondErr)).rejects.toBe(secondErr);

    expect(getter).toHaveBeenCalledTimes(1);
    expect(mockAxios.instance.request).toHaveBeenCalledTimes(1);
    expect(secondHeaders.set).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[API] 401 Unauthorized - Token missing, expired, or invalid',
      expect.objectContaining({
        path: '/comments/',
        detail: 'Token inválido ou expirado',
        refreshAttempt: 'attempted',
        refreshMode: 'cooldown',
      }),
    );

    nowSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('skips refresh for 401 with missing-token detail', async () => {
    vi.stubEnv('VITE_AUTH_DEBUG', 'true');
    const apiModule = await loadApiModule();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getter = vi.fn().mockResolvedValue('fresh-token');
    const err = {
      response: { status: 401, data: { detail: 'Token ausente' } },
      config: { url: '/comments/anchors', headers: { set: vi.fn() } },
    } as any;

    apiModule.registerClerkTokenGetter(getter);
    await expect(mockAxios.handlers.responseRejected?.(err)).rejects.toBe(err);

    expect(getter).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[API] 401 Unauthorized - Token missing, expired, or invalid',
      expect.objectContaining({
        path: '/comments/anchors',
        detail: 'Token ausente',
        refreshAttempt: 'skipped',
        refreshMode: 'not_applicable',
      }),
    );
    warnSpy.mockRestore();
  });

  it('logs refresh failures and still rejects the original 401 response', async () => {
    vi.stubEnv('VITE_AUTH_DEBUG', 'true');
    const apiModule = await loadApiModule();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getter = vi.fn().mockRejectedValue(new Error('refresh exploded'));
    const err = {
      response: { status: 401, data: { detail: 'Token inválido ou expirado' } },
      config: { url: '/comments/anchors', headers: { set: vi.fn() } },
    } as any;

    apiModule.registerClerkTokenGetter(getter);

    await expect(mockAxios.handlers.responseRejected?.(err)).rejects.toBe(err);

    expect(warnSpy).toHaveBeenCalledWith(
      '[API] Failed to refresh token after 401:',
      expect.any(Error),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[API] 401 Unauthorized - Token missing, expired, or invalid',
      expect.objectContaining({
        path: '/comments/anchors',
        detail: 'Token inválido ou expirado',
        refreshAttempt: 'attempted',
        refreshMode: 'fresh',
      }),
    );

    warnSpy.mockRestore();
  });

  it('reports 5xx API failures to the client monitoring channel', async () => {
    await loadApiModule();
    const reportedErrors: ClientErrorReport[] = [];
    const handleClientError = (event: Event) => {
      reportedErrors.push((event as CustomEvent<ClientErrorReport>).detail);
    };
    globalThis.addEventListener(CLIENT_ERROR_EVENT_NAME, handleClientError as EventListener);

    try {
      const serverError = {
        code: 'ERR_BAD_RESPONSE',
        message: 'Request failed with status code 503',
        response: { status: 503 },
        config: {
          url: '/profile/me',
          method: 'get',
          timeout: 60000,
          headers: {
            get: (name: string) => (name.toLowerCase() === 'x-request-id' ? 'req_test_123' : undefined),
          },
        },
      } as any;

      await expect(mockAxios.handlers.responseRejected?.(serverError)).rejects.toBe(serverError);

      expect(reportedErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'network',
            handled: true,
            path: '/profile/me',
            requestId: 'req_test_123',
            statusCode: 503,
            message: 'API request failed with status 503',
          }),
        ]),
      );
    } finally {
      globalThis.removeEventListener(CLIENT_ERROR_EVENT_NAME, handleClientError as EventListener);
    }
  });

  it('reports network failures without a response to the client monitoring channel', async () => {
    await loadApiModule();
    const reportedErrors: ClientErrorReport[] = [];
    const handleClientError = (event: Event) => {
      reportedErrors.push((event as CustomEvent<ClientErrorReport>).detail);
    };
    globalThis.addEventListener(CLIENT_ERROR_EVENT_NAME, handleClientError as EventListener);

    try {
      const networkError = {
        message: 'Network Error',
        code: 'ERR_NETWORK',
        config: {
          url: '/profile/me',
          method: 'get',
          timeout: 60000,
          headers: {
            get: () => undefined,
          },
        },
      } as any;

      await expect(mockAxios.handlers.responseRejected?.(networkError)).rejects.toBe(networkError);

      expect(reportedErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'network',
            handled: true,
            path: '/profile/me',
            requestId: undefined,
            statusCode: undefined,
            message: 'API request failed before receiving a response',
          }),
        ]),
      );
    } finally {
      globalThis.removeEventListener(CLIENT_ERROR_EVENT_NAME, handleClientError as EventListener);
    }
  });

  it('does not report canceled API failures to the client monitoring channel', async () => {
    await loadApiModule();
    const reportedErrors: ClientErrorReport[] = [];
    const handleClientError = (event: Event) => {
      reportedErrors.push((event as CustomEvent<ClientErrorReport>).detail);
    };
    globalThis.addEventListener(CLIENT_ERROR_EVENT_NAME, handleClientError as EventListener);

    try {
      const canceledError = {
        message: 'Request canceled',
        code: 'ERR_CANCELED',
        name: 'CanceledError',
        config: {
          url: '/profile/me',
          method: 'get',
          timeout: 60000,
          headers: {
            get: () => undefined,
          },
        },
      } as any;

      await expect(mockAxios.handlers.responseRejected?.(canceledError)).rejects.toBe(canceledError);
      expect(reportedErrors).toEqual([]);
    } finally {
      globalThis.removeEventListener(CLIENT_ERROR_EVENT_NAME, handleClientError as EventListener);
    }
  });

  it('deduplicates in-flight searchNCM requests and caches successful code responses', async () => {
    const apiModule = await loadApiModule();
    let resolveGet: ((value: any) => void) | undefined;
    const getPromise = new Promise((resolve) => {
      resolveGet = resolve;
    });
    mockAxios.instance.get.mockReturnValueOnce(getPromise);

    const p1 = apiModule.searchNCM('8517');
    const p2 = apiModule.searchNCM('8517');

    expect(mockAxios.instance.get).toHaveBeenCalledTimes(1);
    resolveGet?.({
      data: { success: true, type: 'code', results: { '85': { capitulo: '85' } } },
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(r1.resultados).toEqual(r1.results);
    expect(Object.keys(r1)).not.toContain('resultados');

    mockAxios.instance.get.mockClear();
    const cached = await apiModule.searchNCM('8517');
    expect(cached.results).toEqual(r1.results);
    expect(mockAxios.instance.get).not.toHaveBeenCalled();
  });

  it('does not cache text search responses for NCM', async () => {
    const apiModule = await loadApiModule();
    mockAxios.instance.get
      .mockResolvedValueOnce({ data: { success: true, type: 'text', results: [] } })
      .mockResolvedValueOnce({ data: { success: true, type: 'text', results: [] } });

    await apiModule.searchNCM('motor');
    await apiModule.searchNCM('motor');

    expect(mockAxios.instance.get).toHaveBeenCalledTimes(2);
  });

  it('ignores stale legacy persistent code cache entries and fetches fresh data', async () => {
    const apiModule = await loadApiModule();
    const staleTimestamp = Date.now() - (2 * 60 * 60 * 1000);
    localStorage.setItem('nesh_cache_index_v1', JSON.stringify({ ghost: staleTimestamp, 'nesh:9999': staleTimestamp }));
    localStorage.setItem(
      'nesh_cache_nesh:9999',
      JSON.stringify({
        timestamp: staleTimestamp,
        data: { success: true, type: 'code', results: { '99': {} } },
      }),
    );

    mockAxios.instance.get.mockResolvedValueOnce({
      data: { success: true, type: 'code', results: { '99': { capitulo: '99' } } },
    });
    const result = await apiModule.searchNCM('9999');

    expect(result.results['99']).toBeTruthy();
    expect(mockAxios.instance.get).toHaveBeenCalledTimes(1);
  });

  it('ignores legacy localStorage code cache for NCM queries and normalizes fresh responses', async () => {
    const apiModule = await loadApiModule();
    const now = Date.now();
    localStorage.setItem('nesh_cache_index_v1', JSON.stringify({ 'nesh:8517': now - 100 }));
    localStorage.setItem(
      'nesh_cache_nesh:8517',
      JSON.stringify({
        timestamp: now,
        data: { success: true, type: 'code', results: { '85': { capitulo: '85' } } },
      }),
    );

    mockAxios.instance.get.mockResolvedValueOnce({
      data: { success: true, type: 'code', results: { '85': { capitulo: '85' } } },
    });

    const cached = await apiModule.searchNCM('8517');

    expect(mockAxios.instance.get).toHaveBeenCalledTimes(1);
    expect(cached.resultados).toEqual(cached.results);
  });

  it('handles corrupted cache index payload gracefully', async () => {
    const apiModule = await loadApiModule();
    localStorage.setItem('nesh_cache_index_v1', '{invalid');

    mockAxios.instance.get.mockResolvedValueOnce({
      data: { success: true, type: 'code', results: { '85': {} } },
    });

    await expect(apiModule.searchNCM('85')).resolves.toBeTruthy();
    expect(mockAxios.instance.get).toHaveBeenCalledTimes(1);
  });

  it('clears in-flight map after failed request allowing retry', async () => {
    const apiModule = await loadApiModule();
    mockAxios.instance.get
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { success: true, type: 'code', results: { '85': {} } } });

    await expect(apiModule.searchNCM('85')).rejects.toThrow('network down');
    await expect(apiModule.searchNCM('85')).resolves.toBeTruthy();

    expect(mockAxios.instance.get).toHaveBeenCalledTimes(2);
  });

  it('caches TIPI code responses by query and view mode', async () => {
    const apiModule = await loadApiModule();
    mockAxios.instance.get
      .mockResolvedValueOnce({ data: { success: true, type: 'code', results: { '85': { posicoes: [] } } } })
      .mockResolvedValueOnce({ data: { success: true, type: 'code', results: { '85': { posicoes: [] } } } });

    await apiModule.searchTipi('8517', 'family');
    await apiModule.searchTipi('8517', 'family');
    await apiModule.searchTipi('8517', 'chapter');

    expect(mockAxios.instance.get).toHaveBeenCalledTimes(2);
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(1, expectDevCacheBustedPath('/tipi/search?ncm=8517&view_mode=family'));
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(2, expectDevCacheBustedPath('/tipi/search?ncm=8517&view_mode=chapter'));
  });

  it('delegates glossary/status/auth/chapter-notes endpoints', async () => {
    const apiModule = await loadApiModule();
    mockAxios.instance.get
      .mockResolvedValueOnce({ data: { term: 'x' } })
      .mockResolvedValueOnce({ data: { status: 'online' } })
      .mockResolvedValueOnce({
        data: {
          authenticated: true,
          can_use_ai_chat: true,
          can_use_restricted_ui: false,
        },
      })
      .mockResolvedValueOnce({
        data: { success: true, capitulo: '85', notas_parseadas: { '1': 'n' }, notas_gerais: 'g' },
      });

    await expect(apiModule.getGlossaryTerm('aço inox')).resolves.toEqual({ term: 'x' });
    await expect(apiModule.getSystemStatus()).resolves.toEqual({ status: 'online' });
    await expect(apiModule.getAuthSession()).resolves.toEqual({
      authenticated: true,
      can_use_ai_chat: true,
      can_use_restricted_ui: false,
    });
    await expect(apiModule.fetchChapterNotes('85')).resolves.toEqual({
      success: true,
      capitulo: '85',
      notas_parseadas: { '1': 'n' },
      notas_gerais: 'g',
    });

    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(1, expectDevCacheBustedPath('/glossary?term=a%C3%A7o%20inox'));
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(2, expectDevCacheBustedPath('/status'), { timeout: 4000 });
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(3, expectDevCacheBustedPath('/auth/me'), { timeout: 8000 });
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(4, expectDevCacheBustedPath('/nesh/chapter/85/notes'));
  });

  it('delegates the profile endpoints', async () => {
    const apiModule = await loadApiModule();
    mockAxios.instance.get
      .mockResolvedValueOnce({ data: { id: 'me' } })
      .mockResolvedValueOnce({ data: { items: [], total: 0 } })
      .mockResolvedValueOnce({ data: { id: 'user-card' } });
    mockAxios.instance.patch.mockResolvedValueOnce({ data: { bio: 'Atualizada' } });
    mockAxios.instance.delete.mockResolvedValueOnce({ data: { success: true } });

    await expect(apiModule.getMyProfile()).resolves.toEqual({ id: 'me' });
    await expect(apiModule.updateMyProfile({ bio: 'Atualizada' })).resolves.toEqual({ bio: 'Atualizada' });
    await expect(apiModule.getMyContributions({ page: 2, page_size: 5, search: 'ncm' })).resolves.toEqual({ items: [], total: 0 });
    await expect(apiModule.getUserCard('user/42')).resolves.toEqual({ id: 'user-card' });
    await expect(apiModule.deleteMyAccount()).resolves.toEqual({ success: true });

    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(1, expectDevCacheBustedPath('/profile/me'));
    expect(mockAxios.instance.patch).toHaveBeenCalledWith('/profile/me', { bio: 'Atualizada' });
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(2, '/profile/me/contributions', {
      params: expect.objectContaining({ page: 2, page_size: 5, search: 'ncm' }),
    });
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(3, expectDevCacheBustedPath('/profile/user%2F42/card'));
    expect(mockAxios.instance.delete).toHaveBeenCalledWith('/profile/me');
  });
});
