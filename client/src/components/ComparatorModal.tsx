import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { searchNCM, searchTipi, searchNbsServices, searchNebsEntries } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { MarkdownPane } from './MarkdownPane';
import { Loading } from './Loading';
import styles from './ComparatorModal.module.css';

type DocType = 'nesh' | 'tipi' | 'nbs' | 'nebs';

interface ComparatorModalProps {
    isOpen: boolean;
    onClose: () => void;
    defaultDoc?: DocType;
}

type PanelState = {
    title: string;
    markdown: string | null;
    nbsResults: NbsResultItem[] | null;
    loading: boolean;
};

interface NbsResultItem {
    code: string;
    description: string;
    level: number;
    excerpt?: string;
}

const emptyPanel = (title: string): PanelState => ({
    title,
    markdown: null,
    nbsResults: null,
    loading: false
});

function isServiceDoc(doc: DocType): boolean {
    return doc === 'nbs' || doc === 'nebs';
}

function NbsResultPane({ items }: { items: NbsResultItem[] }) {
    if (items.length === 0) {
        return <div className={styles.nbsEmpty}>Nenhum resultado encontrado.</div>;
    }

    return (
        <div className={styles.nbsResultList}>
            {items.map((item) => (
                <div
                    key={item.code}
                    className={styles.nbsResultItem}
                    style={{ paddingLeft: `${(item.level || 1) * 0.75}rem` }}
                >
                    <span className={styles.nbsCode}>{item.code}</span>
                    <span className={styles.nbsDescription}>
                        {item.description || item.excerpt || '—'}
                    </span>
                </div>
            ))}
        </div>
    );
}

export function ComparatorModal({ isOpen, onClose, defaultDoc = 'nesh' }: ComparatorModalProps) {
    const { tipiViewMode } = useSettings();

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

    const fetchSide = useCallback(async (query: string, side: 'left' | 'right') => {
        const clean = query.trim();
        if (!clean) return;

        const setPanel = side === 'left' ? setLeftPanel : setRightPanel;
        setPanel(prev => ({ ...prev, loading: true, title: `Buscando ${clean}...` }));

        try {
            if (isServiceDoc(doc)) {
                // NBS / NEBS search – returns structured data, not markdown
                const data = doc === 'nbs'
                    ? await searchNbsServices(clean)
                    : await searchNebsEntries(clean);

                const items: NbsResultItem[] = data.results.map((r: any) => ({
                    code: r.code || r.code_clean || '',
                    description: r.description || r.title || '',
                    level: r.level ?? 1,
                    excerpt: r.excerpt,
                }));

                setPanel({
                    title: `${doc.toUpperCase()} "${clean}" (${items.length})`,
                    markdown: null,
                    nbsResults: items,
                    loading: false
                });
            } else {
                // NESH / TIPI – returns markdown
                const data = doc === 'nesh'
                    ? await searchNCM(clean)
                    : await searchTipi(clean, tipiViewMode);

                const markdown = data?.markdown || data?.resultados || null;
                setPanel({
                    title: `${doc.toUpperCase()} ${clean}`,
                    markdown,
                    nbsResults: null,
                    loading: false
                });
            }
        } catch (e: any) {
            console.error(e);
            setPanel(prev => ({
                ...prev,
                loading: false,
                title: `${doc.toUpperCase()} ${clean}`,
                markdown: null,
                nbsResults: null
            }));
            toast.error('Erro ao comparar. Verifique a API.');
        }
    }, [doc, tipiViewMode]);

    const onCompare = useCallback(async () => {
        if (!canCompare) {
            toast.error(isServiceDoc(doc) ? 'Preencha ambos os códigos.' : 'Preencha ambos os NCMs.');
            return;
        }
        await Promise.all([
            fetchSide(leftQuery, 'left'),
            fetchSide(rightQuery, 'right')
        ]);
    }, [canCompare, doc, fetchSide, leftQuery, rightQuery]);

    const onSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        onCompare();
    }, [onCompare]);

    if (!isOpen) return null;

    const isService = isServiceDoc(doc);
    const modalTitle = isService ? '⚖️ Comparar NBS' : '⚖️ Comparar NCMs';
    const leftLabel = isService ? 'Código Esquerda' : 'NCM Esquerda';
    const rightLabel = isService ? 'Código Direita' : 'NCM Direita';
    const leftPlaceholder = isService ? 'Ex: 1.0101' : 'Ex: 8517';
    const rightPlaceholder = isService ? 'Ex: 1.0201' : 'Ex: 8471';

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
                        <h2 className={styles.headerHeading}>{modalTitle}</h2>
                        <div className={`${styles.docSelector} ${styles.docSelectorInline}`}>
                            {isService ? (
                                <>
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
                                </>
                            ) : (
                                <>
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
                                </>
                            )}
                        </div>
                    </div>
                    <button className={styles.closeButton} onClick={onClose} aria-label="Fechar">×</button>
                </div>

                <form className={styles.inputs} onSubmit={onSubmit}>
                    <div className={styles.inputGroup}>
                        <label htmlFor="compareLeft">{leftLabel}</label>
                        <input
                            id="compareLeft"
                            className={styles.input}
                            value={leftQuery}
                            onChange={(e) => setLeftQuery(e.target.value)}
                            placeholder={leftPlaceholder}
                        />
                    </div>
                    <div className={styles.vs}>VS</div>
                    <div className={styles.inputGroup}>
                        <label htmlFor="compareRight">{rightLabel}</label>
                        <input
                            id="compareRight"
                            className={styles.input}
                            value={rightQuery}
                            onChange={(e) => setRightQuery(e.target.value)}
                            placeholder={rightPlaceholder}
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
                            ) : leftPanel.nbsResults ? (
                                <NbsResultPane items={leftPanel.nbsResults} />
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
                            ) : rightPanel.nbsResults ? (
                                <NbsResultPane items={rightPanel.nbsResults} />
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
