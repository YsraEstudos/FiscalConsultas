import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildOfflineDatabaseInitPayload,
  clearOfflineDatabaseInstallLock,
  getOfflineDatabaseInstallLock,
  OFFLINE_LOCK_KEY,
  OFFLINE_META_KEY,
  persistStoredOfflineDatabaseMetadata,
  readStoredOfflineDatabaseMetadata,
  setOfflineDatabaseInstallLock,
} from '../../src/context/offlineDatabaseStorage';

describe('offlineDatabaseStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
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
});
