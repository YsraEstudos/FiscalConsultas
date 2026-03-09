import { useState, useRef, useEffect } from 'react';
import { UserButton, OrganizationSwitcher, SignInButton, useClerk } from '@clerk/react';
import { SearchBar } from './SearchBar';
import { HistoryItem } from '../hooks/useHistory';
import {
    clerkOrganizationSwitcherAppearance,
    clerkTheme,
    clerkUserButtonAppearance
} from '../config/clerkAppearance';
import { useAuth } from '../context/AuthContext';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { Modal } from './Modal';
import styles from './Header.module.css';

interface HeaderProps {
    onSearch: (term: string) => void;
    doc: string;
    setDoc: (doc: string) => void;
    searchKey: string;
    onOpenSettings: () => void;
    onOpenTutorial: () => void;
    onOpenStats: () => void;
    onOpenComparator: () => void;
    onOpenModerate: () => void;
    onOpenProfile: () => void;
    history: HistoryItem[];
    onClearHistory: () => void;
    onRemoveHistory: (term: string) => void;
    onMenuOpen: () => void;
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
    onOpenComparator,
    onOpenModerate,
    onOpenProfile,
    history,
    onClearHistory,
    onRemoveHistory,
    onMenuOpen,
    isLoading
}: HeaderProps) {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [shouldRenderClerkWidgets, setShouldRenderClerkWidgets] = useState(false);
    const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
    const [isSigningOut, setIsSigningOut] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const { signOut } = useClerk();
    const { isSignedIn, userName, userEmail } = useAuth();
    const isAdmin = useIsAdmin();

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

    const handleLogoutClick = () => {
        setIsMenuOpen(false);
        setIsLogoutConfirmOpen(true);
    };

    const handleToggleMenu = () => {
        setIsMenuOpen(prev => {
            const next = !prev;
            if (next && !shouldRenderClerkWidgets) {
                setShouldRenderClerkWidgets(true);
            }
            return next;
        });
    };

    const handleConfirmLogout = async () => {
        if (isSigningOut) return;
        setIsSigningOut(true);
        try {
            await signOut({ redirectUrl: '/' });
        } finally {
            setIsSigningOut(false);
            setIsLogoutConfirmOpen(false);
        }
    };

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
                        onClick={handleToggleMenu}
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
                        {isAdmin && (
                            <button onClick={() => { setIsMenuOpen(false); onOpenStats(); }}>
                                <span>📊</span> Estatísticas
                            </button>
                        )}
                        {isAdmin && (
                            <button onClick={() => { setIsMenuOpen(false); onOpenModerate(); }}>
                                <span>🛡️</span> Moderar Comentários
                            </button>
                        )}

                        <div className={styles.menuDivider}></div>

                        {/* Clerk Auth Section */}
                        {shouldRenderClerkWidgets && (
                            <>
                                {!isSignedIn && (
                                    <SignInButton mode="modal" appearance={clerkTheme}>
                                        <button onClick={() => setIsMenuOpen(false)}>
                                            <span>🔐</span> Entrar
                                        </button>
                                    </SignInButton>
                                )}

                                {isSignedIn && (
                                    <>
                                        {/* Admin: apenas OrganizationSwitcher (dropdown já tem "Manage account") */}
                                        {isAdmin ? (
                                            <div className={styles.orgSwitcher}>
                                                <OrganizationSwitcher appearance={clerkOrganizationSwitcherAppearance} />
                                            </div>
                                        ) : (
                                            /* Usuário comum: apenas UserButton — sem avatar duplicado */
                                            <div className={styles.userSection}>
                                                <UserButton appearance={clerkUserButtonAppearance} />
                                            </div>
                                        )}
                                        <div className={styles.userSummary}>
                                            <strong>{userName || 'Usuário'}</strong>
                                            <span>{userEmail || 'Conta autenticada'}</span>
                                        </div>
                                        <button onClick={() => { setIsMenuOpen(false); onOpenProfile(); }}>
                                            <span>👤</span> Meu Perfil
                                        </button>
                                        <button className={styles.logoutMenuButton} onClick={handleLogoutClick}>
                                            <span>🚪</span> Sair da conta
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
            <Modal
                isOpen={isLogoutConfirmOpen}
                onClose={() => !isSigningOut && setIsLogoutConfirmOpen(false)}
                title="Confirmar saída"
            >
                <div className={styles.logoutModalBody}>
                    <p>Deseja encerrar sua sessão agora?</p>
                    <div className={styles.logoutActions}>
                        <button
                            type="button"
                            className={styles.logoutCancelButton}
                            onClick={() => setIsLogoutConfirmOpen(false)}
                            disabled={isSigningOut}
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            className={styles.logoutConfirmButton}
                            onClick={handleConfirmLogout}
                            disabled={isSigningOut}
                        >
                            {isSigningOut ? 'Saindo...' : 'Sair'}
                        </button>
                    </div>
                </div>
            </Modal>
        </header>
    );
}
