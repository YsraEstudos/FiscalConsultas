import axios from 'axios';

export function getApiErrorDetail(error: unknown): string | null {
    if (!axios.isAxiosError(error)) return null;
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    return typeof detail === 'string' ? detail : null;
}

export function isLanHostInDev(): boolean {
    if (!import.meta.env.DEV || typeof window === 'undefined') return false;
    const host = window.location.hostname;
    return host !== 'localhost' && host !== '127.0.0.1';
}
