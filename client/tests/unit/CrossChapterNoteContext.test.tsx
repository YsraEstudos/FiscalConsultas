import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { CrossChapterNoteProvider, useCrossChapterNotes } from '../../src/context/CrossChapterNoteContext';
import { fetchChapterNotes } from '../../src/services/api';

const localDatabaseState = vi.hoisted(() => ({
    status: 'not_installed',
    getNeshChapterNotesLocal: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/api', () => ({
    fetchChapterNotes: vi.fn(),
}));

vi.mock('../../src/context/LocalDatabaseContext', () => ({
    useLocalDatabase: () => localDatabaseState,
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <CrossChapterNoteProvider>{children}</CrossChapterNoteProvider>
);

describe('CrossChapterNoteContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localDatabaseState.status = 'not_installed';
        localDatabaseState.getNeshChapterNotesLocal.mockReset();
        localDatabaseState.getNeshChapterNotesLocal.mockResolvedValue(null);
    });

    it('caches chapter notes after first fetch', async () => {
        vi.mocked(fetchChapterNotes).mockResolvedValue({
            success: true,
            capitulo: '84',
            notas_parseadas: { '1': 'Nota 1 do capitulo 84' },
            notas_gerais: null,
        });

        const { result } = renderHook(() => useCrossChapterNotes(), { wrapper });

        let first: Record<string, string> = {};
        let second: Record<string, string> = {};

        await act(async () => {
            first = await result.current.fetchNotes('84');
            second = await result.current.fetchNotes('84');
        });

        expect(fetchChapterNotes).toHaveBeenCalledTimes(1);
        expect(first).toEqual({ '1': 'Nota 1 do capitulo 84' });
        expect(second).toEqual(first);
        expect(result.current.getNote('84', '1')).toBe('Nota 1 do capitulo 84');
    });

    it('deduplicates concurrent requests for the same chapter', async () => {
        let resolveRequest: (value: {
            success: boolean;
            capitulo: string;
            notas_parseadas: Record<string, string>;
            notas_gerais: string | null;
        }) => void = () => undefined;

        const pending = new Promise<{
            success: boolean;
            capitulo: string;
            notas_parseadas: Record<string, string>;
            notas_gerais: string | null;
        }>((resolve) => {
            resolveRequest = resolve;
        });

        vi.mocked(fetchChapterNotes).mockReturnValue(pending);

        const { result } = renderHook(() => useCrossChapterNotes(), { wrapper });

        let p1: Promise<Record<string, string>>;
        let p2: Promise<Record<string, string>>;

        await act(async () => {
            p1 = result.current.fetchNotes('73');
            p2 = result.current.fetchNotes('73');
        });

        expect(fetchChapterNotes).toHaveBeenCalledTimes(1);
        expect(result.current.isLoading('73')).toBe(true);

        await act(async () => {
            resolveRequest({
                success: true,
                capitulo: '73',
                notas_parseadas: { '2': 'Nota 2 do capitulo 73' },
                notas_gerais: null,
            });
            await Promise.all([p1!, p2!]);
        });

        expect(result.current.isLoading('73')).toBe(false);
        expect(result.current.getNote('73', '2')).toBe('Nota 2 do capitulo 73');
    });

    it('uses offline chapter notes when local database is ready', async () => {
        localDatabaseState.status = 'ready';
        localDatabaseState.getNeshChapterNotesLocal.mockResolvedValue({
            '1': 'Nota local do capitulo 84',
        });

        const { result } = renderHook(() => useCrossChapterNotes(), { wrapper });

        let notes: Record<string, string> = {};

        await act(async () => {
            notes = await result.current.fetchNotes('84');
        });

        expect(localDatabaseState.getNeshChapterNotesLocal).toHaveBeenCalledTimes(1);
        expect(localDatabaseState.getNeshChapterNotesLocal).toHaveBeenCalledWith('84');
        expect(fetchChapterNotes).not.toHaveBeenCalled();
        expect(notes).toEqual({ '1': 'Nota local do capitulo 84' });
        expect(result.current.getNote('84', '1')).toBe('Nota local do capitulo 84');
    });

    it('falls back to API when local database is unavailable', async () => {
        vi.mocked(fetchChapterNotes).mockResolvedValue({
            success: true,
            capitulo: '84',
            notas_parseadas: { '1': 'Nota 1 da API' },
            notas_gerais: null,
        });

        const { result } = renderHook(() => useCrossChapterNotes(), { wrapper });

        let notes: Record<string, string> = {};

        await act(async () => {
            notes = await result.current.fetchNotes('84');
        });

        expect(localDatabaseState.getNeshChapterNotesLocal).not.toHaveBeenCalled();
        expect(fetchChapterNotes).toHaveBeenCalledTimes(1);
        expect(fetchChapterNotes).toHaveBeenCalledWith('84');
        expect(notes).toEqual({ '1': 'Nota 1 da API' });
    });

    it('returns null for missing notes', () => {
        const { result } = renderHook(() => useCrossChapterNotes(), { wrapper });
        expect(result.current.getNote('99', '1')).toBeNull();
    });
});
