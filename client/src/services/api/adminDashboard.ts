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

const DASHBOARD_CACHE_TTL_MS = 30_000;

let dashboardCache: {
    data: AdminDashboardResponse;
    fetchedAt: number;
} | null = null;
let dashboardRequest: Promise<AdminDashboardResponse> | null = null;

function isDashboardCacheFresh(): boolean {
    return !!dashboardCache && Date.now() - dashboardCache.fetchedAt < DASHBOARD_CACHE_TTL_MS;
}

/**
 * Fire-and-forget: logs a search event for telemetry.
 * Silently ignores errors to never impact UX.
 */
export function logSearchEvent(data: SearchEventPayload): void {
    api.post('/admin/search-event', data).then(() => {
        dashboardCache = null;
    }).catch(() => {
        // Intentionally silent — telemetry must never block or toast errors
    });
}

export async function getAdminDashboard(forceRefresh = false): Promise<AdminDashboardResponse> {
    if (!forceRefresh && isDashboardCacheFresh() && dashboardCache) {
        return dashboardCache.data;
    }

    if (!forceRefresh && dashboardRequest) {
        return dashboardRequest;
    }

    dashboardRequest = fetchAdminDashboard();
    return dashboardRequest;
}

export function prefetchAdminDashboard(): void {
    if (isDashboardCacheFresh() || dashboardRequest) {
        return;
    }

    dashboardRequest = fetchAdminDashboard();
    dashboardRequest.catch(() => {
        // Prefetch is best effort; the mounted dashboard will surface load errors.
    });
}

async function fetchAdminDashboard(): Promise<AdminDashboardResponse> {
    try {
        const { data } = await api.get<AdminDashboardResponse>('/admin/dashboard');
        dashboardCache = {
            data,
            fetchedAt: Date.now(),
        };
        return data;
    } finally {
        dashboardRequest = null;
    }
}

export async function getDeviceHistory(fingerprint: string): Promise<DeviceHistoryResponse> {
    const { data } = await api.get<DeviceHistoryResponse>(
        `/admin/device/${encodeURIComponent(fingerprint)}/history`
    );
    return data;
}
