import React, { useCallback, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useSettings } from '../context/SettingsContext';
import type { TextSearchResultItem } from '../types/api.types';
import styles from './TextSearchResults.module.css';

// Re-export para compatibilidade com outros componentes
export type { TextSearchResultItem as SearchResultItem };

interface TextSearchResultsProps {
    results: TextSearchResultItem[] | null;
    query: string;
    onResultClick: (ncm: string) => void;
    scrollParentRef?: React.RefObject<HTMLElement | null>;
}

const VIRTUALIZE_THRESHOLD = 60;

export const TextSearchResults = React.memo(function TextSearchResults({ results, query, onResultClick, scrollParentRef }: TextSearchResultsProps) {
    const { highlightEnabled } = useSettings();
    // Keep hooks execution order stable even when there are no results.
    const normalizedResults = results ?? [];
    const hasResults = normalizedResults.length > 0;

    // Helper para realçar termos.
    const highlightRegex = useMemo(() => {
        if (!highlightEnabled || !query) return null;
        try {
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(${escapedQuery})`, 'gi');
        } catch (e) {
            console.error("Highlight error", e);
            return null;
        }
    }, [highlightEnabled, query]);

    const renderDescription = useCallback((text: string) => {
        if (!highlightRegex || !query) return text;

        const parts = text.split(highlightRegex);
        return parts.map((part, i) =>
            part.toLowerCase() === query.toLowerCase()
                ? <span key={i} className={`${styles.searchHighlight} ${styles.partial}`}>{part}</span>
                : part
        );
    }, [highlightRegex, query]);

    const renderItem = useCallback((item: TextSearchResultItem, index: number) => {
        const typeLabel = item.tipo === 'chapter' ? 'Capítulo' : 'Posição';
        const typeClass = item.tipo === 'chapter' ? styles.chapter : styles.position;

        // Tier logic maps to styles
        let tierClass = styles.tierPartial;
        if (item.tier === 1) tierClass = styles.tierExact;
        else if (item.tier === 2) tierClass = styles.tierAll;

        const tierLabel = item.tier_label || 'Parcial';

        return (
            <button
                type="button"
                key={`${item.ncm}-${index}`}
                className={styles.item}
                onClick={() => onResultClick(item.ncm)}
            >
                <div className={styles.header}>
                    <span className={styles.ncm}>{item.ncm}</span>
                    <span className={`${styles.badge} ${typeClass}`}>{typeLabel}</span>
                    <span className={`${styles.badge} ${tierClass}`}>{tierLabel}</span>
                    {item.score !== null && item.score !== undefined
                        ? <span className={styles.score} title="Score">{Math.round(item.score)}</span>
                        : null}
                </div>
                <div className={styles.desc}>
                    {renderDescription(item.descricao)}
                </div>
            </button>
        );
    }, [onResultClick, renderDescription]);

    if (!hasResults) {
        return (
            <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>🔎</div>
                <h3>Nenhum resultado encontrado</h3>
                <p>Tente termos mais genéricos (ex: "motor" em vez de "motores") ou verifique a ortografia.</p>
            </div>
        );
    }

    const shouldVirtualize = normalizedResults.length >= VIRTUALIZE_THRESHOLD;

    const customScrollParent = scrollParentRef?.current ?? null;

    return (
        <div className={styles.list}>
            <div className={styles.queryInfo}>
                <p>Resultados para: <strong>{query}</strong></p>
            </div>
            {shouldVirtualize ? (
                <Virtuoso
                    className={styles.virtualList}
                    data={normalizedResults}
                    customScrollParent={customScrollParent || undefined}
                    useWindowScroll={!customScrollParent}
                    itemContent={(index, item) => (
                        <div className={styles.virtualItem}>
                            {renderItem(item, index)}
                        </div>
                    )}
                />
            ) : (
                normalizedResults.map((item, index) => renderItem(item, index))
            )}
        </div>
    );
});
