import { StrictMode, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import './index.css'
import './styles/fiscalProtection.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider, AnonymousAuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { GlossaryProvider } from './context/GlossaryContext';
import { CrossChapterNoteProvider } from './context/CrossChapterNoteContext';
import { LocalDatabaseProvider } from './context/LocalDatabaseContext';
import { clerkTheme } from './config/clerkAppearance';
import { installGlobalErrorMonitoring } from './utils/errorMonitoring';
import { installDevToolsGuard } from './utils/security/devtoolsGuard';
import {
    getClerkUnavailableMessage,
    isClerkLoadFailureReason,
    isClerkScriptTarget,
} from './auth/clerkLoadFailure';

type AuthBootstrapMode = 'clerk' | 'anonymous' | 'missing-key';

const PUBLISHABLE_KEY = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '').trim();

function AppProviders({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <SettingsProvider>
            <LocalDatabaseProvider>
                <GlossaryProvider>
                    <CrossChapterNoteProvider>
                        {children}
                    </CrossChapterNoteProvider>
                </GlossaryProvider>
            </LocalDatabaseProvider>
        </SettingsProvider>
    );
}

function MissingKeyScreen() {
    return (
        <main className="security-fallback-main">
            <h1 className="security-fallback-title">Configuration Required</h1>
            <p>
                Missing <code>VITE_CLERK_PUBLISHABLE_KEY</code>.
            </p>
            <p>
                Create <code>client/.env.local</code> with:
            </p>
            <pre className="security-fallback-pre">
                VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key
            </pre>
            <p>Then restart <code>npm run dev</code>.</p>
        </main>
    );
}

function AnonymousApp({ reason }: Readonly<{ reason: string | null }>) {
    return (
        <AnonymousAuthProvider reason={reason}>
            <AppProviders>
                <App />
            </AppProviders>
        </AnonymousAuthProvider>
    );
}

function ClerkApp() {
    return (
        <ClerkProvider publishableKey={PUBLISHABLE_KEY} appearance={clerkTheme}>
            <AuthProvider>
                <AppProviders>
                    <App />
                </AppProviders>
            </AuthProvider>
        </ClerkProvider>
    );
}

function RootApp() {
    const [mode, setMode] = useState<AuthBootstrapMode>(PUBLISHABLE_KEY ? 'clerk' : 'missing-key');
    const [fallbackReason, setFallbackReason] = useState<string | null>(null);

    const anonymousReason = useMemo(() => fallbackReason || getClerkUnavailableMessage(), [fallbackReason]);

    useLayoutEffect(() => {
        if (mode !== 'clerk') return undefined;

        const activateAnonymousMode = () => {
            setFallbackReason((previous) => previous || getClerkUnavailableMessage());
            setMode('anonymous');
        };

        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            if (!isClerkLoadFailureReason(event.reason)) return;

            event.preventDefault();
            console.warn('[AuthBootstrap] Clerk runtime unavailable. Falling back to signed-out mode.');
            activateAnonymousMode();
        };

        const handleWindowError = (event: Event) => {
            if (event instanceof ErrorEvent) {
                if (!isClerkLoadFailureReason(event.error ?? event.message)) return;
                event.preventDefault();
                console.warn('[AuthBootstrap] Clerk error intercepted during startup. Falling back to signed-out mode.');
                activateAnonymousMode();
                return;
            }

            if (!isClerkScriptTarget(event.target)) return;

            event.preventDefault();
            console.warn('[AuthBootstrap] Clerk script request was blocked. Falling back to signed-out mode.');
            activateAnonymousMode();
        };

        globalThis.addEventListener('unhandledrejection', handleUnhandledRejection);
        globalThis.addEventListener('error', handleWindowError, true);

        return () => {
            globalThis.removeEventListener('unhandledrejection', handleUnhandledRejection);
            globalThis.removeEventListener('error', handleWindowError, true);
        };
    }, [mode]);

    useLayoutEffect(() => {
        installGlobalErrorMonitoring();
        installDevToolsGuard();
    }, []);

    if (mode === 'missing-key') {
        console.error(
            'Missing Clerk key. Configure VITE_CLERK_PUBLISHABLE_KEY in client/.env.local and restart Vite.'
        );
        return <MissingKeyScreen />;
    }

    if (mode === 'anonymous') {
        return <AnonymousApp reason={anonymousReason} />;
    }

    return <ClerkApp />;
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

createRoot(rootElement).render(
    <StrictMode>
        <ErrorBoundary
            boundaryName="root-app"
            title="Não foi possível iniciar o aplicativo."
            description="A aplicação encontrou um erro inesperado durante a inicialização. Tente recarregar a página para continuar."
            variant="full-screen"
        >
            <RootApp />
        </ErrorBoundary>
    </StrictMode>,
);
