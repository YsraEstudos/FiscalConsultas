import axios from 'axios';

import type { SystemStatusResponse } from '../types/api.types';
import { getApiErrorDetail, isLanHostInDev } from './apiError';

export type ServiceCatalogDoc = 'nbs' | 'nebs';
export type ServiceCatalogAvailability = 'online' | 'offline' | 'unknown';

export interface ServiceCatalogSnapshot {
    availability: ServiceCatalogAvailability;
    checkedAt: number | null;
    message: string | null;
}

export const SERVICE_CATALOG_STATUS_TTL_MS = 30_000;

export const UNKNOWN_SERVICE_CATALOG_SNAPSHOT: ServiceCatalogSnapshot = {
    availability: 'unknown',
    checkedAt: null,
    message: null,
};

function getCatalogStatus(
    status: SystemStatusResponse | null | undefined,
    key: ServiceCatalogDoc,
): ServiceCatalogAvailability {
    const direct = status?.[key]?.status;
    if (direct === 'online' || direct === 'error') {
        return direct === 'online' ? 'online' : 'offline';
    }

    const nested = status?.catalogs?.[key]?.status;
    if (nested === 'online' || nested === 'error') {
        return nested === 'online' ? 'online' : 'offline';
    }

    return 'unknown';
}

export function getServicesCatalogOfflineMessage(
    status: SystemStatusResponse | null | undefined,
): string {
    const nbsStatus = getCatalogStatus(status, 'nbs');
    const nebsStatus = getCatalogStatus(status, 'nebs');

    if (nbsStatus === 'offline' && nebsStatus === 'offline') {
        return 'Catálogo NBS/NEBS indisponível no momento.';
    }

    if (nbsStatus === 'offline') {
        return 'Catálogo NBS indisponível no momento.';
    }

    if (nebsStatus === 'offline') {
        return 'Catálogo NEBS indisponível no momento.';
    }

    return 'Catálogo de serviços indisponível no momento.';
}

export function buildServiceCatalogSnapshot(
    status: SystemStatusResponse | null | undefined,
): ServiceCatalogSnapshot {
    const nbsStatus = getCatalogStatus(status, 'nbs');
    const nebsStatus = getCatalogStatus(status, 'nebs');

    if (nbsStatus === 'online' && nebsStatus === 'online') {
        return {
            availability: 'online',
            checkedAt: Date.now(),
            message: null,
        };
    }

    if (nbsStatus === 'offline' || nebsStatus === 'offline') {
        return {
            availability: 'offline',
            checkedAt: Date.now(),
            message: getServicesCatalogOfflineMessage(status),
        };
    }

    return {
        ...UNKNOWN_SERVICE_CATALOG_SNAPSHOT,
        checkedAt: Date.now(),
    };
}

export function isServiceCatalogDoc(doc: string): doc is ServiceCatalogDoc {
    return doc === 'nbs' || doc === 'nebs';
}

export function getServiceCatalogErrorMessage(
    error: unknown,
    doc: ServiceCatalogDoc,
): string {
    const fallback = doc === 'nbs'
        ? 'Erro ao carregar o catálogo NBS.'
        : 'Erro ao carregar o catálogo NEBS.';
    const detail = getApiErrorDetail(error);

    if (axios.isAxiosError(error)) {
        const status = error.response?.status;

        if (status === 401) {
            if (detail === 'Token ausente') {
                if (isLanHostInDev()) {
                    return 'Token do Clerk indisponível neste host de rede. Abra em http://localhost:5173 para acessar o catálogo de serviços.';
                }
                return 'Faça login para acessar o catálogo de serviços.';
            }

            if (detail?.startsWith('Token inválido ou expirado')) {
                return 'Sua sessão expirou. Faça login novamente para acessar o catálogo de serviços.';
            }

            return 'Sua sessão expirou. Faça login novamente para acessar o catálogo de serviços.';
        }

        if (status === 429) {
            return 'Muitas tentativas no catálogo de serviços. Aguarde um instante e tente novamente.';
        }

        if (status != null && status >= 500) {
            return 'Catálogo de serviços indisponível no momento. Tente novamente em instantes.';
        }

        if (error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK') {
            return 'Catálogo de serviços indisponível no momento. Tente novamente em instantes.';
        }
    }

    return fallback;
}
