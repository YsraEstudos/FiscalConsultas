import React, { useMemo, useEffect, useRef } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import styles from './Sidebar.module.css';
import { generateAnchorId, normalizeNCMQuery } from '../utils/id_utils';
import { debug } from '../utils/debug';

interface Position {
    codigo: string;
    descricao: string;
    anchor_id?: string;
    nivel?: number;
    aliquota?: string;
}

interface Chapter {
    capitulo: string;
    posicoes: Position[];
}

interface SidebarProps {
    results: Record<string, Chapter> | null;
    onNavigate: (targetId: string) => void;
    isOpen: boolean;
    onClose: () => void;
    searchQuery?: string;
    activeAnchorId?: string | null;
}

// Flat list types (Header or Item)
type SidebarItem =
    | { type: 'header'; capitulo: string; count: number }
    | { type: 'item'; pos: Position };

export const Sidebar = React.memo(function Sidebar({ results, onNavigate, isOpen, onClose, searchQuery, activeAnchorId }: SidebarProps) {
    debug.log('[Sidebar] Rendering with results keys:', results ? Object.keys(results).length : 'null');

    const isTipi = useMemo(() => {
        if (!results) return false;
        return Object.values(results).some((chapter: any) =>
            Array.isArray(chapter?.posicoes) && chapter.posicoes.some((pos: any) => 'nivel' in pos || 'aliquota' in pos)
        );
    }, [results]);

    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const lastScrolledQueryRef = useRef<string | null>(null);

    useEffect(() => {
        lastScrolledQueryRef.current = null;
    }, [results, searchQuery]);

    // 1. Flatten Data & Build Index Map
    const { items, codeToIndex, anchorToIndex } = useMemo(() => {
        if (!results) return { items: [], codeToIndex: {}, anchorToIndex: {} };

        const sortedChapters = Object.values(results).sort((a, b) =>
            parseInt(a.capitulo) - parseInt(b.capitulo)
        );

        const flatList: SidebarItem[] = [];
        const indexMap: Record<string, number> = {};
        const anchorMap: Record<string, number> = {};

        sortedChapters.forEach(chapter => {
            // Add Header
            flatList.push({
                type: 'header',
                capitulo: chapter.capitulo,
                count: chapter.posicoes.length
            });

            // Add Positions
            chapter.posicoes.forEach(pos => {
                const currentIndex = flatList.length;
                flatList.push({ type: 'item', pos });

                // Map normalize code to index for fast lookup
                // Store both raw "8417.10" and clean "841710"
                indexMap[pos.codigo] = currentIndex;
                indexMap[pos.codigo.replace(/\./g, '')] = currentIndex;
                anchorMap[generateAnchorId(pos.codigo)] = currentIndex;
            });
        });

        debug.log(`[Sidebar] Flattened ${flatList.length} items from ${sortedChapters.length} chapters.`);
        return { items: flatList, codeToIndex: indexMap, anchorToIndex: anchorMap };
    }, [results]);

    const [highlightedIndex, setHighlightedIndex] = React.useState<number | null>(null);

    // 2. Handle Auto-Scroll using Virtuoso
    // 2. Handle Auto-Scroll using Virtuoso
    useEffect(() => {
        if (!searchQuery || items.length === 0) return;

        const rawQuery = searchQuery.trim();
        if (!rawQuery) return;

        const normalizedQuery = isTipi ? rawQuery : normalizeNCMQuery(rawQuery);
        // Guard: Check normalized query to prevent loops if format changes slightly
        if (lastScrolledQueryRef.current === normalizedQuery) return;

        const cleanQuery = isTipi
            ? rawQuery.replace(/\D/g, '')
            : normalizedQuery.replace(/\./g, '');

        debug.log('[Sidebar Autoscroll] Look for:', normalizedQuery, 'Last:', lastScrolledQueryRef.current);

        // Try exact match first
        let targetIndex = codeToIndex[normalizedQuery] ?? codeToIndex[cleanQuery];

        // Partial match if strict fails (look for startsWith in keys?)
        // Since O(N) lookup on keys is okay for user action (clicks/search), we can scan if needed.
        if (targetIndex === undefined) {
            // Find first item that starts with query
            // Note: items contains headers too, we only care about positions
            const foundItemIndex = items.findIndex(item =>
                item.type === 'item' &&
                item.pos.codigo.replace(/\D/g, '').startsWith(cleanQuery)
            );
            if (foundItemIndex !== -1) targetIndex = foundItemIndex;
        }

        if (targetIndex !== undefined) {
            debug.log('[Sidebar Autoscroll] Scrolling to index:', targetIndex);

            // Wait for slight delay to ensure list is ready/measured
            requestAnimationFrame(() => {
                // Double check Ref execution to avoid race conditions
                if (lastScrolledQueryRef.current === normalizedQuery) return;
                lastScrolledQueryRef.current = normalizedQuery;

                virtuosoRef.current?.scrollToIndex({
                    index: targetIndex,
                    align: 'center',
                    behavior: 'smooth'
                });

                // Set highlight
                setHighlightedIndex(targetIndex);

                // Remove highlight after animation
                setTimeout(() => {
                    setHighlightedIndex(null);
                }, 2500);
            });
        }
    }, [searchQuery, items, codeToIndex]);

    useEffect(() => {
        if (!activeAnchorId || items.length === 0) return;
        const targetIndex = anchorToIndex[activeAnchorId];
        if (targetIndex === undefined) return;

        virtuosoRef.current?.scrollToIndex({
            index: targetIndex,
            align: 'center',
            behavior: 'smooth'
        });
        setHighlightedIndex(targetIndex);
    }, [activeAnchorId, anchorToIndex, items.length]);


    if (!results || Object.keys(results).length === 0) return null;

    return (
        <>
            <div
                className={`${styles.sidebarOverlay} ${isOpen ? styles.open : ''}`}
                onClick={onClose}
            />

            <div className={`${styles.navSidebar} ${styles.active} ${isOpen ? styles.mobileOpen : ''} ${isTipi ? styles.navSidebarTipi : ''}`}>
                <div className={styles.navHeader}>
                    <h3>Navegação</h3>
                    <button className={styles.closeSidebarBtn} onClick={onClose} aria-label="Fechar menu">✕</button>
                </div>

                <div className={styles.virtualContainer}>
                    <Virtuoso
                        ref={virtuosoRef}
                        data={items}
                        totalCount={items.length}
                        className={`${styles.virtualList} ${isTipi ? styles.virtualListTipi : ''}`}
                        itemContent={(index, item) => {
                            if (item.type === 'header') {
                                return (
                                    <div className={`${styles.chapterTitle} ${isTipi ? styles.chapterTitleTipi : ''}`}>
                                        <span>Capítulo {item.capitulo}</span>
                                        <span className={styles.chapterBadge}>{item.count}</span>
                                    </div>
                                );
                            }

                            const { pos } = item;
                            const isHighlighted = index === highlightedIndex;
                            const level = typeof pos.nivel === 'number' ? Math.min(pos.nivel, 5) : null;
                            const levelClass = level ? styles[`tipiLevel${level}` as keyof typeof styles] : '';

                            return (
                                <button
                                    className={`${styles.item} ${isTipi ? styles.itemTipi : ''} ${levelClass} ${isHighlighted ? styles.itemHighlight : ''}`}
                                    onClick={() => {
                                        const targetId = pos.anchor_id || generateAnchorId(pos.codigo);
                                        debug.log('[Sidebar] Navigating to:', targetId);
                                        onNavigate(targetId);
                                        if (window.innerWidth < 768) onClose();
                                    }}
                                    title={pos.descricao}
                                >
                                    <span className={`${styles.itemCode} ${isTipi ? styles.itemCodeTipi : ''}`}>{pos.codigo}</span>
                                    <span className={`${styles.itemDesc} ${isTipi ? styles.itemDescTipi : ''}`}>{pos.descricao}</span>
                                </button>
                            );
                        }}
                    />
                </div>
            </div>
        </>
    );
});

