import { useState, useCallback, useMemo } from "react";
import type { SearchResponse } from "../types/api.types";

/** Tipo de documento suportado */
export type DocType = "nesh" | "tipi";

/** Representa uma aba no sistema */
export interface Tab {
  id: string;
  title: string;
  document: DocType;
  content: string | null;
  loading: boolean;
  error: string | null;
  ncm?: string;
  latestTextQuery?: string;
  results?: SearchResponse | null;
  /**
   * Flag para indicar que há resultados novos de busca.
   * Quando true, o ResultDisplay prioriza auto-scroll e NÃO restaura scroll salvo.
   * Deve ser consumido (setado para false) após o auto-scroll concluir.
   */
  isNewSearch?: boolean;
  /**
   * Posição do scroll salva por aba.
   * Usado para restaurar a posição exata ao alternar de volta para a aba.
   */
  scrollTop?: number;
  /**
   * Flag indicando que o conteúdo HTML (marked/nesh) foi injetado e está pronto.
   * Usado para sincronizar a remoção do Skeleton apenas quando Sidebar+Content existirem.
   */
  isContentReady?: boolean;
  /**
   * Capítulos já carregados por documento nesta aba (ex: { nesh: ["84"], tipi: ["73"] }).
   * Usado para otimização de navegação dentro do mesmo capítulo.
   * Quando um NCM do mesmo capítulo é buscado, evita-se fetch e re-render, fazendo apenas scroll.
   */
  loadedChaptersByDoc?: Record<DocType, string[]>;
}

const createLoadedChaptersByDoc = (): Record<DocType, string[]> => ({
  nesh: [],
  tipi: [],
});

let fallbackTabIdCounter = 0;

const generateTabId = (): string => {
  const cryptoObj = globalThis.crypto;
  const randomId = cryptoObj?.randomUUID?.();
  if (randomId) {
    return `tab-${randomId}`;
  }

  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `tab-${hex}`;
  }

  fallbackTabIdCounter += 1;
  return `tab-${Date.now()}-${fallbackTabIdCounter.toString(36)}`;
};

type TabReference = string | number;

const resolveTabIndex = (tabs: Tab[], tabReference: TabReference): number => {
  if (typeof tabReference === "number") {
    return Number.isInteger(tabReference) ? tabReference : -1;
  }
  return tabs.findIndex((tab) => tab.id === tabReference);
};

const isTabIndexWithinBounds = (tabs: Tab[], tabIndex: number): boolean =>
  tabIndex >= 0 && tabIndex < tabs.length;

export function useTabs() {
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: "tab-1",
      title: "Nova busca",
      document: "nesh",
      content: null,
      loading: false,
      error: null,
      loadedChaptersByDoc: createLoadedChaptersByDoc(),
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("tab-1");

  const createTab = useCallback((document: DocType = "nesh") => {
    const newTabId = generateTabId();
    const newTab: Tab = {
      id: newTabId,
      title: "Nova busca",
      document,
      content: null,
      loading: false,
      error: null,
      loadedChaptersByDoc: createLoadedChaptersByDoc(),
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTabId);
    return newTabId;
  }, []);

  const closeTab = useCallback(
    (e: any, tabId: string) => {
      e.stopPropagation();
      setTabs((prev) => {
        if (prev.length <= 1) return prev; // Nao fechar a ultima aba

        const newTabs = prev.filter((t) => t.id !== tabId);

        // Se fechar a aba ativa, troca para outra
        if (tabId === activeTabId) {
          // Tenta ir para a anterior, ou para a primeira
          const index = prev.findIndex((t) => t.id === tabId);
          const nextActive = newTabs[index - 1] || newTabs[0];
          setActiveTabId(nextActive.id);
        }
        return newTabs;
      });
    },
    [activeTabId],
  );

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const updateTab = useCallback((tabId: string, updates: Partial<Tab>) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, ...updates } : tab)),
    );
  }, []);

  const reorderTabs = useCallback(
    (draggedTabId: string | number, targetTabId: string | number) => {
      if (draggedTabId === targetTabId) return;

      setTabs((prev) => {
        const sourceIndex = resolveTabIndex(prev, draggedTabId);
        const targetIndex = resolveTabIndex(prev, targetTabId);

        if (
          !isTabIndexWithinBounds(prev, sourceIndex) ||
          !isTabIndexWithinBounds(prev, targetIndex)
        ) {
          return prev;
        }

        const next = [...prev];
        const [movedTab] = next.splice(sourceIndex, 1);
        next.splice(targetIndex, 0, movedTab);
        return next;
      });
    },
    [],
  );

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) || tabs[0],
    [tabs, activeTabId],
  );
  const tabsById = useMemo(
    () => new Map(tabs.map((tab) => [tab.id, tab])),
    [tabs],
  );

  return {
    tabs,
    tabsById,
    activeTabId,
    activeTab,
    createTab,
    closeTab,
    switchTab,
    updateTab,
    reorderTabs,
  };
}
