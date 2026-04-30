/**
 * DatabaseInstaller Component
 *
 * Renders inside the SettingsModal to manage the offline search database.
 * Shows status, progress, and actions for installing/removing the local DB.
 */
import { useCallback } from "react";
import { useLocalDatabase } from "../context/LocalDatabaseContext";
import styles from "./DatabaseInstaller.module.css";

const STEP_LABELS: Record<string, string> = {
  requesting_token: "Solicitando token…",
  downloading: "Baixando banco de dados…",
  verifying_download: "Verificando integridade do arquivo…",
  decrypting: "Verificando e decriptando…",
  loading: "Carregando no motor de busca…",
  saving: "Salvando localmente…",
  waiting_for_other_tab: "Outra aba está instalando os dados…",
  syncing_with_other_tab: "Sincronizando dados com outra aba…",
  done: "Concluído!",
  starting: "Iniciando…",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Displays the status and management interface for the offline search database.
 *
 * Provides buttons to install, remove, or retry the offline database, a progress bar during
 * installation, version/size information when installed, and appropriate messages for
 * unsupported browsers.
 */
export default function DatabaseInstaller() {
  const {
    status,
    progress,
    progressStep,
    localVersion,
    remoteVersion,
    updateAvailable,
    error,
    dbSizeBytes,
    isSupported,
    install,
  } = useLocalDatabase();

  const progressWidth = progress > 0 ? Math.max(progress, 2) : 0;

  const handleInstall = useCallback(async () => {
    try {
      await install();
    } catch {
      // Error is managed by the context
    }
  }, [install]);

  // ---------- Unsupported browser ----------
  if (!isSupported) {
    return (
      <div className={styles.installerCard}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}>⚡</span>
          <span className={styles.cardTitle}>Busca Offline</span>
          <span className={`${styles.statusBadge} ${styles.statusUnsupported}`}>
            ⚠ Indisponível
          </span>
        </div>
        <p className={styles.unsupportedInfo}>
          Seu navegador não suporta os recursos necessários para busca offline
          (SharedArrayBuffer, OPFS). Use Chrome, Edge, ou outro navegador
          baseado em Chromium para esta funcionalidade.
        </p>
      </div>
    );
  }

  // ---------- Checking (initial load) ----------
  if (status === "checking") {
    return (
      <div className={styles.installerCard}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}>⚡</span>
          <span className={styles.cardTitle}>Busca Offline</span>
          <span
            className={`${styles.statusBadge} ${styles.statusInstalling}`}
          >
            🔄 Verificando…
          </span>
        </div>
        <p className={styles.cardDescription}>
          Verificando banco de dados local…
        </p>
      </div>
    );
  }

  // ---------- Installing ----------
  if (status === "installing" || status === "updating") {
    return (
      <div className={styles.installerCard}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}>⚡</span>
          <span className={styles.cardTitle}>Busca Offline</span>
          <span
            className={`${styles.statusBadge} ${styles.statusInstalling}`}
          >
            ⏳ {status === "updating" ? "Atualizando…" : "Instalando…"}
          </span>
        </div>

        <div className={styles.progressContainer}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${progressWidth}%` }}
            />
          </div>
          <div className={styles.progressInfo}>
            <span className={styles.stepLabel}>
              {STEP_LABELS[progressStep] || progressStep}
            </span>
            <span className={styles.progressPercent}>{progress}%</span>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Ready ----------
  if (status === "ready") {
    return (
      <div className={styles.installerCard}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}>⚡</span>
          <span className={styles.cardTitle}>Busca Offline</span>
          <span className={`${styles.statusBadge} ${styles.statusReady}`}>
            ✅ Ativa
          </span>
        </div>

        <p className={styles.cardDescription}>
          O banco de dados está instalado. Suas buscas de NBS, TIPI e NESH
          são executadas localmente em milissegundos.
        </p>

        <div className={styles.infoRow}>
          {localVersion && (
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Versão:</span>
              <span>{localVersion}</span>
            </div>
          )}
          {updateAvailable && remoteVersion && (
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Nova versão:</span>
              <span>{remoteVersion}</span>
            </div>
          )}
          {dbSizeBytes && (
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Tamanho:</span>
              <span>{formatBytes(dbSizeBytes)}</span>
            </div>
          )}
        </div>

        <div className={styles.actions}>
          {updateAvailable && (
            <button
              type="button"
              className={styles.btnInstall}
              onClick={handleInstall}
              id="db-installer-update"
            >
              🔄 Atualizar Banco Offline
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------- Error ----------
  if (status === "error") {
    return (
      <div className={styles.installerCard}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}>⚡</span>
          <span className={styles.cardTitle}>Busca Offline</span>
          <span className={`${styles.statusBadge} ${styles.statusError}`}>
            ❌ Erro
          </span>
        </div>

        {error && <div className={styles.errorMessage}>⚠️ {error}</div>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnRetry}
            onClick={handleInstall}
            id="db-installer-retry"
          >
            🔄 Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  // ---------- Not Installed ----------
  return (
    <div className={styles.installerCard}>
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon}>⚡</span>
        <span className={styles.cardTitle}>Busca Offline</span>
      </div>

      <p className={styles.cardDescription}>
        Instale o banco de dados localmente para buscar NBS, TIPI e NESH
        instantaneamente, sem depender de conexão de internet. O download é feito
        uma única vez{dbSizeBytes ? ` (~${formatBytes(dbSizeBytes)})` : " (~24 MB)"}.
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.btnInstall}
          onClick={handleInstall}
          id="db-installer-install"
        >
          ⚡ Instalar Busca Instantânea
        </button>
      </div>
    </div>
  );
}
