import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
    getNbsServiceDetailPage,
    getNbsServiceTreePage,
    getNebsEntryDetail,
} from '../services/api';
import type {
    NbsDetailResponse,
    NbsSearchResponse,
    NebsDetailResponse,
    NebsSearchResponse,
    ServiceDocType,
} from '../types/api.types';
import {
    getServiceCatalogErrorInfo,
    reportServiceCatalogError,
} from '../utils/servicesCatalog';
import {
    ServicesWorkspace,
    type ServicesWorkspaceNebsState,
    type ServicesWorkspaceNbsState,
} from './ServicesWorkspace';
import styles from './ServicesTabContent.module.css';

type ServicesSearchResponse = NbsSearchResponse | NebsSearchResponse;
type DetailStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ServicesTabContentProps {
    readonly doc: ServiceDocType;
    readonly data: ServicesSearchResponse;
    readonly onSwitchDoc: (nextDoc: ServiceDocType, query?: string) => void;
    readonly onOpenDocInNewTab?: (nextDoc: ServiceDocType, query?: string) => void;
    readonly onContentReady?: () => void;
}

const EMPTY_NBS_STATE: ServicesWorkspaceNbsState = {
    results: [],
    selectedCode: null,
    detail: null,
    isSearching: false,
    isLoadingDetail: false,
    query: '',
};

const EMPTY_NEBS_STATE: ServicesWorkspaceNebsState = {
    results: [],
    selectedCode: null,
    detail: null,
    isSearching: false,
    isLoadingDetail: false,
    hasSearched: false,
};

const DEFAULT_NBS_TREE_PAGE_SIZE = 50;

function mergeNbsChapterItems(
    existingItems: readonly NbsDetailResponse['item'][],
    incomingItems: readonly NbsDetailResponse['item'][],
): NbsDetailResponse['item'][] {
    const mergedItems = [...existingItems];
    const seenCodes = new Set(existingItems.map((item) => item.code));

    for (const item of incomingItems) {
        if (seenCodes.has(item.code)) continue;
        seenCodes.add(item.code);
        mergedItems.push(item);
    }

    return mergedItems;
}

export function ServicesTabContent({
    doc,
    data,
    onSwitchDoc,
    onOpenDocInNewTab,
    onContentReady,
}: Readonly<ServicesTabContentProps>) {
    const [selectedCode, setSelectedCode] = useState<string | null>(null);
    const [nbsDetail, setNbsDetail] = useState<NbsDetailResponse | null>(null);
    const [nebsDetail, setNebsDetail] = useState<NebsDetailResponse | null>(null);
    const [detailStatus, setDetailStatus] = useState<DetailStatus>('idle');
    const [isWorkspaceReady, setIsWorkspaceReady] = useState(false);
    const detailRequestRef = useRef(0);
    const readySignalRef = useRef(false);

    const loadNbsDetail = useCallback(async (code: string) => {
        const requestId = detailRequestRef.current + 1;
        detailRequestRef.current = requestId;
        setSelectedCode(code);
        setDetailStatus('loading');

        try {
            const response = await getNbsServiceDetailPage(code, {
                includeTree: true,
                page: 1,
                pageSize: DEFAULT_NBS_TREE_PAGE_SIZE,
            });
            if (detailRequestRef.current !== requestId) return;

            const firstPage = response.chapter_page;
            let hydratedResponse = response;

            if (firstPage?.has_more) {
                let mergedItems = mergeNbsChapterItems(
                    response.chapter_items ?? firstPage.items,
                    [],
                );
                let currentPage = firstPage.page;
                let lastPage = firstPage;
                let chapterRoot = response.chapter_root;

                while (lastPage.has_more) {
                    const nextPageNumber = currentPage + 1;
                    const nextPageResponse = await getNbsServiceTreePage(
                        code,
                        nextPageNumber,
                        firstPage.page_size,
                    );
                    if (detailRequestRef.current !== requestId) return;

                    mergedItems = mergeNbsChapterItems(
                        mergedItems,
                        nextPageResponse.chapter_page.items,
                    );
                    chapterRoot = chapterRoot ?? nextPageResponse.chapter_root;
                    currentPage = nextPageNumber;
                    lastPage = nextPageResponse.chapter_page;
                }

                hydratedResponse = {
                    ...response,
                    chapter_root: chapterRoot,
                    chapter_items: mergedItems,
                    chapter_page: {
                        ...lastPage,
                        items: mergedItems,
                        page: currentPage,
                        page_size: firstPage.page_size,
                        total: firstPage.total,
                        has_more: false,
                    },
                };
            }

            setNbsDetail(hydratedResponse);
            setNebsDetail(null);
            setSelectedCode(hydratedResponse.item.code);
            setDetailStatus('ready');
        } catch (error) {
            console.error(error);
            if (detailRequestRef.current !== requestId) return;
            setNbsDetail(null);
            setDetailStatus('error');
            const serviceError = getServiceCatalogErrorInfo(error, 'nbs');
            reportServiceCatalogError(error, 'nbs', serviceError);
            toast.error(serviceError.message);
        }
    }, []);

    const loadNebsDetail = useCallback(async (code: string) => {
        const requestId = detailRequestRef.current + 1;
        detailRequestRef.current = requestId;
        setSelectedCode(code);
        setDetailStatus('loading');

        try {
            const response = await getNebsEntryDetail(code);
            if (detailRequestRef.current !== requestId) return;
            setNebsDetail(response);
            setNbsDetail(null);
            setSelectedCode(response.entry.code);
            setDetailStatus('ready');
        } catch (error) {
            console.error(error);
            if (detailRequestRef.current !== requestId) return;
            setNebsDetail(null);
            setDetailStatus('error');
            const serviceError = getServiceCatalogErrorInfo(error, 'nebs');
            reportServiceCatalogError(error, 'nebs', serviceError);
            toast.error(serviceError.message);
        }
    }, []);

    const firstResultCode = data.results[0]?.code || null;
    const preferredNbsCode = useMemo(() => {
        if (doc !== 'nbs') return null;

        const rawQuery = data.query.trim();
        if (!rawQuery) {
            return firstResultCode;
        }

        const cleanQuery = rawQuery.replaceAll(/[^0-9.]/g, '');
        const isCodeLike = Boolean(cleanQuery) && [...rawQuery].every(
            (character) => (character >= '0' && character <= '9') || character === '.',
        );

        if (!isCodeLike) {
            return firstResultCode;
        }

        const exactMatch = (data.results as NbsSearchResponse['results']).find(
            (item) => item.code === rawQuery || item.code_clean === cleanQuery.replaceAll('.', ''),
        );

        return exactMatch?.code || firstResultCode;
    }, [data.query, data.results, doc, firstResultCode]);

    useEffect(() => {
        detailRequestRef.current += 1;
        readySignalRef.current = false;
        setIsWorkspaceReady(false);
        setSelectedCode(null);
        setNbsDetail(null);
        setNebsDetail(null);

        if (!firstResultCode) {
            setDetailStatus('idle');
            return;
        }

        if (doc === 'nbs') {
            if (!preferredNbsCode) {
                setDetailStatus('idle');
                return;
            }
            void loadNbsDetail(preferredNbsCode);
        } else {
            void loadNebsDetail(firstResultCode);
        }
    }, [doc, firstResultCode, loadNbsDetail, loadNebsDetail, preferredNbsCode]);

    useEffect(() => {
        if (readySignalRef.current) return;

        const hasResults = data.results.length > 0;
        const isReady = !hasResults || detailStatus === 'ready' || detailStatus === 'error';
        if (!isReady) return;

        readySignalRef.current = true;
        setIsWorkspaceReady(true);
        onContentReady?.();
    }, [data.results.length, detailStatus, onContentReady]);

    const nbsState = useMemo<ServicesWorkspaceNbsState>(() => (
        doc === 'nbs'
            ? {
                results: data.results as NbsSearchResponse['results'],
                selectedCode,
                detail: nbsDetail,
                isSearching: false,
                isLoadingDetail: detailStatus === 'loading',
                query: data.query,
            }
            : EMPTY_NBS_STATE
    ), [data.query, data.results, detailStatus, doc, nbsDetail, selectedCode]);

    const nebsState = useMemo<ServicesWorkspaceNebsState>(() => (
        doc === 'nebs'
            ? {
                results: data.results as NebsSearchResponse['results'],
                selectedCode,
                detail: nebsDetail,
                isSearching: false,
                isLoadingDetail: detailStatus === 'loading',
                hasSearched: true,
            }
            : EMPTY_NEBS_STATE
    ), [data.results, detailStatus, doc, nebsDetail, selectedCode]);

    const title = doc === 'nbs' ? 'Resultados NBS' : 'Resultados NEBS';
    const countLabel = `${data.total} ${doc === 'nbs' ? 'itens' : 'notas'}`;
    const queryLabel = data.query.trim() || 'catalogo raiz';
    const shellClassName = `${styles.shell} ${isWorkspaceReady ? styles.shellVisible : styles.shellHidden}`;

    return (
        <section className={shellClassName} data-document={doc}>
            <header className={styles.shellHeader}>
                <div className={styles.copy}>
                    <span className={styles.kicker}>Catalogo de servicos</span>
                    <h3 className={styles.title}>{title}</h3>
                </div>

                <div className={styles.actions}>
                    <span className={styles.queryPill}>Consulta: {queryLabel}</span>
                    <span className={styles.countPill}>{countLabel}</span>
                </div>
            </header>

            <div className={styles.workspaceFrame}>
                <ServicesWorkspace
                    doc={doc}
                    nbsState={nbsState}
                    nebsState={nebsState}
                    onSelectNbs={(code) => {
                        void loadNbsDetail(code);
                    }}
                    onSelectNebs={(code) => {
                        void loadNebsDetail(code);
                    }}
                    onSwitchDoc={onSwitchDoc}
                    onOpenDocInNewTab={onOpenDocInNewTab}
                />
            </div>
        </section>
    );
}
