import { act, renderHook, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { useTabs } from '../../src/hooks/useTabs';
import { SearchBar } from '../../src/components/SearchBar';
import { summarizeDurations } from './helpers.perf';

const runTabSwitchScenario = (openTabs: number, iterations: number): number[] => {
  const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID');
  let sequence = 0;
  uuidSpy.mockImplementation(() => `perf-${++sequence}`);

  const { result } = renderHook(() => useTabs());
  const durations: number[] = [];
  try {
    act(() => {
      for (let index = 0; index < openTabs; index += 1) {
        result.current.createTab(index % 2 === 0 ? 'nesh' : 'tipi');
      }
    });

    for (let i = 0; i < iterations; i += 1) {
      const activeTabId = result.current.activeTabId;
      const targetTabId = result.current.tabs.find((tab) => tab.id !== activeTabId)?.id;

      expect(targetTabId).toBeDefined();
      expect(targetTabId).not.toBe(activeTabId);
      if (!targetTabId) {
        throw new Error('Expected a different tab id for the switch benchmark');
      }

      const start = performance.now();
      act(() => {
        result.current.switchTab(targetTabId);
      });
      const end = performance.now();

      expect(result.current.activeTabId).toBe(targetTabId);
      durations.push(end - start);
    }

    return durations;
  } finally {
    uuidSpy.mockRestore();
  }
};

const runSearchTypingScenario = async (openTabs: number, inputValue: string): Promise<number> => {
  const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID');
  let sequence = 0;
  uuidSpy.mockImplementation(() => `search-${++sequence}`);

  const { result } = renderHook(() => useTabs());
  const { unmount } = render(
    <SearchBar
      onSearch={vi.fn()}
      history={[]}
      onClearHistory={vi.fn()}
      onRemoveHistory={vi.fn()}
    />,
  );

  const input = screen.getByPlaceholderText(/Digite os NCMs/i);
  const user = userEvent.setup();
  try {
    act(() => {
      for (let index = 1; index < openTabs; index += 1) {
        result.current.createTab(index % 2 === 0 ? 'nesh' : 'tipi');
      }
    });

    const start = performance.now();
    await user.type(input, inputValue);
    const end = performance.now();

    expect(input).toHaveValue(inputValue);
    return end - start;
  } finally {
    unmount();
    uuidSpy.mockRestore();
  }
};

const TAB_SWITCH_P95_GUARDRAIL_MS = 100;

describe('Fase 1 - baseline multi-abas (C1-C4)', () => {
  it('collects tab-switch latency baseline for C1/C2/C3', () => {
    const c1 = summarizeDurations(runTabSwitchScenario(1, 40));
    const c2 = summarizeDurations(runTabSwitchScenario(5, 60));
    const c3 = summarizeDurations(runTabSwitchScenario(10, 80));

    expect(c1.samples).toBe(40);
    expect(c2.samples).toBe(60);
    expect(c3.samples).toBe(80);

    expect(c1.p95).toBeGreaterThanOrEqual(0);
    expect(c2.p95).toBeGreaterThanOrEqual(0);
    expect(c3.p95).toBeGreaterThanOrEqual(0);

    // Guardrail de sanidade (ambiente de teste pode variar).
    expect(c1.p95).toBeLessThan(TAB_SWITCH_P95_GUARDRAIL_MS);
    expect(c2.p95).toBeLessThan(TAB_SWITCH_P95_GUARDRAIL_MS);
    expect(c3.p95).toBeLessThan(TAB_SWITCH_P95_GUARDRAIL_MS);
  });

  it('collects search input-to-paint proxy for C4', async () => {
    const durations: number[] = [];

    for (let attempt = 0; attempt < 10; attempt += 1) {
      durations.push(await runSearchTypingScenario(10, '8413'));
    }

    const c4 = summarizeDurations(durations);

    expect(c4.samples).toBe(10);
    expect(c4.p95).toBeGreaterThanOrEqual(0);

    // Guardrail amplo para evitar flakiness em CI/JSDOM.
    expect(c4.p95).toBeLessThan(2500);
  });
});
