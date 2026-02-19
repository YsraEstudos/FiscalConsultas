import { ReactNode } from 'react';
import { Header } from './Header';
import { HistoryItem } from '../hooks/useHistory';
import styles from './Layout.module.css';

interface LayoutProps {
    children: ReactNode;
    onSearch: (query: string) => void;
    doc: string;
    setDoc: (doc: string) => void;
    searchKey: string;
    onMenuOpen: () => void;
    onOpenSettings: () => void;
    onOpenTutorial: () => void;
    onOpenStats: () => void;
    onOpenComparator: () => void;
    onOpenModerate: () => void;
    history: HistoryItem[];
    onClearHistory: () => void;
    onRemoveHistory: (term: string) => void;
    isLoading?: boolean;
}

export function Layout({
    children,
    onSearch,
    doc,
    setDoc,
    searchKey,
    onMenuOpen,
    onOpenSettings,
    onOpenTutorial,
    onOpenStats,
    onOpenComparator,
    onOpenModerate,
    history,
    onClearHistory,
    onRemoveHistory,
    isLoading
}: LayoutProps) {
    return (
        <div className={styles.appLayout}>
            <Header
                onSearch={onSearch}
                doc={doc}
                setDoc={setDoc}
                searchKey={searchKey}
                onMenuOpen={onMenuOpen}
                onOpenSettings={onOpenSettings}
                onOpenTutorial={onOpenTutorial}
                onOpenStats={onOpenStats}
                onOpenComparator={onOpenComparator}
                onOpenModerate={onOpenModerate}
                history={history}
                onClearHistory={onClearHistory}
                onRemoveHistory={onRemoveHistory}
                isLoading={isLoading}
            />
            <main className={styles.mainContent}>
                {children}
            </main>
        </div>
    );
}
