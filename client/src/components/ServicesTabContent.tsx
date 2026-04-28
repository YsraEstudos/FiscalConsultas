import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
    getNbsServiceDetailPage,
    getNbsServiceTreePage,
} from '../services/api';
import { useLocalDatabase } from '../context/LocalDatabaseContext';
import type {
    NbsDetailResponse,
    NbsServiceItem,
    NbsSearchResponse,
    ServiceDocType,
} from '../types/api.types';
import {
    getServiceCatalogErrorInfo,
    reportServiceCatalogError,
} from '../utils/servicesCatalog';
import {
    ServicesWorkspace,
    type ServicesWorkspaceNbsState,
} from './ServicesWorkspace';
import styles from './ServicesTabContent.module.css';

type DetailStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ServicesTabContentProps {
    readonly doc: ServiceDocType;
    readonly data: NbsSearchResponse;
    readonly onSwitchDoc: (nextDoc: ServiceDocType, query?: string) => void;
    readonly onOpenDocInNewTab?: (nextDoc: ServiceDocType, query?: string) => void;
    readonly onContentReady?: () => void;
}



const DEFAULT_NBS_TREE_PAGE_SIZE = 50;

function runInBackground(task: Promise<unknown>) {
    task.catch(() => undefined);
}

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

async function fetchLocalNbsDetailPage(
    getNbsDetailLocal: (
        code: string,
        options?: { page?: number; pageSize?: number },
    ) => Promise<NbsDetailResponse | null>,
    code: string,
    page: number,
    pageSize: number,
): Promise<NbsDetailResponse | null> {
    try {
        return await getNbsDetailLocal(code, { page, pageSize });
    } catch {
        return null;
    }
}

async function fetchInitialNbsDetailPage(
    code: string,
    pageSize: number,
    preferLocal: boolean,
    getNbsDetailLocal: (
        code: string,
        options?: { page?: number; pageSize?: number },
    ) => Promise<NbsDetailResponse | null>,
): Promise<NbsDetailResponse | null> {
    if (preferLocal) {
        const localResponse = await fetchLocalNbsDetailPage(
            getNbsDetailLocal,
            code,
            1,
            pageSize,
        );
        if (localResponse) return localResponse;
    }

    return getNbsServiceDetailPage(code, {
        includeTree: true,
        page: 1,
        pageSize,
    });
}

async function fetchNextNbsDetailPage(
    code: string,
    page: number,
    pageSize: number,
    preferLocal: boolean,
    getNbsDetailLocal: (
        code: string,
        options?: { page?: number; pageSize?: number },
    ) => Promise<NbsDetailResponse | null>,
): Promise<
    Pick<NbsDetailResponse, 'chapter_root' | 'chapter_page'> | null
> {
    if (preferLocal) {
        const localResponse = await fetchLocalNbsDetailPage(
            getNbsDetailLocal,
            code,
            page,
            pageSize,
        );
        if (localResponse) return localResponse;
    }

    return getNbsServiceTreePage(code, page, pageSize);
}

function buildHydratedNbsResponse(
    response: NbsDetailResponse,
    chapterRoot: NbsDetailResponse['chapter_root'],
    mergedItems: NbsServiceItem[],
    currentPage: number,
    lastPage: NonNullable<NbsDetailResponse['chapter_page']>,
): NbsDetailResponse {
    const firstPage = response.chapter_page!;
    return {
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
    } as NbsDetailResponse;
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
    const [detailStatus, setDetailStatus] = useState<DetailStatus>('idle');
    const [isWorkspaceReady, setIsWorkspaceReady] = useState(false);
    const detailRequestRef = useRef(0);
    const readySignalRef = useRef(false);
    const {
        status: localDbStatus,
        getNbsDetailLocal,
    } = useLocalDatabase();

    const isCurrentDetailRequest = useCallback(
        (requestId: number) => detailRequestRef.current === requestId,
        [],
    );

    const hydrateNbsDetailResponse = useCallback(
        async (
            code: string,
            response: NbsDetailResponse,
            requestId: number,
            preferLocal: boolean,
        ): Promise<NbsDetailResponse | null> => {
            const firstPage = response.chapter_page;
            if (!firstPage?.has_more) {
                return response;
            }

            let mergedItems = mergeNbsChapterItems(
                response.chapter_items ?? firstPage.items,
                [],
            );
            let currentPage = firstPage.page;
            let lastPage = firstPage;
            let chapterRoot = response.chapter_root;

            while (lastPage.has_more) {
                const nextPageNumber = currentPage + 1;
                const nextPageResponse = await fetchNextNbsDetailPage(
                    code,
                    nextPageNumber,
                    firstPage.page_size,
                    preferLocal,
                    getNbsDetailLocal,
                );
                if (!nextPageResponse) break;
                if (!isCurrentDetailRequest(requestId)) return null;

                const nextPage = nextPageResponse.chapter_page;
                if (!nextPage) break;

                mergedItems = mergeNbsChapterItems(
                    mergedItems,
                    nextPage.items,
                );
                chapterRoot = chapterRoot ?? nextPageResponse.chapter_root ?? undefined;
                currentPage = nextPageNumber;
                lastPage = nextPage;
            }

            return buildHydratedNbsResponse(
                response,
                chapterRoot,
                mergedItems,
                currentPage,
                lastPage,
            );
        },
        [getNbsDetailLocal, isCurrentDetailRequest],
    );

    const loadNbsDetail = useCallback(async (code: string) => {
        const requestId = detailRequestRef.current + 1;
        detailRequestRef.current = requestId;
        setSelectedCode(code);
        setDetailStatus('loading');

        try {
            const preferLocal = localDbStatus === 'ready';
            const response = await fetchInitialNbsDetailPage(
                code,
                DEFAULT_NBS_TREE_PAGE_SIZE,
                preferLocal,
                getNbsDetailLocal,
            );
            if (!response) {
                throw new Error('NBS detail unavailable');
            }
            if (!isCurrentDetailRequest(requestId)) return;

            const hydratedResponse = await hydrateNbsDetailResponse(
                code,
                response,
                requestId,
                preferLocal,
            );
            if (!hydratedResponse) return;

            setNbsDetail(hydratedResponse);
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
    }, [getNbsDetailLocal, hydrateNbsDetailResponse, isCurrentDetailRequest, localDbStatus]);

    const startNbsDetailLoad = useCallback((code: string) => {
        runInBackground(loadNbsDetail(code));
    }, [loadNbsDetail]);
    const firstResultCode = data.results[0]?.code || null;
    const preferredNbsCode = useMemo(() => {
        const firstCode = data.results[0]?.code || null;

        const rawQuery = data.query.trim();
        if (!rawQuery) {
            return firstCode;
        }

        const cleanQuery = rawQuery.replaceAll(/[^0-9.]/g, '');
        const isCodeLike = Boolean(cleanQuery) && [...rawQuery].every(
            (character) => (character >= '0' && character <= '9') || character === '.',
        );

        if (!isCodeLike) {
            return firstCode;
        }

        const exactMatch = data.results.find(
            (item) => item.code === rawQuery || item.code_clean === cleanQuery.replaceAll('.', ''),
        );

        return exactMatch?.code || firstCode;
    }, [data.query, data.results]);

    useEffect(() => {
        detailRequestRef.current += 1;
        readySignalRef.current = false;
        setIsWorkspaceReady(false);
        setSelectedCode(null);
        setNbsDetail(null);

        if (!firstResultCode) {
            setDetailStatus('idle');
            return;
        }

        if (!preferredNbsCode) {
            setDetailStatus('idle');
            return;
        }
        startNbsDetailLoad(preferredNbsCode);
    }, [firstResultCode, preferredNbsCode, startNbsDetailLoad]);

    useEffect(() => {
        if (readySignalRef.current) return;

        const hasResults = data.results.length > 0;
        const isReady = !hasResults || detailStatus === 'ready' || detailStatus === 'error';
        if (!isReady) return;

        readySignalRef.current = true;
        setIsWorkspaceReady(true);
        onContentReady?.();
    }, [data.results.length, detailStatus, onContentReady]);

    const nbsState = useMemo<ServicesWorkspaceNbsState>(() => ({
        results: data.results,
        selectedCode,
        detail: nbsDetail,
        isSearching: false,
        isLoadingDetail: detailStatus === 'loading',
        query: data.query,
    }), [data.query, data.results, detailStatus, nbsDetail, selectedCode]);

    const title = 'Resultados NBS';
    const countLabel = `${data.total} itens`;
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
                    onSelectNbs={(code) => {
                        startNbsDetailLoad(code);
                    }}
                    onSwitchDoc={onSwitchDoc}
                    onOpenDocInNewTab={onOpenDocInNewTab}
                />
            </div>
        </section>
    );
}
