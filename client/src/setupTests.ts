import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

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

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});
