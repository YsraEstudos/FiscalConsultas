import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import { toast } from 'react-hot-toast';
import { useCrossChapterNotes } from './context/CrossChapterNoteContext';
import { useHistory, type HistoryItem } from './hooks/useHistory';
import { useSearch } from './hooks/useSearch';
import { useServicesAccess } from './hooks/useServicesAccess';
import { useSettings } from './context/SettingsContext';
import { useLocalDatabase } from './context/LocalDatabaseContext';
import { extractChapter } from './utils/chapterDetection';
import { isCodeSearchApiResponse } from './services/apiResponseGuards';
import { isServiceCatalogDoc } from './utils/servicesCatalog';
import { reportClientError } from './utils/errorMonitoring';
import type { OfflineDatabaseStatus } from './context/offlineDatabase.types';
import type { AppNoteModal } from './appTypes';
import type { DocType, Tab } from './hooks/useTabs';
import {
    handleDelegatedNoteNavigation,
    handleDelegatedSearchNavigation,
    scrollToNotesSection,
    splitSearchTerms,
    type NeshBridge,
} from './appHelpers';

type ChapterNotesEntry = {
    notas_parseadas?: Record<string, string>;
};

type UpdateTabFn = (
    tabId: string,
    updatesOrUpdater:
        | Partial<Tab>
        | ((currentTab: Tab | undefined) => Partial<Tab> | undefined),
) => void;

export interface UseAppInteractionsArgs {
    activeTab: Tab | undefined;
    activeTabId: string;
    tabsById: Map<string, Tab>;
    createTab: (document?: DocType, activate?: boolean) => string;
    updateTab: UpdateTabFn;
    setNoteModal: Dispatch<SetStateAction<AppNoteModal | null>>;
    onOpenSettings: () => void;
}

export interface AppInteractionsState {
    sidebarPosition: 'left' | 'right';
    localDbStatus: OfflineDatabaseStatus;
    progress: number;
    history: HistoryItem[];
    clearHistory: () => void;
    removeFromHistory: (term: string) => void;
    servicesUnavailableReason: string | null;
    triggerInstall: () => void;
    handleSearch: (query: string) => void;
    setDoc: (doc: string) => void;
    openInDocCurrentTab: (doc: DocType, ncm: string) => Promise<void>;
    openInDocNewTab: (doc: DocType, ncm?: string) => Promise<void>;
    switchTabDocument: (tabId: string, doc: DocType, query?: string) => Promise<void>;
    consumeNewSearch: (tabId: string, finalScrollTop?: number) => void;
    persistScroll: (tabId: string, scrollTop: number) => void;
    markContentReady: (tabId: string) => void;
    handleHydratedResults: (
        incomingTabId: string,
        hydratedResults: Record<string, any> | null | undefined,
    ) => void;
}

function createLoadedChaptersByDoc(): Record<DocType, string[]> {
    return {
        nesh: [],
        tipi: [],
        nbs: [],
        nebs: [],
    };
}

export function useAppInteractions({
    activeTab,
    activeTabId,
    tabsById,
    createTab,
    updateTab,
    setNoteModal,
    onOpenSettings,
}: UseAppInteractionsArgs): AppInteractionsState {
    const { sidebarPosition } = useSettings();
    const { status: localDbStatus, install, progress } = useLocalDatabase();
    const { history, addToHistory, removeFromHistory, clearHistory } = useHistory();
    const { ensureServicesSearchAccess, servicesUnavailableReason } = useServicesAccess();
    const { executeSearchForTab } = useSearch(tabsById, updateTab, addToHistory);
    const { fetchNotes: fetchCrossChapterNotes } = useCrossChapterNotes();

    const activeTabRef = useRef(activeTab);
    const handleSearchRef = useRef<(query: string) => void>(() => {});
    const handleOpenNoteRef = useRef<(note: string, chapter?: string) => Promise<void> | void>(() => {});
    const openTextResultInNewTabRef = useRef<(ncm: string, textQuery?: string, activate?: boolean) => Promise<void> | void>(() => {});
    const openServiceResultInNewTabRef = useRef<(code: string, textQuery?: string, activate?: boolean) => Promise<void> | void>(() => {});

    activeTabRef.current = activeTab;

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

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                globalThis.document.activeElement &&
                event.key === '/' &&
                !['INPUT', 'TEXTAREA'].includes(globalThis.document.activeElement.tagName)
            ) {
                event.preventDefault();
                const searchInput = globalThis.document.getElementById('ncmInput');
                if (searchInput) {
                    searchInput.focus();
                }
            }
        };

        globalThis.addEventListener('keydown', handleKeyDown);
        return () => globalThis.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleSearch = useCallback((query: string) => {
        runNonBlockingTask((async () => {
            const terms = splitSearchTerms(query);
            if (terms.length === 0) {
                return;
            }

            const currentTab = activeTabRef.current;
            const doc = (currentTab?.document || 'nesh') as DocType;

            if (isServiceCatalogDoc(doc)) {
                const hasAccess = await ensureServicesSearchAccess();
                if (!hasAccess) {
                    return;
                }
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

            for (let index = startIndex; index < terms.length; index += 1) {
                const tabId = createTab(doc);
                searchTasks.push(executeSearchForTab(tabId, doc, terms[index], true));
            }

            await Promise.all(searchTasks);
        })(), 'handleSearch');
    }, [activeTabId, createTab, ensureServicesSearchAccess, executeSearchForTab, runNonBlockingTask]);

    const triggerInstall = useCallback(() => {
        runNonBlockingTask(install(), 'installLocalDb');
    }, [install, runNonBlockingTask]);

    const handleOpenNote = useCallback(async (note: string, chapter?: string) => {
        const currentTab = activeTabRef.current;
        const results = currentTab?.results;
        if (!results || !isCodeSearchApiResponse(results)) {
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
                if (keys.length === 1) {
                    targetChapter = keys[0];
                }
            }
        }

        let notesMap: Record<string, string> | null = null;
        let isCrossChapter = false;

        if (targetChapter && resultsMap[targetChapter]) {
            const chapterData = (resultsMap as Record<string, ChapterNotesEntry>)[targetChapter] || {};
            notesMap = chapterData.notas_parseadas || {};
        } else if (targetChapter) {
            isCrossChapter = true;
            const loadingToastId = toast.loading(`Carregando notas do Capítulo ${targetChapter}...`);

            try {
                notesMap = await fetchCrossChapterNotes(targetChapter);
            } catch (error) {
                if (import.meta.env.DEV) {
                    console.error('Erro no fetchCrossChapterNotes:', error);
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
            const scrolled = !isCrossChapter
                && scrollToNotesSection(activeTabId, targetChapter);
            if (scrolled) {
                toast(`Nota ${note} não encontrada. Mostrando notas do capítulo.`);
            } else {
                toast.error(`Nota ${note} não encontrada no capítulo ${targetChapter}.`);
            }
            return;
        }

        setNoteModal({ note, chapter: targetChapter, content, isCrossChapter });
    }, [activeTabId, fetchCrossChapterNotes, setNoteModal]);

    useEffect(() => {
        handleSearchRef.current = handleSearch;
    }, [handleSearch]);

    useEffect(() => {
        handleOpenNoteRef.current = handleOpenNote;
    }, [handleOpenNote]);

    const handleHydratedResults = useCallback((
        incomingTabId: string,
        hydratedResults: Record<string, any> | null | undefined,
    ) => {
        if (!hydratedResults) {
            return;
        }

        updateTab(incomingTabId, (currentTab) => {
            if (currentTab?.id !== incomingTabId) {
                return undefined;
            }

            const currentResults = currentTab.results;
            if (!currentResults || !isCodeSearchApiResponse(currentResults)) {
                return undefined;
            }

            return {
                results: {
                    ...currentResults,
                    results: hydratedResults,
                    resultados: hydratedResults,
                },
            };
        });
    }, [updateTab]);

    useEffect(() => {
        const handleDelegatedMiddleMouseDown = (event: MouseEvent) => {
            if (event.button !== 1) {
                return;
            }

            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

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
            if (!(target instanceof Element)) {
                return;
            }

            if (event.button === 2 || event.button === 1) {
                return;
            }

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

            handleDelegatedNoteNavigation(target, event, handleOpenNoteRef.current);
        };

        document.addEventListener('mousedown', handleDelegatedMiddleMouseDown);
        document.addEventListener('click', handleDelegatedClick);
        return () => {
            document.removeEventListener('mousedown', handleDelegatedMiddleMouseDown);
            document.removeEventListener('click', handleDelegatedClick);
        };
    }, []);

    const openInDocNewTab = useCallback(async (doc: DocType, ncm?: string) => {
        const tabId = createTab(doc);
        await executeSearchForTab(tabId, doc, ncm || '', false);
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
            isContentReady: false,
            loadedChaptersByDoc: createLoadedChaptersByDoc(),
        });
        await executeSearchForTab(activeTabId, doc, ncm, false);
    }, [activeTabId, executeSearchForTab, openInDocNewTab, updateTab]);

    const setDoc = useCallback((doc: string) => {
        const nextDoc = doc as DocType;

        const currentTab = activeTabRef.current;
        const shouldOpenNewTab = Boolean(
            currentTab?.loading ||
            currentTab?.results ||
            currentTab?.content ||
            currentTab?.ncm,
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
            loadedChaptersByDoc: createLoadedChaptersByDoc(),
        });
    }, [activeTabId, createTab, updateTab]);

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
            loadedChaptersByDoc: createLoadedChaptersByDoc(),
        });

        if (query?.trim()) {
            if (isServiceCatalogDoc(doc)) {
                const hasAccess = await ensureServicesSearchAccess();
                if (!hasAccess) {
                    return;
                }
            }

            await executeSearchForTab(tabId, doc, query.trim(), false);
        }
    }, [ensureServicesSearchAccess, executeSearchForTab, updateTab]);

    const consumeNewSearch = useCallback((tabId: string, finalScrollTop?: number) => {
        const updates: Partial<Tab> = { isNewSearch: false };
        if (typeof finalScrollTop === 'number') {
            updates.scrollTop = finalScrollTop;
        }
        updateTab(tabId, updates);
    }, [updateTab]);

    const persistScroll = useCallback((tabId: string, scrollTop: number) => {
        updateTab(tabId, { scrollTop });
    }, [updateTab]);

    const markContentReady = useCallback((tabId: string) => {
        updateTab(tabId, { isContentReady: true });
    }, [updateTab]);

    useEffect(() => {
        const globalBridge = globalThis as typeof globalThis & { nesh?: NeshBridge };
        const bridge: NeshBridge = {
            smartLinkSearch: (ncm: string) => {
                handleSearchRef.current(ncm);
            },
            openNote: (note: string, chapter?: string) => {
                handleOpenNoteRef.current(note, chapter);
            },
            openSettings: onOpenSettings,
            openTextResultInNewTab: (ncm: string, textQuery?: string, activate?: boolean) => {
                runNonBlockingTask(
                    Promise.resolve(openTextResultInNewTabRef.current(ncm, textQuery, activate)),
                    'openTextResultInNewTab',
                );
            },
        };
        globalBridge.nesh = bridge;

        return () => {
            if (globalBridge.nesh === bridge) {
                globalBridge.nesh = undefined;
            }
        };
    }, [onOpenSettings, runNonBlockingTask]);

    return {
        sidebarPosition,
        localDbStatus,
        progress,
        history,
        clearHistory,
        removeFromHistory,
        servicesUnavailableReason,
        triggerInstall,
        handleSearch,
        setDoc,
        openInDocCurrentTab,
        openInDocNewTab,
        switchTabDocument,
        consumeNewSearch,
        persistScroll,
        markContentReady,
        handleHydratedResults,
    };
}
