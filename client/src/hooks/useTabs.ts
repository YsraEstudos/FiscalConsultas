import { useState, useCallback, useMemo } from 'react';
import type { SearchResponse } from '../types/api.types';

/** Tipo de documento suportado */
export type DocType = 'nesh' | 'tipi';

/** Representa uma aba no sistema */
export interface Tab {
    id: string;
    title: string;
    document: DocType;
    content: string | null;
    loading: boolean;
    error: string | null;
    ncm?: string;
    results?: SearchResponse | null;
    /** Flag para indicar que há resultados novos de busca - ativa auto-scroll */
    isNewSearch?: boolean;
    /** Posição do scroll salva para restauração */
    scrollTop?: number;
}

export function useTabs() {
    const [tabs, setTabs] = useState<Tab[]>([
        { id: 'tab-1', title: 'Nova busca', document: 'nesh', content: null, loading: false, error: null }
    ]);
    const [activeTabId, setActiveTabId] = useState<string>('tab-1');

    const createTab = useCallback((document: DocType = 'nesh') => {
        const newTabId = `tab-${Date.now()}`;
        const newTab: Tab = {
            id: newTabId,
            title: 'Nova busca',
            document,
            content: null,
            loading: false,
            error: null
        };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newTabId);
        return newTabId;
    }, []);

    const closeTab = useCallback((e: any, tabId: string) => {
        e.stopPropagation();
        setTabs(prev => {
            if (prev.length <= 1) return prev; // Don't close last tab

            const newTabs = prev.filter(t => t.id !== tabId);

            // If closing active tab, switch to another
            if (tabId === activeTabId) {
                // Try to go to the one before, or the first one
                const index = prev.findIndex(t => t.id === tabId);
                const nextActive = newTabs[index - 1] || newTabs[0];
                setActiveTabId(nextActive.id);
            }
            return newTabs;
        });
    }, [activeTabId]);

    const switchTab = useCallback((tabId: string) => {
        setActiveTabId(tabId);
    }, []);

    const updateTab = useCallback((tabId: string, updates: Partial<Tab>) => {
        setTabs(prev => prev.map(tab =>
            tab.id === tabId ? { ...tab, ...updates } : tab
        ));
    }, []);

    const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId) || tabs[0], [tabs, activeTabId]);

    return {
        tabs,
        activeTabId,
        activeTab,
        createTab,
        closeTab,
        switchTab,
        updateTab
    };
}

