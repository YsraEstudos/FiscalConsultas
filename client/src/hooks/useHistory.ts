import { useState, useEffect, useCallback } from 'react';

const MAX_HISTORY = 10;
const STORAGE_KEY = 'nesh_search_history';

export interface HistoryItem {
    term: string;
    timestamp: number;
}

export function useHistory() {
    const [history, setHistory] = useState<HistoryItem[]>([]);

    // Load from local storage on mount
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                setHistory(JSON.parse(saved));
            } catch (e) {
                console.error("Failed to parse history", e);
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
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            return updated;
        });
    }, []);

    const clearHistory = useCallback(() => {
        setHistory([]);
        localStorage.removeItem(STORAGE_KEY);
    }, []);

    const removeFromHistory = useCallback((termToRemove: string) => {
        setHistory(prev => {
            const updated = prev.filter(item => item.term !== termToRemove);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
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
