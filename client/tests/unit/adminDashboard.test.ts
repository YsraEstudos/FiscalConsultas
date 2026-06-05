import { beforeEach, describe, expect, it, vi } from 'vitest';

const refs = vi.hoisted(() => ({
    apiGetMock: vi.fn(),
    apiPostMock: vi.fn(),
}));

vi.mock('../../src/services/api/httpClient', () => ({
    api: {
        get: refs.apiGetMock,
        post: refs.apiPostMock,
    },
}));

const dashboardResponse = {
    total_active_devices: 1,
    total_searches_today: 2,
    searches_by_type: { nesh: 2 },
    devices: [],
};

describe('admin dashboard API cache', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        refs.apiGetMock.mockResolvedValue({ data: dashboardResponse });
        refs.apiPostMock.mockResolvedValue({});
    });

    it('deduplicates concurrent dashboard loads', async () => {
        const { getAdminDashboard } = await import('../../src/services/api/adminDashboard');

        const [first, second] = await Promise.all([
            getAdminDashboard(),
            getAdminDashboard(),
        ]);

        expect(first).toBe(dashboardResponse);
        expect(second).toBe(dashboardResponse);
        expect(refs.apiGetMock).toHaveBeenCalledTimes(1);
    });

    it('serves a warm dashboard cache without another request', async () => {
        const { getAdminDashboard } = await import('../../src/services/api/adminDashboard');

        await getAdminDashboard();
        await getAdminDashboard();

        expect(refs.apiGetMock).toHaveBeenCalledTimes(1);
    });

    it('prefetches data before the dashboard mounts', async () => {
        const { getAdminDashboard, prefetchAdminDashboard } = await import(
            '../../src/services/api/adminDashboard'
        );

        prefetchAdminDashboard();
        await Promise.resolve();
        await getAdminDashboard();

        expect(refs.apiGetMock).toHaveBeenCalledTimes(1);
    });

    it('invalidates dashboard cache after successful telemetry write', async () => {
        const { getAdminDashboard, logSearchEvent } = await import('../../src/services/api/adminDashboard');

        await getAdminDashboard();
        logSearchEvent({
            search_type: 'nesh',
            search_query: '0101',
            device_fingerprint: 'fp',
            device_label: 'Chrome / Windows',
        });
        await Promise.resolve();
        await getAdminDashboard();

        expect(refs.apiGetMock).toHaveBeenCalledTimes(2);
    });

    it('logs telemetry warnings in DEV without throwing', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        refs.apiPostMock.mockRejectedValueOnce(new Error('telemetry failed'));

        const { logSearchEvent } = await import('../../src/services/api/adminDashboard');

        expect(() => logSearchEvent({
            search_type: 'nesh',
            search_query: '0101',
            device_fingerprint: 'fp',
            device_label: 'Chrome / Windows',
        })).not.toThrow();

        await vi.waitFor(() => {
            expect(warnSpy).toHaveBeenCalled();
        });
        warnSpy.mockRestore();
    });

    it('force refresh bypasses warm dashboard cache', async () => {
        const { getAdminDashboard } = await import('../../src/services/api/adminDashboard');

        await getAdminDashboard();
        await getAdminDashboard(true);

        expect(refs.apiGetMock).toHaveBeenCalledTimes(2);
    });

    it('deduplicates concurrent forced dashboard refreshes', async () => {
        const { getAdminDashboard } = await import('../../src/services/api/adminDashboard');

        const [first, second] = await Promise.all([
            getAdminDashboard(true),
            getAdminDashboard(true),
        ]);

        expect(first).toBe(dashboardResponse);
        expect(second).toBe(dashboardResponse);
        expect(refs.apiGetMock).toHaveBeenCalledTimes(1);
    });
});
