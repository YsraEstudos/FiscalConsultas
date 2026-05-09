import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  FISCAL_OFFLINE_SOURCES,
  buildFiscalBundleUrls,
  isFiscalSourceId,
} from '../../src/context/offlineSources';
import type {
  OfflineDocumentType,
  OfflineFiscalSourceId,
  OfflineSearchDocumentType,
} from '../../src/context/offlineDatabase.types';
import { sanitizeOfflineSourceMetadata } from '../../src/utils/offlineDatabase';

describe('offline fiscal sources', () => {
  it('declares the four independent fiscal sources', () => {
    expect(FISCAL_OFFLINE_SOURCES.map((source) => source.id)).toEqual([
      'nesh',
      'tipi',
      'nbs',
      'unspsc',
    ]);
  });

  it('builds source-scoped R2 URLs without using /api', () => {
    expect(buildFiscalBundleUrls('https://r2.example.com/fiscal', 'tipi')).toEqual({
      metadataUrl: 'https://r2.example.com/fiscal/tipi/tipi.meta.json',
      encryptedUrl: 'https://r2.example.com/fiscal/tipi/tipi.enc',
    });
  });

  it('normalizes trailing slashes in source-scoped R2 URLs', () => {
    expect(buildFiscalBundleUrls('https://r2.example.com/fiscal/', 'nbs')).toEqual({
      metadataUrl: 'https://r2.example.com/fiscal/nbs/nbs.meta.json',
      encryptedUrl: 'https://r2.example.com/fiscal/nbs/nbs.enc',
    });
  });

  it('sanitizes source metadata with encrypted bundle URL requirements', () => {
    expect(
      sanitizeOfflineSourceMetadata('nesh', {
        version: '2026.05.06.120000',
        size_bytes: 123,
        sha256: 'plain',
        encrypted_sha256: 'encrypted',
        built_at: '2026-05-06T12:00:00Z',
        format_version: 1,
        chunk_size: 65536,
        pbkdf2_iterations: 600000,
      }),
    ).toMatchObject({
      source: 'nesh',
      version: '2026.05.06.120000',
      encrypted_sha256: 'encrypted',
      size_bytes: 123,
    });
  });

  it('rejects unknown source ids', () => {
    expect(isFiscalSourceId('nesh')).toBe(true);
    expect(isFiscalSourceId('render')).toBe(false);
  });

  it('rejects source metadata without encrypted hashes or known source ids', () => {
    expect(
      sanitizeOfflineSourceMetadata('tipi', {
        version: '2026.05.06.120000',
        size_bytes: 123,
        sha256: 'plain',
      }),
    ).toBeNull();

    expect(
      sanitizeOfflineSourceMetadata('render', {
        version: '2026.05.06.120000',
        size_bytes: 123,
        sha256: 'plain',
        encrypted_sha256: 'encrypted',
      }),
    ).toBeNull();

    expect(
      sanitizeOfflineSourceMetadata('nesh', {
        version: '2026.05.06.120000',
        size_bytes: 123,
        sha256: 'plain',
        encrypted_sha256: '   ',
      }),
    ).toBeNull();

    expect(
      sanitizeOfflineSourceMetadata('nesh', {
        version: '2026.05.06.120000',
        size_bytes: 123,
        sha256: 'plain',
        encrypted_sha256: 42 as any,
      }),
    ).toBeNull();
  });

  it('keeps bundle source ids separate from currently searchable documents', () => {
    expectTypeOf<'unspsc'>().toExtend<OfflineFiscalSourceId>();
    expectTypeOf<'unspsc'>().not.toExtend<OfflineSearchDocumentType>();
    expectTypeOf<OfflineDocumentType>().toEqualTypeOf<OfflineSearchDocumentType>();
  });
});
