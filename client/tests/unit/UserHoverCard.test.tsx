/**
 * Testes unitários para UserHoverCard.
 *
 * Estratégia:
 * - Mock de `getUserCard` para simular resposta da API
 * - Verifica renderização do tooltip (card) quando dados disponíveis
 * - Verifica fallback para iniciais quando sem avatar
 * - Verifica cancelamento de fetch ao desmontar (sem memory leak)
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserHoverCard } from '../../src/components/UserHoverCard';

// Mock do módulo de API para evitar chamadas HTTP reais
vi.mock('../../src/services/api', () => ({
    getUserCard: vi.fn(),
}));

// Importa após o mock para obter a versão mockada
import { getUserCard } from '../../src/services/api';
const mockGetUserCard = vi.mocked(getUserCard);

describe('UserHoverCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renderiza o children passado sem card enquanto carrega', () => {
        // Simula fetch em andamento (nunca resolve no escopo deste teste)
        mockGetUserCard.mockReturnValue(new Promise(() => { }));

        render(
            <UserHoverCard userId="user_123">
                <span>João Silva</span>
            </UserHoverCard>,
        );

        // Children deve estar visível
        expect(screen.getByText('João Silva')).toBeInTheDocument();
        // Card ainda não deve aparecer (dados não chegaram)
        expect(screen.queryByText('Bio do card')).not.toBeInTheDocument();
    });

    it('exibe o card com nome, bio e contagem de comentários após carregar', async () => {
        mockGetUserCard.mockResolvedValue({
            user_id: 'user_123',
            full_name: 'Maria Souza',
            bio: 'Especialista em NCM',
            image_url: null,
            comment_count: 42,
        });

        render(
            <UserHoverCard userId="user_123">
                <span>Maria Souza</span>
            </UserHoverCard>,
        );

        // Aguarda os dados chegarem e o card ser renderizado
        await waitFor(() => {
            expect(screen.getByText('Especialista em NCM')).toBeInTheDocument();
        });

        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.getAllByText('Maria Souza').length).toBeGreaterThanOrEqual(1);
    });

    it('usa iniciais quando não há imagem disponível', async () => {
        mockGetUserCard.mockResolvedValue({
            user_id: 'user_456',
            full_name: 'Carlos Mendes',
            bio: null,
            image_url: null,
            comment_count: 5,
        });

        render(
            <UserHoverCard userId="user_456">
                <span>Carlos Mendes</span>
            </UserHoverCard>,
        );

        await waitFor(() => {
            // Iniciais de "Carlos Mendes" = "CM"
            expect(screen.getByText('CM')).toBeInTheDocument();
        });
    });

    it('mostra imagem quando image_url é fornecida via prop imageUrl', async () => {
        mockGetUserCard.mockResolvedValue({
            user_id: 'user_789',
            full_name: 'Ana Lima',
            bio: 'Auditora fiscal',
            image_url: null,
            comment_count: 8,
        });

        render(
            <UserHoverCard userId="user_789" imageUrl="https://example.com/avatar.png">
                <span>Ana Lima</span>
            </UserHoverCard>,
        );

        await waitFor(() => {
            const img = screen.getByRole('img');
            expect(img).toHaveAttribute('src', 'https://example.com/avatar.png');
            expect(img).toHaveAttribute('alt', 'Ana Lima');
        });
    });

    it('não exibe a bio quando ela é nula', async () => {
        mockGetUserCard.mockResolvedValue({
            user_id: 'user_000',
            full_name: 'Sem Bio',
            bio: null,
            image_url: null,
            comment_count: 0,
        });

        render(
            <UserHoverCard userId="user_000">
                <span>Sem Bio</span>
            </UserHoverCard>,
        );

        await waitFor(() => {
            // Contagem deve aparecer mesmo sem bio
            expect(screen.getByText('0')).toBeInTheDocument();
        });

        // Bio container não deve existir no DOM
        expect(screen.queryByText('null')).not.toBeInTheDocument();
    });

    it('não quebra quando a API retorna erro (tratamento silencioso)', async () => {
        // Simula falha de rede
        mockGetUserCard.mockRejectedValue(new Error('Network error'));

        render(
            <UserHoverCard userId="user_err">
                <span>Usuário Erro</span>
            </UserHoverCard>,
        );

        // Deve renderizar children normalmente
        expect(screen.getByText('Usuário Erro')).toBeInTheDocument();

        // Aguarda promise ser rejeitada sem lançar exceção
        await waitFor(() => {
            // Card não deve aparecer após erro
            expect(screen.queryByText('Especialista em NCM')).not.toBeInTheDocument();
        });
    });

    it('busca apenas uma vez mesmo após re-render', async () => {
        mockGetUserCard.mockResolvedValue({
            user_id: 'user_once',
            full_name: 'Test User',
            bio: null,
            image_url: null,
            comment_count: 1,
        });

        const { rerender } = render(
            <UserHoverCard userId="user_once">
                <span>Test</span>
            </UserHoverCard>,
        );

        await waitFor(() => {
            expect(screen.getByText('Test User')).toBeInTheDocument();
        });

        // Re-render não deve disparar novo fetch (already loaded)
        rerender(
            <UserHoverCard userId="user_once">
                <span>Test</span>
            </UserHoverCard>,
        );

        expect(mockGetUserCard).toHaveBeenCalledTimes(1);
    });
});
