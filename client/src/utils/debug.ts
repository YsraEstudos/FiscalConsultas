/**
 * Debug utility — delegates to the global console for allowed support users.
 */
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
    return getDebugGlobal()[DEBUG_LOG_FLAG] === true;
}

function log(...args: unknown[]): void {
    if (isAppDebugLoggingEnabled()) {
        console.log(...args);
    }
}

export const debug = {
    log,
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: log,
};

export default debug;
