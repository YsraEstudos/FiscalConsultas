import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import './index.css'
import App from './App'
import { AuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { GlossaryProvider } from './context/GlossaryContext';
import { CrossChapterNoteProvider } from './context/CrossChapterNoteContext';
import { clerkTheme } from './config/clerkAppearance';

// Import your publishable key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

if (PUBLISHABLE_KEY) {
    createRoot(rootElement).render(
        <StrictMode>
            <ClerkProvider publishableKey={PUBLISHABLE_KEY} appearance={clerkTheme}>
                <AuthProvider>
                    <SettingsProvider>
                        <GlossaryProvider>
                            <CrossChapterNoteProvider>
                                <App />
                            </CrossChapterNoteProvider>
                        </GlossaryProvider>
                    </SettingsProvider>
                </AuthProvider>
            </ClerkProvider>
        </StrictMode>,
    );
} else {
    console.error(
        'Missing Clerk key. Configure VITE_CLERK_PUBLISHABLE_KEY in client/.env.local and restart Vite.'
    );

    createRoot(rootElement).render(
        <StrictMode>
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
        </StrictMode>,
    );
}
