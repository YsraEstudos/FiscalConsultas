import { RefreshCw } from 'lucide-react';
import { useAppUpdate } from '../hooks/useAppUpdate';
import styles from './Header.module.css'; // Vamos reutilizar/adicionar classes no css do header

export function ReloadPrompt() {
  const { hasUpdateAvailable, applyUpdate } = useAppUpdate();

  if (!hasUpdateAvailable) return null;

  return (
    <button
      onClick={applyUpdate}
      title="Atualização disponível. Clique para aplicar."
      className={styles.updateBadge}
    >
      <RefreshCw size={14} className={styles.updateBadgeIcon} />
      <span>Atualizar</span>
    </button>
  );
}
