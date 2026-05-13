/**
 * Debug utility — delegates to the global console for allowed support users.
 *
 * In test mode all calls are suppressed to avoid noise in unit-test output.
 */
const IS_TEST = import.meta.env.MODE === 'test';
const noop = () => { };
const DEBUG_LOG_EMAIL = 'israelsena2@gmail.com';
const DEBUG_LOG_FLAG = '__FISCAL_APP_DEBUG_LOGS__';

type DebugGlobal = typeof globalThis & {
    [DEBUG_LOG_FLAG]?: boolean;
};

function getDebugGlobal(): DebugGlobal {
    return globalThis as DebugGlobal;
}

export function setAppDebugLoggingUser(email: string | null | undefined): void {
    getDebugGlobal()[DEBUG_LOG_FLAG] = canUseAppDebugLogging(email);
}

export function canUseAppDebugLogging(email: string | null | undefined): boolean {
    return String(email || '').trim().toLowerCase() === DEBUG_LOG_EMAIL;
}

export function isAppDebugLoggingEnabled(): boolean {
    return !IS_TEST && getDebugGlobal()[DEBUG_LOG_FLAG] === true;
}

function log(...args: unknown[]): void {
    if (isAppDebugLoggingEnabled()) {
        console.debug(...args);
    }
}

export const debug = {
    log: IS_TEST ? noop : log,
    error: IS_TEST ? noop : console.error.bind(console),
    warn: IS_TEST ? noop : console.warn.bind(console),
    info: IS_TEST ? noop : log,
};

export default debug;
