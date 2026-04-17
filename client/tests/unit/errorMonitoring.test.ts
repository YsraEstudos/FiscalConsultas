import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    __resetErrorMonitoringForTests,
    __setClientErrorEndpointForTests,
    CLIENT_ERROR_EVENT_NAME,
    installGlobalErrorMonitoring,
    reportClientError,
    type ClientErrorReport,
} from '../../src/utils/errorMonitoring';

function collectReportedErrors() {
    const reportedErrors: ClientErrorReport[] = [];
    const handler = (event: Event) => {
        reportedErrors.push((event as CustomEvent<ClientErrorReport>).detail);
    };

    globalThis.addEventListener(CLIENT_ERROR_EVENT_NAME, handler as EventListener);

    return {
        reportedErrors,
        dispose: () => globalThis.removeEventListener(CLIENT_ERROR_EVENT_NAME, handler as EventListener),
    };
}

describe('errorMonitoring', () => {
    beforeEach(() => {
        __resetErrorMonitoringForTests();
    });

    afterEach(() => {
        __resetErrorMonitoringForTests();
    });

    it('emits a normalized client error report', () => {
        const { reportedErrors, dispose } = collectReportedErrors();

        try {
            const report = reportClientError({
                source: 'async-task',
                error: new Error('background failure'),
                context: 'refresh-history',
                handled: true,
            });

            expect(report).toEqual(
                expect.objectContaining({
                    source: 'async-task',
                    message: 'background failure',
                    context: 'refresh-history',
                    handled: true,
                    route: expect.any(String),
                }),
            );
            expect(reportedErrors).toEqual([
                expect.objectContaining({
                    source: 'async-task',
                    message: 'background failure',
                    context: 'refresh-history',
                    handled: true,
                }),
            ]);
        } finally {
            dispose();
        }
    });

    it('deduplicates repeated reports inside the time window', () => {
        const { reportedErrors, dispose } = collectReportedErrors();

        try {
            reportClientError({
                source: 'network',
                message: 'same failure',
                handled: true,
                path: '/api/status',
                statusCode: 500,
            });
            reportClientError({
                source: 'network',
                message: 'same failure',
                handled: true,
                path: '/api/status',
                statusCode: 500,
            });

            expect(reportedErrors).toHaveLength(1);
        } finally {
            dispose();
        }
    });

    it('falls back to fetch when sendBeacon rejects the payload queue', () => {
        __resetErrorMonitoringForTests();
        const sendBeaconMock = vi.fn().mockReturnValue(false);
        const fetchMock = vi.fn().mockResolvedValue(undefined);

        __setClientErrorEndpointForTests('/api/client-errors');
        vi.stubGlobal('navigator', { sendBeacon: sendBeaconMock } as Navigator);
        vi.stubGlobal('fetch', fetchMock);

        try {
            reportClientError({
                source: 'network',
                message: 'queue dropped',
                handled: true,
            });

            expect(sendBeaconMock).toHaveBeenCalledTimes(1);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/client-errors',
                expect.objectContaining({
                    method: 'POST',
                    keepalive: true,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: expect.stringContaining('"message":"queue dropped"'),
                }),
            );
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('captures window errors and unhandled promise rejections after installation', () => {
        const { reportedErrors, dispose } = collectReportedErrors();

        try {
            installGlobalErrorMonitoring();

            globalThis.dispatchEvent(
                new ErrorEvent('error', {
                    message: 'window exploded',
                    error: new Error('window exploded'),
                    filename: '/src/main.tsx',
                    lineno: 10,
                    colno: 3,
                }),
            );

            const rejectionEvent = new Event('unhandledrejection') as PromiseRejectionEvent;
            Object.defineProperty(rejectionEvent, 'reason', {
                configurable: true,
                value: new Error('promise exploded'),
            });
            globalThis.dispatchEvent(rejectionEvent);

            expect(reportedErrors).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        source: 'window-error',
                        message: 'window exploded',
                        handled: false,
                    }),
                    expect.objectContaining({
                        source: 'unhandled-rejection',
                        message: 'Unhandled promise rejection',
                        handled: false,
                    }),
                ]),
            );
        } finally {
            dispose();
        }
    });
});
