import { createContext, useContext, useState, useEffect, useCallback, ReactNode, lazy, Suspense } from 'react';
import { toast } from 'react-hot-toast';
import { getGlossaryTerm } from '../services/api';

// Lazy load the modal to avoid importing it if not used
const GlossaryModal = lazy(() => import('../components/GlossaryModal').then(module => ({ default: module.GlossaryModal })));

type GlossaryState = {
    isOpen: boolean;
    term: string;
    definition: any; // Specify strict type once data model is known
    loading: boolean;
};

interface GlossaryContextType {
    openGlossary: (term: string) => Promise<void>;
    closeGlossary: () => void;
}

const GlossaryContext = createContext<GlossaryContextType | undefined>(undefined);

export function GlossaryProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<GlossaryState>({
        isOpen: false,
        term: '',
        definition: null,
        loading: false
    });

    const openGlossary = useCallback(async (term: string) => {
        setState({ isOpen: true, term, definition: null, loading: true });
        try {
            const data = await getGlossaryTerm(term);
            if (data.found) {
                setState(prev => ({ ...prev, definition: data.data, loading: false }));
            } else {
                setState(prev => ({ ...prev, definition: null, loading: false }));
            }
        } catch (e) {
            console.error(e);
            setState(prev => ({ ...prev, loading: false }));
            toast.error("Erro ao buscar termo.");
        }
    }, []);

    const closeGlossary = useCallback(() => {
        setState(prev => ({ ...prev, isOpen: false }));
    }, []);

    // Global Click Listener for glossary terms delegation
    useEffect(() => {
        const handleGlobalClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const termElement = target.closest('.glossary-term') as HTMLElement;
            if (termElement) {
                const term = termElement.dataset.term;
                if (term) {
                    openGlossary(term);
                }
            }
        };

        document.addEventListener('click', handleGlobalClick);
        return () => document.removeEventListener('click', handleGlobalClick);
    }, [openGlossary]);

    return (
        <GlossaryContext.Provider value={{ openGlossary, closeGlossary }}>
            {children}
            <Suspense fallback={null}>
                <GlossaryModal
                    isOpen={state.isOpen}
                    onClose={closeGlossary}
                    term={state.term}
                    definition={state.definition}
                    loading={state.loading}
                />
            </Suspense>
        </GlossaryContext.Provider>
    );
}

export function useGlossary() {
    const context = useContext(GlossaryContext);
    if (context === undefined) {
        throw new Error('useGlossary must be used within a GlossaryProvider');
    }
    return context;
}
