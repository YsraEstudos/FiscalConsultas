import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { getSystemStatus } from '../services/api';
import type { SystemStatusResponse } from '../types/api.types';
import styles from './StatsModal.module.css';

interface StatsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function StatsModal({ isOpen, onClose }: StatsModalProps) {
    const [stats, setStats] = useState<SystemStatusResponse | null>(null);
    const [loading, setLoading] = useState(false);

    const dbStatus = stats?.database?.status;
    const tipiStatus = stats?.tipi?.status;
    const isDatabaseOnline = dbStatus === 'online';
    const isTipiOnline = tipiStatus === 'online';
    const tipiChapterCount = stats?.tipi?.chapters ?? 0;

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
                            <div className={`${styles.statStatus} ${isDatabaseOnline ? styles.statStatusOnline : styles.statStatusError}`}>
                                {isDatabaseOnline ? 'Online' : 'Erro'}
                            </div>
                            <div className={styles.statDetails}>
                                <div>{stats.database?.chapters || 0} Capítulos</div>
                                <div>{stats.database?.positions || 0} Posições</div>
                            </div>
                        </div>

                        <div className={styles.statCard}>
                            <div className={styles.statLabel}>Tabela TIPI</div>
                            <div className={`${styles.statStatus} ${isTipiOnline ? styles.statStatusOnline : styles.statStatusError}`}>
                                {isTipiOnline ? 'Online' : 'Offline'}
                            </div>
                            <div className={styles.statDetails}>
                                {tipiChapterCount > 0 && <div>{tipiChapterCount} Capítulos</div>}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}
