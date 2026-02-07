
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../../src/../src/App';
import { AuthProvider } from '../../src/../src/context/AuthContext';
import { SettingsProvider } from '../../src/../src/context/SettingsContext';
import * as api from '../../src/../src/services/api';

// Mock dependencies to avoid real API calls and context issues
vi.mock('../../src/services/api');
vi.mock('../../src/hooks/useHistory', () => ({
    useHistory: () => ({
        history: [],
        addToHistory: vi.fn(),
        removeFromHistory: vi.fn(),
        clearHistory: vi.fn(),
    }),
}));

vi.mock('../../src/context/CrossChapterNoteContext', () => ({
    useCrossChapterNotes: () => ({
        fetchNotes: vi.fn(),
        getNote: vi.fn(),
        isLoading: vi.fn(() => false),
        cache: {}
    }),
    CrossChapterNoteProvider: ({ children }) => <div>{children}</div>
}));

// Mock window.scrollTo since it's not supported in JSDOM
window.scrollTo = vi.fn();

describe('App Search Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('displays loading spinner and then results when searching', async () => {
        // 1. Setup Mock Delayed Response
        let resolvePromise;
        const promise = new Promise((resolve) => {
            resolvePromise = resolve;
        });

        // Mock searchNCM to return our controlled promise
        api.searchNCM.mockReturnValue(promise);

        // 2. Render App wrapped in AuthProvider
        render(
            <AuthProvider>
                <SettingsProvider>
                    <App />
                </SettingsProvider>
            </AuthProvider>
        );

        // 3. Perform Search Interaction
        const input = screen.getByPlaceholderText(/Digite os NCMs separados/i);
        fireEvent.change(input, { target: { value: '8517' } });

        // Find the search button (magnifying glass) - usually in the input group or separate
        // Assuming the input handles Enter, or there's a button. Let's try Enter key first.
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        // 4. Verify Loading State
        // A UI atual mantém o texto "Buscar" e mostra spinner + desabilita o botão.
        const searchBtn = screen.getByRole('button', { name: /buscar/i });
        expect(searchBtn).toBeDisabled();

        // 5. Resolve Promise and Verify Results
        const mockResponse = {
            query: '8517',
            type: 'code',
            results: {},
            resultados: {
                '85': {
                    capitulo: '85',
                    posicoes: [{ codigo: '85.17', descricao: 'Telefones' }]
                }
            },
            markdown: '<div class="chapter-content"><h1>Telefones</h1></div>'
        };

        resolvePromise(mockResponse);

        // 6. Wait for Loading to Disappear and Results to Appear
        await waitFor(() => {
            expect(searchBtn).not.toBeDisabled();
            expect(screen.getByText('Telefones')).toBeInTheDocument();
        });
    });
});
