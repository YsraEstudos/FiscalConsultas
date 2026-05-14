/**
 * Admin Dashboard API functions.
 *
 * - logSearchEvent: fire-and-forget telemetry after each search
 * - getAdminDashboard: admin-only overview
 * - getDeviceHistory: admin-only device drill-down
 */
import { api } from './httpClient';
import type {
    AdminDashboardResponse,
    DeviceHistoryResponse,
    SearchEventPayload,
} from '../../types/apiAdmin.types';

/**
 * Fire-and-forget: logs a search event for telemetry.
 * Silently ignores errors to never impact UX.
 */
export function logSearchEvent(data: SearchEventPayload): void {
    api.post('/admin/search-event', data).catch(() => {
        // Intentionally silent — telemetry must never block or toast errors
    });
}

export async function getAdminDashboard(): Promise<AdminDashboardResponse> {
    const { data } = await api.get<AdminDashboardResponse>('/admin/dashboard');
    return data;
}

export async function getDeviceHistory(fingerprint: string): Promise<DeviceHistoryResponse> {
    const { data } = await api.get<DeviceHistoryResponse>(
        `/admin/device/${encodeURIComponent(fingerprint)}/history`
    );
    return data;
}
