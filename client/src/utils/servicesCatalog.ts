import axios from 'axios';

import type { SystemStatusResponse } from '../types/api.types';

export type ServiceCatalogDoc = 'nbs' | 'nebs';
export type ServiceCatalogAvailability = 'online' | 'offline' | 'unknown';

export interface ServiceCatalogSnapshot {
    availability: ServiceCatalogAvailability;
    checkedAt: number | null;
    message: string | null;
}

export interface ServiceCatalogErrorInfo {
    message: string;
    status: number | null;
    requestId: string | null;
    detail: string | null;
}

export const SERVICE_CATALOG_STATUS_TTL_MS = 30_000;

export const UNKNOWN_SERVICE_CATALOG_SNAPSHOT: ServiceCatalogSnapshot = {
    availability: 'unknown',
    checkedAt: null,
    message: null,
};

function appendSupportRequestId(message: string, requestId: string | null): string {
    if (!requestId) return message;
    return `${message} Codigo de suporte: ${requestId}.`;
}

function getResponseHeaderValue(headers: unknown, headerName: string): string | null {
    if (!headers) return null;

    if (typeof headers === 'object' && headers !== null) {
        const getter = (headers as { get?: (name: string) => unknown }).get;
        if (typeof getter === 'function') {
            const value = getter.call(headers, headerName);
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }

        const record = headers as Record<string, unknown>;
        const candidates = [
            headerName,
            headerName.toLowerCase(),
            headerName.toUpperCase(),
        ];
        for (const candidate of candidates) {
            const value = record[candidate];
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
    }

    return null;
}

function getAxiosErrorDetail(error: unknown): string | null {
    if (!axios.isAxiosError(error)) return null;
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    return typeof detail === 'string' && detail.trim() ? detail.trim() : null;
}

function getAxiosErrorRequestUrl(error: unknown): string | null {
    if (!axios.isAxiosError(error)) return null;
    const url = error.config?.url;
    return typeof url === 'string' && url.trim() ? url.trim() : null;
}

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

export function getServiceCatalogErrorInfo(
    error: unknown,
    doc: ServiceCatalogDoc,
): ServiceCatalogErrorInfo {
    const fallback = doc === 'nbs'
        ? 'Erro ao carregar o catálogo NBS.'
        : 'Erro ao carregar o catálogo NEBS.';

    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const requestId = getResponseHeaderValue(error.response?.headers, 'x-request-id');
        const detail = getAxiosErrorDetail(error);

        if (status === 429) {
            return {
                message: appendSupportRequestId(
                    'Muitas tentativas no catálogo de serviços. Aguarde um instante e tente novamente.',
                    requestId,
                ),
                status,
                requestId,
                detail,
            };
        }

        if (status === 401 || status === 403) {
            return {
                message: appendSupportRequestId(
                    'Catálogo de serviços indisponível no momento. Tente novamente em instantes.',
                    requestId,
                ),
                status,
                requestId,
                detail,
            };
        }

        if (status != null && status >= 500) {
            return {
                message: appendSupportRequestId(
                    'Catálogo de serviços indisponível no momento. Tente novamente em instantes.',
                    requestId,
                ),
                status,
                requestId,
                detail,
            };
        }

        if (error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK') {
            return {
                message: appendSupportRequestId(
                    'Catálogo de serviços indisponível no momento. Tente novamente em instantes.',
                    requestId,
                ),
                status: status ?? null,
                requestId,
                detail,
            };
        }
    }

    return {
        message: fallback,
        status: null,
        requestId: null,
        detail: null,
    };
}

export function getServiceCatalogErrorMessage(
    error: unknown,
    doc: ServiceCatalogDoc,
): string {
    return getServiceCatalogErrorInfo(error, doc).message;
}

export function reportServiceCatalogError(
    error: unknown,
    doc: ServiceCatalogDoc,
    resolved: ServiceCatalogErrorInfo = getServiceCatalogErrorInfo(error, doc),
): void {
    if (!axios.isAxiosError(error) || !import.meta.env.DEV) return;

    const requestUrl = getAxiosErrorRequestUrl(error) || 'unknown';
    if (resolved.status === 401 || resolved.status === 403) {
        console.warn('[servicesCatalog] Public catalog route failed', {
            doc,
            status: resolved.status,
            requestId: resolved.requestId,
            detail: resolved.detail,
            url: requestUrl,
        });
        return;
    }

    if (!resolved.requestId) return;

    console.warn('[servicesCatalog] Catalog request failed', {
        doc,
        status: resolved.status,
        requestId: resolved.requestId,
        detail: resolved.detail,
        url: requestUrl,
    });
}
