import { describe, expect, it, vi } from 'vitest';

import {
  extractOfflineCatalogSearchResult,
  extractOfflineWorkerDetail,
  isOfflineDatabaseWorkerReadyMessage,
  sendOfflineDatabaseWorkerRequest,
} from '../../src/context/offlineDatabaseWorkerClient';
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
