import axios from 'axios';

const rawBaseUrl = import.meta.env.VITE_API_FILTER_URL || import.meta.env.VITE_API_URL || '/api';

const normalizeApiUrl = (base: string) => {
    const trimmed = base.replace(/\/$/, '');

    if (trimmed === '/api' || trimmed.startsWith('/api/')) {
        return trimmed;
    }

    if (/^https?:\/\//i.test(trimmed)) {
        if (trimmed.endsWith('/api')) return trimmed;
        if (trimmed.endsWith('/api/')) return trimmed.slice(0, -1);
        return `${trimmed}/api`;
    }

    return trimmed;
};

const API_URL = normalizeApiUrl(rawBaseUrl);

export const api = axios.create({
    baseURL: API_URL,
    timeout: 20000,
});

export const searchNCM = async (query: string): Promise<any> => {
    const response = await api.get(`/search?ncm=${encodeURIComponent(query)}`);
    return response.data;
};

export const searchTipi = async (query: string, viewMode: 'chapter' | 'family' = 'family'): Promise<any> => {
    const response = await api.get(`/tipi/search?ncm=${encodeURIComponent(query)}&view_mode=${viewMode}`);
    return response.data;
};

export const getGlossaryTerm = async (term: string): Promise<any> => {
    const response = await api.get(`/glossary?term=${encodeURIComponent(term)}`);
    return response.data;
};

export const getSystemStatus = async (): Promise<any> => {
    const response = await api.get('/status');
    return response.data;
};
