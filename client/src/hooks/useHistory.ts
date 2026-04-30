import { useState, useEffect, useCallback } from 'react';
import type { DocType } from './useTabs';

const MAX_HISTORY = 10;
const LEGACY_STORAGE_KEY = 'nesh_search_history';
const DOC_TYPES: DocType[] = ['nesh', 'tipi', 'nbs'];

const STORAGE_KEYS: Record<DocType, string> = {
    nesh: 'fiscal_search_history_v1_nesh',
    tipi: 'fiscal_search_history_v1_tipi',
    nbs: 'fiscal_search_history_v1_nbs',
};

type HistoryByDoc = Record<DocType, HistoryItem[]>;

function getHistoryStorage(): Storage | null {
    try {
        if (typeof window === 'undefined') {
            return null;
        }
        return window.localStorage;
    } catch {
        return null;
    }
}

export interface HistoryItem {
    term: string;
    timestamp: number;
}

function createEmptyHistory(): HistoryByDoc {
    return {
        nesh: [],
        tipi: [],
        nbs: [],
    };
}

function parseHistory(storage: Storage, key: string): HistoryItem[] {
    const saved = storage.getItem(key);
    if (!saved) {
        return [];
    }

    try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) {
            storage.removeItem(key);
            return [];
        }

        return parsed.filter((item): item is HistoryItem => (
            item &&
            typeof item.term === 'string' &&
            typeof item.timestamp === 'number'
        ));
    } catch (e) {
        console.error('Failed to parse history', e);
        storage.removeItem(key);
        return [];
    }
}

function isValidStoredHistory(saved: string | null): boolean {
    if (!saved) {
        return false;
    }

    try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) && parsed.some((item) => (
            item &&
            typeof item.term === 'string' &&
            typeof item.timestamp === 'number'
        ));
    } catch {
        return false;
    }
}

function migrateLegacyHistory(storage: Storage): void {
    const legacySaved = storage.getItem(LEGACY_STORAGE_KEY);
    const hasNewNeshHistory = isValidStoredHistory(storage.getItem(STORAGE_KEYS.nesh));

    if (!legacySaved) {
        return;
    }

    if (hasNewNeshHistory) {
        storage.removeItem(LEGACY_STORAGE_KEY);
        return;
    }

    const legacyHistory = parseHistory(storage, LEGACY_STORAGE_KEY);
    if (legacyHistory.length > 0) {
        storage.setItem(STORAGE_KEYS.nesh, JSON.stringify(legacyHistory.slice(0, MAX_HISTORY)));
    }
    storage.removeItem(LEGACY_STORAGE_KEY);
}

function loadHistoryByDoc(storage: Storage): HistoryByDoc {
    migrateLegacyHistory(storage);

    return DOC_TYPES.reduce<HistoryByDoc>((acc, doc) => {
        acc[doc] = parseHistory(storage, STORAGE_KEYS[doc]).slice(0, MAX_HISTORY);
        return acc;
    }, createEmptyHistory());
}

export function useHistory() {
    const [historyByDoc, setHistoryByDoc] = useState<HistoryByDoc>(createEmptyHistory);
    const [hasLoadedHistory, setHasLoadedHistory] = useState(false);

    useEffect(() => {
        const storage = getHistoryStorage();
        if (storage) {
            setHistoryByDoc(loadHistoryByDoc(storage));
        }
        setHasLoadedHistory(true);
    }, []);

    useEffect(() => {
        if (!hasLoadedHistory) {
            return;
        }

        const storage = getHistoryStorage();
        if (!storage) {
            return;
        }

        DOC_TYPES.forEach((doc) => {
            const history = historyByDoc[doc] ?? [];
            if (history.length > 0) {
                storage.setItem(STORAGE_KEYS[doc], JSON.stringify(history));
            } else {
                storage.removeItem(STORAGE_KEYS[doc]);
            }
        });
    }, [historyByDoc, hasLoadedHistory]);

    const getHistoryForDoc = useCallback((doc: DocType) => historyByDoc[doc] ?? [], [historyByDoc]);

    const addToHistory = useCallback((doc: DocType, term: string) => {
        if (!term) return;

        setHistoryByDoc(prev => {
            const previousDocHistory = prev[doc] ?? [];
            // Remove duplicates (case insensitive) and keep only unique recent
            const filtered = previousDocHistory.filter(item => item.term.toLowerCase() !== term.toLowerCase());

            const newItem: HistoryItem = {
                term,
                timestamp: Date.now()
            };

            const updated = [newItem, ...filtered].slice(0, MAX_HISTORY);

            return {
                ...prev,
                [doc]: updated,
            };
        });
    }, []);

    const clearHistory = useCallback((doc: DocType) => {
        setHistoryByDoc(prev => {
            return {
                ...prev,
                [doc]: [],
            };
        });
    }, []);

    const removeFromHistory = useCallback((doc: DocType, termToRemove: string) => {
        setHistoryByDoc(prev => {
            const updated = (prev[doc] ?? []).filter(item => item.term !== termToRemove);
            return {
                ...prev,
                [doc]: updated,
            };
        });
    }, []);

    return {
        history: historyByDoc.nesh,
        getHistoryForDoc,
        addToHistory,
        clearHistory,
        removeFromHistory
    };
}
