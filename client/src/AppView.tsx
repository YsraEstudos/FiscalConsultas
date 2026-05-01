import { Suspense } from 'react';

import { Toaster } from 'react-hot-toast';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ResultDisplay } from './components/ResultDisplay';
import { TabsBar } from './components/TabsBar';
import { ResultSkeleton } from './components/ResultSkeleton';
import { TabPanel } from './components/Tabs/TabPanel';
import type { NbsCatalogSearchApiResponse } from './types/api.types';
import { NotePanel } from './components/NotePanel';
import { UserProfilePage } from './components/UserProfilePage';
import styles from './App.module.css';
import { ModalManager } from './components/ModalManager';
import { ServicesTabContent } from './components/ServicesTabContent';
import { Spinner } from './components/Spinner';
import type { AppControllerState } from './useAppController';

const noop = () => {};

function renderOfflineStatusAction(
    status: AppControllerState['localDbStatus'],
    progress: number,
    onTriggerInstall: () => void,
) {
    if (status === 'ready') {
        return null;
    }

    if (status === 'checking' || status === 'installing' || status === 'updating') {
        return (
            <div
                title={status === 'updating' ? `Atualizando... ${Math.round(progress)}%` : `Baixando... ${Math.round(progress)}%`}
                className={`${styles.minimalDownloadBtn} ${styles.downloading}`}
            >
                <Spinner size="sm" />
            </div>
        );
    }

    if (status === 'error') {
        return (
            <button onClick={onTriggerInstall} title="Erro ao baixar. Tentar de novo" className={`${styles.minimalDownloadBtn} ${styles.errorStatus}`}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            </button>
        );
    }

    if (status === 'unsupported') {
        return (
            <div title="Este navegador não suporta banco offline" className={`${styles.minimalDownloadBtn} ${styles.disabledStatus}`}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="8" x2="16" y2="16"></line></svg>
            </div>
        );
    }

    return (
        <button onClick={onTriggerInstall} title="Baixar BD para habilitar as buscas" className={styles.minimalDownloadBtn}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
    );
}

export function AppView({ controller }: { controller: AppControllerState }) {
    const {
        tabs,
        activeTab,
        activeTabId,
        createTab,
        closeTab,
        switchTab,
        reorderTabs,
        handleSearch,
        setDoc,
        closeMobileMenu,
        toggleMobileMenu,
        mobileMenuOpen,
        isSettingsOpen,
        onOpenSettings,
        onCloseSettings,
        isTutorialOpen,
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
        sidebarPosition,
        localDbStatus,
        progress,
        triggerInstall,
        history,
        clearHistory,
        removeFromHistory,
        servicesUnavailableReason,
        openInDocCurrentTab,
        openInDocNewTab,
        switchTabDocument,
        consumeNewSearch,
        persistScroll,
        markContentReady,
        handleHydratedResults,
    } = controller;

    const currentDoc = activeTab?.document || 'nesh';

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
                            settings: onCloseSettings,
                            tutorial: onCloseTutorial,
                            stats: onCloseStats,
                            comparator: onCloseComparator,
                            moderate: onCloseModerate,
                        }}
                        currentDoc={currentDoc}
                        onOpenInDoc={openInDocCurrentTab}
                        onOpenInNewTab={openInDocNewTab}
                    />
                </Suspense>
            </ErrorBoundary>

            <NotePanel
                isOpen={!!noteModal}
                onClose={closeNoteModal}
                note={noteModal?.note || ''}
                chapter={noteModal?.chapter || ''}
                content={noteModal?.content || ''}
                position={sidebarPosition}
            />

            <Layout
                onSearch={handleSearch}
                doc={currentDoc}
                setDoc={setDoc}
                searchKey={`${activeTabId}-${currentDoc}`}
                servicesUnavailableReason={servicesUnavailableReason}
                onOpenSettings={onOpenSettings}
                onOpenStats={onOpenStats}
                onOpenComparator={onOpenComparator}
                onOpenModerate={onOpenModerate}
                onOpenProfile={onOpenProfile}
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
                    onNewTab={() => createTab(currentDoc)}
                />

                <ErrorBoundary
                    boundaryName="results-section"
                    title="Não foi possível renderizar os resultados."
                    description="A área principal da busca encontrou um erro inesperado. Tente novamente ou mude de aba para continuar."
                    resetKeys={[activeTabId, tabs.length]}
                >
                    <div className={styles.resultsSection}>
                        {tabs.map((tab) => (
                            <TabPanel
                                key={tab.id}
                                id={tab.id}
                                activeTabId={activeTabId}
                                className={styles.tabPane}
                            >
                                {(tab.loading && !tab.results) && <ResultSkeleton />}

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

                                            {renderOfflineStatusAction(localDbStatus, progress, triggerInstall)}
                                        </div>
                                        <h3 className={styles.emptyStateTitle}>Pronto para buscar</h3>
                                        <p>{tab.document === 'nbs'
                                            ? (servicesUnavailableReason || 'Digite um código NBS ou termo textual acima')
                                            : 'Digite um NCM acima ou use o histórico'}</p>
                                        <p className={styles.emptyStateHint}>
                                            Dica: Pressione <kbd>/</kbd> para buscar
                                        </p>
                                    </div>
                                )}

                                {tab.results && tab.document === 'nbs' && (
                                    <ServicesTabContent
                                        doc={tab.document}
                                        data={tab.results as NbsCatalogSearchApiResponse}
                                        onSwitchDoc={(nextDoc, query) => {
                                            switchTabDocument(tab.id, nextDoc, query);
                                        }}
                                        onOpenDocInNewTab={openInDocNewTab}
                                        onContentReady={() => {
                                            markContentReady(tab.id);
                                        }}
                                    />
                                )}

                                {tab.results && tab.document !== 'nbs' && (
                                    <ResultDisplay
                                        data={tab.results}
                                        latestTextQuery={tab.latestTextQuery}
                                        mobileMenuOpen={tab.id === activeTabId ? mobileMenuOpen : false}
                                        onCloseMobileMenu={tab.id === activeTabId ? closeMobileMenu : noop}
                                        onToggleMobileMenu={tab.id === activeTabId ? toggleMobileMenu : noop}
                                        isActive={tab.id === activeTabId}
                                        tabId={tab.id}
                                        isNewSearch={tab.isNewSearch || false}
                                        onConsumeNewSearch={consumeNewSearch}
                                        initialScrollTop={tab.scrollTop}
                                        onPersistScroll={persistScroll}
                                        onContentReady={() => {
                                            markContentReady(tab.id);
                                        }}
                                        onHydratedResults={handleHydratedResults}
                                    />
                                )}
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
                    onClose={onCloseProfile}
                />
            </ErrorBoundary>
        </>
    );
}
