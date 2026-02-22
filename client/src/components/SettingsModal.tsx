import { useSettings } from '../context/SettingsContext';
import { ChangeEvent, useEffect } from 'react';
import { VIEW_MODE, SIDEBAR_POSITION } from '../constants';
import { useIsAdmin } from '../hooks/useIsAdmin';
import styles from './SettingsModal.module.css';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: Readonly<SettingsModalProps>) {
    const {
        theme, fontSize, highlightEnabled, adminMode, tipiViewMode, sidebarPosition,
        updateTheme, updateFontSize, toggleHighlight, toggleAdminMode, updateTipiViewMode, updateSidebarPosition, restoreDefaults
    } = useSettings();
    const isAdmin = useIsAdmin();

    // Close on ESC
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) globalThis.addEventListener('keydown', handleEsc);
        return () => globalThis.removeEventListener('keydown', handleEsc);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleFontSizeChange = (e: ChangeEvent<HTMLInputElement>) => {
        updateFontSize(Number.parseInt(e.target.value));
    };

    return (
        // nosonar: ignoring non-interactive element click warning since this is a standard modal backdrop pattern
        <div className={`${styles.modal} ${isOpen ? styles.active : ''}`} onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} role="presentation"> {/* NOSONAR */}
            <div
                className={styles.content}
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-modal-title"
                onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
            > {/* NOSONAR */}

                {/* Header */}
                <div className={styles.header}>
                    <h2 id="settings-modal-title">Configurações</h2>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
                        ×
                    </button>
                </div>

                {/* Body with Grid Layout */}
                <div className={styles.body}>
                    <div className={styles.grid}>

                        {/* CARD 1: APARÊNCIA */}
                        <div className={styles.card}>
                            <div className={styles.item}>
                                <div className={styles.label}>
                                    <span>Tema</span>
                                    <span className={styles.hint}>Aparência da interface</span>
                                </div>
                                <div className={styles.toggleGroup}>
                                    <button
                                        className={`${styles.toggleBtn} ${theme === 'light' ? styles.active : ''}`}
                                        onClick={() => updateTheme('light')}
                                        title="Tema Claro"
                                    >
                                        ☀️ Claro
                                    </button>
                                    <button
                                        className={`${styles.toggleBtn} ${theme === 'dark' ? styles.active : ''}`}
                                        onClick={() => updateTheme('dark')}
                                        title="Tema Escuro"
                                    >
                                        🌙 Escuro
                                    </button>
                                </div>
                            </div>

                            <div className={styles.item}>
                                <div className={styles.label}>
                                    <span>Tamanho da Fonte</span>
                                    <span className={styles.hint}>{fontSize}px</span>
                                </div>
                                <input
                                    type="range"
                                    min="12"
                                    max="20"
                                    value={fontSize}
                                    onChange={handleFontSizeChange}
                                    className={`${styles.slider} ${styles.sliderInput}`}
                                    aria-label="Tamanho da Fonte"
                                    title="Tamanho da Fonte"
                                    placeholder="Tamanho da Fonte"
                                />
                            </div>
                        </div>

                        {/* CARD 2: FUNCIONALIDADES */}
                        <div className={styles.card}>
                            <div className={styles.item}>
                                <div className={styles.label}>
                                    <span>Realçar Resultados</span>
                                    <span className={styles.hint}>Destacar termos encontrados</span>
                                </div>
                                <label className={styles.switch} aria-label="Realçar Resultados" title="Realçar Resultados">
                                    <input
                                        type="checkbox"
                                        checked={highlightEnabled}
                                        onChange={toggleHighlight}
                                        data-testid="highlight-toggle"
                                        aria-label="Realçar Resultados"
                                        title="Realçar Resultados"
                                        placeholder="Realçar Resultados"
                                    />
                                    <span className={styles.sliderRound}></span>
                                </label>
                            </div>

                            {isAdmin && (
                                <div className={styles.item}>
                                    <div className={styles.label}>
                                        <span>Modo Desenvolvedor</span>
                                        <span className={styles.hint}>Logs de IA e Admin</span>
                                    </div>
                                    <label className={styles.switch} aria-label="Modo Desenvolvedor" title="Modo Desenvolvedor">
                                        <input
                                            type="checkbox"
                                            checked={adminMode}
                                            onChange={toggleAdminMode}
                                            data-testid="admin-toggle"
                                            aria-label="Modo Desenvolvedor"
                                            title="Modo Desenvolvedor"
                                            placeholder="Modo Desenvolvedor"
                                        />
                                        <span className={styles.sliderRound}></span>
                                    </label>
                                </div>
                            )}
                        </div>

                        {/* CARD 3: NAVEGAÇÃO */}
                        <div className={styles.card}>
                            <div className={styles.item}>
                                <div className={styles.label}>
                                    <span>Posição da Navegação</span>
                                    <span className={styles.hint}>Lado da sidebar de capítulos</span>
                                </div>
                                <div className={styles.toggleGroup}>
                                    <button
                                        className={`${styles.toggleBtn} ${sidebarPosition === SIDEBAR_POSITION.LEFT ? styles.active : ''}`}
                                        onClick={() => updateSidebarPosition(SIDEBAR_POSITION.LEFT)}
                                    >
                                        ◀ Esquerda
                                    </button>
                                    <button
                                        className={`${styles.toggleBtn} ${sidebarPosition === SIDEBAR_POSITION.RIGHT ? styles.active : ''}`}
                                        onClick={() => updateSidebarPosition(SIDEBAR_POSITION.RIGHT)}
                                    >
                                        Direita ▶
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* CARD 4: TIPI (Full width) */}
                        <div className={`${styles.card} ${styles.fullWidthCard}`}>
                            <div className={styles.item}>
                                <div className={styles.label}>
                                    <span>Visualização TIPI</span>
                                    <span className={styles.hint}>Comportamento de busca por código</span>
                                </div>
                                <div className={styles.toggleGroup}>
                                    <button
                                        className={`${styles.toggleBtn} ${tipiViewMode === VIEW_MODE.FAMILY ? styles.active : ''}`}
                                        onClick={() => updateTipiViewMode(VIEW_MODE.FAMILY)}
                                    >
                                        📁 Família NCM
                                    </button>
                                    <button
                                        className={`${styles.toggleBtn} ${tipiViewMode === VIEW_MODE.CHAPTER ? styles.active : ''}`}
                                        onClick={() => updateTipiViewMode(VIEW_MODE.CHAPTER)}
                                    >
                                        📖 Capítulo Completo
                                    </button>
                                </div>
                            </div>
                        </div>

                    </div>

                    <div className={styles.footer}>
                        <button className={styles.btnReset} onClick={restoreDefaults}>
                            Restaurar Padrões
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
