import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    fetchAvailableFiscalR2DatabaseMetadata,
    fetchFiscalR2DatabaseAvailabilityMetadata,
    fetchOfflineSourceAvailabilityMetadata,
    getBundledFiscalR2BaseUrl,
} from './offlineDatabaseSync';

describe('offlineDatabaseSync R2 metadata checks', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('treats missing consolidated R2 metadata as unavailable without retrying', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response('not found', { status: 404 }),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchFiscalR2DatabaseAvailabilityMetadata('https://r2.example.test/fiscal'),
        ).resolves.toBeNull();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://r2.example.test/fiscal/fiscal_offline.meta.json',
            expect.objectContaining({ method: 'GET' }),
        );
    });

    it('treats missing source R2 metadata as unavailable without retrying', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response('not found', { status: 404 }),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchOfflineSourceAvailabilityMetadata(
                'https://r2.example.test/fiscal',
                'nesh',
            ),
        ).resolves.toBeNull();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://r2.example.test/fiscal/nesh/nesh.meta.json',
            expect.objectContaining({ method: 'GET' }),
        );
    });

    it('builds the bundled fallback base URL from the Vite base path', () => {
        vi.stubEnv('BASE_URL', '/FiscalConsultas/');

        expect(getBundledFiscalR2BaseUrl()).toBe(
            'http://localhost:3000/FiscalConsultas/fiscal-bases',
        );
    });

    it('falls back to the bundled offline metadata when public R2 is missing', async () => {
        vi.stubEnv('BASE_URL', '/FiscalConsultas/');
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('not found', { status: 404 }))
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        version: '2026.05.13',
                        size_bytes: 2048,
                        sha256: 'plain-sha',
                        encrypted_sha256: 'enc-sha',
                    }),
                    { status: 200 },
                ),
            );
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchAvailableFiscalR2DatabaseMetadata([
                'https://r2.example.test/fiscal',
                getBundledFiscalR2BaseUrl(),
            ]),
        ).resolves.toMatchObject({
            r2BaseUrl: 'http://localhost:3000/FiscalConsultas/fiscal-bases',
            metadata: {
                version: '2026.05.13',
                encrypted_sha256: 'enc-sha',
            },
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            'https://r2.example.test/fiscal/fiscal_offline.meta.json',
            expect.objectContaining({ method: 'GET' }),
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            'http://localhost:3000/FiscalConsultas/fiscal-bases/fiscal_offline.meta.json',
            expect.objectContaining({ method: 'GET' }),
        );
    });
});
