import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTabs } from "../../src/hooks/useTabs";

const mockRandomUuid = (...values: string[]) => {
  const spy = vi.spyOn(globalThis.crypto, "randomUUID");
  for (const value of values) {
    spy.mockReturnValueOnce(value);
  }
  if (values.length === 1) {
    spy.mockReturnValue(values[0]);
  }
  return spy;
};

describe("useTabs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with one empty nesh tab", () => {
    const { result } = renderHook(() => useTabs());

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe("tab-1");
    expect(result.current.activeTab.id).toBe("tab-1");
    expect(result.current.activeTab.document).toBe("nesh");
    expect(result.current.activeTab.loadedChaptersByDoc).toEqual({
      nesh: [],
      tipi: [],
      nbs: [],
      nebs: [],
    });
    expect(result.current.tabsById.get("tab-1")?.title).toBe("Nova busca");
  });

  it("creates tabs with deterministic id and switches active tab", () => {
    const uuidSpy = mockRandomUuid("171", "172");

    const { result } = renderHook(() => useTabs());

    act(() => {
      const created = result.current.createTab("tipi");
      expect(created).toBe("tab-171");
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTabId).toBe("tab-171");
    expect(result.current.activeTab.document).toBe("tipi");
    expect(result.current.tabsById.get("tab-171")?.loadedChaptersByDoc).toEqual(
      {
        nesh: [],
        tipi: [],
        nbs: [],
        nebs: [],
      },
    );

    act(() => {
      const createdDefault = result.current.createTab();
      expect(createdDefault).toBe("tab-172");
    });

    expect(result.current.tabs).toHaveLength(3);
    expect(result.current.activeTabId).toBe("tab-172");
    expect(result.current.activeTab.document).toBe("nesh");

    act(() => {
      result.current.switchTab("tab-1");
    });
    expect(result.current.activeTabId).toBe("tab-1");
    uuidSpy.mockRestore();
  });

  it("updates only the target tab", () => {
    const uuidSpy = mockRandomUuid("300");
    const { result } = renderHook(() => useTabs());

    act(() => {
      result.current.createTab("tipi");
    });

    act(() => {
      result.current.updateTab("tab-300", {
        ncm: "8517",
        error: "erro parcial",
        loading: true,
      });
    });

    expect(result.current.tabsById.get("tab-300")).toEqual(
      expect.objectContaining({
        document: "tipi",
        ncm: "8517",
        error: "erro parcial",
        loading: true,
      }),
    );
    expect(result.current.tabsById.get("tab-1")).toEqual(
      expect.objectContaining({
        loading: false,
        error: null,
      }),
    );

    uuidSpy.mockRestore();
  });

  it("avoids state updates when updateTab receives unchanged values", () => {
    const { result } = renderHook(() => useTabs());
    const previousTabs = result.current.tabs;

    act(() => {
      result.current.updateTab("tab-1", {
        title: "Nova busca",
        loading: false,
        error: null,
      });
    });

    expect(result.current.tabs).toBe(previousTabs);
  });

  it("does not close when there is only one tab", () => {
    const { result } = renderHook(() => useTabs());
    const stopPropagation = vi.fn();

    act(() => {
      result.current.closeTab({ stopPropagation } as any, "tab-1");
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe("tab-1");
  });


  it("ignores close requests for unknown tab ids", () => {
    const uuidSpy = mockRandomUuid("900");
    const { result } = renderHook(() => useTabs());

    act(() => {
      result.current.createTab("tipi");
    });

    const previousTabs = result.current.tabs;
    const stopPropagation = vi.fn();

    act(() => {
      result.current.closeTab({ stopPropagation } as any, "tab-does-not-exist");
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(result.current.tabs).toBe(previousTabs);
    expect(result.current.tabs.map((tab) => tab.id)).toEqual(["tab-1", "tab-900"]);
    expect(result.current.activeTabId).toBe("tab-900");
    uuidSpy.mockRestore();
  });

  it("closes non-active tab without changing active selection", () => {
    const uuidSpy = mockRandomUuid("400");
    const { result } = renderHook(() => useTabs());

    act(() => {
      result.current.createTab("tipi");
    });

    expect(result.current.activeTabId).toBe("tab-400");
    const stopPropagation = vi.fn();

    act(() => {
      result.current.closeTab({ stopPropagation } as any, "tab-1");
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(result.current.tabs.map((tab) => tab.id)).toEqual(["tab-400"]);
    expect(result.current.activeTabId).toBe("tab-400");
    uuidSpy.mockRestore();
  });

  it("closes active tab selecting previous tab when available", () => {
    const uuidSpy = mockRandomUuid("501", "502");
    const { result } = renderHook(() => useTabs());

    act(() => {
      result.current.createTab("tipi");
      result.current.createTab("nesh");
    });

    expect(result.current.activeTabId).toBe("tab-502");

    act(() => {
      result.current.closeTab({ stopPropagation: vi.fn() } as any, "tab-502");
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual([
      "tab-1",
      "tab-501",
    ]);
    expect(result.current.activeTabId).toBe("tab-501");
    uuidSpy.mockRestore();
  });

  it("closes first active tab selecting fallback first remaining tab", () => {
    const uuidSpy = mockRandomUuid("601");
    const { result } = renderHook(() => useTabs());

    act(() => {
      result.current.createTab("tipi");
      result.current.switchTab("tab-1");
    });

    expect(result.current.activeTabId).toBe("tab-1");

    act(() => {
      result.current.closeTab({ stopPropagation: vi.fn() } as any, "tab-1");
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(["tab-601"]);
    expect(result.current.activeTabId).toBe("tab-601");
    uuidSpy.mockRestore();
  });


  it("closes the latest active tab correctly even with batched updates", () => {
    const uuidSpy = mockRandomUuid("801");
    const { result } = renderHook(() => useTabs());

    act(() => {
      result.current.createTab("tipi");
    });

    act(() => {
      result.current.switchTab("tab-1");
      result.current.closeTab({ stopPropagation: vi.fn() } as any, "tab-1");
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(["tab-801"]);
    expect(result.current.activeTabId).toBe("tab-801");
    uuidSpy.mockRestore();
  });

  it("reorders tabs within bounds and ignores invalid indices", () => {
    const uuidSpy = mockRandomUuid("701", "702");
    const { result } = renderHook(() => useTabs());

    act(() => {
      result.current.createTab("tipi");
      result.current.createTab("nesh");
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual([
      "tab-1",
      "tab-701",
      "tab-702",
    ]);

    act(() => {
      result.current.reorderTabs(0, 2);
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual([
      "tab-701",
      "tab-1",
      "tab-702",
    ]);

    act(() => {
      result.current.reorderTabs(-1, 1);
      result.current.reorderTabs(1, 99);
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual([
      "tab-701",
      "tab-1",
      "tab-702",
    ]);
    uuidSpy.mockRestore();
  });

  it("keeps active tab when switchTab receives the current tab id", () => {
    const { result } = renderHook(() => useTabs());

    const beforeSwitch = result.current.activeTab;

    act(() => {
      result.current.switchTab("tab-1");
    });

    expect(result.current.activeTabId).toBe("tab-1");
    expect(result.current.activeTab).toBe(beforeSwitch);
  });
});
