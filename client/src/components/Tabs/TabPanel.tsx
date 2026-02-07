import React, { useRef } from 'react';

interface TabPanelProps {
    id: string;
    activeTabId: string;
    children: React.ReactNode;
    className?: string;
}

/**
 * TabPanel Component
 * 
 * Implements "Lazy Loading + Keep Alive" pattern.
 * - Does not mount children until the tab is activated for the first time (Performance).
 * - Keep children mounted but hidden when tab is inactive (Persistence).
 */
export const TabPanel: React.FC<TabPanelProps> = ({ id, activeTabId, children, className }) => {
    const isActive = id === activeTabId;
    const hasBeenActive = useRef(false);

    if (isActive && !hasBeenActive.current) {
        hasBeenActive.current = true;
    }

    // Lazy Load: If never activated, render nothing
    if (!hasBeenActive.current) {
        return null;
    }

    return (
        <div
            role="tabpanel"
            hidden={!isActive}
            id={`tabpanel-${id}`}
            aria-labelledby={`tab-${id}`}
            className={className}
            style={{
                display: isActive ? 'block' : 'none',
                height: '100%',
                width: '100%'
            }}
        >
            {children}
        </div>
    );
};
