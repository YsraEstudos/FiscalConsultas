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

function getResultTypeMeta(tipo: TextSearchResultItem['tipo']) {
    if (tipo === 'chapter') {
        return { label: 'Capítulo', className: styles.chapter };
    }

    if (tipo === 'subposition') {
        return { label: 'Subposição', className: styles.subposition };
    }

    return { label: 'Posição', className: styles.position };
}

export const TextSearchResults = React.memo(function TextSearchResults({ results, query, onResultClick, scrollParentRef }: TextSearchResultsProps) {
    const { highlightEnabled } = useSettings();
    const normalizedResults = results ?? [];
    const hasResults = normalizedResults.length > 0;
    const normalizedQuery = query.trim();
    const displayQuery = normalizedQuery || 'termo informado';

    const highlightRegex = useMemo(() => {
        if (!highlightEnabled || !normalizedQuery) return null;
        try {
            const escapedQuery = normalizedQuery.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
            return new RegExp(`(${escapedQuery})`, 'gi');
        } catch (e) {
            console.error('Highlight error', e);
            return null;
        }
    }, [highlightEnabled, normalizedQuery]);

    const summaryCards = useMemo(() => {
        const exact = normalizedResults.filter(item => item.tier === 1).length;
        const allWords = normalizedResults.filter(item => item.tier === 2).length;
        const partial = normalizedResults.length - exact - allWords;
        const highestScore = normalizedResults.reduce((best, item) => {
            const score = typeof item.score === 'number' ? item.score : 0;
            return Math.max(best, score);
        }, 0);

        return [
            { label: 'Resultados', value: `${normalizedResults.length} itens` },
            { label: 'Exatos', value: `${exact} itens` },
            { label: 'Todas palavras', value: `${allWords} itens` },
            { label: 'Melhor score', value: `${Math.round(highestScore)} pts` },
            { label: 'Parciais', value: `${partial} itens` },
        ];
    }, [normalizedResults]);

    const renderDescription = useCallback((text: string) => {
        if (!highlightRegex || !normalizedQuery) return text;

        const parts = text.split(highlightRegex);
        return parts.map((part, i) =>
            part.toLowerCase() === normalizedQuery.toLowerCase()
                ? <span key={i} className={`${styles.searchHighlight} ${styles.partial}`}>{part}</span>
                : part
        );
    }, [highlightRegex, normalizedQuery]);

    const renderItem = useCallback((item: TextSearchResultItem, index: number) => {
        const typeMeta = getResultTypeMeta(item.tipo);

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
                    <div className={styles.identity}>
                        <span className={styles.ncm}>{item.ncm}</span>
                        <span className={styles.resultIndex}>Resultado {index + 1}</span>
                    </div>

                    <div className={styles.badges}>
                        <span className={`${styles.badge} ${typeMeta.className}`}>{typeMeta.label}</span>
                        <span className={`${styles.badge} ${tierClass}`}>{tierLabel}</span>
                        {item.near_bonus ? <span className={`${styles.badge} ${styles.nearBonus}`}>Contexto</span> : null}
                    </div>

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
                <div className={styles.queryCopy}>
                    <span className={styles.eyebrow}>Busca textual</span>
                    <p>Resultados para: <strong>{displayQuery}</strong></p>
                    <span className={styles.queryHint}>Selecione um item para abrir o NCM correspondente na aba atual.</span>
                </div>

                <div className={styles.summaryGrid}>
                    {summaryCards.map((card) => (
                        <div key={card.label} className={styles.statCard}>
                            <span className={styles.statValue}>{card.value}</span>
                            <span className={styles.statLabel}>{card.label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className={styles.resultsRegion}>
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
                    <div className={styles.resultsStack}>
                        {normalizedResults.map((item, index) => renderItem(item, index))}
                    </div>
                )}
            </div>
        </div>
    );
});

