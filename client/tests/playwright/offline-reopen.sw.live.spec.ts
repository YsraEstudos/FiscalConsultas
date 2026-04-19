import { expect, test, type Page } from '@playwright/test';

type OfflineApiCounters = {
  version: number;
  token: number;
  download: number;
};

const OFFLINE_METADATA = {
  version: '2026.04.17.001',
  size_bytes: 3_145_728,
  sha256: 'mock-plain-sha',
  encrypted_sha256: 'mock-encrypted-sha',
  built_at: '2026-04-17T12:00:00Z',
  format_version: 1,
  chunk_size: 65536,
  pbkdf2_iterations: 600000,
};

function isNonLocalHostBaseUrlConfigured(): boolean {
  const rawBaseUrl = process.env.PLAYWRIGHT_LIVE_BASE_URL || '';
  if (!rawBaseUrl) return false;

  try {
    const hostname = new URL(rawBaseUrl).hostname;
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  } catch {
    return false;
  }
}

async function installOfflineApiMock(page: Page, counters: OfflineApiCounters) {
  const encryptedBytes = Buffer.from('mock-encrypted-offline-bundle', 'utf-8');

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path.endsWith('/database/version') && request.method() === 'GET') {
      counters.version += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(OFFLINE_METADATA),
      });
      return;
    }

    if (path.endsWith('/database/token') && request.method() === 'POST') {
      counters.token += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'mock-offline-token',
          encrypted_sha256: OFFLINE_METADATA.encrypted_sha256,
          chunk_size: OFFLINE_METADATA.chunk_size,
          pbkdf2_iterations: OFFLINE_METADATA.pbkdf2_iterations,
        }),
      });
      return;
    }

    if (path.endsWith('/database/download') && request.method() === 'POST') {
      counters.download += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: {
          'content-length': String(encryptedBytes.length),
        },
        body: encryptedBytes,
      });
      return;
    }

    if (path.endsWith('/status') && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'online',
          database: { status: 'online', latency_ms: 1 },
          tipi: { status: 'online' },
          nbs: { status: 'online' },
          nebs: { status: 'online' },
          catalogs: {
            nesh: { status: 'online', latency_ms: 1 },
            tipi: { status: 'online' },
            nbs: { status: 'online' },
            nebs: { status: 'online' },
          },
        }),
      });
      return;
    }

    await route.continue();
  });
}

async function installAuthSessionMock(page: Page) {
  await page.route('**/api/auth/me*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        can_use_ai_chat: false,
        can_use_restricted_ui: false,
      }),
    });
  });
}

async function installOfflineSupportMock(page: Page) {
  await page.addInitScript(() => {
    try {
      if (typeof globalThis.SharedArrayBuffer === 'undefined') {
        Object.defineProperty(globalThis, 'SharedArrayBuffer', {
          configurable: true,
          value: class SharedArrayBufferShim {},
        });
      }
    } catch {
      // Some browsers expose this as a non-configurable global; ignore that.
    }

    try {
      const cryptoObject = globalThis.crypto as Crypto & { subtle?: unknown } | undefined;
      if (cryptoObject && typeof cryptoObject.subtle === 'undefined') {
        Object.defineProperty(cryptoObject, 'subtle', {
          configurable: true,
          value: {},
        });
      }
    } catch {
      // If crypto is read-only, the live spec will still surface the unsupported state.
    }

    try {
      const navigatorWithStorage = navigator as Navigator & {
        storage?: { getDirectory?: unknown };
      };
      const storage = navigatorWithStorage.storage;
      if (!storage || typeof storage.getDirectory !== 'function') {
        Object.defineProperty(navigatorWithStorage, 'storage', {
          configurable: true,
          value: {
            ...(storage && typeof storage === 'object' ? storage : {}),
            getDirectory: async () => ({}),
          },
        });
      }
    } catch {
      // If storage is read-only, the live spec will still surface the unsupported state.
    }
  });
}

async function installOfflineWorkerMock(page: Page) {
  await page.addInitScript((metadata) => {
    const OFFLINE_META_KEY = 'offline-db:installed-meta';

    type WorkerMessage = {
      type: string;
      id: string | null;
      payload: Record<string, unknown>;
    };

    function readInstalledMeta() {
      const raw = globalThis.localStorage.getItem(OFFLINE_META_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as {
          version?: string;
          size_bytes?: number;
        };
      } catch {
        return null;
      }
    }

    function emitToWorker(
      worker: {
        onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
        listeners: Set<(event: MessageEvent<WorkerMessage>) => void>;
      },
      message: WorkerMessage,
    ) {
      const event = { data: message } as MessageEvent<WorkerMessage>;
      worker.onmessage?.(event);
      worker.listeners.forEach((listener) => listener(event));
    }

    class MockOfflineWorker {
      public onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;

      public onerror: ((event: ErrorEvent) => void) | null = null;

      public listeners = new Set<(event: MessageEvent<WorkerMessage>) => void>();

      constructor() {
        queueMicrotask(() => {
          emitToWorker(this, { type: 'READY', id: null, payload: {} });
        });
      }

      addEventListener(type: string, listener: (event: MessageEvent<WorkerMessage>) => void) {
        if (type !== 'message') return;
        this.listeners.add(listener);
      }

      removeEventListener(type: string, listener: (event: MessageEvent<WorkerMessage>) => void) {
        if (type !== 'message') return;
        this.listeners.delete(listener);
      }

      terminate() {
        this.listeners.clear();
      }

      async postMessage(message: { type?: string; id?: string | null; payload?: Record<string, unknown> }) {
        const type = message.type || '';
        const id = message.id || null;
        const payload = message.payload || {};

        try {
          if (type === 'INIT') {
            const installedMeta = readInstalledMeta();
            if (installedMeta?.version) {
              emitToWorker(this, {
                type: 'STATUS',
                id,
                payload: {
                  status: 'ready',
                  version: installedMeta.version,
                  sizeBytes: installedMeta.size_bytes || 0,
                },
              });
            } else {
              emitToWorker(this, {
                type: 'STATUS',
                id,
                payload: { status: 'not_installed' },
              });
            }
            return;
          }

          if (type === 'INSTALL') {
            emitToWorker(this, {
              type: 'PROGRESS',
              id,
              payload: { progress: 0, step: 'requesting_token' },
            });

            const apiBase = String(payload.apiBase || '/api');

            const tokenResponse = await fetch(`${apiBase}/database/token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            });
            const tokenPayload = await tokenResponse.json() as { token?: string };

            emitToWorker(this, {
              type: 'PROGRESS',
              id,
              payload: { progress: 40, step: 'downloading' },
            });

            const downloadResponse = await fetch(`${apiBase}/database/download`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: tokenPayload.token || 'mock-offline-token' }),
            });
            await downloadResponse.arrayBuffer();

            const versionResponse = await fetch(`${apiBase}/database/version`, {
              method: 'GET',
              headers: { Accept: 'application/json' },
            });
            const versionPayload = await versionResponse.json() as {
              version?: string;
              size_bytes?: number;
            };

            const installedMeta = {
              ...metadata,
              version: versionPayload.version || metadata.version,
              size_bytes: versionPayload.size_bytes || metadata.size_bytes,
            };

            globalThis.localStorage.setItem(OFFLINE_META_KEY, JSON.stringify(installedMeta));

            emitToWorker(this, {
              type: 'PROGRESS',
              id,
              payload: { progress: 100, step: 'done' },
            });
            emitToWorker(this, {
              type: 'STATUS',
              id,
              payload: {
                status: 'ready',
                version: installedMeta.version,
                sizeBytes: installedMeta.size_bytes,
              },
            });
            return;
          }

          if (type === 'GET_STATUS') {
            const installedMeta = readInstalledMeta();
            emitToWorker(this, {
              type: 'STATUS',
              id,
              payload: installedMeta?.version
                ? {
                  status: 'ready',
                  version: installedMeta.version,
                  sizeBytes: installedMeta.size_bytes || 0,
                }
                : { status: 'not_installed' },
            });
            return;
          }

          if (type === 'SEARCH') {
            emitToWorker(this, {
              type: 'RESULT',
              id,
              payload: { results: null, source: 'not_ready' },
            });
            return;
          }

          if (type === 'REMOVE') {
            globalThis.localStorage.removeItem(OFFLINE_META_KEY);
            emitToWorker(this, {
              type: 'STATUS',
              id,
              payload: { status: 'not_installed' },
            });
            return;
          }

          emitToWorker(this, {
            type: 'ERROR',
            id,
            payload: { error: `Unknown message type: ${type}` },
          });
        } catch (error) {
          emitToWorker(this, {
            type: 'ERROR',
            id,
            payload: {
              error: error instanceof Error ? error.message : 'Mock worker failure',
            },
          });
        }
      }
    }

    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: MockOfflineWorker,
    });
  }, OFFLINE_METADATA);
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: /Menu/, exact: true }).click();
  await page.getByRole('button', { name: /Configurações/ }).click();
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
}

async function installOfflineFromSettings(page: Page) {
  await openSettings(page);
  const installButton = page.locator('#db-installer-install');
  await expect(installButton).toBeVisible({ timeout: 15_000 });
  await installButton.click();
  await expect(page.locator('#db-installer-remove')).toBeVisible({ timeout: 15_000 });
}

test.describe('live offline reopen with active service worker', () => {
  test.skip(!isNonLocalHostBaseUrlConfigured(), 'Set PLAYWRIGHT_LIVE_BASE_URL to a non-localhost host (e.g. http://offline-e2e.local:4173).');

  test('reopens fully offline with cached app shell and local DB ready state', async ({ page, context }) => {
    const counters: OfflineApiCounters = {
      version: 0,
      token: 0,
      download: 0,
    };

    await installOfflineSupportMock(page);
    await installOfflineWorkerMock(page);
    await installAuthSessionMock(page);
    await installOfflineApiMock(page, counters);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();

    const hostname = await page.evaluate(() => globalThis.location.hostname);
    expect(hostname).not.toBe('localhost');
    expect(hostname).not.toBe('127.0.0.1');

    await page.reload();
    await page.waitForFunction(() => window.crossOriginIsolated === true);

    await installOfflineFromSettings(page);
    expect(counters.token).toBe(1);
    expect(counters.download).toBe(1);

    await page.keyboard.press('Escape');
    await expect(page.getByTitle('Buscas Offline configuradas!')).toBeVisible();

    await page.unroute('**/api/**');
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();
      await expect(page.getByTitle('Buscas Offline configuradas!')).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
