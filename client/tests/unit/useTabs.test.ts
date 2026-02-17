import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTabs } from '../../src/hooks/useTabs';

describe('useTabs', () => {
    it('creates unique tab ids even when called in rapid sequence', () => {
        const { result } = renderHook(() => useTabs());

        let firstId = '';
        let secondId = '';

        act(() => {
            firstId = result.current.createTab('nesh');
            secondId = result.current.createTab('nesh');
        });

        expect(firstId).not.toBe(secondId);

        const ids = result.current.tabs.map(tab => tab.id);
        const uniqueCount = new Set(ids).size;
        expect(uniqueCount).toBe(ids.length);
    });
});
