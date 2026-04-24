import axios from 'axios';
import type {
    AxiosError,
    AxiosInstance,
    InternalAxiosRequestConfig,
} from 'axios';

import { reportClientError } from '../../utils/errorMonitoring';
import { reportApiFailure } from './apiFailure';
import {
    getRequestPath,
    getOrCreateRequestId,
    getResponseRequestId,
    isPublicRoutePath,
    logRequestPrepared,
    logUnauthorizedResponse,
    normalizeRequestPath,
    REQUEST_ID_HEADER,
} from './authLogging';
import {
    attachAuthorizationHeader,
    isAuthGetterRegistered,
    retryUnauthorizedRequest,
    shouldAuthenticateRequest,
    shouldRetryUnauthorizedRequest,
} from './authSession';
import type { AuthRefreshMode, AuthRetryRequestConfig } from './authTypes';

const configuredApiInstances = new WeakSet<AxiosInstance>();
export { registerClerkTokenGetter, unregisterClerkTokenGetter } from './authSession';

export function configureApiAuthTransport(apiInstance: AxiosInstance): void {
    if (configuredApiInstances.has(apiInstance)) {
        return;
    }

    configuredApiInstances.add(apiInstance);

    apiInstance.interceptors.request.use(
        async (config: InternalAxiosRequestConfig) => {
            const normalizedPath = normalizeRequestPath(getRequestPath(config.url));
            const isPublicRoute = isPublicRoutePath(normalizedPath);
            const requestId = getOrCreateRequestId();

            config.headers.set(REQUEST_ID_HEADER, requestId);
            logRequestPrepared(
                requestId,
                normalizedPath,
                isPublicRoute,
                isAuthGetterRegistered(),
            );

            if (shouldAuthenticateRequest(isPublicRoute)) {
                await attachAuthorizationHeader(config, normalizedPath, requestId);
            }
            return config;
        },
        async (error: AxiosError) => {
            const axiosMetadata = axios.isAxiosError(error)
                ? {
                    code: error.code,
                    timeoutMs: error.config?.timeout,
                }
                : undefined;

            reportClientError({
                source: 'network',
                error,
                handled: true,
                context: 'axios-request-interceptor',
                message: error instanceof Error ? error.message : 'API request could not be prepared',
                metadata: axiosMetadata,
            });
            throw error;
        },
    );

    apiInstance.interceptors.response.use(
        (response) => response,
        async (error: AxiosError) => {
            const status = error.response?.status;
            const originalRequest = error.config as AuthRetryRequestConfig | undefined;
            const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
            const detailText = typeof detail === 'string' ? detail : undefined;
            const requestId = getResponseRequestId(originalRequest);
            let refreshAttempt: 'skipped' | 'attempted' = 'skipped';
            let refreshMode: AuthRefreshMode = 'not_applicable';

            if (shouldRetryUnauthorizedRequest(status, originalRequest, detailText)) {
                const retryResult = await retryUnauthorizedRequest(
                    apiInstance,
                    originalRequest,
                    detailText,
                    requestId,
                );
                refreshAttempt = retryResult.refreshAttempt;
                refreshMode = retryResult.refreshMode;
                if (retryResult.response) {
                    return retryResult.response;
                }
            }

            logUnauthorizedResponse(
                status,
                originalRequest?.url,
                requestId,
                detailText,
                refreshAttempt,
                refreshMode,
            );
            reportApiFailure(error, originalRequest, requestId, status);
            throw error;
        },
    );
}
