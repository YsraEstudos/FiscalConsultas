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
    onOpenLogin: () => void;
    onOpenComparator: () => void;
    isAdmin: boolean;
    onLogout: () => void;
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
    onOpenLogin,
    onOpenComparator,
    isAdmin,
    onLogout,
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
                onOpenLogin={onOpenLogin}
                onOpenComparator={onOpenComparator}
                isAdmin={isAdmin}
                onLogout={onLogout}
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
