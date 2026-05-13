import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    fetchFiscalR2DatabaseAvailabilityMetadata,
    fetchOfflineSourceAvailabilityMetadata,
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
});
