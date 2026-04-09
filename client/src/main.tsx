import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import './index.css'
import App from './App'
import { AuthProvider, GuestAuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { GlossaryProvider } from './context/GlossaryContext';
import { CrossChapterNoteProvider } from './context/CrossChapterNoteContext';
import { clerkTheme } from './config/clerkAppearance';

// Import your publishable key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

// Função para renderizar o App com ou sem Clerk
const renderApp = (useClerk: boolean) => {
    const appContent = (
        <AuthProvider>
            <SettingsProvider>
                <GlossaryProvider>
                    <CrossChapterNoteProvider>
                        <App />
                    </CrossChapterNoteProvider>
                </GlossaryProvider>
            </SettingsProvider>
        </AuthProvider>
    );

    const fallbackContent = (
        <GuestAuthProvider>
            <SettingsProvider>
                <GlossaryProvider>
                    <CrossChapterNoteProvider>
                        <App />
                    </CrossChapterNoteProvider>
                </GlossaryProvider>
            </SettingsProvider>
        </GuestAuthProvider>
    );

    createRoot(rootElement).render(
        <StrictMode>
            <Suspense fallback={<div style={{ padding: '20px', fontFamily: 'sans-serif' }}>Carregando...</div>}>
                {useClerk && PUBLISHABLE_KEY ? (
                    <ClerkProvider 
                        publishableKey={PUBLISHABLE_KEY} 
                        appearance={clerkTheme}
                    >
                        {appContent}
                    </ClerkProvider>
                ) : (
                    /* Modo Visitante: Carrega sem ClerkProvider se houver erro ou falta de chave */
                    fallbackContent
                )}
            </Suspense>
        </StrictMode>
    );
};

// Tenta iniciar com Clerk, se houver erro de carregamento (como o de CSP), 
// ele detecta e carrega o app em modo "Guest" para não travar a busca.
try {
    if (!PUBLISHABLE_KEY) {
        console.warn('Missing Clerk key. Entering Guest Mode.');
        renderApp(false);
    } else {
        renderApp(true);
    }
} catch (e) {
    console.warn("Clerk falhou ao inicializar. Entrando em Modo Visitante.", e);
    renderApp(false);
}

// Escuta erros globais de script (como falha ao baixar o JS do Clerk)
window.addEventListener('error', (event) => {
    if (event.message?.includes('Clerk') || (event.target as any)?.src?.includes('clerk')) {
        console.warn("Falha detectada no script do Clerk. Ativando fallback.");
        renderApp(false);
    }
}, true);

window.addEventListener('unhandledrejection', (event) => {
    if (event.reason?.message?.includes('Clerk') || event.reason?.message?.includes('failed to load script: https://clerk')) {
        console.warn("Rejeição de promessa detectada no script do Clerk. Ativando fallback.");
        renderApp(false);
    }
});
