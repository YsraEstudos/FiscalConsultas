/**
 * DatabaseInstaller Component
 *
 * Renders inside the SettingsModal to manage the offline search database.
 * Shows status, progress, and actions for installing/removing the local DB.
 */
import { useCallback } from "react";
import { useLocalDatabase } from "../context/LocalDatabaseContext";
import type { OfflineDatabaseMissingFeature } from "../context/offlineDatabaseStorage";
import styles from "./DatabaseInstaller.module.css";

const STEP_LABELS: Record<string, string> = {
  requesting_token: "Solicitando token…",
  downloading: "Preparando base fiscal…",
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

function formatDatabaseVersion(version: string): string {
  const match = version.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (!match) return version;

  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function getUnsupportedMessage(
  missingFeatures: OfflineDatabaseMissingFeature[],
): string {
  if (missingFeatures.includes("secure-context")) {
    return "A busca local precisa de uma origem segura. Abra o app em http://127.0.0.1:5173/, localhost ou HTTPS para usar esta funcionalidade.";
  }

  if (missingFeatures.includes("opfs")) {
    return "Seu navegador não liberou OPFS, o armazenamento local necessário para a busca offline. Use uma versão atual do Edge, Chrome ou outro navegador baseado em Chromium.";
  }

  if (
    missingFeatures.includes("shared-array-buffer")
    || missingFeatures.includes("cross-origin-isolation")
  ) {
    return "Seu navegador ainda não liberou SharedArrayBuffer para esta página. Aguarde alguns segundos e recarregue; se persistir, use Edge ou Chrome atualizados em HTTPS.";
  }

  return "Seu navegador não suporta todos os recursos necessários para busca offline. Use Edge, Chrome ou outro navegador baseado em Chromium atualizado.";
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
    supportReport,
    install,
  } = useLocalDatabase();

  const progressWidth = progress > 0 ? Math.max(progress, 2) : 0;
  const missingFeatures = supportReport?.missingFeatures ?? [];
  const canRecoverWithIsolationReload =
    supportReport?.canRecoverWithIsolationReload === true;

  const handleInstall = useCallback(async () => {
    try {
      await install();
    } catch {
      // Error is managed by the context
    }
  }, [install]);

  // ---------- Recoverable isolation setup ----------
  if (!isSupported && canRecoverWithIsolationReload) {
    return (
      <div className={styles.installerCard}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}>⚡</span>
          <span className={styles.cardTitle}>Busca local</span>
          <span className={`${styles.statusBadge} ${styles.statusInstalling}`}>
            🔄 Preparando…
          </span>
        </div>
        <p className={styles.unsupportedInfo}>
          O navegador parece compatível, mas ainda precisa ativar o isolamento
          de origem para liberar a busca local. Aguarde alguns segundos e
          recarregue esta página se ela não atualizar automaticamente.
        </p>
      </div>
    );
  }

  // ---------- Unsupported browser ----------
  if (!isSupported) {
    const unsupportedMessage = getUnsupportedMessage(missingFeatures);

    return (
      <div className={styles.installerCard}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}>⚡</span>
          <span className={styles.cardTitle}>Busca local</span>
          <span className={`${styles.statusBadge} ${styles.statusUnsupported}`}>
            ⚠ Indisponível
          </span>
        </div>
        <p className={styles.unsupportedInfo}>
          {unsupportedMessage}
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
          <span className={styles.cardTitle}>Busca local</span>
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
          <span className={styles.cardTitle}>Busca local</span>
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
          <span className={styles.cardTitle}>Busca local</span>
          <span className={`${styles.statusBadge} ${styles.statusReady}`}>
            ✅ Pronta
          </span>
        </div>

        <p className={styles.cardDescription}>
          NBS, TIPI e NESH disponíveis neste computador, sem depender da
          internet.
        </p>

        <div className={styles.infoRow}>
          {localVersion && (
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Atualização:</span>
              <span>{formatDatabaseVersion(localVersion)}</span>
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
              <span className={styles.infoLabel}>Espaço usado:</span>
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
              🔄 Atualizar base local
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
          <span className={styles.cardTitle}>Busca local</span>
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
        <span className={styles.cardTitle}>Busca local</span>
      </div>

      <p className={styles.cardDescription}>
        A busca local é instalada automaticamente na primeira visita para manter
        NBS, TIPI e NESH rápidos e disponíveis neste computador. Se você removeu
        a base local, pode reinstalar quando quiser
        {dbSizeBytes ? ` (~${formatBytes(dbSizeBytes)})` : " (~24 MB)"}.
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.btnInstall}
          onClick={handleInstall}
          id="db-installer-install"
        >
          ⚡ Instalar agora
        </button>
      </div>
    </div>
  );
}
