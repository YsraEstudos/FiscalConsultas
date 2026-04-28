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
    onOpenStats: () => void;
    onOpenComparator: () => void;
    onOpenModerate: () => void;
    onOpenProfile: () => void;
    servicesUnavailableReason?: string | null;
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
    onOpenStats,
    onOpenComparator,
    onOpenModerate,
    onOpenProfile,
    servicesUnavailableReason,
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
                onOpenStats={onOpenStats}
                onOpenComparator={onOpenComparator}
                onOpenModerate={onOpenModerate}
                onOpenProfile={onOpenProfile}
                servicesUnavailableReason={servicesUnavailableReason}
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
