/**
 * CrossChapterNoteContext
 * 
 * Context para cache e fetch de notas de capítulos não carregados.
 * Permite acessar notas de qualquer capítulo sem precisar carregar o capítulo inteiro.
 */

import { createContext, useContext, useState, useCallback, useRef, useMemo, ReactNode } from 'react';
import { fetchChapterNotes } from '../services/api';

// Tipos
interface NotesCache {
    [chapterNum: string]: Record<string, string>; // notas_parseadas por capítulo
}

interface CrossChapterNoteContextValue {
    cache: NotesCache;
    fetchNotes: (chapter: string) => Promise<Record<string, string>>;
    getNote: (chapter: string, noteNum: string) => string | null;
    isLoading: (chapter: string) => boolean;
}

// Context
const CrossChapterNoteContext = createContext<CrossChapterNoteContextValue | null>(null);

// Provider Props
interface CrossChapterNoteProviderProps {
    children: ReactNode;
}

const MAX_CACHED_CHAPTERS = 20;

/**
 * Provider que gerencia cache de notas cross-chapter.
 * 
 * Performance:
 * - useRef para tracking de fetches em andamento (evita race conditions)
 * - Cache persiste no estado (evita re-fetches)
 * - useCallback estável para evitar re-renders
 */
export function CrossChapterNoteProvider({ children }: CrossChapterNoteProviderProps) {
    const [cache, setCache] = useState<NotesCache>({});
    const cacheRef = useRef<NotesCache>({});
    const cacheOrderRef = useRef<string[]>([]);
    const inFlightRef = useRef<Map<string, Promise<Record<string, string>>>>(new Map());

    /**
     * Busca notas de um capítulo específico.
     * Retorna do cache se disponível, senão faz fetch e cacheia.
     */
    const fetchNotes = useCallback(async (chapter: string): Promise<Record<string, string>> => {
        const cached = cacheRef.current[chapter];
        if (cached) {
            return cached;
        }

        const inFlight = inFlightRef.current.get(chapter);
        if (inFlight) {
            return inFlight;
        }

        const request = fetchChapterNotes(chapter)
            .then(response => {
                const notesData = response?.notas_parseadas || {};
                if (cacheRef.current[chapter]) {
                    return cacheRef.current[chapter];
                }

                const nextCache: NotesCache = { ...cacheRef.current, [chapter]: notesData };
                const nextOrder = [...cacheOrderRef.current.filter(id => id !== chapter), chapter];

                while (nextOrder.length > MAX_CACHED_CHAPTERS) {
                    const oldest = nextOrder.shift();
                    if (oldest) {
                        delete nextCache[oldest];
                    }
                }

                cacheOrderRef.current = nextOrder;
                cacheRef.current = nextCache;
                setCache(nextCache);
                return notesData;
            })
            .catch(error => {
                console.error(`[CrossChapterNote] Erro ao buscar notas do capítulo ${chapter}:`, error);
                throw error;
            })
            .finally(() => {
                inFlightRef.current.delete(chapter);
            });

        inFlightRef.current.set(chapter, request);
        return request;
    }, []);

    /**
     * Obtém uma nota específica do cache (síncrono).
     * Retorna null se não estiver em cache.
     */
    const getNote = useCallback((chapter: string, noteNum: string): string | null => {
        return cacheRef.current[chapter]?.[noteNum] || null;
    }, []);

    /**
     * Verifica se um capítulo está sendo carregado.
     */
    const isLoading = useCallback((chapter: string): boolean => {
        return inFlightRef.current.has(chapter);
    }, []);

    const value = useMemo<CrossChapterNoteContextValue>(() => ({
        cache,
        fetchNotes,
        getNote,
        isLoading
    }), [cache, fetchNotes, getNote, isLoading]);

    return (
        <CrossChapterNoteContext.Provider value={value}>
            {children}
        </CrossChapterNoteContext.Provider>
    );
}

/**
 * Hook para acessar o contexto de notas cross-chapter.
 * Deve ser usado dentro de CrossChapterNoteProvider.
 */
export function useCrossChapterNotes(): CrossChapterNoteContextValue {
    const context = useContext(CrossChapterNoteContext);
    if (!context) {
        throw new Error('useCrossChapterNotes must be used within CrossChapterNoteProvider');
    }
    return context;
}

export default CrossChapterNoteContext;
