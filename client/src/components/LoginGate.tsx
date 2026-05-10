/**
 * LoginGate — Full-screen authentication gate.
 *
 * Displayed when the user is not signed in.  Shows a branded prompt
 * with a "Sign In" button that opens the Clerk modal.
 */
import { useEffect, useRef } from 'react';
import styles from './LoginGate.module.css';

interface LoginGateProps {
    onSignIn: () => void;
    isAuthConfigured: boolean;
}

export function LoginGate({ onSignIn, isAuthConfigured }: Readonly<LoginGateProps>) {
    const signInRef = useRef<HTMLButtonElement>(null);

    // Move focus to the primary action when the gate mounts so keyboard and
    // screen-reader users can act immediately without tabbing through the page.
    useEffect(() => {
        signInRef.current?.focus();
    }, []);

    return (
        <div className={styles.backdrop}>
            <div
                className={styles.card}
                role="dialog"
                aria-modal="true"
                aria-labelledby="login-gate-title"
            >
                <div className={styles.iconContainer}>
                    {/* Decorative lock icon — hidden from assistive technology */}
                    <svg
                        className={styles.icon}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        focusable="false"
                    >
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        <circle cx="12" cy="16" r="1" />
                    </svg>
                </div>

                <h1 id="login-gate-title" className={styles.title}>Acesso Restrito</h1>
                <p className={styles.subtitle}>
                    Faça login para acessar o sistema de consultas fiscais.
                </p>

                {isAuthConfigured ? (
                    <button
                        ref={signInRef}
                        type="button"
                        className={styles.signInButton}
                        onClick={onSignIn}
                        id="login-gate-sign-in"
                    >
                        Entrar
                    </button>
                ) : (
                    <p className={styles.unavailable}>
                        O serviço de autenticação está temporariamente indisponível.
                        Tente recarregar a página.
                    </p>
                )}

                <p className={styles.footer}>
                    Apenas membros autorizados podem acessar este sistema.
                </p>
            </div>
        </div>
    );
}
