import styles from './Spinner.module.css';

interface SpinnerProps {
    size?: 'sm' | 'md';
    className?: string;
}

export function Spinner({ size = 'sm', className }: SpinnerProps) {
    const sizeClass = size === 'md' ? styles.spinnerMd : styles.spinner;
    return <div className={`${sizeClass} ${className || ''}`.trim()} aria-hidden="true" />;
}
