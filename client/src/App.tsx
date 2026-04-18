import { useEffect, useCallback, useRef, useState, Suspense } from 'react';

import { Toaster, toast } from 'react-hot-toast';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ResultDisplay } from './components/ResultDisplay';
import { TabsBar } from './components/TabsBar';
import { ResultSkeleton } from './components/ResultSkeleton';
import { TabPanel } from './components/Tabs/TabPanel';
import { useTabs, type DocType, type Tab } from './hooks/useTabs';
import { useCrossChapterNotes } from './context/CrossChapterNoteContext';
import { useSearch } from './hooks/useSearch';
import { useHistory } from './hooks/useHistory';
import { extractChapter } from './utils/chapterDetection';
import { isCodeSearchResponse } from './types/api.types';
import type { NbsSearchResponse, NebsSearchResponse } from './types/api.types';
import { useSettings } from './context/SettingsContext';
import { useServicesAccess } from './hooks/useServicesAccess';
import { isServiceCatalogDoc } from './utils/servicesCatalog';
import { useLocalDatabase } from './context/LocalDatabaseContext';
import { NotePanel } from './components/NotePanel';
import { UserProfilePage } from './components/UserProfilePage';
import { reportClientError } from './utils/errorMonitoring';
import styles from './App.module.css';

import { ModalManager } from './components/ModalManager';
import { ServicesTabContent } from './components/ServicesTabContent';
import { Spinner } from './components/Spinner';

function splitSearchTerms(raw: string): string[] {
    // Split only on commas — spaces are kept as part of multi-word queries
    // e.g. "centrifugal motor" → ["centrifugal motor"] (single query)
    // e.g. "motor, bomba"     → ["motor", "bomba"] (two queries)
    return raw
        .split(/,/)
        .map(term => term.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
}

const noop = () => { };

function handleDelegatedSearchNavigation(
    target: Element,
    selector: string,
    dataKey: 'ncm' | 'serviceCode',
    isBackgroundNavigation: boolean,
    event: MouseEvent,
    onSearch: (query: string) => void,
    onOpenInNewTab: (query: string, textQuery?: string, activate?: boolean) => Promise<void> | void,
): boolean {
    const link = target.closest(selector);
    if (!(link instanceof HTMLElement)) {
        return false;
    }

    const value = link.dataset[dataKey];
    if (!value) {
        return true;
    }

    event.preventDefault();
    if (isBackgroundNavigation) {
        onOpenInNewTab(value, undefined, false);
        return true;
    }

    onSearch(value);
    return true;
}

function handleDelegatedNoteNavigation(
    target: Element,
    onOpenNote: (note: string, chapter?: string) => Promise<void> | void,
): boolean {
    const noteRef = target.closest('.note-ref');
    if (!(noteRef instanceof HTMLElement)) {
        return false;
    }

    const note = noteRef.dataset.note;
    if (!note) {
        return true;
    }

    onOpenNote(note, noteRef.dataset.chapter || undefined);
    return true;
}

function App() {
    const {
        tabs,
        tabsById,
        activeTab,
        activeTabId,
        createTab,
        closeTab,
        switchTab,
        reorderTabs,
        updateTab
    } = useTabs();

    // Estados dos modais
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isTutorialOpen, setIsTutorialOpen] = useState(false);
    const [isStatsOpen, setIsStatsOpen] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [isComparatorOpen, setIsComparatorOpen] = useState(false);
    const [isModerateOpen, setIsModerateOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [noteModal, setNoteModal] = useState<{
        note: string;
        chapter: string;
        content: string;
        isCrossChapter?: boolean;
    } | null>(null);

    const { sidebarPosition } = useSettings();
    const { status: localDbStatus, install, progress } = useLocalDatabase();

    // Hooks customizados
    const { history, addToHistory, removeFromHistory, clearHistory } = useHistory();
    const {
        ensureServicesSearchAccess,
        servicesUnavailableReason,
    } = useServicesAccess();
    const { executeSearchForTab } = useSearch(tabsById, updateTab, addToHistory);
    const activeTabRef = useRef(activeTab);
    const handleSearchRef = useRef<(query: string) => void>(() => { });
    const handleOpenNoteRef = useRef<(note: string, chapter?: string) => Promise<void> | void>(() => { });
    const openTextResultInNewTabRef = useRef<(ncm: string, textQuery?: string, activate?: boolean) => Promise<void> | void>(() => { });
    const openServiceResultInNewTabRef = useRef<(code: string, textQuery?: string, activate?: boolean) => Promise<void> | void>(() => { });

    activeTabRef.current = activeTab;

    const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
    const resetLoadedChaptersForDoc = useCallback((doc: DocType) => {
        const current = activeTabRef.current?.loadedChaptersByDoc || { nesh: [], tipi: [], nbs: [], nebs: [] };
        return { ...current, [doc]: [] };
    }, []);
    const runNonBlockingTask = useCallback((task: Promise<unknown> | void, context: string) => {
        Promise.resolve(task).catch((error) => {
            reportClientError({
                source: 'async-task',
                error,
                context,
                handled: true,
                message: `Background UI task failed: ${context}`,
            });
        });
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
        globalThis.addEventListener('keydown', handleKeyDown);
        return () => globalThis.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Busca atua na aba ativa, mas suporta multiplos NCMs por virgula/espaco
    const handleSearch = useCallback((query: string) => {
        runNonBlockingTask((async () => {
            const terms = splitSearchTerms(query);
            if (terms.length === 0) return;

            const currentTab = activeTabRef.current;
            const doc = (currentTab?.document || 'nesh') as DocType;

            if (isServiceCatalogDoc(doc)) {
                const hasAccess = await ensureServicesSearchAccess();
                if (!hasAccess) return;
            }

            if (terms.length === 1) {
                await executeSearchForTab(activeTabId, doc, terms[0], true);
                return;
            }

            const canReuseActiveTab = !currentTab?.loading && !currentTab?.results && !currentTab?.ncm;
            const searchTasks: Promise<unknown>[] = [];
            let startIndex = 0;

            if (canReuseActiveTab) {
                searchTasks.push(executeSearchForTab(activeTabId, doc, terms[0], true));
                startIndex = 1;
            }

            for (let i = startIndex; i < terms.length; i += 1) {
                const tabId = createTab(doc);
                searchTasks.push(executeSearchForTab(tabId, doc, terms[i], true));
            }

            await Promise.all(searchTasks);
        })(), 'handleSearch');
    }, [activeTabId, createTab, ensureServicesSearchAccess, executeSearchForTab, runNonBlockingTask]);

    const triggerInstall = useCallback(() => {
        runNonBlockingTask(install(), 'installLocalDb');
    }, [install, runNonBlockingTask]);

    const renderOfflineStatusAction = useCallback(() => {
        if (localDbStatus === 'ready') {
            return (
                <div title="Buscas Offline configuradas!" className={`${styles.minimalDownloadBtn} ${styles.installed}`}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
            );
        }

        if (localDbStatus === 'checking' || localDbStatus === 'installing' || localDbStatus === 'updating') {
            return (
                <div
                    title={localDbStatus === 'updating' ? `Atualizando... ${Math.round(progress)}%` : `Baixando... ${Math.round(progress)}%`}
                    className={`${styles.minimalDownloadBtn} ${styles.downloading}`}
                >
                    <Spinner size="sm" />
                </div>
            );
        }

        if (localDbStatus === 'error') {
            return (
                <button onClick={triggerInstall} title="Erro ao baixar. Tentar de novo" className={`${styles.minimalDownloadBtn} ${styles.errorStatus}`}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                </button>
            );
        }

        if (localDbStatus === 'unsupported') {
            return (
                <div title="Este navegador não suporta banco offline" className={`${styles.minimalDownloadBtn} ${styles.disabledStatus}`}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="8" x2="16" y2="16"></line></svg>
                </div>
            );
        }

        return (
            <button onClick={triggerInstall} title="Baixar BD para habilitar as buscas" className={styles.minimalDownloadBtn}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
        );
    }, [localDbStatus, progress, triggerInstall]);

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
            const el = container.querySelector<HTMLElement>(sel);
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

    // nosonar: cognitive complexity warning ignored here as spreading the hook makes it harder to read
    const handleOpenNote = useCallback(async (note: string, chapter?: string) => { // NOSONAR
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
                if (import.meta.env.DEV) {
                    console.error("Erro no fetchCrossChapterNotes:", error);
                }
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
            if (scrolled) {
                toast(`Nota ${note} não encontrada. Mostrando notas do capítulo.`);
            } else {
                toast.error(`Nota ${note} não encontrada no capítulo ${targetChapter}.`);
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
        const handleDelegatedMiddleMouseDown = (event: MouseEvent) => {
            if (event.button !== 1) return;

            const target = event.target;
            if (!(target instanceof Element)) return;

            if (handleDelegatedSearchNavigation(
                target,
                'a.smart-link',
                'ncm',
                true,
                event,
                handleSearchRef.current,
                openTextResultInNewTabRef.current,
            )) {
                return;
            }

            handleDelegatedSearchNavigation(
                target,
                '.service-smart-link, .service-code-target',
                'serviceCode',
                true,
                event,
                handleSearchRef.current,
                openServiceResultInNewTabRef.current,
            );
        };

        const handleDelegatedClick = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;

            // Ignorar botão direito
            if (event.button === 2) return;

            // Middle button is handled on mousedown to avoid native scroll-mode capture.
            if (event.button === 1) return;

            const isMiddleClickOrCmd = event.ctrlKey || event.metaKey;

            if (handleDelegatedSearchNavigation(
                target,
                'a.smart-link',
                'ncm',
                isMiddleClickOrCmd,
                event,
                handleSearchRef.current,
                openTextResultInNewTabRef.current,
            )) {
                return;
            }

            if (handleDelegatedSearchNavigation(
                target,
                '.service-smart-link, .service-code-target',
                'serviceCode',
                isMiddleClickOrCmd,
                event,
                handleSearchRef.current,
                openServiceResultInNewTabRef.current,
            )) {
                return;
            }

            handleDelegatedNoteNavigation(target, handleOpenNoteRef.current);
        };

        document.addEventListener('mousedown', handleDelegatedMiddleMouseDown);
        document.addEventListener('click', handleDelegatedClick);
        return () => {
            document.removeEventListener('mousedown', handleDelegatedMiddleMouseDown);
            document.removeEventListener('click', handleDelegatedClick);
        };
    }, []);

    const openInDocNewTab = useCallback(async (doc: DocType, ncm: string) => {
        const tabId = createTab(doc);
        await executeSearchForTab(tabId, doc, ncm, false);
    }, [createTab, executeSearchForTab]);

    const openTextResultInNewTab = useCallback(async (ncm: string, textQuery?: string, activate: boolean = true) => {
        const activeDoc = (activeTabRef.current?.document || 'nesh') as DocType;
        const doc: DocType = activeDoc === 'nbs' || activeDoc === 'nebs' ? 'nesh' : activeDoc;
        const tabId = createTab(doc, activate);
        const nextTextQuery = (textQuery || '').trim();

        if (nextTextQuery) {
            updateTab(tabId, { latestTextQuery: nextTextQuery });
        }

        await executeSearchForTab(tabId, doc, ncm, false);

        if (nextTextQuery) {
            updateTab(tabId, { latestTextQuery: nextTextQuery });
        }
    }, [createTab, executeSearchForTab, updateTab]);

    useEffect(() => {
        openTextResultInNewTabRef.current = openTextResultInNewTab;
    }, [openTextResultInNewTab]);

    const openServiceResultInNewTab = useCallback(async (code: string, _textQuery?: string, activate: boolean = true) => {
        const activeDoc = (activeTabRef.current?.document || 'nbs') as DocType;
        const doc: DocType = activeDoc === 'nebs' ? 'nebs' : 'nbs';
        const tabId = createTab(doc, activate);

        await executeSearchForTab(tabId, doc, code, false);
    }, [createTab, executeSearchForTab]);

    useEffect(() => {
        openServiceResultInNewTabRef.current = openServiceResultInNewTab;
    }, [openServiceResultInNewTab]);

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
        const nextDoc = doc as DocType;

        const currentTab = activeTabRef.current;
        const shouldOpenNewTab = Boolean(
            currentTab?.loading ||
            currentTab?.results ||
            currentTab?.content ||
            currentTab?.ncm
        );

        if (shouldOpenNewTab) {
            createTab(nextDoc);
            return;
        }

        updateTab(activeTabId, {
            document: nextDoc,
            results: null,
            content: null,
            error: null,
            ncm: '',
            title: 'Nova busca',
            latestTextQuery: '',
            isNewSearch: false,
            scrollTop: 0,
            isContentReady: false,
            loadedChaptersByDoc: resetLoadedChaptersForDoc(nextDoc)
        });
    }, [activeTabId, createTab, resetLoadedChaptersForDoc, updateTab]);

    const switchTabDocument = useCallback(async (tabId: string, doc: DocType, query?: string) => {
        updateTab(tabId, {
            document: doc,
            results: null,
            content: null,
            error: null,
            ncm: '',
            title: 'Nova busca',
            latestTextQuery: '',
            isNewSearch: false,
            scrollTop: 0,
            isContentReady: false,
            loadedChaptersByDoc: resetLoadedChaptersForDoc(doc)
        });

        if (query?.trim()) {
            if (isServiceCatalogDoc(doc)) {
                const hasAccess = await ensureServicesSearchAccess();
                if (!hasAccess) return;
            }
            await executeSearchForTab(tabId, doc, query.trim(), false);
        }
    }, [
        ensureServicesSearchAccess,
        executeSearchForTab,
        resetLoadedChaptersForDoc,
        updateTab
    ]);

    // Ponte legado + ponte de configuracoes
    useEffect(() => {
        (globalThis as any).nesh = {
            smartLinkSearch: (ncm: string) => {
                handleSearchRef.current(ncm);
            },
            openNote: (note: string, chapter?: string) => {
                handleOpenNoteRef.current(note, chapter);
            },
            openSettings: () => {
                setIsSettingsOpen(true);
            },
            openTextResultInNewTab: (ncm: string, textQuery?: string, activate?: boolean) => {
                runNonBlockingTask(
                    Promise.resolve(openTextResultInNewTabRef.current(ncm, textQuery, activate)),
                    'openTextResultInNewTab'
                );
            }
        };
        return () => {
            (globalThis as any).nesh = undefined;
        };
    }, [runNonBlockingTask]);

    return (
        <>
            <Toaster position="top-right" />
            <ErrorBoundary
                boundaryName="modal-manager"
                title="Não foi possível abrir um painel da interface."
                description="Um dos modais ou painéis da aplicação falhou ao renderizar. Feche e tente abrir novamente."
                resetKeys={[isSettingsOpen, isTutorialOpen, isStatsOpen, isComparatorOpen, isModerateOpen]}
            >
                <Suspense fallback={null}>
                    <ModalManager
                        modals={{
                            settings: isSettingsOpen,
                            tutorial: isTutorialOpen,
                            stats: isStatsOpen,
                            comparator: isComparatorOpen,
                            moderate: isModerateOpen,
                        }}
                        onClose={{
                            settings: () => setIsSettingsOpen(false),
                            tutorial: () => setIsTutorialOpen(false),
                            stats: () => setIsStatsOpen(false),
                            comparator: () => setIsComparatorOpen(false),
                            moderate: () => setIsModerateOpen(false),
                        }}
                        currentDoc={activeTab?.document || 'nesh'}
                        onOpenInDoc={openInDocCurrentTab}
                        onOpenInNewTab={openInDocNewTab}
                    />
                </Suspense>
            </ErrorBoundary>
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
                onMenuOpen={() => setMobileMenuOpen(true)}
                servicesUnavailableReason={servicesUnavailableReason}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenTutorial={() => setIsTutorialOpen(true)}
                onOpenStats={() => setIsStatsOpen(true)}
                onOpenComparator={() => setIsComparatorOpen(true)}
                onOpenModerate={() => setIsModerateOpen(true)}
                onOpenProfile={() => setIsProfileOpen(true)}
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
                    onReorder={reorderTabs}
                    onNewTab={() => createTab(activeTab?.document || 'nesh')}
                />

                <ErrorBoundary
                    boundaryName="results-section"
                    title="Não foi possível renderizar os resultados."
                    description="A área principal da busca encontrou um erro inesperado. Tente novamente ou mude de aba para continuar."
                    resetKeys={[activeTabId, tabs.length]}
                >
                    <div className={styles.resultsSection}>
                        {/* Renderizacao persistente das abas - usa TabPanel para lazy loading + keep alive */}
                        {tabs.map(tab => (
                            <TabPanel
                                key={tab.id}
                                id={tab.id}
                                activeTabId={activeTabId}
                                className={styles.tabPane}
                            >
                                {/* Loading inicial: mostra skeleton APENAS se estiver carregando E nao tiver resultados ainda */}
                                {(tab.loading && !tab.results) && <ResultSkeleton />}

                                {/* Mostrar overlay de carregamento se já temos resultados mas estamos buscando de novo */}
                                {tab.loading && !!tab.results && (
                                    <>
                                        <div className={styles.loadingOverlay} />
                                        <div className={styles.loadingSpinnerContainer}>
                                            <Spinner />
                                        </div>
                                    </>
                                )}

                                {tab.error && (
                                    <div className={styles.emptyState}>
                                        <h3 className={styles.emptyStateTitle}>Erro</h3>
                                        <p>{tab.error}</p>
                                    </div>
                                )}

                                {!tab.loading && !tab.results && !tab.error && (
                                    <div className={styles.emptyState}>
                                        <div className={styles.emptyStateIconContainer}>
                                            <div className={styles.emptyStateIcon}>
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                                                    <circle cx="10" cy="10" r="7" strokeWidth="2.5" fill="currentColor" fillOpacity="0.1"></circle>
                                                    <path d="M6.5 10a3.5 3.5 0 0 1 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"></path>
                                                    <line x1="15.5" y1="15.5" x2="21" y2="21" strokeWidth="3"></line>
                                                </svg>
                                            </div>

                                            {renderOfflineStatusAction()}
                                        </div>
                                        <h3 className={styles.emptyStateTitle}>Pronto para buscar</h3>
                                        <p>{tab.document === 'nbs' || tab.document === 'nebs'
                                            ? (servicesUnavailableReason || 'Digite um codigo de servico ou termo textual acima')
                                            : 'Digite um NCM acima ou use o histórico'}</p>
                                        <p className={styles.emptyStateHint}>
                                            Dica: Pressione <kbd>/</kbd> para buscar
                                        </p>
                                    </div>
                                )}

                                {tab.results && (tab.document === 'nbs' || tab.document === 'nebs') && (
                                    <ServicesTabContent
                                        doc={tab.document}
                                        data={tab.results as NbsSearchResponse | NebsSearchResponse}
                                        onSwitchDoc={(nextDoc, query) => {
                                            runNonBlockingTask(
                                                switchTabDocument(tab.id, nextDoc, query),
                                                'switchTabDocument (services)'
                                            );
                                        }}
                                        onOpenDocInNewTab={(nextDoc, query) => {
                                            const nextTabId = createTab(nextDoc);
                                            runNonBlockingTask(
                                                switchTabDocument(nextTabId, nextDoc, query),
                                                'switchTabDocument (services new tab)'
                                            );
                                        }}
                                        onContentReady={() => {
                                            if (!tab.isContentReady) {
                                                updateTab(tab.id, { isContentReady: true });
                                            }
                                        }}
                                    />
                                )}

                                {tab.results && tab.document !== 'nbs' && tab.document !== 'nebs' && (
                                    <ResultDisplay
                                        data={tab.results}
                                        latestTextQuery={tab.latestTextQuery}
                                        mobileMenuOpen={tab.id === activeTabId ? mobileMenuOpen : false}
                                        onCloseMobileMenu={tab.id === activeTabId ? closeMobileMenu : noop}
                                        isActive={tab.id === activeTabId}
                                        tabId={tab.id}
                                        isNewSearch={tab.isNewSearch || false}
                                        onConsumeNewSearch={(incomingTabId, finalScrollTop) => {
                                            const updates: Partial<Tab> = { isNewSearch: false };
                                            if (typeof finalScrollTop === 'number') {
                                                updates.scrollTop = finalScrollTop;
                                            }
                                            updateTab(incomingTabId, updates);
                                        }}
                                        // Persistencia explicita do scroll para robustez em unmounts/otimizacoes
                                        initialScrollTop={tab.scrollTop}
                                        onPersistScroll={(id, top) => updateTab(id, { scrollTop: top })}
                                        onContentReady={() => {
                                            if (!tab.isContentReady) {
                                                updateTab(tab.id, { isContentReady: true });
                                            }
                                        }}
                                        onHydratedResults={(incomingTabId, hydratedResults) => {
                                            if (!hydratedResults || !tab.results || !isCodeSearchResponse(tab.results)) {
                                                return;
                                            }

                                            updateTab(incomingTabId, {
                                                results: {
                                                    ...tab.results,
                                                    results: hydratedResults,
                                                    resultados: hydratedResults,
                                                },
                                            });
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
                </ErrorBoundary>
            </Layout>
            <ErrorBoundary
                boundaryName="user-profile-page"
                title="Não foi possível abrir o perfil."
                description="A área de conta encontrou um erro inesperado. Feche e tente abrir o perfil novamente."
                resetKeys={[isProfileOpen]}
            >
                <UserProfilePage
                    isOpen={isProfileOpen}
                    onClose={() => setIsProfileOpen(false)}
                />
            </ErrorBoundary>
        </>
    );
}

export default App;
