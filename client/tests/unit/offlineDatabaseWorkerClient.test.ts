import { describe, expect, it, vi } from 'vitest';

import {
  extractOfflineCatalogSearchResult,
  extractOfflineWorkerDetail,
  isOfflineDatabaseWorkerReadyMessage,
  sendOfflineDatabaseWorkerRequest,
} from '../../src/context/offlineDatabaseWorkerClient';
import { validateSourceAwareInstallPayload } from '../../src/workers/dbWorker/messages.js';
import type {
  OfflineDatabaseWorkerRequest,
  PendingOfflineDatabaseRequest,
} from '../../src/context/offlineDatabase.types';

describe('offlineDatabaseWorkerClient', () => {
  it('rejects requests when the worker is unavailable', async () => {
    await expect(
      sendOfflineDatabaseWorkerRequest(
        null,
        new Map<string, PendingOfflineDatabaseRequest>(),
        {
          type: 'SEARCH',
          id: null,
          payload: {
            docType: 'nesh',
            query: '01',
          },
        },
        1000,
      ),
    ).rejects.toThrow('Worker not initialized');
  });

  it('assigns an id to requests without one and resolves the pending entry', async () => {
    const postedMessages: OfflineDatabaseWorkerRequest[] = [];
    const worker = {
      postMessage: vi.fn((message: OfflineDatabaseWorkerRequest) => {
        postedMessages.push(message);
      }),
    } as unknown as Worker;
    const pending = new Map<string, PendingOfflineDatabaseRequest>();

    const requestPromise = sendOfflineDatabaseWorkerRequest(
      worker,
      pending,
      {
        type: 'GET_NBS_DETAIL',
        id: null,
        payload: { code: '01.001', page: 1, pageSize: 50 },
      },
      1000,
    );

    const message = postedMessages[0] as OfflineDatabaseWorkerRequest & { id: string };
    expect(message.id).toMatch(/^req_/);
    expect(pending.has(message.id)).toBe(true);

    const pendingEntry = pending.get(message.id);
    expect(pendingEntry).toBeDefined();
    clearTimeout(pendingEntry!.timeout);
    pending.delete(message.id);
    pendingEntry!.resolve({
      type: 'RESULT',
      id: message.id,
      payload: { detail: { codigo: '01.001' } },
    });

    await expect(requestPromise).resolves.toEqual({
      type: 'RESULT',
      id: message.id,
      payload: { detail: { codigo: '01.001' } },
    });
  });

  it('accepts source-aware install payloads', async () => {
    const postedMessages: OfflineDatabaseWorkerRequest[] = [];
    const worker = {
      postMessage: vi.fn((message: OfflineDatabaseWorkerRequest) => {
        postedMessages.push(message);
      }),
    } as unknown as Worker;
    const pending = new Map<string, PendingOfflineDatabaseRequest>();

    const requestPromise = sendOfflineDatabaseWorkerRequest(
      worker,
      pending,
      {
        type: 'INSTALL',
        id: null,
        payload: {
          source: 'nbs',
          r2BaseUrl: 'https://r2.example.com/fiscal',
          publicSeed: 'public-seed',
          metadata: {
            source: 'nbs',
            version: '2026.05.01',
            size_bytes: 4096,
            sha256: 'plain-sha',
            encrypted_sha256: 'enc-sha',
            chunk_size: 65536,
            pbkdf2_iterations: 600000,
          },
        },
      },
      1000,
    );

    const message = postedMessages[0] as OfflineDatabaseWorkerRequest & { id: string };
    expect(message).toMatchObject({
      type: 'INSTALL',
      payload: {
        source: 'nbs',
        r2BaseUrl: 'https://r2.example.com/fiscal',
        publicSeed: 'public-seed',
        metadata: {
          source: 'nbs',
          version: '2026.05.01',
          encrypted_sha256: 'enc-sha',
        },
      },
    });

    const pendingEntry = pending.get(message.id);
    expect(pendingEntry).toBeDefined();
    clearTimeout(pendingEntry!.timeout);
    pending.delete(message.id);
    pendingEntry!.resolve({
      type: 'STATUS',
      id: message.id,
      payload: { status: 'ready', version: '2026.05.01' },
    });

    await expect(requestPromise).resolves.toMatchObject({
      type: 'STATUS',
      payload: { status: 'ready', version: '2026.05.01' },
    });
  });

  it('accepts source-aware init and remove payloads', async () => {
    const worker = {
      postMessage: vi.fn(),
    } as unknown as Worker;
    const pending = new Map<string, PendingOfflineDatabaseRequest>();

    sendOfflineDatabaseWorkerRequest(
      worker,
      pending,
      {
        type: 'INIT',
        id: null,
        payload: {
          source: 'nesh',
          publicSeed: 'public-seed',
          chunkSize: 65536,
          pbkdf2Iterations: 600000,
        },
      },
      1000,
    ).catch(() => undefined);

    sendOfflineDatabaseWorkerRequest(
      worker,
      pending,
      {
        type: 'REMOVE',
        id: null,
        payload: { source: 'nesh' },
      },
      1000,
    ).catch(() => undefined);

    expect(worker.postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'INIT',
        payload: expect.objectContaining({
          source: 'nesh',
          publicSeed: 'public-seed',
        }),
      }),
    );
    expect(worker.postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'REMOVE',
        payload: { source: 'nesh' },
      }),
    );

    for (const pendingEntry of pending.values()) {
      clearTimeout(pendingEntry.timeout);
    }
  });

  it('rejects malformed source-aware install payloads before legacy fallback', () => {
    expect(
      validateSourceAwareInstallPayload({
        source: 'nbs',
        r2BaseUrl: 'https://r2.example.com/fiscal',
        publicSeed: 'public-seed',
        metadata: {
          source: 'tipi',
          version: '2026.05.01',
          encrypted_sha256: 'enc-sha',
        },
      }),
    ).toEqual({
      ok: false,
      error: 'Source metadata does not match install source',
    });

    expect(
      validateSourceAwareInstallPayload({
        source: 'nbs',
        r2BaseUrl: 'https://r2.example.com/fiscal',
      }),
    ).toEqual({
      ok: false,
      error: 'Source-aware install payload is incomplete',
    });
  });

  it('extracts ready, search, and detail payloads from worker responses', () => {
    expect(
      isOfflineDatabaseWorkerReadyMessage({
        type: 'READY',
        id: null,
        payload: {},
      }),
    ).toBe(true);

    expect(
      extractOfflineCatalogSearchResult({
        type: 'RESULT',
        id: 'req_1',
        payload: {
          results: [{ codigo: '01' }],
          searchType: 'code',
          markdown: 'result',
          timing: {
            sqlDurationMs: 10,
            totalDurationMs: 12,
            cacheHit: false,
          },
        },
      }),
    ).toEqual({
      results: [{ codigo: '01' }],
      searchType: 'code',
      markdown: 'result',
      timing: {
        sqlDurationMs: 10,
        totalDurationMs: 12,
        cacheHit: false,
      },
    });

    expect(
      extractOfflineWorkerDetail<{ codigo: string }>({
        type: 'RESULT',
        id: 'req_2',
        payload: {
          detail: { codigo: '01.001' },
        },
      }),
    ).toEqual({ codigo: '01.001' });
  });
});
