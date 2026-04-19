import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { searchNCMFull, searchTipi } from '../services/api';
import { useLocalDatabase } from '../context/LocalDatabaseContext';
import { useSettings } from '../context/SettingsContext';
import { buildLocalCodeSearchResponse, resolveSearchResponseMarkup } from '../utils/searchResultMarkup';
import { MarkdownPane } from './MarkdownPane';
import { Loading } from './Loading';
import styles from './ComparatorModal.module.css';

type DocType = 'nesh' | 'tipi';

interface ComparatorModalProps {
    isOpen: boolean;
    onClose: () => void;
    defaultDoc?: DocType;
}

type PanelState = {
    title: string;
    markdown: string | null;
    loading: boolean;
};

const emptyPanel = (title: string): PanelState => ({
    title,
    markdown: null,
    loading: false
});

export function ComparatorModal({ isOpen, onClose, defaultDoc = 'nesh' }: ComparatorModalProps) {
    const { tipiViewMode } = useSettings();
    const { status: dbStatus, searchLocal } = useLocalDatabase();

    const [doc, setDoc] = useState<DocType>(defaultDoc);
    const [leftQuery, setLeftQuery] = useState('');
    const [rightQuery, setRightQuery] = useState('');
    const [leftPanel, setLeftPanel] = useState<PanelState>(() => emptyPanel('Esquerda'));
    const [rightPanel, setRightPanel] = useState<PanelState>(() => emptyPanel('Direita'));

    // Keep modal state in sync when opening
    useEffect(() => {
        if (!isOpen) return;
        setDoc(defaultDoc);
        setLeftQuery('');
        setRightQuery('');
        setLeftPanel(emptyPanel('Esquerda'));
        setRightPanel(emptyPanel('Direita'));
    }, [isOpen, defaultDoc]);

    // Body scroll lock
    useEffect(() => {
        if (!isOpen) return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prevOverflow;
        };
    }, [isOpen]);

    // Close on ESC
    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    const canCompare = useMemo(() => {
        return leftQuery.trim().length > 0 && rightQuery.trim().length > 0;
    }, [leftQuery, rightQuery]);

    const fetchSide = useCallback(async (ncm: string, side: 'left' | 'right') => {
        const clean = ncm.trim();
        if (!clean) return;

        const setPanel = side === 'left' ? setLeftPanel : setRightPanel;
        setPanel(prev => ({ ...prev, loading: true, title: `Buscando ${clean}...` }));

        try {
            let markdown: string | null = null;

            if (dbStatus === 'ready') {
                const localResponse = await searchLocal(
                    doc,
                    clean,
                    doc === 'tipi' ? tipiViewMode : undefined,
                );

                if (localResponse?.searchType === 'code' && localResponse.results && typeof localResponse.results === 'object') {
                    const normalizedLocalResponse = buildLocalCodeSearchResponse(
                        doc,
                        clean,
                        localResponse.results as Record<string, any>,
                    );
                    markdown = resolveSearchResponseMarkup(doc, normalizedLocalResponse);
                }
            }

            if (!markdown) {
                const data = doc === 'nesh'
                    ? await searchNCMFull(clean)
                    : await searchTipi(clean, tipiViewMode);

                markdown = resolveSearchResponseMarkup(doc, data);
            }

            if (!markdown || typeof markdown !== 'string') {
                throw new Error('Nenhum conteúdo renderizável retornado para a comparação.');
            }

            setPanel({
                title: `${doc.toUpperCase()} ${clean}`,
                markdown,
                loading: false
            });
        } catch (e: any) {
            console.error(e);
            setPanel(prev => ({
                ...prev,
                loading: false,
                title: `${doc.toUpperCase()} ${clean}`,
                markdown: null
            }));
            toast.error('Erro ao comparar. Verifique a API.');
        }
    }, [dbStatus, doc, searchLocal, tipiViewMode]);

    const onCompare = useCallback(async () => {
        if (!canCompare) {
            toast.error('Preencha ambos os NCMs.');
            return;
        }
        await Promise.all([
            fetchSide(leftQuery, 'left'),
            fetchSide(rightQuery, 'right')
        ]);
    }, [canCompare, fetchSide, leftQuery, rightQuery]);

    const onSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        onCompare();
    }, [onCompare]);

    if (!isOpen) return null;

    return (
        <div
            className={styles.overlay}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className={styles.content}>
                <div className={styles.header}>
                    <div className={styles.headerTitle}>
                        <h2 className={styles.headerHeading}>⚖️ Comparar NCMs</h2>
                        <div className={`${styles.docSelector} ${styles.docSelectorInline}`}>
                            <button
                                className={`${styles.docButton} ${doc === 'nesh' ? styles.docButtonActive : ''}`}
                                type="button"
                                onClick={() => setDoc('nesh')}
                            >
                                NESH
                            </button>
                            <button
                                className={`${styles.docButton} ${doc === 'tipi' ? styles.docButtonActive : ''}`}
                                type="button"
                                onClick={() => setDoc('tipi')}
                            >
                                TIPI
                            </button>
                        </div>
                    </div>
                    <button className={styles.closeButton} onClick={onClose} aria-label="Fechar">×</button>
                </div>

                <form className={styles.inputs} onSubmit={onSubmit}>
                    <div className={styles.inputGroup}>
                        <label htmlFor="compareLeft">NCM Esquerda</label>
                        <input
                            id="compareLeft"
                            className={styles.input}
                            value={leftQuery}
                            onChange={(e) => setLeftQuery(e.target.value)}
                            placeholder="Ex: 8517"
                        />
                    </div>
                    <div className={styles.vs}>VS</div>
                    <div className={styles.inputGroup}>
                        <label htmlFor="compareRight">NCM Direita</label>
                        <input
                            id="compareRight"
                            className={styles.input}
                            value={rightQuery}
                            onChange={(e) => setRightQuery(e.target.value)}
                            placeholder="Ex: 8471"
                        />
                    </div>

                    <button
                        className={styles.compareButton}
                        type="submit"
                        disabled={!canCompare}
                        title="Comparar"
                    >
                        ⚖️ Comparar
                    </button>
                </form>

                <div className={styles.body}>
                    <div className={styles.panel}>
                        <div className={styles.panelHeader}>{leftPanel.title}</div>
                        <div className={styles.panelContent}>
                            {leftPanel.loading ? (
                                <Loading />
                            ) : leftPanel.markdown ? (
                                <MarkdownPane markdown={leftPanel.markdown} className="markdown-body" />
                            ) : null}
                        </div>
                    </div>

                    <div className={styles.divider} />

                    <div className={styles.panel}>
                        <div className={styles.panelHeader}>{rightPanel.title}</div>
                        <div className={styles.panelContent}>
                            {rightPanel.loading ? (
                                <Loading />
                            ) : rightPanel.markdown ? (
                                <MarkdownPane markdown={rightPanel.markdown} className="markdown-body" />
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
