import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
    getNbsServiceDetail,
    getNebsEntryDetail,
} from '../services/api';
import type {
    NbsDetailResponse,
    NbsSearchResponse,
    NebsDetailResponse,
    NebsSearchResponse,
    ServiceDocType,
} from '../types/api.types';
import { getServiceCatalogErrorMessage } from '../utils/servicesCatalog';
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
};

const EMPTY_NEBS_STATE: ServicesWorkspaceNebsState = {
    results: [],
    selectedCode: null,
    detail: null,
    isSearching: false,
    isLoadingDetail: false,
    hasSearched: false,
};

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
            const response = await getNbsServiceDetail(code);
            if (detailRequestRef.current !== requestId) return;
            setNbsDetail(response);
            setNebsDetail(null);
            setSelectedCode(response.item.code);
            setDetailStatus('ready');
        } catch (error) {
            console.error(error);
            if (detailRequestRef.current !== requestId) return;
            setNbsDetail(null);
            setDetailStatus('error');
            toast.error(getServiceCatalogErrorMessage(error, 'nbs'));
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
            toast.error(getServiceCatalogErrorMessage(error, 'nebs'));
        }
    }, []);

    const firstResultCode = data.results[0]?.code || null;

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
            void loadNbsDetail(firstResultCode);
        } else {
            void loadNebsDetail(firstResultCode);
        }
    }, [doc, firstResultCode, loadNbsDetail, loadNebsDetail]);

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
            }
            : EMPTY_NBS_STATE
    ), [data.results, detailStatus, doc, nbsDetail, selectedCode]);

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
                    <button
                        type="button"
                        className={styles.switchButton}
                        onClick={() => onSwitchDoc(doc === 'nbs' ? 'nebs' : 'nbs', data.query)}
                    >
                        {doc === 'nbs' ? 'Ver NEBS →' : '← Ver NBS'}
                    </button>
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
