import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  LocalDatabaseProvider,
  useLocalDatabase,
} from '../../src/context/LocalDatabaseContext';

type WorkerPayload = {
  type: string;
  id: string | null;
  payload: Record<string, unknown>;
};

class MockWorker {
  static instances: MockWorker[] = [];
  static initStatus: 'not_installed' | 'ready' = 'not_installed';
  static initVersion: string | null = null;
  static initSizeBytes: number | null = null;
  static installVersion: string | null = '2026.04';
  static installSizeBytes: number | null = 1024;

  public onmessage: ((event: MessageEvent<WorkerPayload>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public readonly messages: WorkerPayload[] = [];
  private readonly messageListeners = new Set<
    (event: MessageEvent<WorkerPayload>) => void
  >();

  constructor(
    public readonly scriptURL: URL,
    public readonly options?: WorkerOptions,
  ) {
    MockWorker.instances.push(this);
    queueMicrotask(() => {
      this.dispatch({ type: 'READY', id: null, payload: {} });
    });
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type !== 'message' || typeof listener !== 'function') return;
    this.messageListeners.add(listener as (event: MessageEvent<WorkerPayload>) => void);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type !== 'message' || typeof listener !== 'function') return;
    this.messageListeners.delete(listener as (event: MessageEvent<WorkerPayload>) => void);
  }

  postMessage(message: WorkerPayload): void {
    this.messages.push(message);
    queueMicrotask(() => {
      this.respond(message);
    });
  }

  terminate(): void {
    // Mirror Worker termination by detaching handlers from this test double.
    this.onmessage = null;
    this.onerror = null;
    this.messageListeners.clear();
  }

  private respond(message: WorkerPayload): void {
    if (message.type === 'INIT') {
      this.dispatch({
        type: 'STATUS',
        id: message.id,
        payload: {
          status: MockWorker.initStatus,
          version:
            MockWorker.initStatus === 'ready' ? MockWorker.initVersion : null,
          sizeBytes:
            MockWorker.initStatus === 'ready'
              ? MockWorker.initSizeBytes
              : null,
        },
      });
      return;
    }

    if (message.type === 'INSTALL') {
      this.dispatch({
        type: 'STATUS',
        id: message.id,
        payload: {
          status: 'ready',
          version: MockWorker.installVersion,
          sizeBytes: MockWorker.installSizeBytes,
        },
      });
      return;
    }

    if (message.type === 'REMOVE') {
      this.dispatch({
        type: 'STATUS',
        id: message.id,
        payload: {
          status: 'not_installed',
          version: null,
          sizeBytes: null,
        },
      });
    }
  }

  private dispatch(data: WorkerPayload): void {
    const event = { data } as MessageEvent<WorkerPayload>;
    this.onmessage?.(event);
    for (const listener of this.messageListeners) {
      listener(event);
    }
  }
}

let currentContext: ReturnType<typeof useLocalDatabase> | null = null;

function Probe() {
  currentContext = useLocalDatabase();

  return <div data-testid="status">{currentContext.status}</div>;
}

function makeVersionResponse(version: string) {
  return new Response(
    JSON.stringify({
      version,
      size_bytes: 1024,
      sha256: 'abc123',
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
}

function makeSourceMetadataResponse(version: string) {
  return new Response(
    JSON.stringify({
      source: 'nesh',
      version,
      size_bytes: 4096,
      sha256: 'plain-sha',
      encrypted_sha256: 'enc-sha',
      chunk_size: 65536,
      pbkdf2_iterations: 600000,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
}

function getWorkerMessages() {
  return MockWorker.instances[0]?.messages.map((message) => message.type) ?? [];
}

function getPostedWorkerMessages() {
  return MockWorker.instances[0]?.messages ?? [];
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('LocalDatabaseContext auto-install behavior', () => {
  beforeEach(() => {
    localStorage.clear();
    currentContext = null;
    MockWorker.instances = [];
    MockWorker.initStatus = 'not_installed';
    MockWorker.initVersion = null;
    MockWorker.initSizeBytes = null;
    MockWorker.installVersion = '2026.04';
    MockWorker.installSizeBytes = 1024;

    Object.defineProperty(globalThis.navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue(undefined),
      },
    });

    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.stubGlobal('SharedArrayBuffer', class SharedArrayBufferMock {});
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('crossOriginIsolated', true);
    vi.stubGlobal('crypto', { subtle: {}, randomUUID: vi.fn(() => 'mock-instance') });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(makeVersionResponse('2026.04'))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('auto-installs on first supported visit when the database is missing', async () => {
    render(
      <LocalDatabaseProvider>
        <Probe />
      </LocalDatabaseProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('ready'),
    );
    await flushEffects();

    expect(getWorkerMessages()).toContain('INSTALL');
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
  });

  it('does not reinstall immediately after remove()', async () => {
    MockWorker.initStatus = 'ready';
    MockWorker.initVersion = '2026.04';
    MockWorker.initSizeBytes = 2048;

    render(
      <LocalDatabaseProvider>
        <Probe />
      </LocalDatabaseProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('ready'),
    );
    expect(currentContext).not.toBeNull();

    await act(async () => {
      await currentContext!.remove();
    });

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('not_installed'),
    );
    await flushEffects();

    expect(getWorkerMessages()).not.toContain('INSTALL');
    expect(localStorage.getItem('offline-db:auto-install-opt-out')).toBe('true');
    expect(screen.getByTestId('status')).toHaveTextContent('not_installed');
  });

  it('uses R2 metadata and public seed for first-time install when configured', async () => {
    vi.stubEnv('VITE_FISCAL_R2_BASE_URL', 'https://r2.example.com/fiscal');
    vi.stubEnv('VITE_OFFLINE_DB_PUBLIC_SEED', 'public-seed');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/database/version') || url.includes('/database/token')) {
          return Promise.reject(new Error(`legacy endpoint called: ${url}`));
        }
        return Promise.resolve(makeSourceMetadataResponse('2026.05.01'));
      }),
    );

    render(
      <LocalDatabaseProvider>
        <Probe />
      </LocalDatabaseProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('not_installed'),
    );
    expect(currentContext).not.toBeNull();

    await act(async () => {
      await currentContext!.install();
    });

    const fetchUrls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
      String(call[0]),
    );
    expect(fetchUrls).toContain('https://r2.example.com/fiscal/nesh/nesh.meta.json');
    expect(fetchUrls.join('\n')).not.toContain('/database/version');
    expect(fetchUrls.join('\n')).not.toContain('/database/token');
    expect(getPostedWorkerMessages()).toContainEqual(
      expect.objectContaining({
        type: 'INSTALL',
        payload: {
          source: 'nesh',
          r2BaseUrl: 'https://r2.example.com/fiscal',
          publicSeed: 'public-seed',
          metadata: expect.objectContaining({
            source: 'nesh',
            version: '2026.05.01',
            encrypted_sha256: 'enc-sha',
          }),
        },
      }),
    );
  });

  it('falls back to the legacy install payload when R2 metadata is unavailable', async () => {
    vi.stubEnv('VITE_FISCAL_R2_BASE_URL', 'https://r2.example.com/fiscal');
    vi.stubEnv('VITE_OFFLINE_DB_PUBLIC_SEED', 'public-seed');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(makeVersionResponse('2026.05.01'))),
    );

    render(
      <LocalDatabaseProvider>
        <Probe />
      </LocalDatabaseProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('not_installed'),
    );
    expect(currentContext).not.toBeNull();

    await act(async () => {
      await currentContext!.install();
    });

    expect(getPostedWorkerMessages()).toContainEqual(
      expect.objectContaining({
        type: 'INSTALL',
        payload: {
          apiBase: expect.any(String),
          clerkToken: '',
        },
      }),
    );
  });

  it('clears the auto-install opt-out when install is started manually', async () => {
    localStorage.setItem('offline-db:auto-install-opt-out', 'true');

    render(
      <LocalDatabaseProvider>
        <Probe />
      </LocalDatabaseProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('not_installed'),
    );

    await act(async () => {
      await currentContext!.install();
    });

    expect(localStorage.getItem('offline-db:auto-install-opt-out')).toBeNull();
    expect(getWorkerMessages()).toContain('INSTALL');
  });
});
