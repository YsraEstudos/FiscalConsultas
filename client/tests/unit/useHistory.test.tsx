import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHistory } from '../../src/hooks/useHistory';

describe('useHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads persisted history from localStorage on mount', async () => {
    localStorage.setItem('nesh_search_history', JSON.stringify([
      { term: '8517', timestamp: 1 },
      { term: '8471', timestamp: 2 },
    ]));

    const { result } = renderHook(() => useHistory());

    await waitFor(() => {
      expect(result.current.history).toEqual([
        { term: '8517', timestamp: 1 },
        { term: '8471', timestamp: 2 },
      ]);
    });
  });

  it('logs parse failures and keeps an empty history when persisted data is invalid', async () => {
    localStorage.setItem('nesh_search_history', '{invalid-json');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { result } = renderHook(() => useHistory());

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
      });
      expect(result.current.history).toEqual([]);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('adds unique terms case-insensitively and persists only the 10 most recent entries', () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      result.current.addToHistory('');
      for (let index = 0; index < 11; index += 1) {
        result.current.addToHistory(`84${index}`);
      }
      result.current.addToHistory('840');
    });

    expect(result.current.history).toHaveLength(10);
    expect(result.current.history[0].term).toBe('840');
    expect(result.current.history.map((item) => item.term)).not.toContain('8400');
    expect(JSON.parse(localStorage.getItem('nesh_search_history') || '[]')).toHaveLength(10);
  });

  it('removes individual terms and clears the full history', () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      result.current.addToHistory('8517');
      result.current.addToHistory('8471');
      result.current.removeFromHistory('8517');
    });

    expect(result.current.history).toEqual([
      expect.objectContaining({ term: '8471' }),
    ]);

    act(() => {
      result.current.clearHistory();
    });

    expect(result.current.history).toEqual([]);
    expect(localStorage.getItem('nesh_search_history')).toBeNull();
  });
});
