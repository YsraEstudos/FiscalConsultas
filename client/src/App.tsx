import { useEffect, useCallback, useState, Suspense, lazy } from 'react';
import axios from 'axios';
import { Toaster, toast } from 'react-hot-toast';
import { Layout } from './components/Layout';
import { ResultDisplay } from './components/ResultDisplay';
import { TabsBar } from './components/TabsBar';
import { ResultSkeleton } from './components/ResultSkeleton';
import { useTabs } from './hooks/useTabs';
import { searchNCM, searchTipi, getGlossaryTerm } from './services/api';
import { useAuth } from './context/AuthContext';
import { useSettings } from './context/SettingsContext';
import { useHistory } from './hooks/useHistory';
import styles from './App.module.css';

// Lazy load heavy modals to optimize initial bundle size
const SettingsModal = lazy(() => import('./components/SettingsModal').then(module => ({ default: module.SettingsModal })));
const TutorialModal = lazy(() => import('./components/TutorialModal').then(module => ({ default: module.TutorialModal })));
const GlossaryModal = lazy(() => import('./components/GlossaryModal').then(module => ({ default: module.GlossaryModal })));
const StatsModal = lazy(() => import('./components/StatsModal').then(module => ({ default: module.StatsModal })));
const LoginModal = lazy(() => import('./components/LoginModal').then(module => ({ default: module.LoginModal })));
const AIChat = lazy(() => import('./components/AIChat').then(module => ({ default: module.AIChat })));
const ComparatorModal = lazy(() => import('./components/ComparatorModal').then(module => ({ default: module.ComparatorModal })));
const CrossNavContextMenu = lazy(() => import('./components/CrossNavContextMenu').then(module => ({ default: module.CrossNavContextMenu })));

// Global declaration moved to vite-env.d.ts

function App() {
    const {
        tabs,
        activeTab,
        activeTabId,
        createTab,
        closeTab,
        switchTab,
        updateTab
    } = useTabs();

    const { history, addToHistory, removeFromHistory, clearHistory } = useHistory();

    const [_isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [_isTutorialOpen, setIsTutorialOpen] = useState(false);
    const [isStatsOpen, setIsStatsOpen] = useState(false);
    const [isLoginOpen, setIsLoginOpen] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [isComparatorOpen, setIsComparatorOpen] = useState(false);

    const { isAdmin, logout } = useAuth();
    const { tipiViewMode } = useSettings();

    const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
    const noop = useCallback(() => {}, []);

    // Glossary State
    type GlossaryState = {
        isOpen: boolean;
        term: string;
        definition: any; // Specify strict type once data model is known
        loading: boolean;
    };

    const [glossaryState, setGlossaryState] = useState<GlossaryState>({
        isOpen: false,
        term: '',
        definition: null,
        loading: false
    });

    // Global Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Focus search with '/'
            if (document.activeElement && e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                const searchInput = document.getElementById('ncmInput');
                if (searchInput) searchInput.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Glossary Click Handler (Delegation)
    useEffect(() => {
        const handleGlobalClick = async (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const termElement = target.closest('.glossary-term') as HTMLElement;
            if (termElement) {
                const term = termElement.dataset.term;
                if (term) {
                    openGlossary(term);
                }
            }
        };

        document.addEventListener('click', handleGlobalClick);
        return () => document.removeEventListener('click', handleGlobalClick);
    }, []);

    const openGlossary = async (term: string) => {
        setGlossaryState({ isOpen: true, term, definition: null, loading: true });
        try {
            const data = await getGlossaryTerm(term);
            if (data.found) {
                setGlossaryState(prev => ({ ...prev, definition: data.data, loading: false }));
            } else {
                setGlossaryState(prev => ({ ...prev, definition: null, loading: false }));
            }
        } catch (e) {
            console.error(e);
            setGlossaryState(prev => ({ ...prev, loading: false }));
            toast.error("Erro ao buscar termo.");
        }
    };

    const closeGlossary = () => {
        setGlossaryState(prev => ({ ...prev, isOpen: false }));
    };

    type DocType = 'nesh' | 'tipi';

    const executeSearchForTab = useCallback(async (tabId: string, doc: DocType, query: string, saveHistory: boolean = true) => {
        if (!query) return;

        if (saveHistory) addToHistory(query);

        updateTab(tabId, { loading: true, error: null, ncm: query, title: query });

        try {
            const data = doc === 'nesh'
                ? await searchNCM(query)
                : await searchTipi(query, tipiViewMode);

            updateTab(tabId, {
                results: { ...data, query },
                content: data.markdown || data.resultados,
                loading: false,
                isNewSearch: true
            });
        } catch (err) {
            console.error(err);
            let message = 'Erro ao buscar dados. Verifique a API.';

            if (axios.isAxiosError(err)) {
                const status = err.response?.status;
                if (status === 404) {
                    message = 'Endpoint não encontrado (404). Verifique se o backend está rodando e se a base URL está correta.';
                } else if (status) {
                    message = `Erro ${status} ao buscar dados. Verifique a API.`;
                } else if (err.code === 'ECONNABORTED') {
                    message = 'Tempo limite na requisição. Verifique a conexão com o backend.';
                }
            }

            toast.error(message);
            updateTab(tabId, {
                error: message,
                loading: false
            });
        }
    }, [addToHistory, tipiViewMode, updateTab]);

    // Search function deals with the ACTIVE tab
    const handleSearch = useCallback(async (query: string) => {
        const doc = (activeTab?.document || 'nesh') as DocType;
        await executeSearchForTab(activeTabId, doc, query, true);
    }, [activeTab?.document, activeTabId, executeSearchForTab]);

    // Smart-link Click Handler (Delegation)
    useEffect(() => {
        const handleSmartLinkClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const smartLink = target.closest('a.smart-link') as HTMLAnchorElement | null;
            if (!smartLink) return;

            event.preventDefault();
            const ncm = smartLink.dataset.ncm;
            if (ncm) {
                handleSearch(ncm);
            }
        };

        document.addEventListener('click', handleSmartLinkClick);
        return () => document.removeEventListener('click', handleSmartLinkClick);
    }, [handleSearch]);

    const openInDocNewTab = useCallback(async (doc: DocType, ncm: string) => {
        const tabId = createTab(doc);
        await executeSearchForTab(tabId, doc, ncm, false);
    }, [createTab, executeSearchForTab]);

    const openInDocCurrentTab = useCallback(async (doc: DocType, ncm: string) => {
        // If current tab is occupied, open a new tab to avoid clobbering.
        if (activeTab.results || activeTab.ncm || activeTab.loading) {
            await openInDocNewTab(doc, ncm);
            return;
        }

        updateTab(activeTabId, {
            document: doc,
            results: null,
            content: null,
            error: null,
            ncm: ''
        });
        await executeSearchForTab(activeTabId, doc, ncm, false);
    }, [activeTab.loading, activeTab.ncm, activeTab.results, activeTabId, executeSearchForTab, openInDocNewTab, updateTab]);

    // Set document type for active tab (or open new if current has content)
    const setDoc = (doc: string) => {
        // If current tab has search results or search in progress, open in NEW tab
        if (activeTab.results || activeTab.ncm || activeTab.loading) { // Accessing ncm property which might be dynamic, check Tab type
            createTab(doc);
        } else {
            // If current tab is empty/initial, just switch its document type
            updateTab(activeTabId, {
                document: doc,
                results: null,
                content: null,
                error: null,
                // @ts-ignore: Tab type might not have ncm yet or it's extra
                ncm: ''
            });
        }
    };

    // Legacy Bridge + Settings Bridge
    useEffect(() => {
        window.nesh = {
            smartLinkSearch: (ncm: string) => {
                handleSearch(ncm);
            },
            openNote: (note: string, chapter?: string) => {
                alert(`Nota: ${note} (Capítulo ${chapter || 'Atual'})`);
            },
            openSettings: () => {
                setIsSettingsOpen(true);
            }
        };
        return () => {
            // @ts-ignore
            delete window.nesh;
        };
    }, [handleSearch]);

    return (
        <>
            <Toaster position="top-right" />
            <Suspense fallback={null}>
                <StatsModal isOpen={isStatsOpen} onClose={() => setIsStatsOpen(false)} />
                <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} />
                <SettingsModal isOpen={_isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
                <TutorialModal isOpen={_isTutorialOpen} onClose={() => setIsTutorialOpen(false)} />
                <ComparatorModal
                    isOpen={isComparatorOpen}
                    onClose={() => setIsComparatorOpen(false)}
                    defaultDoc={(activeTab?.document || 'nesh') as DocType}
                />

                <CrossNavContextMenu
                    currentDoc={(activeTab?.document || 'nesh') as DocType}
                    onOpenInDoc={openInDocCurrentTab}
                    onOpenInNewTab={openInDocNewTab}
                />

                {isAdmin && <AIChat />}

                <GlossaryModal
                    isOpen={glossaryState.isOpen}
                    onClose={closeGlossary}
                    term={glossaryState.term}
                    definition={glossaryState.definition}
                    loading={glossaryState.loading}
                />
            </Suspense>

            <Layout
                onSearch={handleSearch}
                doc={activeTab?.document || 'nesh'}
                setDoc={setDoc}
                searchKey={`${activeTabId}-${activeTab?.document || 'nesh'}`}
                onMenuOpen={() => setMobileMenuOpen(prev => !prev)}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenTutorial={() => setIsTutorialOpen(true)}
                onOpenStats={() => setIsStatsOpen(true)}
                onOpenLogin={() => setIsLoginOpen(true)}
                onOpenComparator={() => setIsComparatorOpen(true)}
                isAdmin={isAdmin}
                onLogout={logout}
                history={history}
                onClearHistory={clearHistory}
                onRemoveHistory={removeFromHistory}
                isLoading={activeTab?.loading}
            >
                <TabsBar
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onSwitch={switchTab}
                    onClose={closeTab}
                    onNewTab={() => createTab(activeTab?.document || 'nesh')}
                />

                <div className={styles.resultsSection}>
                    {activeTab?.loading && <ResultSkeleton />}

                    {activeTab?.error && (
                        <div className={styles.emptyState}>
                            <h3 className={styles.emptyStateTitle}>Erro</h3>
                            <p>{activeTab.error}</p>
                        </div>
                    )}

                    {!activeTab?.loading && !activeTab?.results && !activeTab?.error && (
                        <div className={styles.emptyState}>
                            <div className={styles.emptyStateIcon}>🔎</div>
                            <h3 className={styles.emptyStateTitle}>Pronto para buscar</h3>
                            <p>Digite um NCM acima ou use o histórico</p>
                            <p className={styles.emptyStateHint}>
                                Dica: Pressione <kbd>/</kbd> para buscar
                            </p>
                        </div>
                    )}

                    {/* Persistent Tabs Rendering - Keeps DOM alive for all tabs with results */}
                    {tabs.map(tab => {
                        if (!tab.results) return null;

                        const isActiveTab = tab.id === activeTabId;

                        // Hide active tab content if loading (show skeleton instead)
                        if (isActiveTab && tab.loading) return null;

                        return (
                            <div
                                key={tab.id}
                                className={`${styles.tabPane} ${isActiveTab ? styles.tabPaneActive : ''}`}
                            >
                                <ResultDisplay
                                    data={tab.results}
                                    mobileMenuOpen={isActiveTab ? mobileMenuOpen : false}
                                    onCloseMobileMenu={isActiveTab ? closeMobileMenu : noop}
                                    isActive={isActiveTab}
                                    tabId={tab.id}
                                    isNewSearch={tab.isNewSearch || false}
                                    onConsumeNewSearch={(finalScroll) => {
                                        const updates: Partial<any> = { isNewSearch: false };
                                        if (typeof finalScroll === 'number') updates.scrollTop = finalScroll;
                                        updateTab(tab.id, updates);
                                    }}
                                    initialScrollTop={typeof tab.scrollTop === 'number' ? tab.scrollTop : undefined}
                                    onPersistScroll={(id, top) => updateTab(id, { scrollTop: top })}
                                />
                            </div>
                        );
                    })}
                </div>
            </Layout>
        </>
    );
}

export default App;
