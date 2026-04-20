import { describe, expect, it } from 'vitest';

import { compareOfflineVersions, sanitizeOfflineMetadata } from '../../src/utils/offlineDatabase';

describe('offlineDatabase utils', () => {
  it('compares missing and dotted versions consistently', () => {
    expect(compareOfflineVersions(null, null)).toBe(0);
    expect(compareOfflineVersions(null, '2026.04')).toBe(-1);
    expect(compareOfflineVersions('2026.04', null)).toBe(1);
    expect(compareOfflineVersions('2026.04.17', '2026.04.17')).toBe(0);
    expect(compareOfflineVersions('2026.04.18', '2026.04.17')).toBeGreaterThan(0);
    expect(compareOfflineVersions('2026.04', '2026.04.1')).toBeLessThan(0);
    expect(compareOfflineVersions('2026.alpha', '2026.0')).toBe(0);
  });

  it('sanitizes optional metadata fields and fills defaults', () => {
    expect(sanitizeOfflineMetadata(null)).toBeNull();
    expect(sanitizeOfflineMetadata({ sha256: 'ignored' })).toBeNull();

    expect(
      sanitizeOfflineMetadata({
        version: '2026.04.19',
        size_bytes: '3145728' as unknown as number,
        sha256: 123 as unknown as string,
        encrypted_sha256: 'enc',
        built_at: 20260419 as unknown as string,
        updated_at: '',
        format_version: 2,
        chunk_size: 8192,
        pbkdf2_iterations: 900000,
      }),
    ).toEqual({
      version: '2026.04.19',
      size_bytes: 3145728,
      sha256: '123',
      encrypted_sha256: 'enc',
      built_at: '20260419',
      updated_at: null,
      format_version: 2,
      chunk_size: 8192,
      pbkdf2_iterations: 900000,
    });

    expect(
      sanitizeOfflineMetadata({
        version: '2026.04.20',
        size_bytes: 0,
        sha256: '',
      }),
    ).toEqual({
      version: '2026.04.20',
      size_bytes: 0,
      sha256: '',
      encrypted_sha256: null,
      built_at: null,
      updated_at: null,
      format_version: 1,
      chunk_size: 65536,
      pbkdf2_iterations: 600000,
    });
  });
});
