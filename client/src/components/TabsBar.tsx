import React, { useEffect, useRef } from 'react';
import { Tab } from '../hooks/useTabs';
import styles from './TabsBar.module.css';

interface TabsBarProps {
    tabs: Tab[];
    activeTabId: string;
    onSwitch: (tabId: string) => void;
    onClose: (e: React.MouseEvent, tabId: string) => void;
    onNewTab: () => void;
}

export const TabsBar = React.memo(function TabsBar({ tabs, activeTabId, onSwitch, onClose, onNewTab }: TabsBarProps) {
    const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    // Scroll to active tab when it changes
    useEffect(() => {
        const activeTabElement = tabRefs.current.get(activeTabId);
        if (activeTabElement) {
            activeTabElement.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'nearest'
            });
        }
    }, [activeTabId]);

    return (
        <div className={styles.tabsContainer}>
            {tabs.map(tab => (
                <div
                    key={tab.id}
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
