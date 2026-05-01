import { useState, useEffect, useCallback } from 'react';

const MAX_HISTORY = 10;
const STORAGE_KEY = 'nesh_search_history';

function getHistoryStorage(): Storage | null {
    try {
        if (typeof window === 'undefined') {
            return null;
        }
        return window.sessionStorage;
    } catch {
        return null;
    }
}

export interface HistoryItem {
    term: string;
    timestamp: number;
}

function isHistoryItem(value: unknown): value is HistoryItem {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as HistoryItem).term === 'string' &&
        typeof (value as HistoryItem).timestamp === 'number'
    );
}

function parseStoredHistory(saved: string): HistoryItem[] {
    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed) || !parsed.every(isHistoryItem)) {
        throw new Error('Stored search history has an invalid shape');
    }
    return parsed;
}

export function useHistory() {
    const [history, setHistory] = useState<HistoryItem[]>([]);

    // Load from session storage on mount to avoid persisting search behavior across browser sessions.
    useEffect(() => {
        const storage = getHistoryStorage();
        const saved = storage?.getItem(STORAGE_KEY);
        if (saved) {
            try {
                setHistory(parseStoredHistory(saved));
            } catch (e) {
                console.error("Failed to parse history", e);
                storage?.removeItem(STORAGE_KEY);
                setHistory([]);
            }
        }
    }, []);

    const addToHistory = useCallback((term: string) => {
        if (!term) return;

        setHistory(prev => {
            // Remove duplicates (case insensitive) and keep only unique recent
            const filtered = prev.filter(item => item.term.toLowerCase() !== term.toLowerCase());

            const newItem: HistoryItem = {
                term,
                timestamp: Date.now()
            };

            const updated = [newItem, ...filtered].slice(0, MAX_HISTORY);

            // Persist
            getHistoryStorage()?.setItem(STORAGE_KEY, JSON.stringify(updated));
            return updated;
        });
    }, []);

    const clearHistory = useCallback(() => {
        setHistory([]);
        getHistoryStorage()?.removeItem(STORAGE_KEY);
    }, []);

    const removeFromHistory = useCallback((termToRemove: string) => {
        setHistory(prev => {
            const updated = prev.filter(item => item.term !== termToRemove);
            getHistoryStorage()?.setItem(STORAGE_KEY, JSON.stringify(updated));
            return updated;
        });
    }, []);

    return {
        history,
        addToHistory,
        clearHistory,
        removeFromHistory
    };
}
