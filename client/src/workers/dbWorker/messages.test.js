import { afterEach, describe, expect, it, vi } from 'vitest';

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
  readVersion: vi.fn(),
  removeFromOpfs: vi.fn(),
  saveSeed: vi.fn(),
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
  fetchWithTimeout,
} from './messages.js';

describe('dbWorker messages network helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
