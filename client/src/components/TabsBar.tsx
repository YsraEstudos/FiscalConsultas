import React, { useEffect, useRef } from 'react';
import { Tab } from '../hooks/useTabs';
import styles from './TabsBar.module.css';

interface TabsBarProps {
    tabs: Tab[];
    activeTabId: string;
    onSwitch: (tabId: string) => void;
    onClose: (e: React.MouseEvent, tabId: string) => void;
    onReorder: (draggedTabId: string, targetTabId: string) => void;
    onNewTab: () => void;
}

export const TabsBar = React.memo(function TabsBar({ tabs, activeTabId, onSwitch, onClose, onReorder, onNewTab }: TabsBarProps) {
    const tabsContainerRef = useRef<HTMLDivElement | null>(null);
    const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const draggedTabIdRef = useRef<string | null>(null);

    const handleTabMouseDown = (event: React.MouseEvent<HTMLDivElement>, tabId: string) => {
        if (event.button !== 1) return;

        event.preventDefault();
        onClose(event, tabId);
    };

    // Keep the active tab visible inside the horizontal strip without nudging the page vertically.
    useEffect(() => {
        const tabsContainer = tabsContainerRef.current;
        const activeTabElement = tabRefs.current.get(activeTabId);
        if (!tabsContainer || !activeTabElement) return;

        const containerRect = tabsContainer.getBoundingClientRect();
        const activeRect = activeTabElement.getBoundingClientRect();
        const edgePadding = 16;
        let nextScrollLeft = tabsContainer.scrollLeft;

        if (activeRect.left < containerRect.left + edgePadding) {
            nextScrollLeft -= (containerRect.left + edgePadding) - activeRect.left;
        } else if (activeRect.right > containerRect.right - edgePadding) {
            nextScrollLeft += activeRect.right - (containerRect.right - edgePadding);
        } else {
            return;
        }

        const maxScrollLeft = Math.max(0, tabsContainer.scrollWidth - tabsContainer.clientWidth);
        const clampedScrollLeft = Math.min(Math.max(0, nextScrollLeft), maxScrollLeft);

        if (Math.abs(clampedScrollLeft - tabsContainer.scrollLeft) < 1) return;

        if (typeof tabsContainer.scrollTo === 'function') {
            tabsContainer.scrollTo({ left: clampedScrollLeft, behavior: 'smooth' });
            return;
        }

        tabsContainer.scrollLeft = clampedScrollLeft;
    }, [activeTabId]);

    return (
        <div ref={tabsContainerRef} className={styles.tabsContainer}>
            {tabs.map(tab => (
                <div
                    key={tab.id}
                    draggable
                    ref={(el) => {
                        if (el) {
                            tabRefs.current.set(tab.id, el);
                        } else {
                            tabRefs.current.delete(tab.id);
                        }
                    }}
                    tabIndex={0}
                    className={`${styles.tabButton} ${activeTabId === tab.id ? styles.tabButtonActive : ''}`}
                    data-document={tab.document}
                    onClick={() => onSwitch(tab.id)}
                    onMouseDown={(event) => handleTabMouseDown(event, tab.id)}
                    onDragStart={(e) => {
                        draggedTabIdRef.current = tab.id;
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', tab.id);
                    }}
                    onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        const draggedTabId = draggedTabIdRef.current || e.dataTransfer.getData('text/plain');
                        if (!draggedTabId) return;
                        onReorder(draggedTabId, tab.id);
                    }}
                    onDragEnd={() => {
                        draggedTabIdRef.current = null;
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSwitch(tab.id);
                        }
                    }}
                >
                    <span className={`${styles.tabDocBadge} ${tab.document === 'nesh' ? styles.tabDocBadgeNesh : styles.tabDocBadgeTipi}`}>
                        {tab.document === 'nesh' ? 'N' : 'T'}
                    </span>
                    <span className={styles.tabLabel}>
                        {tab.title}
                    </span>
                    <button
                        className={styles.tabClose}
                        title="Fechar aba"
                        onClick={(e) => onClose(e, tab.id)}
                    >
                        ×
                    </button>
                </div>
            ))}
            <button
                className={styles.newTabButton}
                onClick={onNewTab}
                title="Nova aba"
            >
                +
            </button>
        </div>
    );
});
