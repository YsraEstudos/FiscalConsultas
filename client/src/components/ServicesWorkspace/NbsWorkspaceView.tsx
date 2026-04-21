import React from 'react';

import { Loading } from '../Loading';
import styles from '../ServicesWorkspace.module.css';
import {
    lookupNbsChapterNotesEntry,
    openNbsChapterNotesPreviewWindow,
} from '../../utils/nbsChapterNotes';

import { getExpandedPrefixBranch, isCodeLikeNbsQuery } from './noteRendering';
import type {
    OpenCatalogDoc,
    ServicesWorkspaceNbsState,
} from './types';

interface NbsHierarchySectionProps {
    readonly activeChapterNumber: string | null;
    readonly chapterButtonHint: string;
    readonly chapterButtonLabel: string;
    readonly currentChapterNotesEntry: ReturnType<typeof lookupNbsChapterNotesEntry>;
    readonly nbsState: ServicesWorkspaceNbsState;
    readonly onOpenChapterNotes: () => void;
    readonly onSelectNbs: (code: string) => void;
    readonly visibleChildren: readonly ServicesWorkspaceNbsState['results'][number][];
}

function NbsHierarchySection({
    activeChapterNumber,
    chapterButtonHint,
    chapterButtonLabel,
    currentChapterNotesEntry,
    nbsState,
    onOpenChapterNotes,
    onSelectNbs,
    visibleChildren,
}: Readonly<NbsHierarchySectionProps>) {
    return (
        <aside className={styles.leftPanel}>
            <div className={styles.leftPanelHeader}>
                <div className={styles.leftPanelTitle}>
                    <button
                        type="button"
                        className={styles.chapterNotesButton}
                        onClick={onOpenChapterNotes}
                        disabled={!currentChapterNotesEntry}
                        title={chapterButtonHint}
                    >
                        <span className={styles.chapterNotesEyebrow}>Explicações</span>
                        <span>{chapterButtonLabel}</span>
                    </button>
                    Hierarquia NEBS
                </div>
                <span className={styles.sectionBadge}>
                    {activeChapterNumber ? `Capítulo ${activeChapterNumber} ativo` : 'Capítulo ativo'}
                </span>
            </div>

            {nbsState.isSearching ? (
                <Loading label="Buscando catalogo..." />
            ) : nbsState.detail ? (
                <div className={styles.hierarchyList}>
                    {nbsState.detail.ancestors.map((item, index) => (
                        <div key={item.code} className={styles.hierarchyNode} style={{ paddingLeft: `${index * 1.5}rem` }}>
                            <button type="button" className={styles.nodeCard} onClick={() => onSelectNbs(item.code)}>
                                <div className={styles.nodeIcon}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 17 12 21 16 17"></polyline><line x1="12" y1="12" x2="12" y2="21"></line><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"></path></svg>
                                </div>
                                <div className={styles.nodeContent}>
                                    <span className={styles.nodeLabel}>Nível {item.level}</span>
                                    <strong className={`${styles.nodeTitle} ${styles.interactiveCode} service-code-target`} data-service-code={item.code}>{item.code} - {item.description}</strong>
                                </div>
                            </button>
                        </div>
                    ))}
                    <div className={styles.hierarchyNode} style={{ paddingLeft: `${nbsState.detail.ancestors.length * 1.5}rem` }}>
                        <div className={`${styles.nodeCard} ${styles.active}`} data-service-state="active">
                            <div className={styles.nodeIcon}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                            </div>
                            <div className={styles.nodeContent}>
                                <span className={styles.nodeLabel}>Item Ativo</span>
                                <strong className={`${styles.nodeTitle} ${styles.interactiveCode} service-code-target`} data-service-code={nbsState.detail.item.code}>{nbsState.detail.item.code} - {nbsState.detail.item.description}</strong>
                            </div>
                        </div>
                        {visibleChildren.length > 0 && (
                            <div className={styles.peerList} style={{ paddingLeft: '3.5rem' }}>
                                {visibleChildren.map((child) => (
                                    <button
                                        type="button"
                                        key={child.code}
                                        className={styles.peerCard}
                                        onClick={() => onSelectNbs(child.code)}
                                        style={{
                                            marginLeft: `${Math.max(0, child.level - nbsState.detail!.item.level - 1) * 1.25}rem`,
                                        }}
                                    >
                                        <div className={styles.peerIcon}></div>
                                        <span className={`${styles.nodeTitle} ${styles.interactiveCode} service-code-target`} data-service-code={child.code}>{child.code} - {child.description}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ) : nbsState.results.length > 0 ? (
                <div className={styles.resultList}>
                    {nbsState.results.map((item) => (
                        <button
                            key={item.code}
                            type="button"
                            className={`${styles.resultCard} ${nbsState.selectedCode === item.code ? styles.resultCardActive : ''}`}
                            onClick={() => onSelectNbs(item.code)}
                        >
                            <div className={styles.resultMeta}>
                                <span className={`${styles.codeBadge} ${styles.interactiveCode} service-code-target`} data-service-code={item.code}>{item.code}</span>
                                {item.has_nebs && <span className={styles.noteBadge}>NEBS</span>}
                            </div>
                            <strong className={`${styles.interactiveCode} service-code-target`} data-service-code={item.code}>{item.description}</strong>
                            <span className={styles.levelHint}>Nivel {item.level}</span>
                        </button>
                    ))}
                </div>
            ) : (
                <div className={styles.emptyState}>
                    <strong>Nenhum servico encontrado</strong>
                    <p>Tente outro codigo ou um termo mais amplo.</p>
                </div>
            )}
        </aside>
    );
}

interface NbsDetailSectionProps {
    readonly nbsNoteBodyHtml: string;
    readonly nbsNotesContentRef: React.RefObject<HTMLDivElement | null>;
    readonly nbsState: ServicesWorkspaceNbsState;
    readonly openCatalogDoc: OpenCatalogDoc;
}

function NbsDetailSection({
    nbsNoteBodyHtml,
    nbsNotesContentRef,
    nbsState,
    openCatalogDoc,
}: Readonly<NbsDetailSectionProps>) {
    return (
        <section className={styles.rightPanel}>
            {nbsState.isLoadingDetail ? (
                <Loading label="Montando painel..." />
            ) : nbsState.detail ? (
                <>
                    <h3 className={styles.rightPanelTitle}>Detalhamento Técnico</h3>

                    <section className={styles.card}>
                        <div className={styles.cardLabel}>Descrição</div>
                        <p>
                            <strong className={`${styles.interactiveCode} service-code-target`} data-service-code={nbsState.detail.item.code}>{nbsState.detail.item.code}</strong>
                            {' - '}
                            {nbsState.detail.item.description}
                        </p>
                    </section>

                    <section className={styles.codeComposition}>
                        <span className={styles.codeLabel}>COMPOSIÇÃO DO CÓDIGO</span>
                        <div className={styles.codeBoxes}>
                            {nbsState.detail.item.code.split('.').map((part, index) => (
                                <React.Fragment key={index}>
                                    <div className={styles.codeBox}>{part}</div>
                                    {index < nbsState.detail!.item.code.split('.').length - 1 && (
                                        <span className={styles.codeSeparator}>-</span>
                                    )}
                                </React.Fragment>
                            ))}
                        </div>
                    </section>

                    {nbsState.detail.nebs && (
                        <section className={styles.notesCard} style={{ marginTop: '1rem' }}>
                            <div className={styles.notesHeader}>
                                <span className={styles.notesIcon}>i</span>
                                <span>NOTAS EXPLICATIVAS</span>
                            </div>
                            <div
                                ref={nbsNotesContentRef}
                                className={styles.notesContent}
                                dangerouslySetInnerHTML={{ __html: nbsNoteBodyHtml }}
                            />
                        </section>
                    )}

                    {nbsState.detail.nebs && (
                        <div className={styles.detailActions}>
                            <button
                                type="button"
                                className={styles.secondaryAction}
                                onClick={() => openCatalogDoc('nebs', nbsState.detail?.item.code)}
                            >
                                Ver NEBS
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <div className={styles.emptyDetail}>
                    <strong>Selecione um servico</strong>
                    <p>O painel mostra descricao, hierarquia e a disponibilidade de nota explicativa publicada.</p>
                </div>
            )}
        </section>
    );
}

interface NbsChapterNotesDialogProps {
    readonly chapterNotesDialogRef: React.RefObject<HTMLDialogElement | null>;
    readonly chapterNotesHtml: string;
    readonly closeChapterNotes: () => void;
    readonly currentChapterNotesEntry: ReturnType<typeof lookupNbsChapterNotesEntry>;
    readonly onBackdropClick: (event: React.MouseEvent<HTMLDialogElement>) => void;
    readonly onDialogKeyDown: (event: React.KeyboardEvent<HTMLDialogElement>) => void;
}

function NbsChapterNotesDialog({
    chapterNotesDialogRef,
    chapterNotesHtml,
    closeChapterNotes,
    currentChapterNotesEntry,
    onBackdropClick,
    onDialogKeyDown,
}: Readonly<NbsChapterNotesDialogProps>) {
    return (
        <dialog
            ref={chapterNotesDialogRef}
            className={styles.chapterNotesDialog}
            aria-labelledby="nbs-chapter-notes-title"
            onClose={closeChapterNotes}
            onCancel={closeChapterNotes}
            onClick={onBackdropClick}
            onKeyDown={onDialogKeyDown}
        >
            {currentChapterNotesEntry && (
                <section className={styles.chapterNotesSheet}>
                    <div className={styles.chapterNotesSheetHeader}>
                        <div className={styles.chapterNotesSheetCopy}>
                            <span className={styles.chapterNotesSheetEyebrow}>NEBS • Explicações do capítulo</span>
                            <h3 id="nbs-chapter-notes-title">
                                Capítulo {currentChapterNotesEntry.chapter} - {currentChapterNotesEntry.title}
                            </h3>
                            <p>
                                Notas oficiais extraídas do Anexo I da Portaria Conjunta RFB/SCS nº 1.429, de 12 de setembro de 2018.
                            </p>
                        </div>
                        <button
                            type="button"
                            className={styles.chapterNotesClose}
                            aria-label="Fechar explicações do capítulo"
                            onClick={closeChapterNotes}
                        >
                            ×
                        </button>
                    </div>

                    <div className={styles.chapterNotesSheetBody}>
                        <section className={styles.notesCard}>
                            <div className={styles.notesHeader}>
                                <span className={styles.notesIcon}>i</span>
                                <span>NOTAS DO CAPÍTULO</span>
                            </div>
                            <div
                                className={`${styles.notesContent} ${styles.chapterNotesContent}`}
                                dangerouslySetInnerHTML={{ __html: chapterNotesHtml }}
                            />
                        </section>
                    </div>
                </section>
            )}
        </dialog>
    );
}

interface NbsWorkspaceViewProps {
    readonly activeChapterNumber: string | null;
    readonly chapterNotesDialogRef: React.RefObject<HTMLDialogElement | null>;
    readonly chapterNotesHtml: string;
    readonly currentChapterNotesEntry: ReturnType<typeof lookupNbsChapterNotesEntry>;
    readonly nbsChapterNotesNewTab: boolean;
    readonly nbsNoteBodyHtml: string;
    readonly nbsNotesContentRef: React.RefObject<HTMLDivElement | null>;
    readonly nbsPrefixAutoExpand: boolean;
    readonly nbsState: ServicesWorkspaceNbsState;
    readonly onSelectNbs: (code: string) => void;
    readonly openCatalogDoc: OpenCatalogDoc;
    readonly setIsChapterNotesOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function NbsWorkspaceView({
    activeChapterNumber,
    chapterNotesDialogRef,
    chapterNotesHtml,
    currentChapterNotesEntry,
    nbsChapterNotesNewTab,
    nbsNoteBodyHtml,
    nbsNotesContentRef,
    nbsPrefixAutoExpand,
    nbsState,
    onSelectNbs,
    openCatalogDoc,
    setIsChapterNotesOpen,
}: Readonly<NbsWorkspaceViewProps>) {
    const chapterButtonLabel = activeChapterNumber
        ? `Capítulo ${activeChapterNumber}`
        : 'Explicações do capítulo';
    const chapterButtonHint = currentChapterNotesEntry?.hasOfficialNotes
        ? 'Abrir explicações oficiais do capítulo'
        : 'Abrir resumo do capítulo';

    const closeChapterNotes = () => {
        setIsChapterNotesOpen(false);
    };

    const handleChapterNotesDialogKeyDown = (
        event: React.KeyboardEvent<HTMLDialogElement>,
    ) => {
        if (event.key === 'Escape') {
            closeChapterNotes();
        }
    };

    const handleChapterNotesBackdropClick = (
        event: React.MouseEvent<HTMLDialogElement>,
    ) => {
        if (event.target === event.currentTarget) {
            closeChapterNotes();
        }
    };

    const handleOpenChapterNotes = () => {
        if (!currentChapterNotesEntry) return;
        if (nbsChapterNotesNewTab) {
            openNbsChapterNotesPreviewWindow(currentChapterNotesEntry);
            return;
        }

        setIsChapterNotesOpen(true);
    };

    const autoExpandedDescendants = (
        nbsPrefixAutoExpand
        && isCodeLikeNbsQuery(nbsState.query)
        && nbsState.detail
    )
        ? getExpandedPrefixBranch(
            nbsState.detail.chapter_items || nbsState.results,
            nbsState.query,
            nbsState.detail.item.code,
        )
        : [];
    const visibleChildren = autoExpandedDescendants.length > 0
        ? autoExpandedDescendants
        : nbsState.detail?.children || [];

    return (
        <div className={styles.body}>
            <NbsHierarchySection
                activeChapterNumber={activeChapterNumber}
                chapterButtonHint={chapterButtonHint}
                chapterButtonLabel={chapterButtonLabel}
                currentChapterNotesEntry={currentChapterNotesEntry}
                nbsState={nbsState}
                onOpenChapterNotes={handleOpenChapterNotes}
                onSelectNbs={onSelectNbs}
                visibleChildren={visibleChildren}
            />
            <NbsDetailSection
                nbsNoteBodyHtml={nbsNoteBodyHtml}
                nbsNotesContentRef={nbsNotesContentRef}
                nbsState={nbsState}
                openCatalogDoc={openCatalogDoc}
            />
            <NbsChapterNotesDialog
                chapterNotesDialogRef={chapterNotesDialogRef}
                chapterNotesHtml={chapterNotesHtml}
                closeChapterNotes={closeChapterNotes}
                currentChapterNotesEntry={currentChapterNotesEntry}
                onBackdropClick={handleChapterNotesBackdropClick}
                onDialogKeyDown={handleChapterNotesDialogKeyDown}
            />
        </div>
    );
}
