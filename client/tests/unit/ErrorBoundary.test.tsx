import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import {
    __resetErrorMonitoringForTests,
    CLIENT_ERROR_EVENT_NAME,
    type ClientErrorReport,
} from '../../src/utils/errorMonitoring';

function ThrowingChild({ shouldThrow }: Readonly<{ shouldThrow: boolean }>) {
    if (shouldThrow) {
        throw new Error('boom');
    }

    return <div data-testid="healthy-child">ok</div>;
}

describe('ErrorBoundary', () => {
    beforeEach(() => {
        __resetErrorMonitoringForTests();
    });

    afterEach(() => {
        __resetErrorMonitoringForTests();
    });

    it('renders children while there is no error', () => {
        render(
            <ErrorBoundary
                boundaryName="test-boundary"
                title="Fallback title"
                description="Fallback description"
            >
                <ThrowingChild shouldThrow={false} />
            </ErrorBoundary>,
        );

        expect(screen.getByTestId('healthy-child')).toBeInTheDocument();
    });

    it('shows a friendly fallback when a child throws and can retry', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onRetry = vi.fn();
        let shouldThrow = true;
        const reportedErrors: ClientErrorReport[] = [];
        const handleClientError = (event: Event) => {
            reportedErrors.push((event as CustomEvent<ClientErrorReport>).detail);
        };

        globalThis.addEventListener(CLIENT_ERROR_EVENT_NAME, handleClientError as EventListener);

        try {
            const { rerender } = render(
                <ErrorBoundary
                    boundaryName="test-boundary"
                    title="Fallback title"
                    description="Fallback description"
                    onRetry={onRetry}
                >
                    <ThrowingChild shouldThrow={shouldThrow} />
                </ErrorBoundary>,
            );

            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByText('Fallback title')).toBeInTheDocument();
            expect(screen.getByText('Fallback description')).toBeInTheDocument();
            expect(reportedErrors).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        source: 'error-boundary',
                        boundaryName: 'test-boundary',
                        handled: true,
                        message: 'boom',
                    }),
                ]),
            );

            shouldThrow = false;
            rerender(
                <ErrorBoundary
                    boundaryName="test-boundary"
                    title="Fallback title"
                    description="Fallback description"
                    onRetry={onRetry}
                >
                    <ThrowingChild shouldThrow={shouldThrow} />
                </ErrorBoundary>,
            );

            fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

            expect(onRetry).toHaveBeenCalledTimes(1);
            expect(screen.getByTestId('healthy-child')).toBeInTheDocument();
        } finally {
            globalThis.removeEventListener(CLIENT_ERROR_EVENT_NAME, handleClientError as EventListener);
            consoleErrorSpy.mockRestore();
        }
    });

    it('automatically resets when resetKeys change', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { rerender } = render(
            <ErrorBoundary
                boundaryName="reset-boundary"
                title="Falhou"
                description="Descricao"
                resetKeys={['first']}
            >
                <ThrowingChild shouldThrow={true} />
            </ErrorBoundary>,
        );

        expect(screen.getByRole('alert')).toBeInTheDocument();

        rerender(
            <ErrorBoundary
                boundaryName="reset-boundary"
                title="Falhou"
                description="Descricao"
                resetKeys={['second']}
            >
                <ThrowingChild shouldThrow={false} />
            </ErrorBoundary>,
        );

        expect(screen.getByTestId('healthy-child')).toBeInTheDocument();
        consoleErrorSpy.mockRestore();
    });
});
