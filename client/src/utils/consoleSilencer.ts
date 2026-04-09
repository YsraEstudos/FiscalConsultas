/**
 * consoleSilencer.ts
 *
 * Silences ALL console output for non-admin users in production.
 *
 * Strategy (two-phase):
 *  1. IMMEDIATE (module load): In production, replace all console methods
 *     with no-ops. This takes effect before Clerk, React, or any other
 *     library initialises.
 *  2. ACTIVATION: Once Clerk resolves the authenticated user, AuthContext
 *     calls `activateConsoleForAdmin(email)`. If the email matches the
 *     configured admin email the original console methods are restored.
 *
 * In development (`import.meta.env.DEV === true`) the console is never
 * touched — full debug output is always available.
 *
 * Email is baked in at build time via the VITE_ADMIN_EMAIL env variable so
 * it is never exposed as a runtime-queryable value by normal users.
 */

const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || '').trim().toLowerCase();

const METHODS = [
    'assert',
    'clear',
    'count',
    'countReset',
    'debug',
    'dir',
    'dirxml',
    'error',
    'group',
    'groupCollapsed',
    'groupEnd',
    'info',
    'log',
    'profile',
    'profileEnd',
    'table',
    'time',
    'timeEnd',
    'timeLog',
    'timeStamp',
    'trace',
    'warn',
] as const;

type ConsoleMethod = typeof METHODS[number];

// Capture originals BEFORE any third-party library can patch them.
const originals: Record<ConsoleMethod, (...args: unknown[]) => void> = {} as Record<
    ConsoleMethod,
    (...args: unknown[]) => void
>;

for (const method of METHODS) {
    const fn = console[method as keyof Console] as unknown;
    // NOSONAR
    originals[method] = (typeof fn === 'function' ? (fn as Function).bind(console) : () => { }) as (
        ...args: unknown[]
    ) => void;
}

const noop = () => { };

// ── Phase 1: Immediate silencing in production ────────────────────────────────
if (!import.meta.env.DEV) {
    for (const method of METHODS) {
        (console as unknown as Record<string, unknown>)[method] = noop;
    }
}

// ── Phase 2: Restore for the admin user ──────────────────────────────────────

/**
 * Call this once Clerk has resolved the authenticated user's email.
 * If the email matches VITE_ADMIN_EMAIL the full console is restored;
 * otherwise the no-op state is kept (or applied if somehow not yet set).
 */
export function activateConsoleForAdmin(email: string | null | undefined): void {
    if (import.meta.env.DEV) {
        // In dev, console is always active — nothing to do.
        return;
    }

    const normalizedEmail = (email || '').trim().toLowerCase();
    const isAdmin = Boolean(ADMIN_EMAIL) && normalizedEmail === ADMIN_EMAIL;

    if (isAdmin) {
        // Restore every console method to the saved original.
        for (const method of METHODS) {
            (console as unknown as Record<string, unknown>)[method] = originals[method];
        }
        // Use the original info directly so the message always appears.
        originals.info('[ConsoleSilencer] Admin session detected — full console restored.');
    } else {
        // Ensure the no-ops are applied (defensive, in case something restored them).
        for (const method of METHODS) {
            (console as unknown as Record<string, unknown>)[method] = noop;
        }
    }
}

// ── Test / cleanup helpers ────────────────────────────────────────────────────

/**
 * Restores the original console methods unconditionally.
 * Intended for use in test teardown only.
 */
export function restoreConsole(): void {
    for (const method of METHODS) {
        (console as unknown as Record<string, unknown>)[method] = originals[method];
    }
}

/**
 * Returns the captured original console methods.
 * Useful when you need to log inside a context where the console may be
 * silenced (e.g. the consoleSilencer itself).
 */
export const originalConsole: Readonly<
    Record<ConsoleMethod, (...args: unknown[]) => void>
> = originals;
