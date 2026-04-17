import { useSettings } from "../context/SettingsContext";
import { useLocalDatabase } from "../context/LocalDatabaseContext";
import { ChangeEvent, useCallback, useEffect } from "react";
import {
  VIEW_MODE,
  SIDEBAR_POSITION,
  ACCENT_COLOR,
  type AccentColor,
} from "../constants";
import { useIsAdmin } from "../hooks/useIsAdmin";
import DatabaseInstaller from "./DatabaseInstaller";
import styles from "./SettingsModal.module.css";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Renders the user settings modal with controls for appearance, functionality, navigation, and TIPI view.
 *
 * The modal includes theme selection, accent color picker, font-size slider, result highlighting toggle,
 * optional developer mode toggle for admins, sidebar position selection, TIPI view mode selection, and a
 * "Restore Defaults" action. The modal closes when the backdrop is clicked, the close button is pressed,
 * or the Escape key is pressed.
 *
 * @param isOpen - Whether the modal is visible
 * @param onClose - Callback invoked to close the modal
 * @returns The settings modal element when `isOpen` is true, `null` otherwise
 */
export function SettingsModal({
  isOpen,
  onClose,
}: Readonly<SettingsModalProps>) {
  const {
    theme,
    accentColor,
    fontSize,
    highlightEnabled,
    adminMode,
    tipiViewMode,
    sidebarPosition,
    openNewTab,
    nbsPrefixAutoExpand,
    nbsChapterNotesNewTab,
    updateTheme,
    updateAccentColor,
    updateFontSize,
    toggleHighlight,
    toggleAdminMode,
    updateTipiViewMode,
    updateSidebarPosition,
    toggleOpenNewTab,
    toggleNbsPrefixAutoExpand,
    toggleNbsChapterNotesNewTab,
    restoreDefaults,
  } = useSettings();
  const isAdmin = useIsAdmin();
  const { status: offlineDbStatus, isRemoving } = useLocalDatabase();
  const isOfflineMutationInProgress =
    offlineDbStatus === "installing" ||
    offlineDbStatus === "updating" ||
    isRemoving;

  const handleRequestClose = useCallback(() => {
    if (isOfflineMutationInProgress) return;
    onClose();
  }, [isOfflineMutationInProgress, onClose]);

  // Close on ESC
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleRequestClose();
    };
    if (isOpen) globalThis.addEventListener("keydown", handleEsc);
    return () => globalThis.removeEventListener("keydown", handleEsc);
  }, [handleRequestClose, isOpen]);

  if (!isOpen) return null;

  const handleFontSizeChange = (e: ChangeEvent<HTMLInputElement>) => {
    updateFontSize(Number.parseInt(e.target.value));
  };

  return (
    // nosonar: ignoring non-interactive element click warning since this is a standard modal backdrop pattern
    <div
      className={`${styles.modal} ${isOpen ? styles.active : ""}`}
    >
      <button
        type="button"
        className={styles.backdrop}
        onClick={handleRequestClose}
        disabled={isOfflineMutationInProgress}
        aria-label="Fechar configurações"
      />
      <dialog
        open
        className={styles.content}
        aria-labelledby="settings-modal-title"
      >
        {" "}
        {/* NOSONAR */}
        {/* Header */}
        <div className={styles.header}>
          <h2 id="settings-modal-title">Configurações</h2>
          <button
            className={styles.closeBtn}
            onClick={handleRequestClose}
            disabled={isOfflineMutationInProgress}
            aria-label="Fechar"
          >
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
                    className={`${styles.toggleBtn} ${theme === "light" ? styles.active : ""}`}
                    onClick={() => updateTheme("light")}
                    title="Tema Claro"
                  >
                    ☀️ Claro
                  </button>
                  <button
                    className={`${styles.toggleBtn} ${theme === "dark" ? styles.active : ""}`}
                    onClick={() => updateTheme("dark")}
                    title="Tema AMOLED"
                  >
                    🌑 AMOLED
                  </button>
                </div>
              </div>

              <div className={styles.item}>
                <div className={styles.label}>
                  <span>Cor de Destaque</span>
                  <span className={styles.hint}>
                    Cor principal da interface
                  </span>
                </div>
                <div className={styles.colorPicker}>
                  {(
                    Object.entries(ACCENT_COLOR) as [string, AccentColor][]
                  ).map(([key, value]) => (
                    <button
                      key={value}
                      className={`${styles.colorSwatch} ${accentColor === value ? styles.active : ""}`}
                      onClick={() => updateAccentColor(value)}
                      title={key.charAt(0) + key.slice(1).toLowerCase()}
                      aria-label={`Cor ${value}`}
                      data-testid={`accent-${value}`}
                      data-color={value}
                    />
                  ))}
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
                  <span className={styles.hint}>
                    Destacar termos encontrados
                  </span>
                </div>
                <label
                  className={styles.switch}
                >
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

              <div
                className={`${styles.item} ${styles.navigationBehaviorItem}`}
                data-testid="navigation-behavior-item"
              >
                <div className={styles.label}>
                  <span>Comportamento de Navegação</span>
                  <span className={styles.hint}>
                    Abrir NBS/NEBS relacionado
                  </span>
                </div>
                <div
                  className={styles.toggleGroup}
                  data-testid="navigation-behavior-toggle-group"
                >
                  <button
                    className={`${styles.toggleBtn} ${openNewTab ? "" : styles.active}`}
                    onClick={() => openNewTab && toggleOpenNewTab()}
                  >
                    Na mesma aba
                  </button>
                  <button
                    className={`${styles.toggleBtn} ${openNewTab ? styles.active : ""}`}
                    onClick={() => !openNewTab && toggleOpenNewTab()}
                  >
                    Em nova aba
                  </button>
                </div>
              </div>

              <div className={styles.item}>
                <div className={styles.label}>
                  <span>Expandir prefixos NBS</span>
                  <span className={styles.hint}>
                    Mostrar descendentes automaticamente ao buscar códigos como 1.0601
                  </span>
                </div>
                <label
                  className={styles.switch}
                >
                  <input
                    type="checkbox"
                    checked={nbsPrefixAutoExpand}
                    onChange={toggleNbsPrefixAutoExpand}
                    data-testid="nbs-prefix-auto-expand-toggle"
                    aria-label="Expandir prefixos NBS"
                    title="Expandir prefixos NBS"
                    placeholder="Expandir prefixos NBS"
                  />
                  <span className={styles.sliderRound}></span>
                </label>
              </div>

              <div className={styles.item}>
                <div className={styles.label}>
                  <span>Explicações de capítulo NBS</span>
                  <span className={styles.hint}>
                    Abrir na tela atual por padrão ou em nova aba
                  </span>
                </div>
                <div className={styles.toggleGroup}>
                  <button
                    className={`${styles.toggleBtn} ${nbsChapterNotesNewTab ? "" : styles.active}`}
                    onClick={() => nbsChapterNotesNewTab && toggleNbsChapterNotesNewTab()}
                    aria-pressed={!nbsChapterNotesNewTab}
                  >
                    Na tela
                  </button>
                  <button
                    className={`${styles.toggleBtn} ${nbsChapterNotesNewTab ? styles.active : ""}`}
                    onClick={() => !nbsChapterNotesNewTab && toggleNbsChapterNotesNewTab()}
                    aria-pressed={nbsChapterNotesNewTab}
                  >
                    Nova aba
                  </button>
                </div>
              </div>

              {isAdmin && (
                <div className={styles.item}>
                  <div className={styles.label}>
                    <span>Modo Desenvolvedor</span>
                    <span className={styles.hint}>Logs de IA e Admin</span>
                  </div>
                  <label
                    className={styles.switch}
                  >
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
                  <span className={styles.hint}>
                    Lado da sidebar de capítulos
                  </span>
                </div>
                <div className={styles.toggleGroup}>
                  <button
                    className={`${styles.toggleBtn} ${sidebarPosition === SIDEBAR_POSITION.LEFT ? styles.active : ""}`}
                    onClick={() => updateSidebarPosition(SIDEBAR_POSITION.LEFT)}
                  >
                    ◀ Esquerda
                  </button>
                  <button
                    className={`${styles.toggleBtn} ${sidebarPosition === SIDEBAR_POSITION.RIGHT ? styles.active : ""}`}
                    onClick={() =>
                      updateSidebarPosition(SIDEBAR_POSITION.RIGHT)
                    }
                  >
                    Direita ▶
                  </button>
                </div>
              </div>
            </div>

            {/* CARD: BUSCA OFFLINE */}
            <DatabaseInstaller />

            {/* CARD 4: TIPI (Full width) */}
            <div className={`${styles.card} ${styles.fullWidthCard}`}>
              <div className={styles.item}>
                <div className={styles.label}>
                  <span>Visualização TIPI</span>
                  <span className={styles.hint}>
                    Comportamento de busca por código
                  </span>
                </div>
                <div className={styles.toggleGroup}>
                  <button
                    className={`${styles.toggleBtn} ${tipiViewMode === VIEW_MODE.FAMILY ? styles.active : ""}`}
                    onClick={() => updateTipiViewMode(VIEW_MODE.FAMILY)}
                  >
                    📁 Família NCM
                  </button>
                  <button
                    className={`${styles.toggleBtn} ${tipiViewMode === VIEW_MODE.CHAPTER ? styles.active : ""}`}
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
      </dialog>
    </div>
  );
}
