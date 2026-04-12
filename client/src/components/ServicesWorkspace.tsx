import React, { useEffect, useMemo, useState } from 'react';
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
    type NbsChapterNotesEntry,
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
    const [chapterNotesEntry, setChapterNotesEntry] = useState<NbsChapterNotesEntry | null>(null);

    const openCatalogDoc = (targetDoc: ServiceDocType, query?: string) => {
        if (!query) return;

        if (openNewTab && onOpenDocInNewTab) {
            onOpenDocInNewTab(targetDoc, query);
            return;
        }

        onSwitchDoc(targetDoc, query);
    };

    useEffect(() => {
        if (!chapterNotesEntry) return;

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setChapterNotesEntry(null);
            }
        };

        globalThis.addEventListener('keydown', handleEscape);
        return () => globalThis.removeEventListener('keydown', handleEscape);
    }, [chapterNotesEntry]);

    if (doc === 'nbs') {
        const chapterCodeSource = nbsState.detail?.item.code || nbsState.selectedCode || (
            isCodeLikeNbsQuery(nbsState.query) ? nbsState.query : null
        );
        const activeChapterNumber = getNbsChapterNumber(chapterCodeSource);
        const activeChapterNotes = getNbsChapterNotesEntry(chapterCodeSource);
        const chapterButtonLabel = activeChapterNumber
            ? `Capítulo ${activeChapterNumber}`
            : 'Explicações do capítulo';
        const chapterButtonHint = activeChapterNotes?.hasOfficialNotes
            ? 'Abrir explicações oficiais do capítulo'
            : 'Abrir resumo do capítulo';
        const handleOpenChapterNotes = () => {
            if (!activeChapterNotes) return;
            if (nbsChapterNotesNewTab) {
                openNbsChapterNotesTab(activeChapterNotes);
                return;
            }

            setChapterNotesEntry(activeChapterNotes);
        };
        const chapterNotesHtml = chapterNotesEntry
            ? renderNbsChapterNotesHtml(chapterNotesEntry)
            : '';
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
                <aside className={styles.leftPanel}>
                    <div className={styles.leftPanelHeader}>
                        <div className={styles.leftPanelTitle}>
                            <button
                                type="button"
                                className={styles.chapterNotesButton}
                                onClick={handleOpenChapterNotes}
                                disabled={!activeChapterNotes}
                                title={chapterButtonHint}
                            >
                                <span className={styles.chapterNotesEyebrow}>Explicações</span>
                                <span>{chapterButtonLabel}</span>
                            </button>
                            Hierarquia NBS
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
                                <div className={`${styles.nodeCard} ${styles.active}`}>
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
                                <section className={styles.notesCard} style={{ marginTop: "1rem" }}>
                                    <div className={styles.notesHeader}>
                                        <span className={styles.notesIcon}>i</span>
                                        <span>NOTAS EXPLICATIVAS</span>
                                    </div>
                                    <div
                                        className={styles.notesContent}
                                        dangerouslySetInnerHTML={{ __html: nbsNoteBodyHtml }}
                                    />
                                </section>
                            )}

                            <button
                                type="button"
                                className={styles.primaryAction}
                                onClick={() => openCatalogDoc('nebs', nbsState.detail?.item.code)}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
                                Ver NEBS
                            </button>
                        </>
                    ) : (
                        <div className={styles.emptyDetail}>
                            <strong>Selecione um servico</strong>
                            <p>O painel mostra descricao, hierarquia e a disponibilidade de nota explicativa publicada.</p>
                        </div>
                    )}
                </section>

                {chapterNotesEntry && (
                    <div className={styles.chapterNotesOverlay} role="dialog" aria-modal="true" aria-labelledby="nbs-chapter-notes-title">
                        <button
                            type="button"
                            className={styles.chapterNotesBackdrop}
                            aria-label="Fechar explicações do capítulo"
                            onClick={() => setChapterNotesEntry(null)}
                        />
                        <section className={styles.chapterNotesSheet}>
                            <div className={styles.chapterNotesSheetHeader}>
                                <div className={styles.chapterNotesSheetCopy}>
                                    <span className={styles.chapterNotesSheetEyebrow}>NBS • Explicações do capítulo</span>
                                    <h3 id="nbs-chapter-notes-title">
                                        Capítulo {chapterNotesEntry.chapter} - {chapterNotesEntry.title}
                                    </h3>
                                    <p>
                                        Notas oficiais extraídas do Anexo I da Portaria Conjunta RFB/SCS nº 1.429, de 12 de setembro de 2018.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className={styles.chapterNotesClose}
                                    aria-label="Fechar explicações do capítulo"
                                    onClick={() => setChapterNotesEntry(null)}
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
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={styles.body}>
            <aside className={styles.sidebar}>
                <div className={styles.sidebarHeader}>
                    <span>Resultados</span>
                    <strong>{nebsState.results.length}</strong>
                </div>

                {nebsState.isSearching ? (
                    <Loading label="Buscando notas..." />
                ) : !nebsState.hasSearched ? (
                    <div className={styles.emptyState}>
                        <strong>Busque uma nota explicativa</strong>
                        <p>Digite um codigo NBS ou um termo textual para pesquisar a NEBS.</p>
                    </div>
                ) : nebsState.results.length > 0 ? (
                    <div className={styles.resultList}>
                        {nebsState.results.map((item) => (
                            <button
                                key={item.code}
                                type="button"
                                className={`${styles.resultCard} ${nebsState.selectedCode === item.code ? styles.resultCardActive : ''}`}
                                onClick={() => onSelectNebs(item.code)}
                            >
                                <div className={styles.resultMeta}>
                                    <span className={`${styles.codeBadge} ${styles.interactiveCode} service-code-target`} data-service-code={item.code}>{item.code}</span>
                                    <span className={styles.noteBadge}>NEBS</span>
                                </div>
                                <strong className={`${styles.interactiveCode} service-code-target`} data-service-code={item.code}>{item.code} - {item.title}</strong>
                                <span className={styles.resultExcerpt}>{item.excerpt}</span>
                                <span className={styles.levelHint}>Paginas {item.page_start} a {item.page_end}</span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className={styles.emptyState}>
                        <strong>Nenhuma nota encontrada</strong>
                        <p>Tente um termo mais amplo ou um codigo completo.</p>
                    </div>
                )}
            </aside>

            <section className={styles.detailPanel}>
                {nebsState.isLoadingDetail ? (
                    <Loading label="Montando nota..." />
                ) : nebsState.detail ? (
                    <>
                        <div className={styles.detailHero}>
                            <div className={`${styles.detailCode} ${styles.interactiveCode} service-code-target`} data-service-code={nebsState.detail.entry.code}>{nebsState.detail.entry.code}</div>
                            <h3>{nebsState.detail.entry.title}</h3>
                            <p className={styles.heroMeta}>
                                {nebsState.detail.entry.section_title || 'Secao nao informada'} • Paginas {nebsState.detail.entry.page_start} a {nebsState.detail.entry.page_end}
                            </p>
                        </div>

                        <div className={styles.breadcrumbs} aria-label="Hierarquia NBS">
                            {nebsState.detail.ancestors.map((ancestor) => (
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
                                data-service-code={nebsState.detail?.item.code}
                                onClick={() => openCatalogDoc('nbs', nebsState.detail?.item.code)}
                            >
                                {nebsState.detail.item.code}
                            </button>
                        </div>

                        <div className={styles.detailGrid}>
                            <section className={styles.card}>
                                <div className={styles.cardLabel}>Servico NBS vinculado</div>
                                <p>{nebsState.detail.item.description}</p>
                            </section>

                            <section className={styles.card}>
                                <div className={styles.cardLabel}>Origem</div>
                                <p>{nebsState.detail.entry.section_title || 'Secao nao identificada'}</p>
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
                                onClick={() => openCatalogDoc('nbs', nebsState.detail?.item.code)}
                            >
                                Abrir item NBS relacionado
                            </button>
                        </div>
                    </>
                ) : (
                    <div className={styles.emptyDetail}>
                        <strong>Selecione uma nota</strong>
                        <p>O painel mostra a nota explicativa publicada, a seção de origem e o vínculo com o serviço NBS.</p>
                    </div>
                )}
            </section>
        </div>
    );
}
