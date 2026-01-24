import { useState, useRef, useEffect } from 'react';
import { SearchBar } from './SearchBar';
import { HistoryItem } from '../hooks/useHistory';
import styles from './Header.module.css';

interface HeaderProps {
    onSearch: (term: string) => void;
    doc: string;
    setDoc: (doc: string) => void;
    searchKey: string;
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
    onMenuOpen: () => void; // Prop for mobile sidebar toggle
    isLoading?: boolean;
}

export function Header({
    onSearch,
    doc,
    setDoc,
    searchKey,
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
    onMenuOpen, // Prop for mobile sidebar toggle
    isLoading
}: HeaderProps) {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsMenuOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    return (
        <header className={styles.header}>
            <div className={styles.headerContent}>
                <div className={styles.logo}>
                    {/* Mobile Nav Toggle */}
                    <button
                        className={styles.mobileNavToggle}
                        onClick={onMenuOpen}
                        aria-label="Abrir Navegação"
                    >
                        📑
                    </button>
                    <div className={styles.logoIcon}>📦</div>
                    <div className={styles.logoText}>
                        <h1>Busca NCM</h1>
                        <span className={styles.logoSubtitle}>{doc === 'nesh' ? 'Notas Explicativas do Sistema Harmonizado' : 'Tabela de Incidência do IPI'}</span>
                    </div>
                </div>

                <div className={styles.searchContainer}>
                    <SearchBar
                        key={searchKey}
                        onSearch={onSearch}
                        history={history}
                        onClearHistory={onClearHistory}
                        onRemoveHistory={onRemoveHistory}
                        isLoading={isLoading}
                    />
                </div>

                <div className={styles.docSelector}>
                    <button
                        className={`${styles.docButton} ${doc === 'nesh' ? styles.docButtonActive : ''}`}
                        onClick={() => setDoc('nesh')}
                    >
                        NESH
                    </button>
                    <button
                        className={`${styles.docButton} ${doc === 'tipi' ? styles.docButtonActive : ''}`}
                        onClick={() => setDoc('tipi')}
                    >
                        TIPI
                    </button>
                </div>

                <div className={styles.menuDropdown} ref={menuRef}>
                    <button
                        className={`${styles.menuTrigger} ${isMenuOpen ? styles.menuTriggerActive : ''}`}
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                    >
                        <span>☰</span> Menu
                    </button>

                    <div className={`${styles.menuContent} ${isMenuOpen ? styles.menuContentOpen : ''}`}>
                        <button onClick={() => { setIsMenuOpen(false); onOpenComparator(); }}>
                            <span>⚖️</span> Comparar NCMs
                        </button>
                        <div className={styles.menuDivider}></div>
                        <button onClick={() => { setIsMenuOpen(false); onOpenSettings(); }}>
                            <span>⚙️</span> Configurações
                        </button>
                        <button onClick={() => { setIsMenuOpen(false); onOpenTutorial(); }}>
                            <span>❓</span> Ajuda / Tutorial
                        </button>
                        <div className={styles.menuDivider}></div>
                        <button onClick={() => { setIsMenuOpen(false); onOpenStats(); }}>
                            <span>📊</span> Estatísticas
                        </button>

                        <div className={styles.menuDivider}></div>

                        {!isAdmin ? (
                            <button onClick={() => { setIsMenuOpen(false); onOpenLogin(); }}>
                                <span>🔒</span> Acesso Admin
                            </button>
                        ) : (
                            <>
                                <button className={styles.adminBadge}>
                                    <span>👑</span> Admin Ativo
                                </button>
                                <div className={styles.menuDivider}></div>
                                <button className={styles.logoutButton} onClick={() => { setIsMenuOpen(false); onLogout(); }}>
                                    <span>🚪</span> Sair
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}
