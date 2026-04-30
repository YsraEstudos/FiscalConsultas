import type {
    AuthSessionResponse,
    GlossaryTermApiResponse,
    SystemStatusResponse,
} from '../../types/api.types';

import {
    api,
    AUTH_SESSION_TIMEOUT_MS,
    SYSTEM_STATUS_TIMEOUT_MS,
    withDevCacheBust,
} from './httpClient';

export const getGlossaryTerm = async (term: string): Promise<GlossaryTermApiResponse> => {
    const response = await api.get<GlossaryTermApiResponse>(
        withDevCacheBust(`/glossary?term=${encodeURIComponent(term)}`),
    );
    return response.data;
};

export const getSystemStatus = async (): Promise<SystemStatusResponse> => {
    const response = await api.get<SystemStatusResponse>(
        withDevCacheBust('/status'),
        { timeout: SYSTEM_STATUS_TIMEOUT_MS },
    );
    return response.data;
};

export const getAuthSession = async (): Promise<AuthSessionResponse> => {
    const response = await api.get<AuthSessionResponse>(
        withDevCacheBust('/auth/me'),
        { timeout: AUTH_SESSION_TIMEOUT_MS },
    );
    return response.data;
};
