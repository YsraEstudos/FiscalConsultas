import { useSettings } from '../context/SettingsContext';
import { ChangeEvent, useEffect } from 'react';
import { VIEW_MODE, SIDEBAR_POSITION } from '../constants';
import styles from './SettingsModal.module.css';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const {
        theme, fontSize, highlightEnabled, adminMode, tipiViewMode, sidebarPosition,
        updateTheme, updateFontSize, toggleHighlight, toggleAdminMode, updateTipiViewMode, updateSidebarPosition, restoreDefaults
    } = useSettings();

    // Close on ESC
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleFontSizeChange = (e: ChangeEvent<HTMLInputElement>) => {
        updateFontSize(parseInt(e.target.value));
    };

    return (
        <div className={`${styles.modal} ${isOpen ? styles.active : ''}`} onClick={onClose}>
            <div className={styles.content} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className={styles.header}>
                    <h2>Configurações</h2>
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
                                    className={styles.slider}
                                    style={{ maxWidth: '120px' }}
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
                                <label className={styles.switch}>
                                    <input
                                        type="checkbox"
                                        checked={highlightEnabled}
                                        onChange={toggleHighlight}
                                        data-testid="highlight-toggle"
                                    />
                                    <span className={styles.sliderRound}></span>
                                </label>
                            </div>

                            <div className={styles.item}>
                                <div className={styles.label}>
                                    <span>Modo Desenvolvedor</span>
                                    <span className={styles.hint}>Logs de IA e Admin</span>
                                </div>
                                <label className={styles.switch}>
                                    <input
                                        type="checkbox"
                                        checked={adminMode}
                                        onChange={toggleAdminMode}
                                        data-testid="admin-toggle"
                                    />
                                    <span className={styles.sliderRound}></span>
                                </label>
                            </div>
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
                        <div className={styles.card} style={{ gridColumn: '1 / -1' }}>
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
