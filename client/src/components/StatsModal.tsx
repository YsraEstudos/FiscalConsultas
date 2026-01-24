import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { getSystemStatus } from '../services/api';
import styles from './StatsModal.module.css';

interface StatsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function StatsModal({ isOpen, onClose }: StatsModalProps) {
    const [stats, setStats] = useState<any>(null); // Weak type for now
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setLoading(true);
            getSystemStatus()
                .then(data => setStats(data))
                .catch(err => console.error(err))
                .finally(() => setLoading(false));
        }
    }, [isOpen]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Estatísticas do Sistema">
            <div className={styles.statsContent}>
                {loading && <p>Carregando status...</p>}

                {stats && (
                    <div className={styles.statsGrid}>
                        <div className={styles.statCard}>
                            <div className={styles.statLabel}>Versão</div>
                            <div className={styles.statValue}>{stats.version}</div>
                            <div className={styles.statSub}>{stats.backend}</div>
                        </div>

                        <div className={styles.statCard}>
                            <div className={styles.statLabel}>Banco NESH</div>
                            <div className={`${styles.statStatus} ${stats.database?.status === 'ok' ? styles.statStatusOnline : styles.statStatusError}`}>
                                {stats.database?.status === 'ok' ? 'Online' : 'Erro'}
                            </div>
                            <div className={styles.statDetails}>
                                <div>{stats.database?.chapters || 0} Capítulos</div>
                                <div>{stats.database?.positions || 0} Posições</div>
                            </div>
                        </div>

                        <div className={styles.statCard}>
                            <div className={styles.statLabel}>Tabela TIPI</div>
                            <div className={`${styles.statStatus} ${stats.tipi?.status === 'online' ? styles.statStatusOnline : styles.statStatusError}`}>
                                {stats.tipi?.status === 'online' ? 'Online' : 'Offline'}
                            </div>
                            <div className={styles.statDetails}>
                                {stats.tipi?.chapters_count > 0 && <div>{stats.tipi.chapters_count} Capítulos</div>}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}
