import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    canUseAppDebugLogging,
    debug,
    isAppDebugLoggingEnabled,
    setAppDebugLoggingUser,
} from './debug';

describe('debug logging access', () => {
    afterEach(() => {
        setAppDebugLoggingUser(null);
        vi.restoreAllMocks();
    });

    it('allows app debug logs only for the support email', () => {
        expect(canUseAppDebugLogging('other@example.com')).toBe(false);
        expect(canUseAppDebugLogging(' israelsena2@gmail.com ')).toBe(true);
        expect(canUseAppDebugLogging('ISRAELSENA2@GMAIL.COM')).toBe(true);
    });

    it('does not write debug logs in test mode', () => {
        const consoleDebug = vi
            .spyOn(console, 'debug')
            .mockImplementation(() => undefined);

        setAppDebugLoggingUser('israelsena2@gmail.com');
        debug.log('[Sidebar] Rendering with results keys:', 1);

        expect(isAppDebugLoggingEnabled()).toBe(false);
        expect(consoleDebug).not.toHaveBeenCalled();
    });
});
