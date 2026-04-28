import { useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react';

import { useTabs, type DocType, type Tab } from './hooks/useTabs';
import type { AppNoteModal } from './appTypes';
import { useAppInteractions, type AppInteractionsState } from './useAppInteractions';

export interface AppControllerState extends AppInteractionsState {
    tabs: Tab[];
    activeTab: Tab | undefined;
    activeTabId: string;
    createTab: (document?: DocType, activate?: boolean) => string;
    closeTab: (event: ReactMouseEvent, tabId: string) => void;
    switchTab: (tabId: string) => void;
    reorderTabs: (draggedTabId: string | number, targetTabId: string | number) => void;
    onMenuOpen: () => void;
    closeMobileMenu: () => void;
    toggleMobileMenu: () => void;
    mobileMenuOpen: boolean;
    isSettingsOpen: boolean;
    onOpenSettings: () => void;
    onCloseSettings: () => void;
    isTutorialOpen: boolean;
    onOpenTutorial: () => void;
    onCloseTutorial: () => void;
    isStatsOpen: boolean;
    onOpenStats: () => void;
    onCloseStats: () => void;
    isComparatorOpen: boolean;
    onOpenComparator: () => void;
    onCloseComparator: () => void;
    isModerateOpen: boolean;
    onOpenModerate: () => void;
    onCloseModerate: () => void;
    isProfileOpen: boolean;
    onOpenProfile: () => void;
    onCloseProfile: () => void;
    noteModal: AppNoteModal | null;
    closeNoteModal: () => void;
}

export function useAppController(): AppControllerState {
    const {
        tabs,
        tabsById,
        activeTab,
        activeTabId,
        createTab,
        closeTab,
        switchTab,
        reorderTabs,
        updateTab,
    } = useTabs();

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isTutorialOpen, setIsTutorialOpen] = useState(false);
    const [isStatsOpen, setIsStatsOpen] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [isComparatorOpen, setIsComparatorOpen] = useState(false);
    const [isModerateOpen, setIsModerateOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [noteModal, setNoteModal] = useState<AppNoteModal | null>(null);

    const onMenuOpen = useCallback(() => {
        setMobileMenuOpen(true);
    }, []);

    const closeMobileMenu = useCallback(() => {
        setMobileMenuOpen(false);
    }, []);

    const toggleMobileMenu = useCallback(() => {
        setMobileMenuOpen((previous) => !previous);
    }, []);

    const onOpenSettings = useCallback(() => {
        setIsSettingsOpen(true);
    }, []);

    const onCloseSettings = useCallback(() => {
        setIsSettingsOpen(false);
    }, []);

    const onOpenTutorial = useCallback(() => {
        setIsTutorialOpen(true);
    }, []);

    const onCloseTutorial = useCallback(() => {
        setIsTutorialOpen(false);
    }, []);

    const onOpenStats = useCallback(() => {
        setIsStatsOpen(true);
    }, []);

    const onCloseStats = useCallback(() => {
        setIsStatsOpen(false);
    }, []);

    const onOpenComparator = useCallback(() => {
        setIsComparatorOpen(true);
    }, []);

    const onCloseComparator = useCallback(() => {
        setIsComparatorOpen(false);
    }, []);

    const onOpenModerate = useCallback(() => {
        setIsModerateOpen(true);
    }, []);

    const onCloseModerate = useCallback(() => {
        setIsModerateOpen(false);
    }, []);

    const onOpenProfile = useCallback(() => {
        setIsProfileOpen(true);
    }, []);

    const onCloseProfile = useCallback(() => {
        setIsProfileOpen(false);
    }, []);

    const closeNoteModal = useCallback(() => {
        setNoteModal(null);
    }, []);

    const interactions = useAppInteractions({
        activeTab,
        activeTabId,
        tabsById,
        createTab,
        updateTab,
        setNoteModal,
        onOpenSettings,
    });

    return {
        tabs,
        activeTab,
        activeTabId,
        createTab,
        closeTab,
        switchTab,
        reorderTabs,
        onMenuOpen,
        closeMobileMenu,
        toggleMobileMenu,
        mobileMenuOpen,
        isSettingsOpen,
        onOpenSettings,
        onCloseSettings,
        isTutorialOpen,
        onOpenTutorial,
        onCloseTutorial,
        isStatsOpen,
        onOpenStats,
        onCloseStats,
        isComparatorOpen,
        onOpenComparator,
        onCloseComparator,
        isModerateOpen,
        onOpenModerate,
        onCloseModerate,
        isProfileOpen,
        onOpenProfile,
        onCloseProfile,
        noteModal,
        closeNoteModal,
        ...interactions,
    };
}
