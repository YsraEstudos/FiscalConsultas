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

    if (!results || results.length === 0) {
        return (
            <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>🔎</div>
                <h3>Nenhum resultado encontrado</h3>
                <p>Tente termos mais genéricos (ex: "motor" em vez de "motores") ou verifique a ortografia.</p>
            </div>
        );
    }

    // Função helper para realçar termos
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
            <div
                key={`${item.ncm}-${index}`}
                className={styles.item}
                onClick={() => onResultClick(item.ncm)}
            >
                <div className={styles.header}>
                    <span className={styles.ncm}>{item.ncm}</span>
                    <span className={`${styles.badge} ${typeClass}`}>{typeLabel}</span>
                    <span className={`${styles.badge} ${tierClass}`}>{tierLabel}</span>
                    {item.score && <span className={styles.score} title="Score">{Math.round(item.score)}</span>}
                </div>
                <div className={styles.desc}>
                    {renderDescription(item.descricao)}
                </div>
            </div>
        );
    }, [onResultClick, renderDescription]);

    const shouldVirtualize = results.length >= VIRTUALIZE_THRESHOLD;

    const customScrollParent = scrollParentRef?.current ?? null;

    return (
        <div className={styles.list}>
            <div className={styles.queryInfo}>
                <p>Resultados para: <strong>{query}</strong></p>
            </div>
            {shouldVirtualize ? (
                <Virtuoso
                    className={styles.virtualList}
                    data={results}
                    customScrollParent={customScrollParent || undefined}
                    useWindowScroll={!customScrollParent}
                    itemContent={(index, item) => (
                        <div className={styles.virtualItem}>
                            {renderItem(item, index)}
                        </div>
                    )}
                />
            ) : (
                results.map((item, index) => renderItem(item, index))
            )}
        </div>
    );
});
