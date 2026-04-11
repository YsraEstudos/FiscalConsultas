import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { GlossaryProvider } from './context/GlossaryContext';
import { CrossChapterNoteProvider } from './context/CrossChapterNoteContext';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

createRoot(rootElement).render(
    <StrictMode>
        <AuthProvider>
            <SettingsProvider>
                <GlossaryProvider>
                    <CrossChapterNoteProvider>
                        <App />
                    </CrossChapterNoteProvider>
                </GlossaryProvider>
            </SettingsProvider>
        </AuthProvider>
    </StrictMode>,
);
