import { expect, type Page } from '@playwright/test';

export type OfflineApiCounters = {
  version: number;
  token: number;
  download: number;
};

export const OFFLINE_METADATA = {
  version: '2026.04.17.001',
  size_bytes: 3_145_728,
  sha256: 'mock-plain-sha',
  encrypted_sha256: 'mock-encrypted-sha',
  built_at: '2026-04-17T12:00:00Z',
  format_version: 1,
  chunk_size: 65536,
  pbkdf2_iterations: 600000,
};

export async function installOfflineApiMock(page: Page, counters: OfflineApiCounters) {
  const encryptedBytes = Buffer.from('mock-encrypted-offline-bundle', 'utf-8');
  const routeScope = page.context();

  await routeScope.route('**/api/**', async (route) => {
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

    await route.fallback();
  });
}

export async function installAuthSessionMock(page: Page) {
  await page.context().route('**/api/auth/me*', async (route) => {
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

export async function installOfflineWorkerMock(page: Page) {
  await page.addInitScript((metadata) => {
    const OFFLINE_META_KEY = 'offline-db:installed-meta';

    type WorkerMessage = {
      type: string;
      id: string | null;
      payload: Record<string, unknown>;
    };

    type WorkerTarget = {
      onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
      listeners: Set<(event: MessageEvent<WorkerMessage>) => void>;
    };

    type WorkerCommand = (
      worker: WorkerTarget,
      id: string | null,
      payload: Record<string, unknown>,
    ) => Promise<void> | void;

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
      worker: WorkerTarget,
      message: WorkerMessage,
    ) {
      const event = { data: message } as MessageEvent<WorkerMessage>;
      worker.onmessage?.(event);
      worker.listeners.forEach((listener) => listener(event));
    }

    function installedStatusPayload() {
      const installedMeta = readInstalledMeta();
      return installedMeta?.version
        ? {
          status: 'ready',
          version: installedMeta.version,
          sizeBytes: installedMeta.size_bytes || 0,
        }
        : { status: 'not_installed' };
    }

    function emitInstalledStatus(worker: WorkerTarget, id: string | null) {
      emitToWorker(worker, {
        type: 'STATUS',
        id,
        payload: installedStatusPayload(),
      });
    }

    function emitError(worker: WorkerTarget, id: string | null, error: unknown) {
      emitToWorker(worker, {
        type: 'ERROR',
        id,
        payload: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }

    function resolveApiBase(payload: Record<string, unknown>) {
      return typeof payload.apiBase === 'string' && payload.apiBase.trim()
        ? payload.apiBase
        : '/api';
    }

    async function installOfflineBundle(
      worker: WorkerTarget,
      id: string | null,
      payload: Record<string, unknown>,
    ) {
      emitToWorker(worker, {
        type: 'PROGRESS',
        id,
        payload: { progress: 0, step: 'requesting_token' },
      });

      const apiBase = resolveApiBase(payload);
      const tokenResponse = await fetch(`${apiBase}/database/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const tokenPayload = await tokenResponse.json() as { token?: string };

      emitToWorker(worker, {
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

      emitToWorker(worker, {
        type: 'PROGRESS',
        id,
        payload: { progress: 100, step: 'done' },
      });
      emitToWorker(worker, {
        type: 'STATUS',
        id,
        payload: {
          status: 'ready',
          version: installedMeta.version,
          sizeBytes: installedMeta.size_bytes,
        },
      });
    }

    const commands: Record<string, WorkerCommand> = {
      INIT: (worker, id) => emitInstalledStatus(worker, id),
      INSTALL: installOfflineBundle,
      GET_STATUS: (worker, id) => emitInstalledStatus(worker, id),
      SEARCH: (worker, id) => emitToWorker(worker, {
        type: 'RESULT',
        id,
        payload: { results: null, source: 'not_ready' },
      }),
      REMOVE: (worker, id) => {
        globalThis.localStorage.removeItem(OFFLINE_META_KEY);
        emitToWorker(worker, {
          type: 'STATUS',
          id,
          payload: { status: 'not_installed' },
        });
      },
    };

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
          const command = commands[type];
          if (!command) throw new Error(`Unknown message type: ${type}`);
          await command(this, id, payload);
        } catch (error) {
          emitError(this, id, error instanceof Error ? error : new Error('Mock worker failure'));
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

export async function openSettings(page: Page) {
  await page.getByRole('button', { name: /Menu/, exact: true }).click();
  await page.getByRole('button', { name: /Configurações/ }).click();
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
}

export async function installOfflineFromSettings(page: Page, timeout = 15_000) {
  await openSettings(page);
  const installButton = page.locator('#db-installer-install');
  await expect(installButton).toBeVisible({ timeout });
  await installButton.click();
  await expectOfflineReadyInSettings(page, timeout);
}

export async function expectOfflineReadyInSettings(page: Page, timeout = 15_000) {
  const settingsDialog = page.getByRole('dialog', { name: 'Configurações' });
  if (!(await settingsDialog.isVisible().catch(() => false))) {
    await openSettings(page);
  }

  await expect(page.getByText(/Ativa/)).toBeVisible({ timeout });
}

export async function expectOfflineMetadataPersisted(page: Page) {
  await expect.poll(async () => (
    page.evaluate(() => Boolean(globalThis.localStorage.getItem('offline-db:installed-meta')))
  )).toBe(true);
}
