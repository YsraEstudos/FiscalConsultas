import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    instance.request.mockReset();
    instance.interceptors.request.use.mockClear();
    instance.interceptors.response.use.mockClear();
  };

  return { handlers, instance, create, reset };
});

vi.mock('axios', () => ({
  default: {
    create: mockAxios.create,
  },
}));

async function loadApiModule() {
  vi.resetModules();
  mockAxios.reset();
  localStorage.clear();
  return import('../../src/services/api');
}

describe('api service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates axios instance and registers interceptors on import', async () => {
    await loadApiModule();

    expect(mockAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: expect.stringMatching(/\/api$/),
        timeout: 60000,
        withCredentials: true,
      }),
    );
    expect(mockAxios.instance.interceptors.request.use).toHaveBeenCalledTimes(1);
    expect(mockAxios.instance.interceptors.response.use).toHaveBeenCalledTimes(1);
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
    expect(headers.set).not.toHaveBeenCalled();

    apiModule.unregisterClerkTokenGetter();
  });

  it('handles token getter failures and malformed absolute URLs without crashing', async () => {
    const apiModule = await loadApiModule();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getter = vi.fn().mockRejectedValue(new Error('token failed'));
    const headers = { set: vi.fn() };

    apiModule.registerClerkTokenGetter(getter);

    const config = { url: 'http://[::1', headers };
    const out = await mockAxios.handlers.requestFulfilled?.(config);

    expect(out).toBe(config);
    expect(warnSpy).toHaveBeenCalled();
    expect(headers.set).not.toHaveBeenCalled();
    apiModule.unregisterClerkTokenGetter();
  });

  it('propagates request and response interceptor errors and logs 401', async () => {
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

  it('cleans invalid localStorage index and handles stale cache entries', async () => {
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
    const index = JSON.parse(localStorage.getItem('nesh_cache_index_v1') || '{}');
    expect(index.ghost).toBeUndefined();
  });

  it('uses valid localStorage cache without network call and normalizes aliases', async () => {
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

    const cached = await apiModule.searchNCM('8517');

    expect(mockAxios.instance.get).not.toHaveBeenCalled();
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
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(1, '/tipi/search?ncm=8517&view_mode=family');
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(2, '/tipi/search?ncm=8517&view_mode=chapter');
  });

  it('delegates glossary/status/auth/chapter-notes endpoints', async () => {
    const apiModule = await loadApiModule();
    mockAxios.instance.get
      .mockResolvedValueOnce({ data: { term: 'x' } })
      .mockResolvedValueOnce({ data: { status: 'online' } })
      .mockResolvedValueOnce({ data: { authenticated: true } })
      .mockResolvedValueOnce({
        data: { success: true, capitulo: '85', notas_parseadas: { '1': 'n' }, notas_gerais: 'g' },
      });

    await expect(apiModule.getGlossaryTerm('aço inox')).resolves.toEqual({ term: 'x' });
    await expect(apiModule.getSystemStatus()).resolves.toEqual({ status: 'online' });
    await expect(apiModule.getAuthSession()).resolves.toEqual({ authenticated: true });
    await expect(apiModule.fetchChapterNotes('85')).resolves.toEqual({
      success: true,
      capitulo: '85',
      notas_parseadas: { '1': 'n' },
      notas_gerais: 'g',
    });

    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(1, '/glossary?term=a%C3%A7o%20inox');
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(2, '/status');
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(3, '/auth/me');
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(4, '/nesh/chapter/85/notes');
  });
});
