import { useMemo } from 'react';
import styles from './ResultSkeleton.module.css';

export function ResultSkeleton() {
    const sidebarWidths = useMemo(() => [88, 72, 95, 64, 78, 86, 69, 91], []);

    return (
        <div className={styles.skeletonWrapper}>
            <div className={styles.skeletonHeader}>
                <div className={styles.skeletonTitle} />
                <div className={styles.skeletonBadge} />
            </div>

            <div className={styles.skeletonContent}>
                {/* Simulated Sidebar */}
                <div className={styles.skeletonSidebar}>
                    {sidebarWidths.map((width, i) => (
                        <div
                            key={`sidebar-${i}`}
                            className={styles.skeletonSidebarItem}
                            style={{ width: `${width}%` }}
                        />
                    ))}
                </div>

                {/* Simulated Main Content */}
                <div className={styles.skeletonMain}>
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={`p-${i}`} className={styles.skeletonP}>
                            <div className={styles.skeletonLine} style={{ width: '90%' }} />
                            <div className={styles.skeletonLine} style={{ width: '95%' }} />
                            <div className={styles.skeletonLine} style={{ width: '80%' }} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
