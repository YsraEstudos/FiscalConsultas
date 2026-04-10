import React from 'react';
import { useMemo } from 'react';
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

export interface ServicesWorkspaceNbsState {
    readonly results: readonly NbsServiceItem[];
    readonly selectedCode: string | null;
    readonly detail: NbsDetailResponse | null;
    readonly isSearching: boolean;
    readonly isLoadingDetail: boolean;
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
    return noteBody
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
        .join('');
}

function renderNoteHtml(note: NoteContent): string {
    const markdownBody = note?.body_markdown?.trim();
    if (markdownBody) {
        const renderedMarkdown = marked.parse(markdownBody, {
            async: false,
            breaks: true,
            gfm: true,
        }) as string;

        return DOMPurify.sanitize(renderedMarkdown, {
            USE_PROFILES: { html: true },
        });
    }

    const plainTextBody = note?.body_text?.trim();
    if (!plainTextBody) {
        return '<p>Sem conteudo detalhado.</p>';
    }

    return DOMPurify.sanitize(renderPlainTextNoteHtml(plainTextBody), {
        USE_PROFILES: { html: true },
    });
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

    if (doc === 'nbs') {
        return (
            <div className={styles.body}>
                <aside className={styles.sidebar}>
                    <div className={styles.sidebarHeader}>
                        <span>Resultados</span>
                        <strong>{nbsState.results.length}</strong>
                    </div>

                    {nbsState.isSearching ? (
                        <Loading label="Buscando catalogo..." />
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
                                        <span className={styles.codeBadge}>{item.code}</span>
                                        {item.has_nebs && <span className={styles.noteBadge}>NEBS</span>}
                                    </div>
                                    <strong>{item.description}</strong>
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

                <section className={styles.detailPanel}>
                    {nbsState.isLoadingDetail ? (
                        <Loading label="Montando painel..." />
                    ) : nbsState.detail ? (
                        <>
                            <div className={styles.detailHeroInline}>
                                <div className={styles.detailCodeInline}>{nbsState.detail.item.code}</div>
                                <h3>{nbsState.detail.item.description}</h3>
                            </div>

                            <div className={styles.breadcrumbs} aria-label="Hierarquia NBS">
                                {nbsState.detail.ancestors.map((ancestor) => (
                                    <React.Fragment key={ancestor.code}>
                                        <button
                                            type="button"
                                            className={styles.crumbText}
                                            onClick={() => onSelectNbs(ancestor.code)}
                                        >
                                            {ancestor.code}
                                        </button>
                                        <span className={styles.crumbSeparator}>/</span>
                                    </React.Fragment>
                                ))}
                                <span className={styles.crumbCurrentText}>{nbsState.detail.item.code}</span>
                            </div>

                            {nbsState.detail.nebs && (
                                <section className={styles.card} style={{ marginTop: "1rem" }}>
                                    <div className={styles.cardLabel}>Nota Explicativa (NEBS)</div>
                                    <div
                                        className={styles.noteBody}
                                        dangerouslySetInnerHTML={{ __html: nbsNoteBodyHtml }}
                                    />
                                </section>
                            )}

                            <section className={styles.childrenSection}>
                                <div className={styles.childrenHeader}>
                                    <h4>Subitens</h4>
                                    <span>{nbsState.detail.children.length}</span>
                                </div>
                                {nbsState.detail.children.length > 0 ? (
                                    <div className={styles.childrenList}>
                                        {nbsState.detail.children.map((child) => (
                                            <button
                                                key={child.code}
                                                type="button"
                                                className={styles.childItem}
                                                onClick={() => onSelectNbs(child.code)}
                                            >
                                                <span className={styles.childCode}>{child.code}</span>
                                                <span>{child.description}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className={styles.emptyChildren}>Este item nao possui filhos diretos.</div>
                                )}
                            </section>
                        </>
                    ) : (
                        <div className={styles.emptyDetail}>
                            <strong>Selecione um servico</strong>
                            <p>O painel mostra descricao, hierarquia e a disponibilidade de nota explicativa publicada.</p>
                        </div>
                    )}
                </section>
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
                                    <span className={styles.codeBadge}>{item.code}</span>
                                    <span className={styles.noteBadge}>NEBS</span>
                                </div>
                                <strong>{item.title}</strong>
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
                            <div className={styles.detailCode}>{nebsState.detail.entry.code}</div>
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
                                    className={styles.crumb}
                                    onClick={() => onSwitchDoc('nbs', ancestor.code)}
                                >
                                    {ancestor.code}
                                </button>
                            ))}
                            <button
                                type="button"
                                className={styles.crumbCurrentButton}
                                onClick={() => onSwitchDoc('nbs', nebsState.detail?.item.code)}
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
                                onClick={() => onSwitchDoc('nbs', nebsState.detail?.item.code)}
                            >
                                Abrir item NBS relacionado
                            </button>
                            {onOpenDocInNewTab && (
                                <button
                                    type="button"
                                    className={styles.secondaryAction}
                                    onClick={() => onOpenDocInNewTab('nbs', nebsState.detail?.item.code)}
                                >
                                    Abrir NBS em nova aba
                                </button>
                            )}
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
