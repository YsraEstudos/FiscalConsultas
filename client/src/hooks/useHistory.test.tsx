import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useHistory } from './useHistory';

const NESH_KEY = 'fiscal_search_history_v1_nesh';
const TIPI_KEY = 'fiscal_search_history_v1_tipi';
const NBS_KEY = 'fiscal_search_history_v1_nbs';
const LEGACY_KEY = 'nesh_search_history';

describe('useHistory', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('loads from localStorage instead of sessionStorage', async () => {
        localStorage.setItem(NESH_KEY, JSON.stringify([{ term: '8413', timestamp: 100 }]));
        sessionStorage.setItem(NESH_KEY, JSON.stringify([{ term: 'wrong', timestamp: 200 }]));

        const { result } = renderHook(() => useHistory());

        await waitFor(() => {
            expect(result.current.getHistoryForDoc('nesh')).toEqual([{ term: '8413', timestamp: 100 }]);
        });
    });

    it('persists history across hook remounts', async () => {
        const first = renderHook(() => useHistory());

        await act(async () => {
            first.result.current.addToHistory('nesh', '8413');
        });

        first.unmount();
        const second = renderHook(() => useHistory());

        await waitFor(() => {
            expect(second.result.current.getHistoryForDoc('nesh')).toEqual([
                expect.objectContaining({ term: '8413' }),
            ]);
        });
    });

    it('saves NESH, TIPI, and NBS histories under separate keys', async () => {
        const { result } = renderHook(() => useHistory());

        await act(async () => {
            result.current.addToHistory('nesh', '8413');
            result.current.addToHistory('tipi', '8501');
            result.current.addToHistory('nbs', '1.0101');
        });

        expect(JSON.parse(localStorage.getItem(NESH_KEY) || '[]')).toEqual([
            expect.objectContaining({ term: '8413' }),
        ]);
        expect(JSON.parse(localStorage.getItem(TIPI_KEY) || '[]')).toEqual([
            expect.objectContaining({ term: '8501' }),
        ]);
        expect(JSON.parse(localStorage.getItem(NBS_KEY) || '[]')).toEqual([
            expect.objectContaining({ term: '1.0101' }),
        ]);
    });

    it('deletes one item only from the selected document history', async () => {
        const { result } = renderHook(() => useHistory());

        await act(async () => {
            result.current.addToHistory('nesh', '8413');
            result.current.addToHistory('nesh', '8501');
            result.current.addToHistory('tipi', '8413');
            result.current.removeFromHistory('nesh', '8413');
        });

        expect(result.current.getHistoryForDoc('nesh')).toEqual([
            expect.objectContaining({ term: '8501' }),
        ]);
        expect(result.current.getHistoryForDoc('tipi')).toEqual([
            expect.objectContaining({ term: '8413' }),
        ]);
    });

    it('clears one document history without clearing the others', async () => {
        const { result } = renderHook(() => useHistory());

        await act(async () => {
            result.current.addToHistory('nesh', '8413');
            result.current.addToHistory('tipi', '8501');
            result.current.clearHistory('nesh');
        });

        expect(result.current.getHistoryForDoc('nesh')).toEqual([]);
        expect(result.current.getHistoryForDoc('tipi')).toEqual([
            expect.objectContaining({ term: '8501' }),
        ]);
        expect(localStorage.getItem(NESH_KEY)).toBeNull();
        expect(localStorage.getItem(TIPI_KEY)).not.toBeNull();
    });

    it('deduplicates terms case-insensitively within the same document only', async () => {
        const { result } = renderHook(() => useHistory());

        await act(async () => {
            result.current.addToHistory('nesh', 'abc');
            result.current.addToHistory('nesh', 'ABC');
            result.current.addToHistory('tipi', 'abc');
        });

        expect(result.current.getHistoryForDoc('nesh')).toEqual([
            expect.objectContaining({ term: 'ABC' }),
        ]);
        expect(result.current.getHistoryForDoc('tipi')).toEqual([
            expect.objectContaining({ term: 'abc' }),
        ]);
    });

    it('migrates the legacy shared history only to NESH', async () => {
        localStorage.setItem(LEGACY_KEY, JSON.stringify([{ term: 'legacy', timestamp: 123 }]));

        const { result } = renderHook(() => useHistory());

        await waitFor(() => {
            expect(result.current.getHistoryForDoc('nesh')).toEqual([{ term: 'legacy', timestamp: 123 }]);
        });
        expect(result.current.getHistoryForDoc('tipi')).toEqual([]);
        expect(result.current.getHistoryForDoc('nbs')).toEqual([]);
        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    it('ignores malformed stored history without crashing', async () => {
        localStorage.setItem(NESH_KEY, '{not-json');

        const { result } = renderHook(() => useHistory());

        await waitFor(() => {
            expect(result.current.getHistoryForDoc('nesh')).toEqual([]);
        });
        expect(localStorage.getItem(NESH_KEY)).toBeNull();
    });
});
