import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

import { reportClientError } from '../../utils/errorMonitoring';
import { getRequestPath, normalizeRequestPath } from './authLogging';

function isCanceledRequestError(error: AxiosError | Error | unknown): boolean {
    if (axios.isCancel(error)) {
        return true;
    }

    const candidate = error as { code?: unknown; name?: unknown } | null;
    return candidate?.code === 'ERR_CANCELED' || candidate?.name === 'CanceledError';
}

function shouldReportApiFailure(status: number | undefined, error: AxiosError): boolean {
    if (isCanceledRequestError(error)) {
        return false;
    }

    if (typeof status === 'number') {
        return status >= 500;
    }

    return !error.response;
}

export function reportApiFailure(
    error: AxiosError,
    originalRequest: InternalAxiosRequestConfig | undefined,
    requestId: string | undefined,
    status: number | undefined,
): void {
    if (!shouldReportApiFailure(status, error)) {
        return;
    }

    const rawPath = getRequestPath(originalRequest?.url);
    const normalizedPath = rawPath ? normalizeRequestPath(rawPath) : undefined;
    const method = originalRequest?.method?.toUpperCase?.();

    reportClientError({
        source: 'network',
        error,
        handled: true,
        path: normalizedPath,
        requestId,
        statusCode: status,
        context: 'axios',
        message: status
            ? `API request failed with status ${status}`
            : 'API request failed before receiving a response',
        metadata: {
            method,
            code: error.code,
            timeoutMs: originalRequest?.timeout,
        },
    });
}
