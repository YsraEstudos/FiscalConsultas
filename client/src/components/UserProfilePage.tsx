/**
 * UserProfilePage — Modal de Perfil do Usuário
 *
 * Tabs: Perfil | Contribuições | Sessões | Organização (admin)
 * Integra dados da API customizada + componentes nativos do Clerk.
 */
import { useState, useEffect, useCallback } from 'react';
import { UserProfile, OrganizationProfile } from '@clerk/clerk-react';
import { useAuth } from '../context/AuthContext';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { clerkTheme } from '../config/clerkAppearance';
import {
    getMyProfile,
    updateMyProfile,
    getMyContributions,
    deleteMyAccount,
} from '../services/api';
import styles from './UserProfilePage.module.css';

interface UserProfilePageProps {
    isOpen: boolean;
    onClose: () => void;
}

type TabKey = 'profile' | 'contributions' | 'sessions' | 'organization';

interface ProfileData {
    user_id: string;
    email: string;
    full_name: string | null;
    bio: string | null;
    image_url: string | null;
    tenant_id: string;
    org_name: string | null;
    is_active: boolean;
    comment_count: number;
    pending_comment_count: number;
    approved_comment_count: number;
}

interface ContributionItem {
    id: number;
    type: string;
    anchor_key: string;
    selected_text: string;
    body: string;
    status: string;
    created_at: string;
    updated_at: string;
}

// ─── Module-level helpers ─────────────────────────────────────────────────

function getInitials(name: string | null): string {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function statusClass(status: string): string {
    switch (status) {
        case 'approved': return styles.statusApproved;
        case 'pending': return styles.statusPending;
        case 'rejected': return styles.statusRejected;
        case 'private': return styles.statusPrivate;
        default: return '';
    }
}

function statusLabel(status: string): string {
    switch (status) {
        case 'approved': return 'Aprovado';
        case 'pending': return 'Pendente';
        case 'rejected': return 'Rejeitado';
        case 'private': return 'Privado';
        default: return status;
    }
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString('pt-BR', {
            day: '2-digit', month: 'short', year: 'numeric',
        });
    } catch {
        return iso;
    }
}

// ─── ContributionsSection ────────────────────────────────────────────────

interface ContributionsSectionProps {
    contributions: ContributionItem[];
    contribLoading: boolean;
    contribSearch: string;
    onSearchChange: (value: string) => void;
    contribTotal: number;
    contribPage: number;
    contribHasNext: boolean;
    onPrevPage: () => void;
    onNextPage: () => void;
}

function ContributionsSection({
    contributions,
    contribLoading,
    contribSearch,
    onSearchChange,
    contribTotal,
    contribPage,
    contribHasNext,
    onPrevPage,
    onNextPage,
}: Readonly<ContributionsSectionProps>) {
    const emptyMsg = contribSearch
        ? 'Nenhum comentário encontrado para esta busca.'
        : 'Você ainda não fez nenhum comentário.';
    const countLabel = contribTotal === 1 ? 'comentário encontrado' : 'comentários encontrados';

    return (
        <>
            <input
                className={styles.searchBox}
                type="text"
                placeholder="🔍 Buscar nos seus comentários..."
                value={contribSearch}
                onChange={(e) => onSearchChange(e.target.value)}
            />

            {contribLoading ? (
                <div className={styles.loading}>Carregando contribuições...</div>
            ) : contributions.length === 0 ? (
                <div className={styles.empty}>{emptyMsg}</div>
            ) : (
                <>
                    <div className={`${styles.pageInfo} ${styles.contribSummary}`}>
                        {contribTotal} {countLabel}
                    </div>
                    {contributions.map((item) => (
                        <div key={item.id} className={styles.contributionItem}>
                            <div className={styles.contributionHeader}>
                                <span className={styles.contributionAnchor}>{item.anchor_key}</span>
                                <span className={`${styles.contributionStatus} ${statusClass(item.status)}`}>
                                    {statusLabel(item.status)}
                                </span>
                            </div>
                            <div className={styles.contributionBody}>{item.body}</div>
                            <div className={styles.contributionDate}>{formatDate(item.created_at)}</div>
                        </div>
                    ))}
                    <div className={styles.pagination}>
                        <button disabled={contribPage <= 1} onClick={onPrevPage}>
                            ← Anterior
                        </button>
                        <span className={styles.pageInfo}>Página {contribPage}</span>
                        <button disabled={!contribHasNext} onClick={onNextPage}>
                            Próxima →
                        </button>
                    </div>
                </>
            )}
        </>
    );
}

// ─── UserProfilePage ─────────────────────────────────────────────────────

export function UserProfilePage({ isOpen, onClose }: Readonly<UserProfilePageProps>) {
    const { userName, userEmail, userImageUrl } = useAuth();
    const isAdmin = useIsAdmin();

    const [activeTab, setActiveTab] = useState<TabKey>('profile');
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [bio, setBio] = useState('');
    const [bioSaving, setBioSaving] = useState(false);
    const [bioSaved, setBioSaved] = useState(false);
    const [loading, setLoading] = useState(true);

    // Contributions state
    const [contributions, setContributions] = useState<ContributionItem[]>([]);
    const [contribTotal, setContribTotal] = useState(0);
    const [contribPage, setContribPage] = useState(1);
    const [contribHasNext, setContribHasNext] = useState(false);
    const [contribSearch, setContribSearch] = useState('');
    const [contribLoading, setContribLoading] = useState(false);

    // Delete account state
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteStep, setDeleteStep] = useState(0); // 0: initial, 1: first confirm, 2: deleting
    const [deleteConfirmText, setDeleteConfirmText] = useState('');

    // Close on ESC
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (showDeleteConfirm) {
                    setShowDeleteConfirm(false);
                    setDeleteStep(0);
                } else {
                    onClose();
                }
            }
        };
        if (isOpen) globalThis.addEventListener('keydown', handleEsc);
        return () => globalThis.removeEventListener('keydown', handleEsc);
    }, [isOpen, onClose, showDeleteConfirm]);

    // Fetch profile on open
    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        getMyProfile()
            .then((data) => {
                setProfile(data);
                setBio(data.bio || '');
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [isOpen]);

    // Fetch contributions
    const fetchContributions = useCallback(async (page: number, search: string) => {
        setContribLoading(true);
        try {
            const data = await getMyContributions({ page, page_size: 15, search: search || undefined });
            setContributions(data.items);
            setContribTotal(data.total);
            setContribHasNext(data.has_next);
            setContribPage(data.page);
        } catch (err) {
            console.error('Failed to load contributions:', err);
        } finally {
            setContribLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen && activeTab === 'contributions') {
            fetchContributions(contribPage, contribSearch);
        }
    }, [isOpen, activeTab, contribPage, contribSearch, fetchContributions]);

    if (!isOpen) return null;

    const handleSaveBio = async () => {
        setBioSaving(true);
        setBioSaved(false);
        try {
            const updated = await updateMyProfile({ bio: bio || null });
            setProfile(updated);
            setBioSaved(true);
            setTimeout(() => setBioSaved(false), 3000);
        } catch (err) {
            console.error('Failed to save bio:', err);
        } finally {
            setBioSaving(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (deleteStep === 0) {
            setDeleteStep(1);
            return;
        }
        if (deleteStep === 1 && deleteConfirmText.toLowerCase() === 'deletar') {
            setDeleteStep(2);
            try {
                await deleteMyAccount();
                // Account deleted — Clerk will handle session cleanup
                onClose();
                globalThis.location.reload();
            } catch (err) {
                console.error('Failed to delete account:', err);
                setDeleteStep(1);
            }
        }
    };

    const tabs: { key: TabKey; label: string; icon: string; adminOnly?: boolean }[] = [
        { key: 'profile', label: 'Perfil', icon: '👤' },
        { key: 'contributions', label: 'Contribuições', icon: '💬' },
        { key: 'sessions', label: 'Sessões', icon: '🔐' },
        { key: 'organization', label: 'Organização', icon: '🏢', adminOnly: true },
    ];

    return (
        <div className={styles.overlay}>
            {/* Backdrop button — closes on click, accessible to keyboard via ESC global handler */}
            <button
                type="button"
                className={styles.backdrop}
                onClick={onClose}
                aria-label="Fechar perfil"
            />

            <dialog
                open
                className={styles.container}
                aria-labelledby="profile-title"
            >
                {/* Header */}
                <div className={styles.header}>
                    <h2 id="profile-title">Meu Perfil</h2>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Fechar">×</button>
                </div>

                {/* Tabs */}
                <div className={styles.tabs}>
                    {tabs
                        .filter(t => !t.adminOnly || isAdmin)
                        .map(t => (
                            <button
                                key={t.key}
                                className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`}
                                onClick={() => setActiveTab(t.key)}
                            >
                                {t.icon} {t.label}
                            </button>
                        ))
                    }
                </div>

                {/* Body */}
                <div className={styles.body}>
                    {loading && activeTab === 'profile' ? (
                        <div className={styles.loading}>Carregando perfil...</div>
                    ) : (
                        <>
                            {/* ─── Profile Tab ─── */}
                            {activeTab === 'profile' && profile && (
                                <>
                                    <div className={styles.profileHeader}>
                                        {userImageUrl ? (
                                            <img src={userImageUrl} alt="Avatar" className={styles.avatar} />
                                        ) : (
                                            <div className={styles.avatarPlaceholder}>
                                                {getInitials(userName)}
                                            </div>
                                        )}
                                        <div className={styles.profileInfo}>
                                            <h3>{userName || 'Usuário'}</h3>
                                            <p>{userEmail || profile.email}</p>
                                            {profile.org_name && <p>🏢 {profile.org_name}</p>}
                                        </div>
                                    </div>

                                    {/* Bio Card */}
                                    <div className={styles.card}>
                                        <h4>📝 Mini-Bio</h4>
                                        <textarea
                                            className={styles.bioTextarea}
                                            value={bio}
                                            onChange={(e) => setBio(e.target.value)}
                                            placeholder="Conte um pouco sobre você..."
                                            maxLength={500}
                                        />
                                        <div className={styles.bioFooter}>
                                            <span className={styles.charCount}>{bio.length}/500</span>
                                            <div>
                                                {bioSaved && <span className={styles.savedMsg}>✓ Salvo!</span>}
                                                <button
                                                    className={styles.saveBtn}
                                                    onClick={handleSaveBio}
                                                    disabled={bioSaving}
                                                >
                                                    {bioSaving ? 'Salvando...' : 'Salvar Bio'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Stats Summary */}
                                    <div className={styles.statsGrid}>
                                        <div className={styles.statCard}>
                                            <div className={styles.statValue}>{profile.comment_count}</div>
                                            <div className={styles.statLabel}>Total Comentários</div>
                                        </div>
                                        <div className={styles.statCard}>
                                            <div className={styles.statValue}>{profile.approved_comment_count}</div>
                                            <div className={styles.statLabel}>Aprovados</div>
                                        </div>
                                        <div className={styles.statCard}>
                                            <div className={styles.statValue}>{profile.pending_comment_count}</div>
                                            <div className={styles.statLabel}>Pendentes</div>
                                        </div>
                                    </div>

                                    {/* Clerk Security (password, 2FA, etc) */}
                                    <div className={styles.card}>
                                        <h4>🔑 Segurança & Senha</h4>
                                        <div className={styles.clerkEmbed}>
                                            <UserProfile
                                                appearance={{
                                                    ...clerkTheme,
                                                    elements: {
                                                        ...clerkTheme.elements,
                                                        rootBox: { width: '100%' },
                                                        card: { backgroundColor: 'transparent', border: 'none', boxShadow: 'none' },
                                                        navbar: { display: 'none' },
                                                        pageScrollBox: { padding: 0 },
                                                    },
                                                }}
                                            />
                                        </div>
                                    </div>

                                    {/* Delete Account */}
                                    <div className={styles.dangerZone}>
                                        <h4>⚠️ Zona de Perigo</h4>
                                        <p>Ao desativar sua conta, seus dados de perfil serão removidos e você perderá acesso ao sistema.</p>
                                        <button
                                            className={styles.deleteBtn}
                                            onClick={() => setShowDeleteConfirm(true)}
                                        >
                                            Desativar Minha Conta
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* ─── Contributions Tab ─── */}
                            {activeTab === 'contributions' && (
                                <ContributionsSection
                                    contributions={contributions}
                                    contribLoading={contribLoading}
                                    contribSearch={contribSearch}
                                    onSearchChange={(v) => { setContribSearch(v); setContribPage(1); }}
                                    contribTotal={contribTotal}
                                    contribPage={contribPage}
                                    contribHasNext={contribHasNext}
                                    onPrevPage={() => setContribPage(p => p - 1)}
                                    onNextPage={() => setContribPage(p => p + 1)}
                                />
                            )}

                            {/* ─── Sessions Tab ─── */}
                            {activeTab === 'sessions' && (
                                <div className={styles.clerkEmbed}>
                                    <UserProfile
                                        appearance={{
                                            ...clerkTheme,
                                            elements: {
                                                ...clerkTheme.elements,
                                                rootBox: { width: '100%' },
                                                card: { backgroundColor: 'transparent', border: 'none', boxShadow: 'none' },
                                                navbar: { display: 'none' },
                                                pageScrollBox: { padding: 0 },
                                            },
                                        }}
                                    />
                                </div>
                            )}

                            {/* ─── Organization Tab (Admin) ─── */}
                            {activeTab === 'organization' && isAdmin && (
                                <div className={styles.clerkEmbed}>
                                    <OrganizationProfile
                                        appearance={{
                                            ...clerkTheme,
                                            elements: {
                                                ...clerkTheme.elements,
                                                rootBox: { width: '100%' },
                                                card: { backgroundColor: 'transparent', border: 'none', boxShadow: 'none' },
                                                navbar: { display: 'none' },
                                                pageScrollBox: { padding: 0 },
                                            },
                                        }}
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>
            </dialog>

            {/* ─── Double Confirm Delete Modal ─── */}
            {showDeleteConfirm && (
                <div className={styles.confirmWrapper}>
                    <button
                        type="button"
                        className={styles.confirmBackdrop}
                        onClick={() => { setShowDeleteConfirm(false); setDeleteStep(0); }}
                        aria-label="Fechar confirmação"
                    />
                    <dialog
                        open
                        className={styles.confirmBox}
                        role="alertdialog"
                        aria-modal="true"
                    >
                        {deleteStep === 0 ? (
                            <>
                                <h3>⚠️ Desativar Conta</h3>
                                <p>Tem certeza que deseja desativar sua conta? Esta ação não pode ser desfeita facilmente.</p>
                                <div className={styles.confirmActions}>
                                    <button className={styles.cancelBtn} onClick={() => { setShowDeleteConfirm(false); setDeleteStep(0); }}>
                                        Cancelar
                                    </button>
                                    <button className={styles.confirmDeleteBtn} onClick={() => setDeleteStep(1)}>
                                        Sim, continuar
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h3>🚨 Confirmação Final</h3>
                                <p>
                                    Digite <strong>"deletar"</strong> para confirmar a desativação permanente da sua conta.
                                </p>
                                <input
                                    className={`${styles.searchBox} ${styles.confirmInput}`}
                                    type="text"
                                    placeholder='Digite "deletar"'
                                    value={deleteConfirmText}
                                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                                    autoFocus
                                />
                                <div className={styles.confirmActions}>
                                    <button className={styles.cancelBtn} onClick={() => { setShowDeleteConfirm(false); setDeleteStep(0); setDeleteConfirmText(''); }}>
                                        Cancelar
                                    </button>
                                    <button
                                        className={styles.confirmDeleteBtn}
                                        disabled={deleteConfirmText.toLowerCase() !== 'deletar' || deleteStep === 2}
                                        onClick={handleDeleteAccount}
                                    >
                                        {deleteStep === 2 ? 'Desativando...' : 'Desativar Conta'}
                                    </button>
                                </div>
                            </>
                        )}
                    </dialog>
                </div>
            )}
        </div>
    );
}
