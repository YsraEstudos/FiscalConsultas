import { useState, useRef, useEffect } from 'react';
import { SearchBar } from './SearchBar';
import { HistoryItem } from '../hooks/useHistory';
import { useAuth } from '../context/AuthContext';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { Modal } from './Modal';
import styles from './Header.module.css';

const DOC_SUBTITLES: Record<string, string> = {
    nbs: 'Classificação Brasileira de Serviços',
    nebs: 'Classificação Brasileira de Serviços',
    nesh: 'Notas Explicativas do Sistema Harmonizado',
    tipi: 'Tabela de Incidência do IPI',
};

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
    servicesUnavailableReason?: string | null;
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
    servicesUnavailableReason = null,
    history,
    onClearHistory,
    onRemoveHistory,
    onMenuOpen,
    isLoading
}: HeaderProps) {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
    const [isSigningOut, setIsSigningOut] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const {
        isSignedIn,
        userName,
        userEmail,
        isAuthConfigured,
        authUnavailableReason,
        openLogin,
        logout
    } = useAuth();
    const isAdmin = useIsAdmin();
    const isServiceDoc = doc === 'nbs' || doc === 'nebs';
    const titleSubtitle = DOC_SUBTITLES[doc] || DOC_SUBTITLES.tipi;

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
        setIsMenuOpen(prev => !prev);
    };

    const handleConfirmLogout = async () => {
        if (isSigningOut) return;
        setIsSigningOut(true);
        try {
            await logout();
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
                        <div className={styles.logoTitleRow}>
                            <h1>Busca NCM</h1>
                            <span className={styles.versionBadge}>1.0.0</span>
                        </div>
                        <span className={styles.logoSubtitle}>{titleSubtitle}</span>
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
                        className={`${styles.docButton} ${doc === (isServiceDoc ? 'nbs' : 'nesh') ? styles.docButtonActive : ''}`}
                        onClick={() => setDoc(isServiceDoc ? 'nbs' : 'nesh')}
                    >
                        {isServiceDoc ? 'NBS' : 'NESH'}
                    </button>
                    <button
                        className={`${styles.docButton} ${doc === (isServiceDoc ? 'nebs' : 'tipi') ? styles.docButtonActive : ''}`}
                        onClick={() => setDoc(isServiceDoc ? 'nebs' : 'tipi')}
                    >
                        {isServiceDoc ? 'NEBS' : 'TIPI'}
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
                        {isServiceDoc && (
                            <>
                                <button onClick={() => { setIsMenuOpen(false); setDoc('nesh'); }}>
                                    <span>📘</span> Voltar para NESH
                                </button>
                                <button onClick={() => { setIsMenuOpen(false); setDoc('tipi'); }}>
                                    <span>🏷️</span> Ir para TIPI
                                </button>
                                <div className={styles.menuDivider}></div>
                            </>
                        )}
                        <button onClick={() => { setIsMenuOpen(false); onOpenComparator(); }}>
                            <span>⚖️</span> Comparar NCMs
                        </button>
                        {!isServiceDoc && (
                            <button 
                                onClick={() => { setIsMenuOpen(false); setDoc('nbs'); }}
                                disabled={Boolean(servicesUnavailableReason)}
                                className={servicesUnavailableReason ? styles.menuButtonDisabled : ''}
                                title={servicesUnavailableReason ?? undefined}
                            >
                                <span>🧭</span> {servicesUnavailableReason ? 'Serviços (NBS) indisponível' : 'Serviços (NBS)'}
                            </button>
                        )}
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
                        {!isSignedIn && (
                            <button
                                onClick={() => {
                                    setIsMenuOpen(false);
                                    openLogin();
                                }}
                                disabled={!isAuthConfigured}
                                className={!isAuthConfigured ? styles.menuButtonDisabled : ''}
                                title={!isAuthConfigured ? (authUnavailableReason || 'Login indisponível no momento.') : undefined}
                            >
                                <span>🔐</span> {isAuthConfigured ? 'Entrar' : 'Login indisponível'}
                            </button>
                        )}

                        {isSignedIn && (
                            <>
                                <div className={styles.userSection}>
                                    <div className={styles.userSummary}>
                                        <strong>{userName || 'Usuário'}</strong>
                                        <span>{userEmail || 'Conta autenticada'}</span>
                                    </div>
                                </div>
                                <button onClick={() => { setIsMenuOpen(false); onOpenProfile(); }}>
                                    <span>👤</span> Meu Perfil
                                </button>
                                <button className={styles.logoutMenuButton} onClick={handleLogoutClick}>
                                    <span>🚪</span> Sair da conta
                                </button>
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
