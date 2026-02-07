import React from 'react';
import { expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

vi.mock('@clerk/clerk-react', () => ({
    ClerkProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    SignedIn: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    SignedOut: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    SignInButton: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    SignUpButton: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    UserButton: () => null,
    OrganizationSwitcher: () => null,
    SignIn: () => null,
    useClerk: () => ({ signOut: vi.fn() }),
    useUser: () => ({
        user: {
            id: 'user_test',
            fullName: 'Test User',
            firstName: 'Test',
            primaryEmailAddress: { emailAddress: 'test@example.com' },
            imageUrl: '',
        },
        isSignedIn: true,
        isLoaded: true,
    }),
    useAuth: () => ({
        getToken: vi.fn().mockResolvedValue('test_token'),
        signOut: vi.fn(),
        isLoaded: true,
    }),
    useOrganization: () => ({
        organization: { id: 'org_test', name: 'Test Org', slug: 'test-org' },
    }),
}));

// Mock scrollIntoView - not implemented in JSDOM
Element.prototype.scrollIntoView = vi.fn();

// Mock ResizeObserver - not implemented in JSDOM
class MockResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
}

// @ts-expect-error - assign mock for test environment
globalThis.ResizeObserver = MockResizeObserver;

// Mock IntersectionObserver
class MockIntersectionObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn();
    constructor(callback: any, options?: any) { }
}
// @ts-expect-error - assign mock
globalThis.IntersectionObserver = MockIntersectionObserver;

// Mock requestIdleCallback/cancelIdleCallback - not implemented in JSDOM
if (!globalThis.requestIdleCallback) {
    // @ts-expect-error - assign mock for test environment
    globalThis.requestIdleCallback = (callback: IdleRequestCallback) => {
        return setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 0) as unknown as number;
    };
}
if (!globalThis.cancelIdleCallback) {
    // @ts-expect-error - assign mock for test environment
    globalThis.cancelIdleCallback = (id: number) => clearTimeout(id);
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null;
let consoleInfoSpy: ReturnType<typeof vi.spyOn> | null = null;
let consoleDebugSpy: ReturnType<typeof vi.spyOn> | null = null;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;
const originalConsoleDebug = console.debug;
const noisyConsolePatterns = [
    /Network Error/i,
    /\[RobustScroll\]/i
];

const shouldSilenceConsole = (args: unknown[]) => {
    for (const arg of args) {
        if (typeof arg === 'string') {
            if (noisyConsolePatterns.some(rx => rx.test(arg))) return true;
            continue;
        }
        if (arg instanceof Error) {
            if (noisyConsolePatterns.some(rx => rx.test(arg.message))) return true;
            continue;
        }
        if (arg && typeof arg === 'object' && 'message' in arg) {
            const msg = (arg as any).message;
            if (typeof msg === 'string' && noisyConsolePatterns.some(rx => rx.test(msg))) return true;
        }
    }
    return false;
};

afterEach(() => {
    vi.useRealTimers();
    cleanup();
    if (consoleErrorSpy) {
        consoleErrorSpy.mockRestore();
        consoleErrorSpy = null;
    }
    if (consoleWarnSpy) {
        consoleWarnSpy.mockRestore();
        consoleWarnSpy = null;
    }
    if (consoleInfoSpy) {
        consoleInfoSpy.mockRestore();
        consoleInfoSpy = null;
    }
    if (consoleDebugSpy) {
        consoleDebugSpy.mockRestore();
        consoleDebugSpy = null;
    }
});

beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
        if (shouldSilenceConsole(args)) return;
        originalConsoleError(...args);
    });
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
        if (shouldSilenceConsole(args)) return;
        originalConsoleWarn(...args);
    });
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation((...args) => {
        if (shouldSilenceConsole(args)) return;
        originalConsoleInfo(...args);
    });
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation((...args) => {
        if (shouldSilenceConsole(args)) return;
        originalConsoleDebug(...args);
    });
});
