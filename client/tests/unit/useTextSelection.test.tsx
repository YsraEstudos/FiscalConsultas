import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTextSelection } from '../../src/hooks/useTextSelection';

function buildSelection(text: string, commonAncestorContainer: Node, rect = new DOMRect(10, 20, 30, 40), isCollapsed = false) {
    const removeAllRanges = vi.fn();
    const selection = {
        isCollapsed,
        toString: () => text,
        getRangeAt: () => ({
            commonAncestorContainer,
            getBoundingClientRect: () => rect,
        }),
        removeAllRanges,
    } as unknown as Selection;
    return { selection, removeAllRanges, rect };
}

describe('useTextSelection', () => {
    let getSelectionSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.useFakeTimers();
        getSelectionSpy = vi.spyOn(window, 'getSelection');
        document.body.innerHTML = '';
    });

    afterEach(() => {
        getSelectionSpy.mockRestore();
        vi.useRealTimers();
    });

    it('captures valid selection inside container and resolves anchor key', () => {
        const container = document.createElement('div');
        const anchor = document.createElement('span');
        anchor.dataset.anchorId = 'anchor-1';
        const textNode = document.createTextNode('selected text');
        anchor.appendChild(textNode);
        container.appendChild(anchor);
        document.body.appendChild(container);

        const { selection, rect } = buildSelection('  selected text  ', textNode);
        getSelectionSpy.mockReturnValue(selection);

        const { result } = renderHook(() => useTextSelection({ current: container }));

        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
            vi.advanceTimersByTime(20);
        });

        expect(result.current.selection?.text).toBe('selected text');
        expect(result.current.selection?.anchorKey).toBe('anchor-1');
        expect(result.current.selection?.rect).toBe(rect);
    });

    it('ignores invalid selections (outside container, collapsed, or empty)', () => {
        const container = document.createElement('div');
        const insideNode = document.createTextNode('inside');
        container.appendChild(insideNode);
        const outsideNode = document.createTextNode('outside');
        document.body.appendChild(container);

        const { result } = renderHook(() => useTextSelection({ current: container }));

        getSelectionSpy.mockReturnValue(buildSelection('outside', outsideNode).selection);
        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
            vi.advanceTimersByTime(20);
        });
        expect(result.current.selection).toBeNull();

        getSelectionSpy.mockReturnValue(buildSelection('inside', insideNode, new DOMRect(), true).selection);
        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
            vi.advanceTimersByTime(20);
        });
        expect(result.current.selection).toBeNull();

        getSelectionSpy.mockReturnValue(buildSelection('   ', insideNode).selection);
        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
            vi.advanceTimersByTime(20);
        });
        expect(result.current.selection).toBeNull();
    });

    it('clearSelection removes ranges and resets local state', () => {
        const container = document.createElement('div');
        const anchor = document.createElement('span');
        anchor.dataset.anchorId = 'anchor-clear';
        const textNode = document.createTextNode('content');
        anchor.appendChild(textNode);
        container.appendChild(anchor);
        document.body.appendChild(container);

        const built = buildSelection('content', textNode);
        getSelectionSpy.mockReturnValue(built.selection);

        const { result } = renderHook(() => useTextSelection({ current: container }));

        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
            vi.advanceTimersByTime(20);
        });
        expect(result.current.selection?.text).toBe('content');

        act(() => {
            result.current.clearSelection();
        });

        expect(built.removeAllRanges).toHaveBeenCalledTimes(1);
        expect(result.current.selection).toBeNull();
    });

    it('does not clear current selection while popover click is pending', () => {
        const container = document.createElement('div');
        const anchor = document.createElement('span');
        anchor.dataset.anchorId = 'anchor-pending';
        const textNode = document.createTextNode('active');
        anchor.appendChild(textNode);
        container.appendChild(anchor);
        document.body.appendChild(container);

        const valid = buildSelection('active', textNode).selection;
        const collapsed = buildSelection('active', textNode, new DOMRect(), true).selection;
        getSelectionSpy.mockReturnValue(valid);

        const { result } = renderHook(() => useTextSelection({ current: container }));

        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
            vi.advanceTimersByTime(20);
        });
        expect(result.current.selection?.text).toBe('active');

        act(() => {
            result.current.onPopoverMouseDown();
        });

        getSelectionSpy.mockReturnValue(collapsed);
        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
            vi.advanceTimersByTime(20);
        });

        expect(result.current.selection?.text).toBe('active');

        act(() => {
            vi.advanceTimersByTime(320);
            document.dispatchEvent(new MouseEvent('mouseup'));
            vi.advanceTimersByTime(20);
        });
        expect(result.current.selection).toBeNull();
    });
});
