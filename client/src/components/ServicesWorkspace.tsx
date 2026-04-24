import React, { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type {
    NbsDetailResponse,
    NbsServiceItem,
    NebsDetailResponse,
    NebsSearchItem,
    ServiceDocType,
} from '../types/api.types';
import { Loading } from './Loading';
import styles from './ServicesWorkspace.module.css';

import { useSettings } from '../context/SettingsContext';
import {
    getNbsChapterNotesEntry,
    getNbsChapterNumber,
    openNbsChapterNotesTab,
    renderNbsChapterNotesHtml,
} from '../utils/nbsChapterNotes';
import { injectServiceLinks } from '../utils/serviceCodes';

export interface ServicesWorkspaceNbsState {
    readonly results: readonly NbsServiceItem[];
    readonly selectedCode: string | null;
    readonly detail: NbsDetailResponse | null;
    readonly isSearching: boolean;
    readonly isLoadingDetail: boolean;
    readonly query: string;
}

export interface ServicesWorkspaceNebsState {
    readonly results: readonly NebsSearchItem[];
    readonly selectedCode: string | null;
    readonly detail: NebsDetailResponse | null;
    readonly isSearching: boolean;
    readonly isLoadingDetail: boolean;
    readonly hasSearched: boolean;
}

interface ServicesWorkspaceProps {
    readonly doc: ServiceDocType;
    readonly nbsState: ServicesWorkspaceNbsState;
    readonly nebsState: ServicesWorkspaceNebsState;
    readonly onSelectNbs: (code: string) => void;
    readonly onSelectNebs: (code: string) => void;
    readonly onSwitchDoc: (doc: ServiceDocType, query?: string) => void;
    readonly onOpenDocInNewTab?: (doc: ServiceDocType, query?: string) => void;
}

type NoteContent = {
    readonly body_markdown?: string | null;
    readonly body_text?: string | null;
} | null | undefined;

type OpenCatalogDoc = (
    targetDoc: ServiceDocType,
    query?: string,
    forceNewTab?: boolean,
) => void;

function getNbsChapterCodeSource(
    doc: ServiceDocType,
    nbsState: ServicesWorkspaceNbsState,
): string | null {
    if (doc !== 'nbs') return null;
    if (nbsState.detail?.item.code) return nbsState.detail.item.code;
    if (nbsState.selectedCode) return nbsState.selectedCode;
    if (isCodeLikeNbsQuery(nbsState.query)) {
        return nbsState.query;
    }
    return null;
}

function getVisibleNbsChildren(
    nbsPrefixAutoExpand: boolean,
    nbsState: ServicesWorkspaceNbsState,
): readonly NbsServiceItem[] {
    const fallbackChildren = nbsState.detail?.children || [];
    if (!nbsPrefixAutoExpand || !nbsState.detail || !isCodeLikeNbsQuery(nbsState.query)) {
        return fallbackChildren;
    }

    const autoExpandedDescendants = getExpandedPrefixBranch(
        nbsState.detail.chapter_items || nbsState.results,
        nbsState.query,
        nbsState.detail.item.code,
    );
    if (autoExpandedDescendants.length > 0) {
        return autoExpandedDescendants;
    }

    return fallbackChildren;
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function renderPlainTextNoteHtml(noteBody: string): string {
    const normalizedBody = noteBody.replaceAll(/\r\n?/g, '\n');

    return normalizedBody
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br />')}</p>`)
        .join('');
}

function renderNoteHtml(note: NoteContent): string {
    const markdownBody = note?.body_markdown?.trim();
    if (markdownBody) {
        const renderedMarkdown = marked.parse(markdownBody, {
            async: false,
            breaks: true,
            gfm: true,
        });

        const sanitizedMarkdown = DOMPurify.sanitize(renderedMarkdown, {
            USE_PROFILES: { html: true },
        });

        if (sanitizedMarkdown.trim()) {
            return injectServiceLinks(sanitizedMarkdown);
        }
    }

    const plainTextBody = note?.body_text?.trim();
    if (!plainTextBody) {
        return '<p>Sem conteudo detalhado.</p>';
    }

    return injectServiceLinks(DOMPurify.sanitize(renderPlainTextNoteHtml(plainTextBody), {
        USE_PROFILES: { html: true },
    }));
}

function isCodeLikeNbsQuery(query: string): boolean {
    const rawQuery = query.trim();
    if (!rawQuery) return false;

    const cleanQuery = rawQuery.replaceAll(/[^0-9.]/g, '');
    return Boolean(cleanQuery) && [...rawQuery].every(
        (character) => (character >= '0' && character <= '9') || character === '.',
    );
}

function getExpandedPrefixBranch(
    results: readonly NbsServiceItem[],
    query: string,
    activeCode: string,
): NbsServiceItem[] {
    const cleanQuery = query.replaceAll(/[^0-9]/g, '');
    if (!cleanQuery) return [];

    return results.filter((item) => (
        item.code !== activeCode
        && item.code_clean.startsWith(cleanQuery)
    ));
}

interface NbsHierarchySectionProps {
    readonly activeChapterNumber: string | null;
    readonly chapterButtonHint: string;
    readonly chapterButtonLabel: string;
    readonly currentChapterNotesEntry: ReturnType<typeof getNbsChapterNotesEntry>;
    readonly nbsState: ServicesWorkspaceNbsState;
    readonly onOpenChapterNotes: () => void;
    readonly onSelectNbs: (code: string) => void;
    readonly visibleChildren: readonly NbsServiceItem[];
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
    let sectionBody: React.ReactNode;

    if (nbsState.isSearching) {
        sectionBody = <Loading label="Buscando catalogo..." />;
    } else if (nbsState.detail) {
        sectionBody = (
            <div className={styles.hierarchyList}>
                {nbsState.detail.ancestors.map((item, index) => (
                    <div
                        key={item.code}
                        className={styles.hierarchyNode}
                        style={{ paddingLeft: `${index * 1.5}rem` }}
                    >
                        <button type="button" className={styles.nodeCard} onClick={() => onSelectNbs(item.code)}>
                            <div className={styles.nodeIcon}>
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <polyline points="8 17 12 21 16 17"></polyline>
                                    <line x1="12" y1="12" x2="12" y2="21"></line>
                                    <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"></path>
                                </svg>
                            </div>
                            <div className={styles.nodeContent}>
                                <span className={styles.nodeLabel}>Nível {item.level}</span>
                                <strong
                                    className={`${styles.nodeTitle} ${styles.interactiveCode} service-code-target`}
                                    data-service-code={item.code}
                                >
                                    {item.code} - {item.description}
                                </strong>
                            </div>
                        </button>
                    </div>
                ))}
                <div
                    className={styles.hierarchyNode}
                    style={{ paddingLeft: `${nbsState.detail.ancestors.length * 1.5}rem` }}
                >
                    <div className={`${styles.nodeCard} ${styles.active}`} data-service-state="active">
                        <div className={styles.nodeIcon}>
                            <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <polyline points="16 18 22 12 16 6"></polyline>
                                <polyline points="8 6 2 12 8 18"></polyline>
                            </svg>
                        </div>
                        <div className={styles.nodeContent}>
                            <span className={styles.nodeLabel}>Item Ativo</span>
                            <strong
                                className={`${styles.nodeTitle} ${styles.interactiveCode} service-code-target`}
                                data-service-code={nbsState.detail.item.code}
                            >
                                {nbsState.detail.item.code} - {nbsState.detail.item.description}
                            </strong>
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
                                    <span
                                        className={`${styles.nodeTitle} ${styles.interactiveCode} service-code-target`}
                                        data-service-code={child.code}
                                    >
                                        {child.code} - {child.description}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    } else if (nbsState.results.length > 0) {
        sectionBody = (
            <div className={styles.resultList}>
                {nbsState.results.map((item) => (
                    <button
                        key={item.code}
                        type="button"
                        className={`${styles.resultCard} ${nbsState.selectedCode === item.code ? styles.resultCardActive : ''}`}
                        onClick={() => onSelectNbs(item.code)}
                    >
                        <div className={styles.resultMeta}>
                            <span
                                className={`${styles.codeBadge} ${styles.interactiveCode} service-code-target`}
                                data-service-code={item.code}
                            >
                                {item.code}
                            </span>
                            {item.has_nebs && <span className={styles.noteBadge}>NEBS</span>}
                        </div>
                        <strong className={`${styles.interactiveCode} service-code-target`} data-service-code={item.code}>
                            {item.description}
                        </strong>
                        <span className={styles.levelHint}>Nivel {item.level}</span>
                    </button>
                ))}
            </div>
        );
    } else {
        sectionBody = (
            <div className={styles.emptyState}>
                <strong>Nenhum servico encontrado</strong>
                <p>Tente outro codigo ou um termo mais amplo.</p>
            </div>
        );
    }

    return (
        <aside className={styles.leftPanel}>
            <div className={styles.leftPanelHeader}>
                <div className={styles.leftPanelTitle}>
                    <button type="button" className={styles.chapterNotesButton} onClick={onOpenChapterNotes} disabled={!currentChapterNotesEntry} title={chapterButtonHint}>
                        <span className={styles.chapterNotesEyebrow}>Explicações</span>
                        <span>{chapterButtonLabel}</span>
                    </button>
                    {' '}
                    Hierarquia NBS
                </div>
                <span className={styles.sectionBadge}>
                    {activeChapterNumber ? `Capítulo ${activeChapterNumber} ativo` : 'Capítulo ativo'}
                </span>
            </div>
            {sectionBody}
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
    let detailBody: React.ReactNode;

    if (nbsState.isLoadingDetail) {
        detailBody = <Loading label="Montando painel..." />;
    } else if (nbsState.detail) {
        const detail = nbsState.detail;
        const codeParts = detail.item.code.split('.');
        const linkedNebs = detail.nebs ?? null;
        const linkedNebsCode = linkedNebs?.code ?? null;

        detailBody = (
            <>
                <h3 className={styles.rightPanelTitle}>Detalhamento Técnico</h3>

                <section className={styles.card}>
                    <div className={styles.cardLabel}>Descrição</div>
                    <p>
                        <strong className={`${styles.interactiveCode} service-code-target`} data-service-code={detail.item.code}>
                            {detail.item.code}
                        </strong>
                        {' - '}
                        {detail.item.description}
                    </p>
                </section>

                <section className={styles.codeComposition}>
                    <span className={styles.codeLabel}>COMPOSIÇÃO DO CÓDIGO</span>
                    <div className={styles.codeBoxes}>
                        {codeParts.map((part, index) => {
                            const partKey = codeParts.slice(0, index + 1).join('.');
                            return (
                                <React.Fragment key={partKey}>
                                    <div className={styles.codeBox}>{part}</div>
                                    {index < codeParts.length - 1 && <span className={styles.codeSeparator}>-</span>}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </section>

                {linkedNebs && (
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

                {linkedNebsCode && (
                    <div className={styles.detailActions}>
                        <button
                            type="button"
                            className={styles.secondaryAction}
                            onClick={() => openCatalogDoc('nebs', linkedNebsCode)}
                        >
                            Ver NEBS
                        </button>
                    </div>
                )}
            </>
        );
    } else {
        detailBody = (
            <div className={styles.emptyDetail}>
                <strong>Selecione um servico</strong>
                <p>O painel mostra descricao, hierarquia e a disponibilidade de nota explicativa publicada.</p>
            </div>
        );
    }

    return (
        <section className={styles.rightPanel}>
            {detailBody}
        </section>
    );
}

interface NbsChapterNotesDialogProps {
    readonly chapterNotesDialogRef: React.RefObject<HTMLDialogElement | null>;
    readonly chapterNotesHtml: string;
    readonly closeChapterNotes: () => void;
    readonly currentChapterNotesEntry: ReturnType<typeof getNbsChapterNotesEntry>;
}

function NbsChapterNotesDialog({
    chapterNotesDialogRef,
    chapterNotesHtml,
    closeChapterNotes,
    currentChapterNotesEntry,
}: Readonly<NbsChapterNotesDialogProps>) {
    return (
        <dialog
            ref={chapterNotesDialogRef}
            className={styles.chapterNotesDialog}
            aria-labelledby="nbs-chapter-notes-title"
            onClose={closeChapterNotes}
            onCancel={closeChapterNotes}
        >
            {currentChapterNotesEntry && (
                <section className={styles.chapterNotesSheet}>
                    <div className={styles.chapterNotesSheetHeader}>
                        <div className={styles.chapterNotesSheetCopy}>
                            <span className={styles.chapterNotesSheetEyebrow}>NBS • Explicações do capítulo</span>
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
    readonly currentChapterNotesEntry: ReturnType<typeof getNbsChapterNotesEntry>;
    readonly openCatalogDoc: OpenCatalogDoc;
    readonly nbsChapterNotesNewTab: boolean;
    readonly nbsNoteBodyHtml: string;
    readonly nbsNotesContentRef: React.RefObject<HTMLDivElement | null>;
    readonly nbsPrefixAutoExpand: boolean;
    readonly nbsState: ServicesWorkspaceNbsState;
    readonly onSelectNbs: (code: string) => void;
    readonly setIsChapterNotesOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

function NbsWorkspaceView({
    activeChapterNumber,
    chapterNotesDialogRef,
    chapterNotesHtml,
    currentChapterNotesEntry,
    openCatalogDoc,
    nbsChapterNotesNewTab,
    nbsNoteBodyHtml,
    nbsNotesContentRef,
    nbsPrefixAutoExpand,
    nbsState,
    onSelectNbs,
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

    const handleOpenChapterNotes = () => {
        if (!currentChapterNotesEntry) return;
        if (nbsChapterNotesNewTab) {
            openNbsChapterNotesTab(currentChapterNotesEntry);
            return;
        }

        setIsChapterNotesOpen(true);
    };

    const visibleChildren = getVisibleNbsChildren(nbsPrefixAutoExpand, nbsState);

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
            />
        </div>
    );
}

interface NebsResultsSectionProps {
    readonly nebsState: ServicesWorkspaceNebsState;
    readonly onSelectNebs: (code: string) => void;
}

function NebsResultsSection({
    nebsState,
    onSelectNebs,
}: Readonly<NebsResultsSectionProps>) {
    let sectionBody: React.ReactNode;

    if (nebsState.isSearching) {
        sectionBody = <Loading label="Buscando notas..." />;
    } else if (!nebsState.hasSearched) {
        sectionBody = (
            <div className={styles.emptyState}>
                <strong>Busque uma nota explicativa</strong>
                <p>Digite um codigo NEBS ou um termo textual para pesquisar a NEBS.</p>
            </div>
        );
    } else if (nebsState.results.length > 0) {
        sectionBody = (
            <div className={styles.resultList}>
                {nebsState.results.map((item) => (
                    <button
                        key={item.code}
                        type="button"
                        className={`${styles.resultCard} ${nebsState.selectedCode === item.code ? styles.resultCardActive : ''}`}
                        onClick={() => onSelectNebs(item.code)}
                    >
                        <div className={styles.resultMeta}>
                            <span
                                className={`${styles.codeBadge} ${styles.interactiveCode} service-code-target`}
                                data-service-code={item.code}
                            >
                                {item.code}
                            </span>
                            <span className={styles.noteBadge}>NEBS</span>
                        </div>
                        <strong className={`${styles.interactiveCode} service-code-target`} data-service-code={item.code}>
                            {item.code} - {item.title}
                        </strong>
                        <span className={styles.resultExcerpt}>{item.excerpt}</span>
                        <span className={styles.levelHint}>
                            Paginas {item.page_start} a {item.page_end}
                        </span>
                    </button>
                ))}
            </div>
        );
    } else {
        sectionBody = (
            <div className={styles.emptyState}>
                <strong>Nenhuma nota encontrada</strong>
                <p>Tente um termo mais amplo ou um codigo completo.</p>
            </div>
        );
    }

    return (
        <aside className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
                <span>Resultados</span>
                <strong>{nebsState.results.length}</strong>
            </div>
            {sectionBody}
        </aside>
    );
}

interface NebsDetailSectionProps {
    readonly nebsNoteBodyHtml: string;
    readonly nebsState: ServicesWorkspaceNebsState;
    readonly openCatalogDoc: OpenCatalogDoc;
}

function NebsDetailSection({
    nebsNoteBodyHtml,
    nebsState,
    openCatalogDoc,
}: Readonly<NebsDetailSectionProps>) {
    let detailBody: React.ReactNode;

    if (nebsState.isLoadingDetail) {
        detailBody = <Loading label="Montando nota..." />;
    } else if (nebsState.detail) {
        const detail = nebsState.detail;
        detailBody = (
            <>
                <div className={styles.detailHero}>
                    <div
                        className={`${styles.detailCode} ${styles.interactiveCode} service-code-target`}
                        data-service-code={detail.entry.code}
                    >
                        {detail.entry.code}
                    </div>
                    <h3>{detail.entry.title}</h3>
                    <p className={styles.heroMeta}>
                        {detail.entry.section_title || 'Secao nao informada'} • Paginas {detail.entry.page_start} a{' '}
                        {detail.entry.page_end}
                    </p>
                </div>

                <div className={styles.breadcrumbs} aria-label="Hierarquia NBS">
                    {detail.ancestors.map((ancestor) => (
                        <button
                            key={ancestor.code}
                            type="button"
                            className={`${styles.crumb} ${styles.interactiveCode} service-code-target`}
                            data-service-code={ancestor.code}
                            onClick={() => openCatalogDoc('nbs', ancestor.code)}
                        >
                            {ancestor.code}
                        </button>
                    ))}
                    <button
                        type="button"
                        className={`${styles.crumbCurrentButton} ${styles.interactiveCode} service-code-target`}
                        data-service-code={detail.item.code}
                        onClick={() => openCatalogDoc('nbs', detail.item.code)}
                    >
                        {detail.item.code}
                    </button>
                </div>

                <div className={styles.detailGrid}>
                    <section className={styles.card}>
                        <div className={styles.cardLabel}>Servico NBS vinculado</div>
                        <p>{detail.item.description}</p>
                    </section>

                    <section className={styles.card}>
                        <div className={styles.cardLabel}>Origem</div>
                        <p>{detail.entry.section_title || 'Secao nao identificada'}</p>
                    </section>
                </div>

                <section className={styles.card}>
                    <div className={styles.cardLabel}>Conteudo da nota</div>
                    <div
                        className={styles.noteBody}
                        dangerouslySetInnerHTML={{ __html: nebsNoteBodyHtml }}
                    />
                </section>

                <div className={styles.detailActions}>
                    <button
                        type="button"
                        className={styles.secondaryAction}
                        onClick={() => openCatalogDoc('nbs', detail.item.code)}
                    >
                        Abrir item NBS relacionado
                    </button>
                </div>
            </>
        );
    } else {
        detailBody = (
            <div className={styles.emptyDetail}>
                <strong>Selecione uma nota</strong>
                <p>O painel mostra a nota explicativa publicada, a seção de origem e o vínculo com o serviço NBS.</p>
            </div>
        );
    }

    return (
        <section className={styles.detailPanel}>
            {detailBody}
        </section>
    );
}

interface NebsWorkspaceViewProps {
    readonly nebsNoteBodyHtml: string;
    readonly nebsState: ServicesWorkspaceNebsState;
    readonly onSelectNebs: (code: string) => void;
    readonly openCatalogDoc: OpenCatalogDoc;
}

function NebsWorkspaceView({
    nebsNoteBodyHtml,
    nebsState,
    onSelectNebs,
    openCatalogDoc,
}: Readonly<NebsWorkspaceViewProps>) {
    return (
        <div className={styles.body}>
            <NebsResultsSection
                nebsState={nebsState}
                onSelectNebs={onSelectNebs}
            />
            <NebsDetailSection
                nebsNoteBodyHtml={nebsNoteBodyHtml}
                nebsState={nebsState}
                openCatalogDoc={openCatalogDoc}
            />
        </div>
    );
}

export function ServicesWorkspace({
    doc,
    nbsState,
    nebsState,
    onSelectNbs,
    onSelectNebs,
    onSwitchDoc,
    onOpenDocInNewTab,
}: Readonly<ServicesWorkspaceProps>) {
    const nbsNoteBodyHtml = useMemo(() => renderNoteHtml(nbsState.detail?.nebs), [nbsState.detail]);
    const nebsNoteBodyHtml = useMemo(() => renderNoteHtml(nebsState.detail?.entry), [nebsState.detail]);
    const { openNewTab, nbsPrefixAutoExpand, nbsChapterNotesNewTab } = useSettings();
    const [isChapterNotesOpen, setIsChapterNotesOpen] = useState(false);
    const chapterNotesDialogRef = useRef<HTMLDialogElement | null>(null);
    const nbsNotesContentRef = useRef<HTMLDivElement | null>(null);
    const chapterCodeSource = getNbsChapterCodeSource(doc, nbsState);
    const activeChapterNumber = getNbsChapterNumber(chapterCodeSource);
    const currentChapterNotesEntry = getNbsChapterNotesEntry(chapterCodeSource);
    const chapterNotesHtml = currentChapterNotesEntry
        ? renderNbsChapterNotesHtml(currentChapterNotesEntry)
        : '';

    const openCatalogDoc = (targetDoc: ServiceDocType, query?: string, forceNewTab?: boolean) => {
        if (!query) return;

        if ((openNewTab || forceNewTab) && onOpenDocInNewTab) {
            onOpenDocInNewTab(targetDoc, query);
            return;
        }

        onSwitchDoc(targetDoc, query);
    };

    useEffect(() => {
        const container = nbsNotesContentRef.current;
        if (!container) return;

        const handlePointer = (event: MouseEvent) => {
            if (event.type === 'mousedown' && event.button !== 1) {
                return;
            }

            const target = event.target;
            if (!(target instanceof Element)) return;

            const serviceLink = target.closest('.service-smart-link, .service-code-target');
            if (!(serviceLink instanceof HTMLElement) || !container.contains(serviceLink)) {
                return;
            }

            const serviceCode = serviceLink.dataset.serviceCode;
            if (!serviceCode) return;

            event.preventDefault();
            event.stopPropagation();

            const forceNewTab = event.metaKey || event.ctrlKey || event.button === 1;
            openCatalogDoc('nebs', serviceCode, forceNewTab);
        };

        container.addEventListener('mousedown', handlePointer);
        container.addEventListener('click', handlePointer);

        return () => {
            container.removeEventListener('mousedown', handlePointer);
            container.removeEventListener('click', handlePointer);
        };
    }, [openCatalogDoc]);

    useEffect(() => {
        if (!isChapterNotesOpen || !currentChapterNotesEntry) {
            if (chapterNotesDialogRef.current?.open) {
                chapterNotesDialogRef.current.close();
            }
            return;
        }

        const dialog = chapterNotesDialogRef.current;
        if (!dialog) return;

        if (!dialog.open) {
            dialog.showModal();
        }
    }, [currentChapterNotesEntry, isChapterNotesOpen]);

    useEffect(() => {
        if (isChapterNotesOpen && !currentChapterNotesEntry) {
            setIsChapterNotesOpen(false);
        }
    }, [currentChapterNotesEntry, isChapterNotesOpen]);

    if (doc === 'nbs') {
        return (
            <NbsWorkspaceView
                activeChapterNumber={activeChapterNumber}
                chapterNotesDialogRef={chapterNotesDialogRef}
                chapterNotesHtml={chapterNotesHtml}
                currentChapterNotesEntry={currentChapterNotesEntry}
                nbsChapterNotesNewTab={nbsChapterNotesNewTab}
                nbsNoteBodyHtml={nbsNoteBodyHtml}
                nbsNotesContentRef={nbsNotesContentRef}
                nbsPrefixAutoExpand={nbsPrefixAutoExpand}
                nbsState={nbsState}
                onSelectNbs={onSelectNbs}
                openCatalogDoc={openCatalogDoc}
                setIsChapterNotesOpen={setIsChapterNotesOpen}
            />
        );
    }

    return (
        <NebsWorkspaceView
            nebsNoteBodyHtml={nebsNoteBodyHtml}
            nebsState={nebsState}
            onSelectNebs={onSelectNebs}
            openCatalogDoc={openCatalogDoc}
        />
    );
}
