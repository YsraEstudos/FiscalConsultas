/**
 * API types for the Admin Dashboard feature.
 */

export interface DeviceSummary {
    fingerprint: string;
    label: string | null;
    user_email: string | null;
    user_id: string | null;
    last_active: string;
    is_active: boolean;
    searches_today: number;
    total_searches: number;
}

export interface AdminDashboardResponse {
    total_active_devices: number;
    total_searches_today: number;
    searches_by_type: Record<string, number>;
    devices: DeviceSummary[];
}

export interface DailyStats {
    date: string;
    nesh: number;
    tipi: number;
    nbs: number;
    text: number;
    total: number;
}

export interface RecentSearch {
    query: string | null;
    type: string;
    at: string;
}

export interface DeviceHistoryResponse {
    device: DeviceSummary;
    daily_stats: DailyStats[];
    recent_searches: RecentSearch[];
}

export interface SearchEventPayload {
    search_type: string;
    search_query: string;
    device_fingerprint: string;
    device_label: string;
}
