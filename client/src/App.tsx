import { useEffect, useCallback, useRef, useState, Suspense } from 'react';

import { Toaster, toast } from 'react-hot-toast';
import { Layout } from './components/Layout';
import { ResultDisplay } from './components/ResultDisplay';
import { TabsBar } from './components/TabsBar';
import { ResultSkeleton } from './components/ResultSkeleton';
import { TabPanel } from './components/Tabs/TabPanel';
import { useTabs } from './hooks/useTabs';
import { useCrossChapterNotes } from './context/CrossChapterNoteContext';
import { useSearch } from './hooks/useSearch';
import { useHistory } from './hooks/useHistory';
import { extractChapter } from './utils/chapterDetection';
import { isCodeSearchResponse } from './types/api.types';
import { useSettings } from './context/SettingsContext';
import { NotePanel } from './components/NotePanel';
import styles from './App.module.css';

import { ModalManager } from './components/ModalManager';

// Declaracao global movida para vite-env.d.ts
type DocType = 'nesh' | 'tipi';

function splitSearchTerms(raw: string): string[] {
    return raw
        .split(/[,\s]+/)
        .map(term => term.trim())
        .filter(Boolean);
}

const noop = () => { };

function App() {
    const {
        tabs,
        tabsById,
        activeTab,
        activeTabId,
        createTab,
        closeTab,
        switchTab,
        updateTab
    } = useTabs();

    // Estados dos modais
    const [_isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [_isTutorialOpen, setIsTutorialOpen] = useState(false);
    const [isStatsOpen, setIsStatsOpen] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [isComparatorOpen, setIsComparatorOpen] = useState(false);
    const [noteModal, setNoteModal] = useState<{
        note: string;
        chapter: string;
        content: string;
        isCrossChapter?: boolean;
    } | null>(null);

    const { sidebarPosition } = useSettings();

    // Hooks customizados
    const { history, addToHistory, removeFromHistory, clearHistory } = useHistory();
    const { executeSearchForTab } = useSearch(tabsById, updateTab, addToHistory);
    const activeTabRef = useRef(activeTab);
    const handleSearchRef = useRef<(query: string) => void>(() => { });
    const handleOpenNoteRef = useRef<(note: string, chapter?: string) => void>(() => { });

    activeTabRef.current = activeTab;

    const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
    const resetLoadedChaptersForDoc = useCallback((doc: DocType) => {
        const current = activeTabRef.current?.loadedChaptersByDoc || { nesh: [], tipi: [] };
        return { ...current, [doc]: [] };
    }, []);


    // Atalhos globais de teclado
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Foca a busca com '/'
            if (document.activeElement && e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                const searchInput = document.getElementById('ncmInput');
                if (searchInput) searchInput.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Busca atua na aba ativa, mas suporta multiplos NCMs por virgula/espaco
    const handleSearch = useCallback((query: string) => {
        const terms = splitSearchTerms(query);
        if (terms.length === 0) return;

        const currentTab = activeTabRef.current;
        const doc = (currentTab?.document || 'nesh') as DocType;

        if (terms.length === 1) {
            void executeSearchForTab(activeTabId, doc, terms[0], true);
            return;
        }

        const canReuseActiveTab = !currentTab?.loading && !currentTab?.results && !currentTab?.ncm;
        let startIndex = 0;

        if (canReuseActiveTab) {
            void executeSearchForTab(activeTabId, doc, terms[0], true);
            startIndex = 1;
        }

        for (let i = startIndex; i < terms.length; i += 1) {
            const tabId = createTab(doc);
            void executeSearchForTab(tabId, doc, terms[i], true);
        }
    }, [activeTabId, createTab, executeSearchForTab]);

    const scrollToNotesSection = useCallback((chapter?: string) => {
        const container = document.getElementById(`results-content-${activeTabId}`);
        if (!container) return false;

        const selectors = [
            ...(chapter ? [`#chapter-${chapter}-notas`, `#chapter-${chapter}`, `#cap-${chapter}`] : []),
            '.section-notas',
            '.regras-gerais'
        ];

        let target: HTMLElement | null = null;
        for (const sel of selectors) {
            const el = container.querySelector(sel) as HTMLElement | null;
            if (el) {
                target = el;
                break;
            }
        }

        if (!target) return false;

        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.add('flash-highlight');
        setTimeout(() => target?.classList.remove('flash-highlight'), 2000);
        return true;
    }, [activeTabId]);

    // Hook para notas cross-chapter
    const { fetchNotes: fetchCrossChapterNotes } = useCrossChapterNotes();

    const handleOpenNote = useCallback(async (note: string, chapter?: string) => {
        const currentTab = activeTabRef.current;
        const results = currentTab?.results;
        if (!results || !isCodeSearchResponse(results)) {
            toast.error('Notas indisponíveis para esta aba.');
            return;
        }

        const resultsMap = results.resultados || results.results;
        if (!resultsMap) {
            toast.error('Notas indisponíveis para esta aba.');
            return;
        }

        let targetChapter = chapter;
        if (!targetChapter) {
            const fromQuery = extractChapter(currentTab?.ncm || results.query || '');
            if (fromQuery && resultsMap[fromQuery]) {
                targetChapter = fromQuery;
            } else {
                const keys = Object.keys(resultsMap);
                if (keys.length === 1) targetChapter = keys[0];
            }
        }

        // CROSS-CHAPTER: Verificar se o capítulo está carregado localmente
        const isLocalChapter = targetChapter && resultsMap[targetChapter];
        let notesMap: Record<string, string> | null = null;
        let isCrossChapter = false;

        if (isLocalChapter && targetChapter) {
            // Capítulo local: usar notas já carregadas
            const chapterData = (resultsMap as Record<string, any>)[targetChapter] || {};
            notesMap = chapterData?.notas_parseadas || {};
        } else if (targetChapter) {
            // CROSS-CHAPTER: Buscar notas do outro capítulo
            isCrossChapter = true;
            const loadingToastId = toast.loading(`Carregando notas do Capítulo ${targetChapter}...`);

            try {
                notesMap = await fetchCrossChapterNotes(targetChapter);
            } catch (error) {
                toast.error(`Erro ao carregar notas do Capítulo ${targetChapter}.`);
                return;
            } finally {
                toast.dismiss(loadingToastId);
            }
        }

        if (!targetChapter) {
            toast.error('Não foi possível identificar o capítulo da nota.');
            return;
        }

        const content = notesMap?.[note];

        if (!content) {
            const scrolled = scrollToNotesSection(targetChapter);
            if (!scrolled) {
                toast.error(`Nota ${note} não encontrada no capítulo ${targetChapter}.`);
            } else {
                toast(`Nota ${note} não encontrada. Mostrando notas do capítulo.`);
            }
            return;
        }

        setNoteModal({ note, chapter: targetChapter, content, isCrossChapter });
    }, [fetchCrossChapterNotes, scrollToNotesSection]);

    useEffect(() => {
        handleSearchRef.current = handleSearch;
    }, [handleSearch]);

    useEffect(() => {
        handleOpenNoteRef.current = handleOpenNote;
    }, [handleOpenNote]);

    // Handler único de clique com delegação (smart-link + note-ref)
    useEffect(() => {
        const handleDelegatedClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement;

            const smartLink = target.closest('a.smart-link') as HTMLAnchorElement | null;
            if (smartLink) {
                event.preventDefault();
                const ncm = smartLink.dataset.ncm;
                if (ncm) {
                    handleSearchRef.current(ncm);
                }
                return;
            }

            const noteRef = target.closest('.note-ref') as HTMLElement | null;
            if (!noteRef) return;

            const note = noteRef.dataset.note;
            if (!note) return;

            handleOpenNoteRef.current(note, noteRef.dataset.chapter);
        };

        document.addEventListener('click', handleDelegatedClick);
        return () => document.removeEventListener('click', handleDelegatedClick);
    }, []);

    const openInDocNewTab = useCallback(async (doc: DocType, ncm: string) => {
        const tabId = createTab(doc);
        await executeSearchForTab(tabId, doc, ncm, false);
    }, [createTab, executeSearchForTab]);

    const openInDocCurrentTab = useCallback(async (doc: DocType, ncm: string) => {
        const currentTab = activeTabRef.current;

        // Se a aba atual estiver ocupada, abre nova para evitar sobrescrever.
        if (currentTab?.results || currentTab?.ncm || currentTab?.loading) {
            await openInDocNewTab(doc, ncm);
            return;
        }

        updateTab(activeTabId, {
            document: doc,
            results: null,
            content: null,
            error: null,
            ncm: '',
            isContentReady: false, // Reseta estado de pronto
            loadedChaptersByDoc: resetLoadedChaptersForDoc(doc) // Reseta cache de capitulos por documento
        });
        await executeSearchForTab(activeTabId, doc, ncm, false);
    }, [activeTabId, executeSearchForTab, openInDocNewTab, resetLoadedChaptersForDoc, updateTab]);

    // Define o documento na aba ativa (ou abre nova se ja houver conteudo)
    const setDoc = useCallback((doc: string) => {
        const currentTab = activeTabRef.current;

        // Se a aba atual tem resultados ou busca em andamento, abre nova aba
        if (currentTab?.results || currentTab?.ncm || currentTab?.loading) {
            createTab(doc as DocType);
        } else {
            // Se a aba atual esta vazia/inicial, apenas troca o documento
            updateTab(activeTabId, {
                document: doc as DocType,
                results: null,
                content: null,
                error: null,
                ncm: '',
                isContentReady: false, // Reseta estado de pronto
                loadedChaptersByDoc: resetLoadedChaptersForDoc(doc as DocType) // Reseta cache de capitulos por documento
            });
        }
    }, [activeTabId, createTab, resetLoadedChaptersForDoc, updateTab]);

    // Ponte legado + ponte de configuracoes
    useEffect(() => {
        window.nesh = {
            smartLinkSearch: (ncm: string) => {
                handleSearchRef.current(ncm);
            },
            openNote: (note: string, chapter?: string) => {
                handleOpenNoteRef.current(note, chapter);
            },
            openSettings: () => {
                setIsSettingsOpen(true);
            }
        };
        return () => {
            (window as any).nesh = undefined;
        };
    }, []);

    return (
        <>
            <Toaster position="top-right" />
            <Suspense fallback={null}>
                <ModalManager
                    modals={{
                        settings: _isSettingsOpen,
                        tutorial: _isTutorialOpen,
                        stats: isStatsOpen,
                        comparator: isComparatorOpen
                    }}
                    onClose={{
                        settings: () => setIsSettingsOpen(false),
                        tutorial: () => setIsTutorialOpen(false),
                        stats: () => setIsStatsOpen(false),
                        comparator: () => setIsComparatorOpen(false)
                    }}
                    currentDoc={(activeTab?.document || 'nesh') as DocType}
                    onOpenInDoc={openInDocCurrentTab}
                    onOpenInNewTab={openInDocNewTab}
                />
            </Suspense>
            <NotePanel
                isOpen={!!noteModal}
                onClose={() => setNoteModal(null)}
                note={noteModal?.note || ''}
                chapter={noteModal?.chapter || ''}
                content={noteModal?.content || ''}
                position={sidebarPosition}
            />

            <Layout
                onSearch={handleSearch}
                doc={activeTab?.document || 'nesh'}
                setDoc={setDoc}
                searchKey={`${activeTabId}-${activeTab?.document || 'nesh'}`}
                onMenuOpen={() => setMobileMenuOpen(prev => !prev)}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenTutorial={() => setIsTutorialOpen(true)}
                onOpenStats={() => setIsStatsOpen(true)}
                onOpenComparator={() => setIsComparatorOpen(true)}
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
                    {/* Renderizacao persistente das abas - usa TabPanel para lazy loading + keep alive */}
                    {tabs.map(tab => (
                        <TabPanel
                            key={tab.id}
                            id={tab.id}
                            activeTabId={activeTabId}
                            className={styles.tabPane}
                        >
                            {/* Loading unificado: mostra skeleton se carregando OU se o conteudo ainda nao esta pronto */}
                            {(tab.loading || (tab.results && tab.isContentReady === false)) && <ResultSkeleton />}

                            {tab.error && (
                                <div className={styles.emptyState}>
                                    <h3 className={styles.emptyStateTitle}>Erro</h3>
                                    <p>{tab.error}</p>
                                </div>
                            )}

                            {!tab.loading && !tab.results && !tab.error && (
                                <div className={styles.emptyState}>
                                    <div className={styles.emptyStateIcon}>🔎</div>
                                    <h3 className={styles.emptyStateTitle}>Pronto para buscar</h3>
                                    <p>Digite um NCM acima ou use o histórico</p>
                                    <p className={styles.emptyStateHint}>
                                        Dica: Pressione <kbd>/</kbd> para buscar
                                    </p>
                                </div>
                            )}

                            {!tab.loading && tab.results && (
                                <ResultDisplay
                                    data={tab.results}
                                    mobileMenuOpen={tab.id === activeTabId ? mobileMenuOpen : false}
                                    onCloseMobileMenu={tab.id === activeTabId ? closeMobileMenu : noop}
                                    isActive={tab.id === activeTabId}
                                    tabId={tab.id}
                                    isNewSearch={tab.isNewSearch || false}
                                    onConsumeNewSearch={(_finalScroll) => {
                                        const updates: Partial<any> = { isNewSearch: false };
                                        if (typeof _finalScroll === 'number') {
                                            updates.scrollTop = _finalScroll;
                                        }
                                        updateTab(tab.id, updates);
                                    }}
                                    // Persistencia explicita do scroll para robustez em unmounts/otimizacoes
                                    initialScrollTop={tab.scrollTop}
                                    onPersistScroll={(id, top) => updateTab(id, { scrollTop: top })}
                                    onContentReady={() => {
                                        if (!tab.isContentReady) {
                                            updateTab(tab.id, { isContentReady: true });
                                        }
                                    }}
                                />
                            )}
                            {/* Esconder visualmente ResultDisplay se nao estiver pronto? Nao, manter montado para o IntersectionObserver rodar,
                                apenas cobrir com Skeleton (posicionado absoluto) ou controlar visibilidade via CSS se precisar.
                                Na pratica o ResultDisplay controla sua propria visibilidade via isContentReady.
                            */}
                        </TabPanel>
                    ))}
                </div>
            </Layout>
        </>
    );
}

export default App;
