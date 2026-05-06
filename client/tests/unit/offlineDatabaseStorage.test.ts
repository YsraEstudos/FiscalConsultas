import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildOfflineDatabaseInitPayload,
  clearOfflineDatabaseInstallLock,
  getOfflineDatabaseInstallLock,
  OFFLINE_LOCK_KEY,
  OFFLINE_META_KEY,
  persistStoredOfflineSourceMetadata,
  persistStoredOfflineDatabaseMetadata,
  readStoredOfflineSourceMetadata,
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

  it('persists and reads sanitized source metadata without source collisions', () => {
    persistStoredOfflineSourceMetadata('nesh', {
      source: 'nesh',
      version: '2026.05.01',
      size_bytes: 2048,
      sha256: 'nesh-plain',
      encrypted_sha256: 'nesh-enc',
      chunk_size: 8192,
      pbkdf2_iterations: 900000,
    });
    persistStoredOfflineSourceMetadata('tipi', {
      source: 'tipi',
      version: '2026.05.02',
      size_bytes: 4096,
      sha256: 'tipi-plain',
      encrypted_sha256: 'tipi-enc',
      chunk_size: 16384,
      pbkdf2_iterations: 700000,
    });

    expect(readStoredOfflineSourceMetadata('nesh')).toEqual({
      source: 'nesh',
      version: '2026.05.01',
      size_bytes: 2048,
      sha256: 'nesh-plain',
      encrypted_sha256: 'nesh-enc',
      built_at: null,
      updated_at: null,
      format_version: 1,
      chunk_size: 8192,
      pbkdf2_iterations: 900000,
    });
    expect(readStoredOfflineSourceMetadata('tipi')).toEqual({
      source: 'tipi',
      version: '2026.05.02',
      size_bytes: 4096,
      sha256: 'tipi-plain',
      encrypted_sha256: 'tipi-enc',
      built_at: null,
      updated_at: null,
      format_version: 1,
      chunk_size: 16384,
      pbkdf2_iterations: 700000,
    });
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
