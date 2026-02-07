import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useRobustScroll } from '../../src/hooks/useRobustScroll';

describe('useRobustScroll Hook', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        // Mock scrollIntoView
        Element.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
        document.body.removeChild(container);
        vi.restoreAllMocks();
    });

    it('should scroll immediately if target exists', () => {
        const target = document.createElement('div');
        target.id = 'pos-84-17';
        container.appendChild(target);

        renderHook(() =>
            useRobustScroll({
                targetId: 'pos-84-17',
                shouldScroll: true,
                containerRef: { current: container },
                onComplete: vi.fn(),
            })
        );

        expect(target.scrollIntoView).toHaveBeenCalled();
        expect(target.classList.contains('flash-highlight')).toBe(true);
    });

    it('should wait for target to appear via MutationObserver', async () => {
        const onComplete = vi.fn();
        vi.useFakeTimers();

        renderHook(() =>
            useRobustScroll({
                targetId: 'future-element',
                shouldScroll: true,
                containerRef: { current: container },
                onComplete
            })
        );

        // Initially not called
        expect(onComplete).not.toHaveBeenCalled();

        // Simulate async insertion
        await act(async () => {
            const el = document.createElement('div');
            el.id = 'future-element';
            container.appendChild(el);
        });

        // Allow observer to fire (MutationObserver is microtask) and timers to tick
        act(() => {
            vi.advanceTimersByTime(50);
        });

        // Allow settle timers to complete
        act(() => {
            vi.advanceTimersByTime(800);
        });

        expect(document.getElementById('future-element')?.scrollIntoView).toHaveBeenCalled();
        expect(onComplete).toHaveBeenCalledWith(true);
        vi.useRealTimers();
    });

    it('should timeout if target never appears', async () => {
        const onComplete = vi.fn();
        vi.useFakeTimers();

        renderHook(() =>
            useRobustScroll({
                targetId: 'missing-element',
                shouldScroll: true,
                containerRef: { current: container },
                onComplete
            })
        );

        expect(onComplete).not.toHaveBeenCalled();

        // Fast-forward time
        act(() => {
            vi.advanceTimersByTime(5500);
        });

        expect(onComplete).toHaveBeenCalledWith(false);
        vi.useRealTimers();
    });

    it('should do nothing if shouldScroll is false', () => {
        const target = document.createElement('div');
        target.id = 'pos-exist';
        container.appendChild(target);

        renderHook(() =>
            useRobustScroll({
                targetId: 'pos-exist',
                shouldScroll: false,
                containerRef: { current: container }
            })
        );

        expect(target.scrollIntoView).not.toHaveBeenCalled();
    });
});
