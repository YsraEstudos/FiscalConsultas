/**
 * AdminDashboard — Painel de monitoramento de dispositivos e pesquisas
 *
 * Visível somente para admin. Mostra:
 * - Dispositivos ativos / total
 * - Pesquisas hoje por tipo (NESH, TIPI, NBS)
 * - Lista de dispositivos com drill-down
 */
import { useState, useEffect, useCallback } from 'react';
import { getAdminDashboard, getDeviceHistory } from '../services/api';
import type {
    AdminDashboardResponse,
    DeviceHistoryResponse,
    DeviceSummary,
} from '../types/apiAdmin.types';
import styles from './AdminDashboard.module.css';

// ─── Helpers ────────────────────────────────────────────────────────

function formatTime(isoString: string): string {
    try {
        return new Date(isoString).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return isoString;
    }
}

function formatDate(isoString: string): string {
    try {
        return new Date(isoString + 'T00:00:00').toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: 'short',
        });
    } catch {
        return isoString;
    }
}

function formatRelative(isoString: string): string {
    try {
        const diff = Date.now() - new Date(isoString).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'agora';
        if (mins < 60) return `${mins}min atrás`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h atrás`;
        const days = Math.floor(hours / 24);
        return `${days}d atrás`;
    } catch {
        return isoString;
    }
}

function typeBadgeClass(type: string): string {
    switch (type) {
        case 'nesh': return styles.typeBadgeNesh;
        case 'tipi': return styles.typeBadgeTipi;
        case 'nbs': return styles.typeBadgeNbs;
        case 'text': return styles.typeBadgeText;
        default: return '';
    }
}

// ─── Device Card ────────────────────────────────────────────────────

interface DeviceCardProps {
    device: DeviceSummary;
    onClick: () => void;
}

function DeviceCard({ device, onClick }: Readonly<DeviceCardProps>) {
    return (
        <button
            type="button"
            className={styles.deviceCard}
            onClick={onClick}
        >
            <div
                className={`${styles.deviceIcon} ${
                    device.is_active ? styles.deviceIconActive : styles.deviceIconInactive
                }`}
            >
                💻
            </div>
            <div className={styles.deviceInfo}>
                <div className={styles.deviceEmail}>
                    {device.user_email || 'Anônimo'}
                </div>
                <div className={styles.deviceLabel}>
                    {device.label || 'Dispositivo desconhecido'} · {formatRelative(device.last_active)}
                </div>
            </div>
            <div className={styles.deviceMeta}>
                <span
                    className={`${styles.statusBadge} ${
                        device.is_active ? styles.statusActive : styles.statusOffline
                    }`}
                >
                    {device.is_active && <span className={styles.statusActiveDot} />}
                    {device.is_active ? 'Ativo' : 'Offline'}
                </span>
                <span className={styles.searchCount}>
                    <span className={styles.searchCountToday}>{device.searches_today}</span> hoje
                </span>
            </div>
            <span className={styles.deviceArrow}>→</span>
        </button>
    );
}

// ─── Drill-Down View ────────────────────────────────────────────────

interface DrillDownProps {
    data: DeviceHistoryResponse;
    onBack: () => void;
}

function DrillDownView({ data, onBack }: Readonly<DrillDownProps>) {
    const { device, daily_stats, recent_searches } = data;

    return (
        <div className={styles.drillDown}>
            <button type="button" className={styles.backButton} onClick={onBack}>
                ← Voltar
            </button>

            <div className={styles.drillDownHeader}>
                <div
                    className={`${styles.deviceIcon} ${
                        device.is_active ? styles.deviceIconActive : styles.deviceIconInactive
                    }`}
                >
                    💻
                </div>
                <div className={styles.drillDownInfo}>
                    <div className={styles.drillDownEmail}>
                        {device.user_email || 'Anônimo'}
                    </div>
                    <div className={styles.drillDownLabel}>
                        {device.label || 'Desconhecido'} · {device.total_searches} pesquisas total
                    </div>
                </div>
                <span
                    className={`${styles.statusBadge} ${
                        device.is_active ? styles.statusActive : styles.statusOffline
                    }`}
                >
                    {device.is_active && <span className={styles.statusActiveDot} />}
                    {device.is_active ? 'Ativo' : 'Offline'}
                </span>
            </div>

            {/* Daily Stats Table */}
            {daily_stats.length > 0 && (
                <>
                    <div className={styles.sectionTitle}>📅 Pesquisas por Dia</div>
                    <table className={styles.dailyTable}>
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>NESH</th>
                                <th>TIPI</th>
                                <th>NBS</th>
                                <th>Texto</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {daily_stats.map((day) => (
                                <tr key={day.date}>
                                    <td>{formatDate(day.date)}</td>
                                    <td>{day.nesh || '-'}</td>
                                    <td>{day.tipi || '-'}</td>
                                    <td>{day.nbs || '-'}</td>
                                    <td>{day.text || '-'}</td>
                                    <td className={styles.dailyTotal}>{day.total}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}

            {/* Recent Searches */}
            {recent_searches.length > 0 && (
                <>
                    <div className={styles.sectionTitle}>🔍 Pesquisas Recentes</div>
                    <div className={styles.recentList}>
                        {recent_searches.map((s, i) => (
                            <div key={`${s.at}-${i}`} className={styles.recentItem}>
                                <span className={`${styles.recentType} ${typeBadgeClass(s.type)}`}>
                                    {s.type.toUpperCase()}
                                </span>
                                <span className={styles.recentQuery}>
                                    {s.query || '—'}
                                </span>
                                <span className={styles.recentTime}>
                                    {formatTime(s.at)}
                                </span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

// ─── Main Component ─────────────────────────────────────────────────

export function AdminDashboard() {
    const [data, setData] = useState<AdminDashboardResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Drill-down state
    const [selectedFp, setSelectedFp] = useState<string | null>(null);
    const [drillData, setDrillData] = useState<DeviceHistoryResponse | null>(null);
    const [drillLoading, setDrillLoading] = useState(false);

    useEffect(() => {
        setLoading(true);
        setError(null);
        getAdminDashboard()
            .then(setData)
            .catch((err) => {
                console.error('Failed to load admin dashboard:', err);
                setError('Erro ao carregar o painel de administração.');
            })
            .finally(() => setLoading(false));
    }, []);

    const handleDeviceClick = useCallback((fp: string) => {
        setSelectedFp(fp);
        setDrillLoading(true);
        getDeviceHistory(fp)
            .then(setDrillData)
            .catch((err) => {
                console.error('Failed to load device history:', err);
                setSelectedFp(null);
            })
            .finally(() => setDrillLoading(false));
    }, []);

    const handleBack = useCallback(() => {
        setSelectedFp(null);
        setDrillData(null);
    }, []);

    if (loading) {
        return <div className={styles.loading}>Carregando painel...</div>;
    }

    if (error) {
        return <div className={styles.error}>{error}</div>;
    }

    if (!data) {
        return null;
    }

    // Drill-down view
    if (selectedFp) {
        if (drillLoading) {
            return <div className={styles.loading}>Carregando histórico...</div>;
        }
        if (drillData) {
            return <DrillDownView data={drillData} onBack={handleBack} />;
        }
    }

    // Main dashboard view
    const { total_active_devices, total_searches_today, searches_by_type, devices } = data;

    return (
        <div className={styles.dashboard}>
            {/* Metrics Row */}
            <div className={styles.metricsRow}>
                <div className={styles.metricCard}>
                    <div className={styles.metricValue}>{total_active_devices}</div>
                    <div className={styles.metricLabel}>Dispositivos Ativos</div>
                </div>
                <div className={styles.metricCard}>
                    <div className={styles.metricValue}>{total_searches_today}</div>
                    <div className={styles.metricLabel}>Pesquisas Hoje</div>
                </div>
                <div className={styles.metricCard}>
                    <div className={styles.metricValue}>{devices.length}</div>
                    <div className={styles.metricLabel}>Total Dispositivos</div>
                </div>
            </div>

            {/* Type Breakdown */}
            {Object.keys(searches_by_type).length > 0 && (
                <div className={styles.typeBreakdown}>
                    {Object.entries(searches_by_type)
                        .sort(([, a], [, b]) => b - a)
                        .map(([type, count]) => (
                            <span
                                key={type}
                                className={`${styles.typeBadge} ${typeBadgeClass(type)}`}
                            >
                                {type.toUpperCase()}: {count}
                            </span>
                        ))}
                </div>
            )}

            {/* Devices List */}
            <div className={styles.sectionTitle}>🖥️ Dispositivos Conectados</div>
            {devices.length === 0 ? (
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>📡</div>
                    <div className={styles.emptyText}>
                        Nenhum dispositivo registrado ainda.
                        <br />
                        As pesquisas começarão a aparecer aqui.
                    </div>
                </div>
            ) : (
                <div className={styles.devicesList}>
                    {devices.map((device) => (
                        <DeviceCard
                            key={device.fingerprint}
                            device={device}
                            onClick={() => handleDeviceClick(device.fingerprint)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
