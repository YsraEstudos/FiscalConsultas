type ClientErrorSource =
    | 'error-boundary'
    | 'window-error'
    | 'unhandled-rejection'
    | 'network'
    | 'async-task';

type ClientErrorLevel = 'error' | 'warning';

export interface ClientErrorReport {
    source: ClientErrorSource;
    level: ClientErrorLevel;
    message: string;
    errorName?: string;
    stack?: string;
    componentStack?: string;
    boundaryName?: string;
    path?: string;
    requestId?: string;
    statusCode?: number;
    context?: string;
    metadata?: Record<string, unknown>;
    handled: boolean;
    route: string;
    timestamp: string;
    runtimeMode: string;
}

interface ReportClientErrorOptions {
    source: ClientErrorSource;
    error?: unknown;
    message?: string;
    level?: ClientErrorLevel;
    componentStack?: string;
    boundaryName?: string;
    path?: string;
    requestId?: string;
    statusCode?: number;
    context?: string;
    metadata?: Record<string, unknown>;
    handled?: boolean;
}

type MonitoringState = {
    installed: boolean;
    handleWindowError?: (event: Event) => void;
    handleUnhandledRejection?: (event: PromiseRejectionEvent) => void;
    recentFingerprints: Map<string, number>;
};

const CLIENT_ERROR_EVENT_NAME = 'nesh:error-report';
const CLIENT_ERROR_ENDPOINT = (import.meta.env.VITE_CLIENT_ERROR_ENDPOINT || '').trim();
const DEDUPE_WINDOW_MS = 3000;
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 4000;
const MAX_COMPONENT_STACK_LENGTH = 4000;
const IS_TEST = import.meta.env.MODE === 'test';
const MONITORING_STATE_KEY = '__neshErrorMonitoringState__';

type GlobalWithMonitoringState = typeof globalThis & {
    [MONITORING_STATE_KEY]?: MonitoringState;
};

function getMonitoringState(): MonitoringState {
    const globalWithState = globalThis as GlobalWithMonitoringState;

    if (!globalWithState[MONITORING_STATE_KEY]) {
        globalWithState[MONITORING_STATE_KEY] = {
            installed: false,
            recentFingerprints: new Map<string, number>(),
        };
    }

    return globalWithState[MONITORING_STATE_KEY]!;
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
    if (!value) return undefined;
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1)}…`;
}

function getCurrentRoute(): string {
    if (typeof globalThis.location === 'undefined') {
        return 'unknown';
    }

    return `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;
}

function getErrorDetails(error: unknown): {
    message: string;
    errorName?: string;
    stack?: string;
} {
    if (error instanceof Error) {
        return {
            message: error.message || error.name || 'Unexpected client error',
            errorName: error.name,
            stack: truncateText(error.stack, MAX_STACK_LENGTH),
        };
    }

    if (typeof error === 'string') {
        return { message: error };
    }

    if (typeof error === 'object' && error !== null) {
        try {
            const serialized = JSON.stringify(error);
            if (serialized && serialized !== '{}') {
                return { message: serialized };
            }
        } catch {
            // Ignore serialization failure and fall through to String conversion.
        }
    }

    return { message: String(error ?? 'Unexpected client error') };
}

function cleanupOldFingerprints(state: MonitoringState, nowMs: number) {
    for (const [fingerprint, timestamp] of state.recentFingerprints.entries()) {
        if ((nowMs - timestamp) > DEDUPE_WINDOW_MS) {
            state.recentFingerprints.delete(fingerprint);
        }
    }
}

function buildFingerprint(report: ClientErrorReport): string {
    return [
        report.source,
        report.level,
        report.message,
        report.boundaryName || '',
        report.path || '',
        report.statusCode || '',
        report.requestId || '',
        report.context || '',
    ].join('|');
}

function shouldSkipDuplicateReport(report: ClientErrorReport): boolean {
    const state = getMonitoringState();
    const nowMs = Date.now();
    cleanupOldFingerprints(state, nowMs);

    const fingerprint = buildFingerprint(report);
    const previousTimestamp = state.recentFingerprints.get(fingerprint);

    if (previousTimestamp && (nowMs - previousTimestamp) <= DEDUPE_WINDOW_MS) {
        return true;
    }

    state.recentFingerprints.set(fingerprint, nowMs);
    return false;
}

function emitClientErrorEvent(report: ClientErrorReport) {
    globalThis.dispatchEvent(
        new CustomEvent<ClientErrorReport>(CLIENT_ERROR_EVENT_NAME, {
            detail: report,
        }),
    );
}

function logClientError(report: ClientErrorReport) {
    if (IS_TEST) return;

    const method = report.level === 'warning' ? console.warn : console.error;
    method('[ClientError]', report);
}

function sendClientErrorToEndpoint(report: ClientErrorReport) {
    if (!CLIENT_ERROR_ENDPOINT) return;

    const payload = JSON.stringify(report);

    try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob([payload], { type: 'application/json' });
            navigator.sendBeacon(CLIENT_ERROR_ENDPOINT, blob);
            return;
        }
    } catch {
        // Fall back to fetch below.
    }

    if (typeof fetch !== 'function') return;

    void fetch(CLIENT_ERROR_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: payload,
        keepalive: true,
    }).catch(() => {
        // Observability transport should never break the app flow.
    });
}

export function reportClientError(options: ReportClientErrorOptions): ClientErrorReport | null {
    const details = getErrorDetails(options.error);
    const message = truncateText(
        options.message || details.message || 'Unexpected client error',
        MAX_MESSAGE_LENGTH,
    )!;

    const report: ClientErrorReport = {
        source: options.source,
        level: options.level || 'error',
        message,
        errorName: details.errorName,
        stack: details.stack,
        componentStack: truncateText(options.componentStack, MAX_COMPONENT_STACK_LENGTH),
        boundaryName: options.boundaryName,
        path: options.path,
        requestId: options.requestId,
        statusCode: options.statusCode,
        context: options.context,
        metadata: options.metadata,
        handled: options.handled ?? false,
        route: getCurrentRoute(),
        timestamp: new Date().toISOString(),
        runtimeMode: import.meta.env.MODE,
    };

    if (shouldSkipDuplicateReport(report)) {
        return null;
    }

    emitClientErrorEvent(report);
    logClientError(report);
    sendClientErrorToEndpoint(report);

    return report;
}

function handleWindowError(event: Event) {
    if (event instanceof ErrorEvent) {
        reportClientError({
            source: 'window-error',
            error: event.error ?? event.message,
            message: event.message || 'Unhandled window error',
            handled: false,
            metadata: {
                filename: event.filename,
                line: event.lineno,
                column: event.colno,
            },
        });
        return;
    }

    const eventTarget = event.target;
    const targetDetails = eventTarget instanceof Element
        ? {
            tagName: eventTarget.tagName,
            source: eventTarget.getAttribute('src') || eventTarget.getAttribute('href') || undefined,
        }
        : undefined;

    reportClientError({
        source: 'window-error',
        message: 'Resource failed to load in the browser',
        handled: false,
        metadata: targetDetails,
    });
}

function handleUnhandledRejection(event: PromiseRejectionEvent) {
    reportClientError({
        source: 'unhandled-rejection',
        error: event.reason,
        message: 'Unhandled promise rejection',
        handled: false,
    });
}

export function installGlobalErrorMonitoring() {
    const state = getMonitoringState();
    if (state.installed) return;

    state.handleWindowError = handleWindowError;
    state.handleUnhandledRejection = handleUnhandledRejection;
    globalThis.addEventListener('error', state.handleWindowError, true);
    globalThis.addEventListener('unhandledrejection', state.handleUnhandledRejection);
    state.installed = true;
}

export function __resetErrorMonitoringForTests() {
    const state = getMonitoringState();

    if (state.handleWindowError) {
        globalThis.removeEventListener('error', state.handleWindowError, true);
    }
    if (state.handleUnhandledRejection) {
        globalThis.removeEventListener('unhandledrejection', state.handleUnhandledRejection);
    }

    state.handleWindowError = undefined;
    state.handleUnhandledRejection = undefined;
    state.recentFingerprints.clear();
    state.installed = false;
}

export { CLIENT_ERROR_EVENT_NAME };
