import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

import { reportApiFailure } from './apiFailure';
import { reportClientError } from '../../utils/errorMonitoring';

vi.mock('../../utils/errorMonitoring', () => ({
    reportClientError: vi.fn(),
}));

function buildAxiosError(
    url: string,
    code: string | undefined,
    status?: number,
): AxiosError {
    return {
        code,
        config: {
            url,
            method: 'get',
            timeout: 8000,
        } as InternalAxiosRequestConfig,
        response: status
            ? {
                status,
            }
            : undefined,
    } as AxiosError;
}

describe('reportApiFailure', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('does not report auth capability cold-start timeouts as fatal network errors', () => {
        const error = buildAxiosError('/auth/me', 'ECONNABORTED');

        reportApiFailure(error, error.config, 'request-1', undefined);

        expect(reportClientError).not.toHaveBeenCalled();
    });

    it('still reports non-auth network failures without a response', () => {
        const error = buildAxiosError('/nesh/search', 'ECONNABORTED');

        reportApiFailure(error, error.config, 'request-2', undefined);

        expect(reportClientError).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'network',
                path: '/nesh/search',
                requestId: 'request-2',
                message: 'API request failed before receiving a response',
            }),
        );
    });
});
