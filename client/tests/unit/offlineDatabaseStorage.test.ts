import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildOfflineDatabaseInitPayload,
  clearOfflineDatabaseInstallLock,
  getOfflineDatabaseSupportReport,
  getOfflineDatabaseInstallLock,
  isOfflineDatabaseSupported,
  OFFLINE_LOCK_KEY,
  OFFLINE_META_KEY,
  persistStoredOfflineDatabaseMetadata,
  readStoredOfflineDatabaseMetadata,
  setOfflineDatabaseInstallLock,
} from '../../src/context/offlineDatabaseStorage';

const originalNavigatorStorageDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  'storage',
);
const originalNavigatorServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  'serviceWorker',
);

type OfflineSupportStubOptions = {
  sharedArrayBuffer?: boolean;
  worker?: boolean;
  webCrypto?: boolean;
  opfs?: boolean;
  serviceWorker?: boolean;
  secureContext?: boolean;
  isolated?: boolean;
};

function restoreNavigatorProperty(
  property: 'storage' | 'serviceWorker',
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(navigator, property, descriptor);
    return;
  }

  Reflect.deleteProperty(navigator, property);
}

function stubOfflineSupport({
  sharedArrayBuffer = true,
  worker = true,
  webCrypto = true,
  opfs = true,
  serviceWorker = true,
  secureContext = true,
  isolated = true,
}: OfflineSupportStubOptions = {}) {
  vi.stubGlobal('isSecureContext', secureContext);
  vi.stubGlobal('crossOriginIsolated', isolated);

  if (sharedArrayBuffer) {
    vi.stubGlobal('SharedArrayBuffer', class SharedArrayBufferMock {});
  } else {
    vi.stubGlobal('SharedArrayBuffer', undefined);
  }

  if (worker) {
    vi.stubGlobal('Worker', class WorkerMock {});
  } else {
    vi.stubGlobal('Worker', undefined);
  }

  vi.stubGlobal('crypto', webCrypto ? { subtle: {} } : {});

  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: opfs ? { getDirectory: vi.fn() } : {},
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: serviceWorker ? {} : undefined,
  });
}

describe('offlineDatabaseStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restoreNavigatorProperty('storage', originalNavigatorStorageDescriptor);
    restoreNavigatorProperty(
      'serviceWorker',
      originalNavigatorServiceWorkerDescriptor,
    );
  });

  it('persists and reads sanitized offline metadata', () => {
    persistStoredOfflineDatabaseMetadata({
      version: '2026.04.21',
      size_bytes: 2048,
      sha256: 'abc123',
      chunk_size: 8192,
      pbkdf2_iterations: 900000,
    });

    expect(readStoredOfflineDatabaseMetadata()).toEqual({
      version: '2026.04.21',
      size_bytes: 2048,
      sha256: 'abc123',
      encrypted_sha256: null,
      built_at: null,
      updated_at: null,
      format_version: 1,
      chunk_size: 8192,
      pbkdf2_iterations: 900000,
    });

    localStorage.setItem(OFFLINE_META_KEY, '{invalid json');
    expect(readStoredOfflineDatabaseMetadata()).toBeNull();
  });

  it('stores, expires, and clears the install lock by owner', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:00:00Z'));

    expect(setOfflineDatabaseInstallLock('tab-a')).toBe(true);
    expect(getOfflineDatabaseInstallLock()).toEqual({
      owner: 'tab-a',
      expiresAt: Date.now() + 180_000,
    });

    clearOfflineDatabaseInstallLock('tab-b');
    expect(localStorage.getItem(OFFLINE_LOCK_KEY)).not.toBeNull();

    clearOfflineDatabaseInstallLock('tab-a');
    expect(getOfflineDatabaseInstallLock()).toBeNull();

    localStorage.setItem(
      OFFLINE_LOCK_KEY,
      JSON.stringify({
        owner: 'tab-c',
        expiresAt: Date.now() + 1,
      }),
    );
    vi.advanceTimersByTime(2);

    expect(getOfflineDatabaseInstallLock()).toBeNull();
  });

  it('builds init payload from metadata or defaults', () => {
    expect(buildOfflineDatabaseInitPayload(null)).toEqual({
      chunkSize: 65536,
      pbkdf2Iterations: 600000,
    });

    expect(
      buildOfflineDatabaseInitPayload({
        version: '2026.04.21',
        size_bytes: 1024,
        sha256: 'abc123',
        chunk_size: 4096,
        pbkdf2_iterations: 750000,
      }),
    ).toEqual({
      chunkSize: 4096,
      pbkdf2Iterations: 750000,
    });
  });

  it('reports Edge or Chromium with required browser primitives as supported', () => {
    stubOfflineSupport();

    expect(isOfflineDatabaseSupported()).toBe(true);
    expect(getOfflineDatabaseSupportReport()).toEqual({
      supported: true,
      missingFeatures: [],
      canRecoverWithIsolationReload: false,
      isSecureContext: true,
      crossOriginIsolated: true,
    });
  });

  it('treats missing SharedArrayBuffer in a secure service-worker origin as recoverable', () => {
    stubOfflineSupport({
      sharedArrayBuffer: false,
      isolated: false,
    });

    expect(isOfflineDatabaseSupported()).toBe(false);
    expect(getOfflineDatabaseSupportReport()).toEqual({
      supported: false,
      missingFeatures: ['cross-origin-isolation', 'shared-array-buffer'],
      canRecoverWithIsolationReload: true,
      isSecureContext: true,
      crossOriginIsolated: false,
    });
  });

  it('does not treat a SharedArrayBuffer failure as recoverable when already isolated', () => {
    stubOfflineSupport({
      sharedArrayBuffer: false,
      isolated: true,
    });

    expect(getOfflineDatabaseSupportReport()).toMatchObject({
      supported: false,
      canRecoverWithIsolationReload: false,
      crossOriginIsolated: true,
    });
  });

  it('reports insecure origins as a non-recoverable missing feature', () => {
    stubOfflineSupport({
      sharedArrayBuffer: false,
      secureContext: false,
      isolated: false,
    });

    expect(getOfflineDatabaseSupportReport()).toMatchObject({
      supported: false,
      canRecoverWithIsolationReload: false,
      isSecureContext: false,
      crossOriginIsolated: false,
    });
    expect(getOfflineDatabaseSupportReport().missingFeatures).toContain('secure-context');
  });

  it('reports missing OPFS as a non-recoverable missing feature', () => {
    stubOfflineSupport({ opfs: false });

    expect(getOfflineDatabaseSupportReport()).toMatchObject({
      supported: false,
      canRecoverWithIsolationReload: false,
    });
    expect(getOfflineDatabaseSupportReport().missingFeatures).toContain('opfs');
  });
});
