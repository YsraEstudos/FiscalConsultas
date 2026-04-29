import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchOfflineDatabaseAvailabilityMetadata } from '../../src/context/offlineDatabaseSync'

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
})
