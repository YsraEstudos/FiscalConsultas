import { debug } from './debug';

type LongTaskSummary = {
    count: number;
    p95: number;
    max: number;
    total: number;
};

const WINDOW_MS = 10_000;
const MIN_LOG_DURATION_MS = 50;

let started = false;

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
}

function summarize(durations: number[]): LongTaskSummary {
    if (durations.length === 0) {
        return { count: 0, p95: 0, max: 0, total: 0 };
    }
    const total = durations.reduce((sum, value) => sum + value, 0);
    return {
        count: durations.length,
        p95: percentile(durations, 95),
        max: Math.max(...durations),
        total
    };
}

/**
 * Starts a lightweight long-task observer in DEV builds.
 * Helps identify main-thread stalls (`scheduler message handler took ...`).
 */
export function startPerformanceObserver(): () => void {
    if (started) return () => { };
    if (!import.meta.env.DEV) return () => { };
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return () => { };

    started = true;
    const durations: number[] = [];

    const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            const duration = entry.duration || 0;
            if (duration >= MIN_LOG_DURATION_MS) {
                durations.push(duration);
            }
        }
    });

    try {
        observer.observe({ entryTypes: ['longtask'] });
    } catch {
        started = false;
        return () => { };
    }

    const intervalId = window.setInterval(() => {
        if (durations.length === 0) return;
        const snapshot = summarize(durations);
        durations.length = 0;
        debug.warn(
            `[Perf][LongTask] window=${WINDOW_MS}ms count=${snapshot.count} p95=${snapshot.p95.toFixed(0)}ms max=${snapshot.max.toFixed(0)}ms total=${snapshot.total.toFixed(0)}ms`
        );
    }, WINDOW_MS);

    return () => {
        window.clearInterval(intervalId);
        observer.disconnect();
        durations.length = 0;
        started = false;
    };
}
