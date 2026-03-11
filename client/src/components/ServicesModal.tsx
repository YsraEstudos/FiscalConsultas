import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { toast } from 'react-hot-toast';
import {
    getNbsServiceDetail,
    getNebsEntryDetail,
    searchNbsServices,
    searchNebsEntries,
} from '../services/api';
import type {
    NbsDetailResponse,
    NbsServiceItem,
    NebsDetailResponse,
    NebsSearchItem,
    ServiceDocType,
} from '../types/api.types';
import { Loading } from './Loading';
import styles from './ServicesModal.module.css';

interface ServicesModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface NbsViewState {
    query: string;
    results: NbsServiceItem[];
    selectedCode: string | null;
    detail: NbsDetailResponse | null;
    isSearching: boolean;
    isLoadingDetail: boolean;
}

interface NebsViewState {
    query: string;
    results: NebsSearchItem[];
    selectedCode: string | null;
    detail: NebsDetailResponse | null;
    isSearching: boolean;
    isLoadingDetail: boolean;
    hasSearched: boolean;
}

const INITIAL_NBS_STATE: NbsViewState = {
    query: '',
    results: [],
    selectedCode: null,
    detail: null,
    isSearching: false,
    isLoadingDetail: false,
};

const INITIAL_NEBS_STATE: NebsViewState = {
    query: '',
    results: [],
    selectedCode: null,
    detail: null,
    isSearching: false,
    isLoadingDetail: false,
    hasSearched: false,
};

function fireAndForget(task: Promise<unknown>) {
    task.catch(() => undefined);
}

export function ServicesModal({ isOpen, onClose }: Readonly<ServicesModalProps>) {
    const [doc, setDoc] = useState<ServiceDocType>('nbs');
    const [nbsState, setNbsState] = useState<NbsViewState>(INITIAL_NBS_STATE);
    const [nebsState, setNebsState] = useState<NebsViewState>(INITIAL_NEBS_STATE);
    const nbsSearchRequestRef = useRef(0);
    const nbsDetailRequestRef = useRef(0);
    const nebsSearchRequestRef = useRef(0);
    const nebsDetailRequestRef = useRef(0);
    const inputId = useId();

    const loadNbsDetail = useCallback(async (code: string) => {
        const requestId = nbsDetailRequestRef.current + 1;
        nbsDetailRequestRef.current = requestId;
        setNbsState((current) => ({ ...current, isLoadingDetail: true }));

        try {
            const response = await getNbsServiceDetail(code);
            if (nbsDetailRequestRef.current !== requestId) return;
            setNbsState((current) => ({
                ...current,
                detail: response,
                selectedCode: response.item.code,
                isLoadingDetail: false,
            }));
        } catch (error) {
            console.error(error);
            if (nbsDetailRequestRef.current === requestId) {
                setNbsState((current) => ({
                    ...current,
                    detail: null,
                    isLoadingDetail: false,
                }));
            }
            toast.error('Não foi possível carregar os detalhes do serviço.');
        }
    }, []);

    const loadNebsDetail = useCallback(async (code: string) => {
        const requestId = nebsDetailRequestRef.current + 1;
        nebsDetailRequestRef.current = requestId;
        setNebsState((current) => ({ ...current, isLoadingDetail: true }));

        try {
            const response = await getNebsEntryDetail(code);
            if (nebsDetailRequestRef.current !== requestId) return;
            setNebsState((current) => ({
                ...current,
                detail: response,
                selectedCode: response.entry.code,
                isLoadingDetail: false,
            }));
        } catch (error) {
            console.error(error);
            if (nebsDetailRequestRef.current === requestId) {
                setNebsState((current) => ({
                    ...current,
                    detail: null,
                    isLoadingDetail: false,
                }));
            }
            toast.error('Não foi possível carregar os detalhes da NEBS.');
        }
    }, []);

    const loadNbsResults = useCallback(async (nextQuery: string) => {
        const requestId = nbsSearchRequestRef.current + 1;
        nbsSearchRequestRef.current = requestId;
        setNbsState((current) => ({ ...current, isSearching: true, query: nextQuery }));

        try {
            const response = await searchNbsServices(nextQuery);
            if (nbsSearchRequestRef.current !== requestId) return;

            const nextSelectedCode = response.results[0]?.code || null;
            setNbsState((current) => ({
                ...current,
                results: response.results,
                selectedCode: nextSelectedCode,
                isSearching: false,
                detail: nextSelectedCode && current.detail?.item.code === nextSelectedCode ? current.detail : null,
            }));

            if (nextSelectedCode) {
                fireAndForget(loadNbsDetail(nextSelectedCode));
            } else {
                nbsDetailRequestRef.current += 1;
                setNbsState((current) => ({
                    ...current,
                    detail: null,
                    isLoadingDetail: false,
                }));
            }
        } catch (error) {
            console.error(error);
            if (nbsSearchRequestRef.current === requestId) {
                setNbsState((current) => ({
                    ...current,
                    results: [],
                    detail: null,
                    selectedCode: null,
                    isSearching: false,
                }));
            }
            toast.error('Erro ao carregar o catálogo NBS.');
        }
    }, [loadNbsDetail]);

    const loadNebsResults = useCallback(async (nextQuery: string) => {
        const requestId = nebsSearchRequestRef.current + 1;
        nebsSearchRequestRef.current = requestId;
        setNebsState((current) => ({
            ...current,
            isSearching: true,
            query: nextQuery,
            hasSearched: true,
        }));

        try {
            const response = await searchNebsEntries(nextQuery);
            if (nebsSearchRequestRef.current !== requestId) return;

            const nextSelectedCode = response.results[0]?.code || null;
            setNebsState((current) => ({
                ...current,
                results: response.results,
                selectedCode: nextSelectedCode,
                isSearching: false,
                detail: nextSelectedCode && current.detail?.entry.code === nextSelectedCode ? current.detail : null,
            }));

            if (nextSelectedCode) {
                fireAndForget(loadNebsDetail(nextSelectedCode));
            } else {
                nebsDetailRequestRef.current += 1;
                setNebsState((current) => ({
                    ...current,
                    detail: null,
                    isLoadingDetail: false,
                }));
            }
        } catch (error) {
            console.error(error);
            if (nebsSearchRequestRef.current === requestId) {
                setNebsState((current) => ({
                    ...current,
                    results: [],
                    detail: null,
                    selectedCode: null,
                    isSearching: false,
                    hasSearched: true,
                }));
            }
            toast.error('Erro ao carregar o catálogo NEBS.');
        }
    }, [loadNebsDetail]);

    const openRelatedNbs = useCallback((code: string) => {
        setDoc('nbs');
        setNbsState((current) => ({
            ...current,
            selectedCode: code,
            query: code,
        }));
        fireAndForget(loadNbsResults(code));
    }, [loadNbsResults]);

    useEffect(() => {
        if (!isOpen) return;
        setDoc('nbs');
        setNbsState(INITIAL_NBS_STATE);
        setNebsState(INITIAL_NEBS_STATE);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || doc !== 'nbs') return;
        const timeoutId = globalThis.setTimeout(() => {
            fireAndForget(loadNbsResults(nbsState.query));
        }, nbsState.query.trim() ? 220 : 0);
        return () => globalThis.clearTimeout(timeoutId);
    }, [doc, isOpen, loadNbsResults, nbsState.query]);

    useEffect(() => {
        if (!isOpen || doc !== 'nebs') return;
        const trimmedQuery = nebsState.query.trim();
        if (!trimmedQuery) {
            nebsSearchRequestRef.current += 1;
            nebsDetailRequestRef.current += 1;
            setNebsState((current) => ({
                ...current,
                results: [],
                selectedCode: null,
                detail: null,
                isSearching: false,
                isLoadingDetail: false,
                hasSearched: false,
            }));
            return;
        }

        const timeoutId = globalThis.setTimeout(() => {
            fireAndForget(loadNebsResults(trimmedQuery));
        }, 220);
        return () => globalThis.clearTimeout(timeoutId);
    }, [doc, isOpen, loadNebsResults, nebsState.query]);

    useEffect(() => {
        if (!isOpen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        globalThis.addEventListener('keydown', onKeyDown);
        return () => globalThis.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    const noteBodyHtml = useMemo(() => {
        const noteBody = nebsState.detail?.entry.body_markdown || nebsState.detail?.entry.body_text || '';
        if (!noteBody) return '';

        const renderedMarkdown = marked.parse(noteBody, {
            async: false,
            breaks: true,
            gfm: true,
        }) as string;

        return DOMPurify.sanitize(renderedMarkdown, {
            USE_PROFILES: { html: true },
        });
    }, [nebsState.detail?.entry.body_markdown, nebsState.detail?.entry.body_text]);

    if (!isOpen) return null;

    const activeHeading = doc === 'nbs' ? 'NBS 2.0' : 'NEBS';
    const activeSubtitle = doc === 'nbs'
        ? 'Navegue pela hierarquia de serviços e veja quando já existe nota explicativa publicada.'
        : 'Pesquise diretamente nas notas explicativas publicadas e abra o serviço NBS relacionado quando precisar.';

    return (
        <div
            className={styles.overlay}
            role="none"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className={styles.content}>
                <div className={styles.header}>
                    <div className={styles.headerCopy}>
                        <span className={styles.kicker}>Catalogo de servicos</span>
                        <h2 className={styles.heading}>{activeHeading}</h2>
                        <p className={styles.subtitle}>{activeSubtitle}</p>
                    </div>

                    <div className={styles.headerActions}>
                        <div className={styles.docSelector}>
                            <button
                                className={`${styles.docButton} ${doc === 'nbs' ? styles.docButtonActive : ''}`}
                                type="button"
                                onClick={() => setDoc('nbs')}
                            >
                                NBS
                            </button>
                            <button
                                className={`${styles.docButton} ${doc === 'nebs' ? styles.docButtonActive : ''}`}
                                type="button"
                                onClick={() => setDoc('nebs')}
                            >
                                NEBS
                            </button>
                        </div>
                        <button className={styles.closeButton} type="button" onClick={onClose} aria-label="Fechar">
                            ×
                        </button>
                    </div>
                </div>

                <div className={styles.toolbar}>
                    <label className={styles.searchLabel} htmlFor={inputId}>
                        {doc === 'nbs' ? 'Buscar por codigo ou descricao' : 'Buscar por codigo ou termo da nota'}
                    </label>
                    <input
                        id={inputId}
                        className={styles.searchInput}
                        value={doc === 'nbs' ? nbsState.query : nebsState.query}
                        onChange={(event) => {
                            const value = event.target.value;
                            if (doc === 'nbs') {
                                setNbsState((current) => ({ ...current, query: value }));
                                return;
                            }
                            setNebsState((current) => ({ ...current, query: value }));
                        }}
                        placeholder={doc === 'nbs' ? 'Ex: 1.0102 ou construcao' : 'Ex: 1.0102.61 ou energia'}
                    />
                    <div className={styles.toolbarHint}>
                        {doc === 'nbs'
                            ? 'Sem busca, mostramos os grupos raiz do catalogo.'
                            : 'A busca NEBS só mostra notas validadas e publicadas.'}
                    </div>
                </div>

                <div className={styles.body}>
                    {doc === 'nbs' ? (
                        <>
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
                                                onClick={() => {
                                                    fireAndForget(loadNbsDetail(item.code));
                                                }}
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
                                        <div className={styles.detailHero}>
                                            <div className={styles.detailCode}>{nbsState.detail.item.code}</div>
                                            <h3>{nbsState.detail.item.description}</h3>
                                        </div>

                                        <div className={styles.breadcrumbs} aria-label="Hierarquia NBS">
                                            {nbsState.detail.ancestors.map((ancestor) => (
                                                <button
                                                    key={ancestor.code}
                                                    type="button"
                                                    className={styles.crumb}
                                                    onClick={() => {
                                                        fireAndForget(loadNbsDetail(ancestor.code));
                                                    }}
                                                >
                                                    {ancestor.code}
                                                </button>
                                            ))}
                                            <span className={styles.crumbCurrent}>{nbsState.detail.item.code}</span>
                                        </div>

                                        <div className={styles.detailGrid}>
                                            <section className={styles.card}>
                                                <div className={styles.cardLabel}>Descricao atual</div>
                                                <p>{nbsState.detail.item.description}</p>
                                            </section>

                                            <section className={styles.card}>
                                                <div className={styles.cardLabel}>Status NEBS</div>
                                                <p>
                                                    {nbsState.detail.nebs
                                                        ? 'Ja existe uma nota explicativa publicada para este codigo.'
                                                        : 'Ainda nao existe nota explicativa publicada para este codigo.'}
                                                </p>
                                            </section>
                                        </div>

                                        {nbsState.detail.nebs && (
                                            <section className={styles.card}>
                                                <div className={styles.cardLabel}>Nota explicativa publicada</div>
                                                <p>{nbsState.detail.nebs.title}</p>
                                                <button
                                                    type="button"
                                                    className={styles.secondaryAction}
                                                    onClick={() => {
                                                        setDoc('nebs');
                                                        setNebsState((current) => ({
                                                            ...current,
                                                            query: nbsState.detail?.item.code || current.query,
                                                        }));
                                                    }}
                                                >
                                                    Abrir na aba NEBS
                                                </button>
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
                                                            onClick={() => {
                                                                fireAndForget(loadNbsDetail(child.code));
                                                            }}
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
                        </>
                    ) : (
                        <>
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
                                                onClick={() => {
                                                    fireAndForget(loadNebsDetail(item.code));
                                                }}
                                            >
                                                <div className={styles.resultMeta}>
                                                    <span className={styles.codeBadge}>{item.code}</span>
                                                    {item.section_title && <span className={styles.noteBadge}>NEBS</span>}
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
                                                    onClick={() => openRelatedNbs(ancestor.code)}
                                                >
                                                    {ancestor.code}
                                                </button>
                                            ))}
                                            <button
                                                type="button"
                                                className={styles.crumbCurrentButton}
                                                onClick={() => openRelatedNbs(nebsState.detail!.item.code)}
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
                                                dangerouslySetInnerHTML={{ __html: noteBodyHtml }}
                                            />
                                        </section>

                                        <div className={styles.detailActions}>
                                            <button
                                                type="button"
                                                className={styles.secondaryAction}
                                                onClick={() => openRelatedNbs(nebsState.detail!.item.code)}
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
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
