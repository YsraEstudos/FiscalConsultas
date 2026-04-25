import { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { SearchBar } from './SearchBar';
import { HistoryItem } from '../hooks/useHistory';
import { useAuth } from '../context/AuthContext';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { Modal } from './Modal';
import styles from './Header.module.css';

const DOC_SUBTITLES: Record<string, string> = {
    nbs: 'Classificação Brasileira de Serviços',
    nebs: 'Notas Explicativas da Nomenclatura Brasileira de Serviços',
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

function getPrimaryDocButtonConfig(doc: string): {
label: string;
target: string;
isActive: boolean;
} {
switch (doc) {
case 'nesh':
return { label: 'NESH', target: 'nesh', isActive: true };
case 'nbs':
return { label: 'NEBS', target: 'nebs', isActive: true };
case 'nebs':
return { label: 'NBS', target: 'nbs', isActive: true };
default:
return { label: 'NESH', target: 'nesh', isActive: false };
}
}

function getConditionalClassName(
baseClass: string,
isActive: boolean,
activeClass: string,
): string {
return [baseClass, isActive ? activeClass : ''].filter(Boolean).join(' ');
}

function getServicesButtonLabel(
servicesUnavailableReason: string | null | undefined,
): string {
return servicesUnavailableReason ? 'Serviços (NBS) indisponível' : 'Serviços (NBS)';
}

function getAuthButtonLabel(isAuthConfigured: boolean): string {
return isAuthConfigured ? 'Entrar' : 'Login indisponível';
}

function getAuthButtonTitle(
isAuthConfigured: boolean,
authUnavailableReason: string | null | undefined,
): string | undefined {
if (isAuthConfigured) {
return undefined;
}

return authUnavailableReason || 'Login indisponível no momento.';
}

function getLogoutButtonLabel(isSigningOut: boolean): string {
return isSigningOut ? 'Saindo...' : 'Sair';
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
const primaryDocButton = getPrimaryDocButtonConfig(doc);
const primaryDocButtonClassName = getConditionalClassName(
styles.docButton,
primaryDocButton.isActive,
styles.docButtonActive,
);
const tipiDocButtonClassName = getConditionalClassName(
styles.docButton,
doc === 'tipi',
styles.docButtonActive,
);
const menuTriggerClassName = getConditionalClassName(
styles.menuTrigger,
isMenuOpen,
styles.menuTriggerActive,
);
const menuContentClassName = getConditionalClassName(
styles.menuContent,
isMenuOpen,
styles.menuContentOpen,
);
const servicesButtonClassName = getConditionalClassName(
'',
Boolean(servicesUnavailableReason),
styles.menuButtonDisabled,
);
const loginButtonClassName = getConditionalClassName(
'',
!isAuthConfigured,
styles.menuButtonDisabled,
);
const servicesButtonLabel = getServicesButtonLabel(servicesUnavailableReason);
const authButtonLabel = getAuthButtonLabel(isAuthConfigured);
const authButtonTitle = getAuthButtonTitle(
isAuthConfigured,
authUnavailableReason,
);
const logoutButtonLabel = getLogoutButtonLabel(isSigningOut);

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
className={primaryDocButtonClassName}
onClick={() => setDoc(primaryDocButton.target)}
                    >
{primaryDocButton.label}
                    </button>
                    <button
className={tipiDocButtonClassName}
                        onClick={() => setDoc('tipi')}
                    >
                        TIPI
                    </button>
                    <button
                        className={`${styles.docButton} ${styles.docButtonLocked}`}
                        onClick={() => toast('UNSPSC estará disponível em breve! 🔒\nEstamos trabalhando para trazer esta classificação internacional.', { icon: '🚧', duration: 4000, style: { background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px', fontSize: '0.9rem', lineHeight: '1.5' } })}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        UNSPSC
                    </button>
                </div>

                <div className={styles.menuDropdown} ref={menuRef}>
                    <button
className={menuTriggerClassName}
                        onClick={handleToggleMenu}
                    >
                        <span>☰</span> Menu
                    </button>

<div className={menuContentClassName}>
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
className={servicesButtonClassName}
                                title={servicesUnavailableReason ?? undefined}
                            >
<span>🧭</span> {servicesButtonLabel}
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
className={loginButtonClassName}
title={authButtonTitle}
                            >
<span>🔐</span> {authButtonLabel}
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
{logoutButtonLabel}
                        </button>
                    </div>
                </div>
            </Modal>
        </header>
    );
}
