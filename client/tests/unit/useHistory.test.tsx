import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHistory } from '../../src/hooks/useHistory';

const NESH_KEY = 'fiscal_search_history_v1_nesh';
const TIPI_KEY = 'fiscal_search_history_v1_tipi';
const LEGACY_KEY = 'nesh_search_history';

describe('useHistory', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('loads persisted NESH history from localStorage on mount', async () => {
    localStorage.setItem(NESH_KEY, JSON.stringify([
      { term: '8517', timestamp: 1 },
      { term: '8471', timestamp: 2 },
    ]));

    const { result } = renderHook(() => useHistory());

    await waitFor(() => {
      expect(result.current.history).toEqual([
        { term: '8517', timestamp: 1 },
        { term: '8471', timestamp: 2 },
      ]);
      expect(result.current.getHistoryForDoc('nesh')).toEqual([
        { term: '8517', timestamp: 1 },
        { term: '8471', timestamp: 2 },
      ]);
    });
  });

  it('logs parse failures and keeps an empty history when persisted data is invalid', async () => {
    localStorage.setItem(NESH_KEY, '{invalid-json');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { result } = renderHook(() => useHistory());

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
      });
      expect(result.current.history).toEqual([]);
      expect(localStorage.getItem(NESH_KEY)).toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('adds unique terms case-insensitively and persists only the 10 most recent entries', () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      result.current.addToHistory('nesh', '');
      for (let index = 0; index < 11; index += 1) {
        result.current.addToHistory('nesh', `84${index}`);
      }
      result.current.addToHistory('nesh', '840');
    });

    expect(result.current.history).toHaveLength(10);
    expect(result.current.history[0].term).toBe('840');
    expect(result.current.history.map((item) => item.term)).not.toContain('8400');
    expect(JSON.parse(localStorage.getItem(NESH_KEY) || '[]')).toHaveLength(10);
  });

  it('removes individual terms and clears the full history', () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      result.current.addToHistory('nesh', '8517');
      result.current.addToHistory('nesh', '8471');
      result.current.addToHistory('tipi', '8517');
      result.current.removeFromHistory('nesh', '8517');
    });

    expect(result.current.history).toEqual([
      expect.objectContaining({ term: '8471' }),
    ]);
    expect(result.current.getHistoryForDoc('tipi')).toEqual([
      expect.objectContaining({ term: '8517' }),
    ]);

    act(() => {
      result.current.clearHistory('nesh');
    });

    expect(result.current.history).toEqual([]);
    expect(result.current.getHistoryForDoc('tipi')).toEqual([
      expect.objectContaining({ term: '8517' }),
    ]);
    expect(localStorage.getItem(NESH_KEY)).toBeNull();
    expect(localStorage.getItem(TIPI_KEY)).not.toBeNull();
  });

  it('migrates legacy localStorage history only to NESH', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([
      { term: 'legacy', timestamp: 1 },
    ]));

    const { result } = renderHook(() => useHistory());

    await waitFor(() => {
      expect(result.current.getHistoryForDoc('nesh')).toEqual([
        { term: 'legacy', timestamp: 1 },
      ]);
    });
    expect(result.current.getHistoryForDoc('tipi')).toEqual([]);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});
