import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchOfflineDatabaseAvailabilityMetadata,
  fetchOfflineSourceAvailabilityMetadata,
  getFiscalR2BaseUrl,
  getOfflineDbPublicSeed,
} from '../../src/context/offlineDatabaseSync'

function makeOfflineVersionResponse(version: string): Response {
  return new Response(
    JSON.stringify({
      version,
      size_bytes: 2048,
      sha256: 'plain-sha',
      encrypted_sha256: 'enc-sha',
      chunk_size: 131072,
      pbkdf2_iterations: 700000,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

describe('offlineDatabaseSync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('reads R2 base URL and public seed from env config', () => {
    vi.stubEnv('VITE_FISCAL_R2_BASE_URL', 'https://r2.example.com/fiscal/')
    vi.stubEnv('VITE_OFFLINE_DB_PUBLIC_SEED', ' public-seed ')

    expect(getFiscalR2BaseUrl()).toBe('https://r2.example.com/fiscal')
    expect(getOfflineDbPublicSeed()).toBe('public-seed')
  })

  it('disables source bundles when R2 env is absent', () => {
    expect(getFiscalR2BaseUrl()).toBe('')
  })

  it('retries metadata checks after a transient abort', async () => {
    const abortError = new DOMException(
      'signal is aborted without reason',
      'AbortError'
    )
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(makeOfflineVersionResponse('2026.04.29'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchOfflineDatabaseAvailabilityMetadata('https://api.example.test')
    ).resolves.toEqual({
      version: '2026.04.29',
      size_bytes: 2048,
      sha256: 'plain-sha',
      encrypted_sha256: 'enc-sha',
      built_at: null,
      updated_at: null,
      format_version: 1,
      chunk_size: 131072,
      pbkdf2_iterations: 700000,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-recoverable HTTP failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('missing bundle', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchOfflineDatabaseAvailabilityMetadata('https://api.example.test')
    ).rejects.toThrow('Version check failed (503)')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetches source metadata from the R2 manifest path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: '2026.05.01',
          size_bytes: 4096,
          sha256: 'plain-sha',
          encrypted_sha256: 'enc-sha',
          chunk_size: 65536,
          pbkdf2_iterations: 600000,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchOfflineSourceAvailabilityMetadata('https://r2.example.com/fiscal/', 'nbs')
    ).resolves.toEqual({
      source: 'nbs',
      version: '2026.05.01',
      size_bytes: 4096,
      sha256: 'plain-sha',
      encrypted_sha256: 'enc-sha',
      built_at: null,
      updated_at: null,
      format_version: 1,
      chunk_size: 65536,
      pbkdf2_iterations: 600000,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://r2.example.com/fiscal/nbs/nbs.meta.json',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
    )
  })

  it('does not call the legacy database version endpoint for source metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: '2026.05.01',
          size_bytes: 4096,
          sha256: 'plain-sha',
          encrypted_sha256: 'enc-sha',
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchOfflineSourceAvailabilityMetadata('https://r2.example.com/fiscal', 'nbs')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/api/database/version')
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/database/version')
  })
})
