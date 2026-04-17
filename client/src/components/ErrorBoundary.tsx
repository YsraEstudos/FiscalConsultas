import React, { type ErrorInfo, type ReactNode } from 'react';

import styles from './ErrorBoundary.module.css';
import { reportClientError } from '../utils/errorMonitoring';

type ErrorBoundaryVariant = 'full-screen' | 'panel';

interface ErrorBoundaryProps {
    children: ReactNode;
    boundaryName: string;
    title: string;
    description: string;
    variant?: ErrorBoundaryVariant;
    resetKeys?: readonly unknown[];
    onRetry?: () => void;
}

interface ErrorBoundaryState {
    error: Error | null;
}

function areResetKeysEqual(
    previousKeys: readonly unknown[] = [],
    nextKeys: readonly unknown[] = [],
): boolean {
    if (previousKeys.length !== nextKeys.length) return false;

    for (let index = 0; index < previousKeys.length; index += 1) {
        if (!Object.is(previousKeys[index], nextKeys[index])) {
            return false;
        }
    }

    return true;
}

function logBoundaryError(boundaryName: string, error: Error, errorInfo: ErrorInfo) {
    reportClientError({
        source: 'error-boundary',
        error,
        boundaryName,
        componentStack: errorInfo.componentStack || undefined,
        handled: true,
        message: error.message || `UI boundary "${boundaryName}" captured an error`,
    });
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = {
        error: null,
    };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        logBoundaryError(this.props.boundaryName, error, errorInfo);
    }

    componentDidUpdate(previousProps: ErrorBoundaryProps) {
        if (!this.state.error) return;

        if (!areResetKeysEqual(previousProps.resetKeys, this.props.resetKeys)) {
            this.resetBoundary();
        }
    }

    resetBoundary = () => {
        this.setState({ error: null });
        this.props.onRetry?.();
    };

    reloadPage = () => {
        globalThis.location.reload();
    };

    render() {
        if (!this.state.error) {
            return this.props.children;
        }

        const variantClassName = this.props.variant === 'full-screen' ? styles.fullScreen : styles.panel;

        return (
            <section className={`${styles.fallback} ${variantClassName}`} role="alert" aria-live="assertive">
                <div className={styles.icon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                </div>
                <h2 className={styles.title}>{this.props.title}</h2>
                <p className={styles.description}>{this.props.description}</p>
                <p className={styles.meta}>Se o problema persistir, tente recarregar a tela ou repetir a ação.</p>
                <div className={styles.actions}>
                    <button type="button" className={styles.primaryAction} onClick={this.resetBoundary}>
                        Tentar novamente
                    </button>
                    {this.props.variant === 'full-screen' && (
                        <button type="button" className={styles.secondaryAction} onClick={this.reloadPage}>
                            Recarregar página
                        </button>
                    )}
                </div>
            </section>
        );
    }
}
