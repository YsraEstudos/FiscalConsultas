import styles from './Loading.module.css';

interface LoadingProps {
    label?: string;
    size?: 'sm' | 'md';
    className?: string;
}

export function Loading({ label = 'Carregando...', size = 'md', className }: LoadingProps) {
    const spinnerClass = size === 'sm' ? `${styles.spinner} ${styles.spinnerSm}` : styles.spinner;

    return (
        <div className={`${styles.container} ${className || ''}`.trim()} role="status" aria-live="polite">
            <div className={spinnerClass} />
            {label && <span className={styles.label}>{label}</span>}
        </div>
    );
}
