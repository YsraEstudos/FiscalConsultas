import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refs = vi.hoisted(() => ({
    getAdminDashboard: vi.fn(),
    getDeviceHistory: vi.fn(),
}));

vi.mock('../../src/services/api', () => ({
    getAdminDashboard: refs.getAdminDashboard,
    getDeviceHistory: refs.getDeviceHistory,
}));

const dashboardResponse = {
    total_active_devices: 1,
    total_searches_today: 2,
    searches_by_type: { nesh: 2 },
    devices: [
        {
            fingerprint: 'fp1',
            label: 'Chrome / Windows',
            user_email: null,
            user_id: null,
            last_active: new Date().toISOString(),
            is_active: true,
            searches_today: 2,
            total_searches: 2,
        },
    ],
};

describe('AdminDashboard', () => {
    let AdminDashboard: typeof import('../../src/components/AdminDashboard').AdminDashboard;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        refs.getAdminDashboard.mockResolvedValue(dashboardResponse);
        refs.getDeviceHistory.mockResolvedValue({});
        ({ AdminDashboard } = await import('../../src/components/AdminDashboard'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps loaded dashboard visible when a background poll fails', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<AdminDashboard />);

        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.getByText('Pesquisas Hoje')).toBeInTheDocument();
        expect(screen.getByText('NESH: 2')).toBeInTheDocument();

        refs.getAdminDashboard.mockRejectedValueOnce(new Error('poll failed'));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(15_000);
        });

        expect(screen.getByText('Pesquisas Hoje')).toBeInTheDocument();
        expect(screen.getByText('NESH: 2')).toBeInTheDocument();
        expect(screen.queryByText('Erro ao carregar o painel de administração.')).not.toBeInTheDocument();
        errorSpy.mockRestore();
    });
});
