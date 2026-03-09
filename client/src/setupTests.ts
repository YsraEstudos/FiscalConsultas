import React from 'react';
import { expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

const {
    getMockSignedInState,
    mockUseUser,
    mockUseAuth,
    mockUseClerk,
    setMockSignedInState,
    resetMockClerkState,
} = vi.hoisted(() => {
    const sharedAuthState = {
        isSignedIn: true,
        getToken: vi.fn().mockResolvedValue('test_token'),
        signOut: vi.fn(),
    };

    const mockUser = {
        id: 'user_test',
        fullName: 'Test User',
        firstName: 'Test',
        primaryEmailAddress: { emailAddress: 'test@example.com' },
        imageUrl: '',
    };

    const mockUseUser = () => ({
        user: sharedAuthState.isSignedIn ? mockUser : null,
        isSignedIn: sharedAuthState.isSignedIn,
        isLoaded: true,
    });

    const mockUseAuth = () => ({
        getToken: sharedAuthState.getToken,
        signOut: sharedAuthState.signOut,
        isSignedIn: sharedAuthState.isSignedIn,
        isLoaded: true,
    });

    const mockUseClerk = () => ({
        signOut: sharedAuthState.signOut,
    });

    const getMockSignedInState = () => {
        const userState = mockUseUser();
        if (typeof userState?.isSignedIn === 'boolean') return userState.isSignedIn;

        const authState = mockUseAuth();
        if (typeof (authState as { isSignedIn?: unknown })?.isSignedIn === 'boolean') {
            return Boolean((authState as { isSignedIn?: boolean }).isSignedIn);
        }

        return false;
    };

    const setMockSignedInState = (value: boolean) => {
        sharedAuthState.isSignedIn = value;
    };

    const resetMockClerkState = () => {
        sharedAuthState.isSignedIn = true;
        sharedAuthState.getToken.mockReset();
        sharedAuthState.getToken.mockResolvedValue('test_token');
        sharedAuthState.signOut.mockReset();
    };

    return {
        getMockSignedInState,
        mockUseUser,
        mockUseAuth,
        mockUseClerk,
        setMockSignedInState,
        resetMockClerkState,
    };
});

export { setMockSignedInState };

vi.mock('@clerk/react', () => ({
    ClerkProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    SignedIn: ({ children }: { children: React.ReactNode }) => getMockSignedInState()
        ? React.createElement(React.Fragment, null, children)
        : null,
    SignedOut: ({ children }: { children: React.ReactNode }) => getMockSignedInState()
        ? null
        : React.createElement(React.Fragment, null, children),
    SignInButton: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    SignUpButton: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    UserButton: () => null,
    OrganizationSwitcher: () => null,
    SignIn: () => null,
    useClerk: mockUseClerk,
    useUser: mockUseUser,
    useAuth: mockUseAuth,
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
    resetMockClerkState();
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
