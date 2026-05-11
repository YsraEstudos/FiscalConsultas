import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./crypto.js', () => ({
  decryptDatabase: vi.fn(),
  setAppSeed: vi.fn(),
  sha256Hex: vi.fn(),
}));

vi.mock('./catalogSearch.js', () => ({
  getLocalNbsDetail: vi.fn(),
}));

vi.mock('./opfs.js', () => ({
  readFromOpfs: vi.fn(),
  readSeed: vi.fn(),
  readSourceFromOpfs: vi.fn(),
  readSourceVersion: vi.fn(),
  readVersion: vi.fn(),
  removeFromOpfs: vi.fn(),
  removeSourceFromOpfs: vi.fn(),
  saveSeed: vi.fn(),
  saveSourceToOpfs: vi.fn(),
  saveSourceVersion: vi.fn(),
  saveToOpfs: vi.fn(),
  saveVersion: vi.fn(),
}));

vi.mock('./protocol.js', () => ({
  postWorkerError: vi.fn(),
  postWorkerProgress: vi.fn(),
  postWorkerResult: vi.fn(),
  postWorkerStatus: vi.fn(),
}));

vi.mock('./searchRuntime.js', () => ({
  getStructuredSearchWithCache: vi.fn(),
}));

vi.mock('./sqlite.js', () => ({
  loadDatabaseFromBytes: vi.fn(),
}));

vi.mock('./state.js', () => ({
  clearSearchCache: vi.fn(),
  closeWorkerDb: vi.fn(),
  getWorkerDb: vi.fn(),
  getWorkerStatus: vi.fn(),
  getWorkerVersion: vi.fn(),
  setWorkerStatus: vi.fn(),
  setWorkerVersion: vi.fn(),
}));

import {
  buildOfflineDatabaseNetworkErrorMessage,
  dispatchWorkerMessage,
  fetchWithTimeout,
} from './messages.js';
import {
  removeFromOpfs,
  removeSourceFromOpfs,
  saveSeed,
  saveSourceToOpfs,
  saveSourceVersion,
  saveToOpfs,
  saveVersion,
} from './opfs.js';
import { decryptDatabase, setAppSeed, sha256Hex } from './crypto.js';
import { postWorkerError, postWorkerStatus } from './protocol.js';
import { loadDatabaseFromBytes } from './sqlite.js';
import { getWorkerVersion } from './state.js';

describe('dbWorker messages network helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('preserves the caught error as cause when fetch fails', async () => {
    const originalError = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(originalError));

    await expect(
      fetchWithTimeout(
        'https://fiscal-api-5eok.onrender.com/api/database/token',
        {},
        1000,
        'token',
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Verifique se o backend permite esta origem'),
      cause: originalError,
    });
  });

  it('describes the backend origin and current origin in network messages', () => {
    expect(
      buildOfflineDatabaseNetworkErrorMessage(
        'https://fiscal-api-5eok.onrender.com/api/database/version',
        'version',
      ),
    ).toContain('https://fiscal-api-5eok.onrender.com');
  });

  it('resolves relative backend URLs against the current origin', () => {
    vi.stubGlobal('location', {
      origin: 'https://3fbcaa44.fiscalconsultas.pages.dev',
    });

    const message = buildOfflineDatabaseNetworkErrorMessage(
      '/api/database/version',
      'version',
    );

    expect(message).toContain('https://3fbcaa44.fiscalconsultas.pages.dev');
    expect(message).toContain('/api/database/version');
  });

  it('shows a recoverable friendly message when the download token is rejected', async () => {
    removeFromOpfs.mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              token: 'token-1',
              app_seed: 'seed-1',
              encrypted_sha256: 'enc-sha',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              detail: 'Token invalid, expired, or already used',
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          ),
        ),
    );

    await dispatchWorkerMessage('INSTALL', 'install-1', {
      apiBase: 'https://api.example.test/api',
    });

    const friendlyMessage =
      'O token temporário do banco offline expirou ou foi recusado pelo servidor (403). Tente instalar novamente.';
    expect(postWorkerError).toHaveBeenCalledWith(
      'install-1',
      expect.stringContaining(friendlyMessage),
    );
    expect(
      postWorkerError.mock.calls.some(([, message]) =>
        String(message).includes('Token invalid, expired, or already used'),
      ),
    ).toBe(false);
    expect(postWorkerStatus).toHaveBeenCalledWith(
      'install-1',
      expect.objectContaining({
        status: 'error',
        recoverable: true,
        error: expect.stringContaining(friendlyMessage),
      }),
    );
  });

  it('treats legacy install payloads with metadata fields as legacy installs', async () => {
    removeFromOpfs.mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              token: 'token-1',
              app_seed: 'seed-1',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    );

    await dispatchWorkerMessage('INSTALL', 'install-legacy', {
      apiBase: 'https://api.example.test/api',
      metadata: null,
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/database/token',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('keeps the previous source bundle until the replacement is saved', async () => {
    const encryptedBlob = new Uint8Array([1, 2, 3]);
    sha256Hex.mockResolvedValue('encrypted-sha');
    decryptDatabase.mockResolvedValue(new Uint8Array([4, 5, 6]));
    loadDatabaseFromBytes.mockResolvedValue(undefined);
    saveSourceToOpfs.mockResolvedValue(undefined);
    saveSourceVersion.mockResolvedValue(undefined);
    getWorkerVersion.mockReturnValue('2026.05.09');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(encryptedBlob, {
          status: 200,
          headers: { 'content-length': String(encryptedBlob.length) },
        }),
      ),
    );

    await dispatchWorkerMessage('INSTALL', 'install-source', {
      source: 'nesh',
      r2BaseUrl: 'https://r2.example.test/fiscal',
      publicSeed: 'public-seed',
      metadata: {
        source: 'nesh',
        version: '2026.05.09',
        encrypted_sha256: 'encrypted-sha',
      },
    });

    expect(setAppSeed).toHaveBeenCalledWith('public-seed');
    expect(saveSourceToOpfs).toHaveBeenCalledWith('nesh', encryptedBlob);
    expect(saveSourceVersion).toHaveBeenCalledWith('nesh', '2026.05.09');
    expect(removeSourceFromOpfs).not.toHaveBeenCalled();
    expect(postWorkerStatus).toHaveBeenCalledWith(
      'install-source',
      expect.objectContaining({ status: 'ready' }),
    );
  });

  it('installs a static consolidated R2 fiscal bundle without requesting backend tokens', async () => {
    const encryptedBlob = new Uint8Array([9, 8, 7]);
    sha256Hex.mockResolvedValue('static-encrypted-sha');
    decryptDatabase.mockResolvedValue(new Uint8Array([6, 5, 4]));
    loadDatabaseFromBytes.mockResolvedValue(undefined);
    saveToOpfs.mockResolvedValue(undefined);
    saveSeed.mockResolvedValue(undefined);
    saveVersion.mockResolvedValue(undefined);
    getWorkerVersion.mockReturnValue('2026.05.11');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(encryptedBlob, {
          status: 200,
          headers: { 'content-length': String(encryptedBlob.length) },
        }),
      ),
    );

    await dispatchWorkerMessage('INSTALL', 'install-r2-static', {
      r2BaseUrl: 'https://r2.example.test/fiscal',
      publicSeed: 'public-seed',
      metadata: {
        version: '2026.05.11',
        encrypted_sha256: 'static-encrypted-sha',
      },
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://r2.example.test/fiscal/fiscal_offline.enc',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/database/token'),
      expect.anything(),
    );
    expect(setAppSeed).toHaveBeenCalledWith('public-seed');
    expect(saveToOpfs).toHaveBeenCalledWith(encryptedBlob);
    expect(saveSeed).toHaveBeenCalledWith('public-seed');
    expect(saveVersion).toHaveBeenCalledWith('2026.05.11');
    expect(postWorkerStatus).toHaveBeenCalledWith(
      'install-r2-static',
      expect.objectContaining({ status: 'ready' }),
    );
  });

  it('does not trim fiscal R2 bundle URLs with a trailing-slash regex', () => {
    const source = readFileSync('src/workers/dbWorker/messages.js', 'utf8');

    expect(source).not.toContain('replace(/\\/+$/, "")');
  });
});
