import { useEffect, useRef, useState } from 'react';
import { HistoryItem } from '../hooks/useHistory';
import { Spinner } from './Spinner';
import styles from './SearchBar.module.css';

interface SearchBarProps {
    onSearch: (term: string) => void;
    history: HistoryItem[];
    onClearHistory: () => void;
    onRemoveHistory: (term: string) => void;
    isLoading?: boolean;
}

/**
 * Search bar with history dropdown.
 * Dropdown only opens on explicit user interaction (left-click, Tab, or '/' shortcut),
 * not on programmatic focus or component remounts.
 */
export function SearchBar({ onSearch, history, onClearHistory, onRemoveHistory, isLoading }: SearchBarProps) {
    const [query, setQuery] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const isUserInteractionRef = useRef(false);

    // Mark keyboard navigation as user interaction (Tab, /)
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Tab' || e.key === '/') {
                isUserInteractionRef.current = true;
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    useEffect(() => {
        const onContextMenu = () => {
            // Always close dropdown on any right-click anywhere
            setIsFocused(false);
        };

        document.addEventListener('contextmenu', onContextMenu);
        return () => document.removeEventListener('contextmenu', onContextMenu);
    }, []);

    const handleSearch = (term: string = query) => {
        if (isLoading) return;
        onSearch(term);
        // Blur input to close dropdown after search
        inputRef.current?.blur();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleSearch();
    };

    // Small delay before closing dropdown to allow button clicks to register
    const handleBlur = () => {
        setTimeout(() => setIsFocused(false), 150);
    };

    const showDropdown = isFocused && history && history.length > 0;

    return (
        <div className={styles.searchBox}>
            <input
                ref={inputRef}
                type="text"
                id="ncmInput"
                className={styles.searchInput}
                placeholder="Digite os NCMs separados por vírgula (ex: 01, 02, 0301, 84.71)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onPointerDownCapture={(e) => {
                    if (e.button === 0) {
                        // Left-click: mark as user interaction to allow dropdown
                        isUserInteractionRef.current = true;
                    } else if (e.button === 2) {
                        // Right-click: prevent dropdown
                        isUserInteractionRef.current = false;
                        setIsFocused(false);
                    }
                }}
                onFocus={() => {
                    // Only open dropdown if triggered by user interaction (left-click or keyboard)
                    if (isUserInteractionRef.current) {
                        setIsFocused(true);
                    }
                    // Reset the flag
                    isUserInteractionRef.current = false;
                }}
                onContextMenu={() => {
                    // Ensure dropdown stays closed during context menu
                    setIsFocused(false);
                }}
                onBlur={handleBlur}
                autoComplete="off"
            />
            <button
                className={`${styles.searchButton} ${isLoading ? styles.searchButtonLoading : ''}`}
                id="searchBtn"
                onClick={() => handleSearch()}
                disabled={isLoading}
            >
                <span className={styles.buttonContent}>
                    <span className={styles.buttonIcon}>🔍</span>
                    <span className={styles.buttonText}>Buscar</span>
                </span>
                <div className={styles.buttonLoader}>
                    <Spinner size="sm" />
                </div>
            </button>

            {/* History Dropdown */}
            {showDropdown && (
                <div className={styles.historyDropdown}>
                    <div className={styles.historyHeader}>
                        <span>Buscas Recentes</span>
                        <button onMouseDown={(e) => { e.preventDefault(); onClearHistory(); }}>
                            Limpar
                        </button>
                    </div>
                    {history.map((item, idx) => (
                        <div
                            key={`${item.term}-${idx}`}
                            className={styles.historyRow}
                            onMouseDown={(e) => {
                                e.preventDefault(); // Prevent blur before click registers
                                setQuery(item.term);
                                handleSearch(item.term);
                            }}
                        >
                            <span className={styles.historyTerm}>
                                <span className={styles.historyIcon}>🕒</span>
                                {item.term}
                            </span>
                            <button
                                className={styles.historyRemoveButton}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onRemoveHistory(item.term);
                                }}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
