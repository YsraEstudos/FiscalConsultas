import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { searchNCM, searchTipi } from '../services/api';
import { useSettings } from '../context/SettingsContext';
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
    ncm: string;
    title: string;
    markdown: string | null;
    loading: boolean;
};

const emptyPanel = (title: string): PanelState => ({
    ncm: '',
    title,
    markdown: null,
    loading: false
});

export function ComparatorModal({ isOpen, onClose, defaultDoc = 'nesh' }: ComparatorModalProps) {
    const { tipiViewMode } = useSettings();

    const [doc, setDoc] = useState<DocType>(defaultDoc);
    const [left, setLeft] = useState<PanelState>(() => emptyPanel('Esquerda'));
    const [right, setRight] = useState<PanelState>(() => emptyPanel('Direita'));

    // Keep doc in sync when opening (so it follows current UI context)
    useEffect(() => {
        if (isOpen) setDoc(defaultDoc);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

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
        return left.ncm.trim().length > 0 && right.ncm.trim().length > 0;
    }, [left.ncm, right.ncm]);

    const fetchSide = useCallback(async (ncm: string, side: 'left' | 'right') => {
        const clean = ncm.trim();
        if (!clean) return;

        const setPanel = side === 'left' ? setLeft : setRight;
        setPanel(prev => ({ ...prev, loading: true, title: `Buscando ${clean}...` }));

        try {
            const data = doc === 'nesh'
                ? await searchNCM(clean)
                : await searchTipi(clean, tipiViewMode);

            const markdown = data?.markdown || data?.resultados || null;
            setPanel({
                ncm: clean,
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
    }, [doc, tipiViewMode]);

    const onCompare = useCallback(async () => {
        if (!canCompare) {
            toast.error('Preencha ambos os NCMs.');
            return;
        }
        await Promise.all([
            fetchSide(left.ncm, 'left'),
            fetchSide(right.ncm, 'right')
        ]);
    }, [canCompare, fetchSide, left.ncm, right.ncm]);

    const onSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        onCompare();
    }, [onCompare]);

    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.content} onClick={(e) => e.stopPropagation()}>
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
                            value={left.ncm}
                            onChange={(e) => setLeft(prev => ({ ...prev, ncm: e.target.value }))}
                            placeholder="Ex: 8517"
                        />
                    </div>
                    <div className={styles.vs}>VS</div>
                    <div className={styles.inputGroup}>
                        <label htmlFor="compareRight">NCM Direita</label>
                        <input
                            id="compareRight"
                            className={styles.input}
                            value={right.ncm}
                            onChange={(e) => setRight(prev => ({ ...prev, ncm: e.target.value }))}
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
                        <div className={styles.panelHeader}>{left.title}</div>
                        <div className={styles.panelContent}>
                            {left.loading ? (
                                <Loading />
                            ) : (
                                <MarkdownPane markdown={left.markdown} className="markdown-body" />
                            )}
                        </div>
                    </div>

                    <div className={styles.divider} />

                    <div className={styles.panel}>
                        <div className={styles.panelHeader}>{right.title}</div>
                        <div className={styles.panelContent}>
                            {right.loading ? (
                                <Loading />
                            ) : (
                                <MarkdownPane markdown={right.markdown} className="markdown-body" />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
