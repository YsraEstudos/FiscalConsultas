/**
 * NotePanel - Painel lateral para exibição de notas
 * 
 * Aparece na lateral da tela (esquerda ou direita baseado em configuração)
 * ao invés de um modal que cobre a tela.
 */

import styles from './NotePanel.module.css';

interface NotePanelProps {
    isOpen: boolean;
    onClose: () => void;
    note: string;
    chapter: string;
    content: string;
    position: 'left' | 'right';
}

export function NotePanel({
    isOpen,
    onClose,
    note,
    chapter,
    content,
    position
}: NotePanelProps) {
    if (!isOpen) return null;

    return (
        <aside
            className={`${styles.panel} ${styles[position]} ${isOpen ? styles.open : ''}`}
            aria-label={`Nota ${note} do Capítulo ${chapter}`}
        >
            <div className={styles.header}>
                <h3 className={styles.title}>
                    Nota {note}
                    <span className={styles.chapter}>Capítulo {chapter}</span>
                </h3>
                <button
                    className={styles.closeBtn}
                    onClick={onClose}
                    aria-label="Fechar nota"
                >
                    ×
                </button>
            </div>
            <div className={styles.content}>
                {content}
            </div>
        </aside>
    );
}

