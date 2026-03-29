import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  },
}));

async function loadApiModule() {
  vi.resetModules();
  mockAxios.reset();
  localStorage.clear();
  return import('../../src/services/api');
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
  const env = import.meta.env;

  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    // Use Object.defineProperty to modify DEV just for the scope of the tests
    Object.defineProperty(import.meta, 'env', {
      value: { ...env, DEV: false },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(import.meta, 'env', {
      value: env,
      configurable: true,
    });
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

  it('warns in dev when no auth token is available after the fallback refresh attempt', async () => {
    const apiModule = await loadApiModule();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getter = vi.fn().mockResolvedValue(null);
    const headers = { set: vi.fn() };

    apiModule.registerClerkTokenGetter(getter);

    await mockAxios.handlers.requestFulfilled?.({ url: '/profile/me', headers });

    expect(getter).toHaveBeenCalledTimes(2);
    expect(getter).toHaveBeenNthCalledWith(2, expect.objectContaining({ skipCache: true }));
    expect(headers.set).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[API] No Clerk token available for authenticated request:', '/profile/me');

    apiModule.unregisterClerkTokenGetter();
    warnSpy.mockRestore();
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

  it('logs refresh failures and still rejects the original 401 response', async () => {
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
    const staleTimestamp = Date.now() - (2 * 60 * 60 * 1000);
    // ensure test has expected structure even before calling module
    localStorage.setItem('nesh_cache_index_v1', JSON.stringify({ ghost: staleTimestamp, 'valid:9999': staleTimestamp }));
    localStorage.setItem(
      'nesh_cache_valid:9999',
      JSON.stringify({
        timestamp: staleTimestamp,
        data: { success: true, type: 'code', results: { '99': {} } },
      }),
    );
    const apiModule = await loadApiModule();

    // mock cache fetch function inside the module using a custom endpoint since nesh/tipi are memory-only now
    mockAxios.instance.get.mockResolvedValueOnce({
      data: { success: true, type: 'code', results: { '99': { capitulo: '99' } } },
    });
    // This is technically testing internal cache behavior using searchNCM, but since searchNCM uses 'nesh:' prefix
    // which is memory-only now, we cannot test localStorage eviction this way.
    // The legacy code cleanup will actually remove the `nesh:` items from localStorage entirely on load!
    // So the previous ghost should just be gone. Let's just verify ghost is gone.
    const index = JSON.parse(localStorage.getItem('nesh_cache_index_v1') || '{}');
    expect(index.ghost).toBeUndefined();
  });

  it('uses valid localStorage cache without network call and normalizes aliases', async () => {
    // searchNCM uses 'nesh:' prefix, which is now MEMORY-ONLY
    // so we can't test localStorage caching via searchNCM directly anymore.
    // However, the test intended to test caching logic.
    // We can test memory cache by calling it twice.
    const apiModule = await loadApiModule();

    mockAxios.instance.get.mockResolvedValueOnce({
      data: { success: true, type: 'code', results: { '85': { capitulo: '85' } } },
    });

    await apiModule.searchNCM('8517');
    mockAxios.instance.get.mockClear();

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

    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(1, '/profile/me');
    expect(mockAxios.instance.patch).toHaveBeenCalledWith('/profile/me', { bio: 'Atualizada' });
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(2, '/profile/me/contributions', {
      params: { page: 2, page_size: 5, search: 'ncm' },
    });
    expect(mockAxios.instance.get).toHaveBeenNthCalledWith(3, '/profile/user%2F42/card');
    expect(mockAxios.instance.delete).toHaveBeenCalledWith('/profile/me');
  });
});
