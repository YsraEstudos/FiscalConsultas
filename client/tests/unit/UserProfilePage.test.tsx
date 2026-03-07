/**
 * Testes unitários para UserProfilePage.
 *
 * Estratégia:
 * - Mock de todos os módulos externos (API, Clerk, AuthContext, hooks)
 * - Testa abertura/fechamento do modal
 * - Testa bio editor: edição e save
 * - Testa troca de tabs e carregamento de contribuições
 * - Testa fluxo de deleção de conta (double-confirmation)
 * - Testa visibilidade da aba Organização apenas para admins
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks de API ────────────────────────────────────────────────────────────
vi.mock('../../src/services/api', () => ({
    getMyProfile: vi.fn(),
    updateMyProfile: vi.fn(),
    getMyContributions: vi.fn(),
    deleteMyAccount: vi.fn(),
}));

// ─── Mocks de Clerk ──────────────────────────────────────────────────────────
vi.mock('@clerk/clerk-react', () => ({
    UserProfile: () => <div data-testid="clerk-user-profile" />,
    OrganizationProfile: () => <div data-testid="clerk-org-profile" />,
}));

// ─── Mocks de contexto e hooks ───────────────────────────────────────────────
const isAdminRef = { value: false };
const userEmailRef = { value: 'israelseja2@gmail.com' };

vi.mock('../../src/context/AuthContext', () => ({
    useAuth: () => ({
        userName: 'João Silva',
        userEmail: userEmailRef.value,
        userImageUrl: null,
    }),
}));

vi.mock('../../src/hooks/useIsAdmin', () => ({
    useIsAdmin: () => isAdminRef.value,
}));

vi.mock('../../src/config/clerkAppearance', () => ({
    clerkTheme: { elements: {} },
}));

// ─── Importa os mocks ────────────────────────────────────────────────────────
import {
    getMyProfile,
    updateMyProfile,
    getMyContributions,
    deleteMyAccount,
} from '../../src/services/api';

const mockGetMyProfile = vi.mocked(getMyProfile);
const mockUpdateMyProfile = vi.mocked(updateMyProfile);
const mockGetMyContributions = vi.mocked(getMyContributions);
const mockDeleteMyAccount = vi.mocked(deleteMyAccount);
let UserProfilePage: typeof import('../../src/components/UserProfilePage').UserProfilePage;

// ─── Dados de fixture ─────────────────────────────────────────────────────────

/** Perfil completo retornado pela API no mock */
const MOCK_PROFILE = {
    user_id: 'user_123',
    email: 'joao@example.com',
    full_name: 'João Silva',
    bio: 'Especialista em classificação fiscal',
    image_url: null,
    tenant_id: 'org_test',
    org_name: 'Empresa Teste',
    is_active: true,
    comment_count: 10,
    approved_comment_count: 7,
    pending_comment_count: 3,
};

/** Lista de contribuições retornada pela API no mock */
const MOCK_CONTRIBUTIONS = {
    items: [
        {
            id: 1,
            type: 'comment',
            anchor_key: 'ncm-8517.12.31',
            selected_text: 'texto selecionado',
            body: 'Meu comentário de teste sobre NCM',
            status: 'approved',
            created_at: '2026-01-15T10:00:00Z',
            updated_at: '2026-01-15T10:00:00Z',
        },
    ],
    total: 1,
    page: 1,
    page_size: 15,
    has_next: false,
};

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(async () => {
    vi.clearAllMocks();
    isAdminRef.value = false;
    userEmailRef.value = 'israelseja2@gmail.com';
    ({ UserProfilePage } = await import('../../src/components/UserProfilePage'));
    mockGetMyProfile.mockResolvedValue(MOCK_PROFILE);
    mockGetMyContributions.mockResolvedValue(MOCK_CONTRIBUTIONS);
    mockUpdateMyProfile.mockImplementation(async (data) => ({
        ...MOCK_PROFILE,
        bio: data.bio,
    }));
    mockDeleteMyAccount.mockResolvedValue({ success: true, message: 'Conta desativada' });
});

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('UserProfilePage', () => {
    // --- Visibilidade ---

    it('não renderiza nada quando isOpen=false', () => {
        render(<UserProfilePage isOpen={false} onClose={vi.fn()} />);
        expect(screen.queryByText('Meu Perfil')).not.toBeInTheDocument();
        expect(mockGetMyProfile).not.toHaveBeenCalled();
    });

    it('renderiza o modal com título quando isOpen=true', async () => {
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);
        expect(screen.getByText('Meu Perfil')).toBeInTheDocument();
    });

    it('chama onClose ao clicar no botão X', async () => {
        const onClose = vi.fn();
        render(<UserProfilePage isOpen={true} onClose={onClose} />);

        await waitFor(() => expect(mockGetMyProfile).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // --- Aba Perfil ---

    it('carrega e exibe dados do perfil na aba Perfil', async () => {
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        // Aguarda o fetch completar
        await waitFor(() => {
            expect(screen.getByText('Especialista em classificação fiscal')).toBeInTheDocument();
        });

        // Verifica dados estatísticos
        expect(screen.getByText('10')).toBeInTheDocument(); // total comments
        expect(screen.getByText('7')).toBeInTheDocument();  // approved
        expect(screen.getByText('3')).toBeInTheDocument();  // pending
    });

    it('exibe component Clerk de segurança embutido na aba Perfil', async () => {
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => expect(mockGetMyProfile).toHaveBeenCalled());
        expect(screen.getByTestId('clerk-user-profile')).toBeInTheDocument();
    });

    it('exibe iniciais quando não há imagem de perfil', async () => {
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => {
            // "João Silva" → iniciais "JS"
            expect(screen.getByText('JS')).toBeInTheDocument();
        });
    });

    // --- Bio Editor ---

    it('edita e salva bio com sucesso', async () => {
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByPlaceholderText('Conte um pouco sobre você...')).toBeInTheDocument();
        });

        const textarea = screen.getByPlaceholderText('Conte um pouco sobre você...');
        fireEvent.change(textarea, { target: { value: 'Nova bio aqui' } });

        // Clica em salvar
        fireEvent.click(screen.getByRole('button', { name: /salvar bio/i }));

        await waitFor(() => {
            expect(mockUpdateMyProfile).toHaveBeenCalledWith({ bio: 'Nova bio aqui' });
        });

        // Confirmação de salvo aparece
        await waitFor(() => {
            expect(screen.getByText('✓ Salvo!')).toBeInTheDocument();
        });
    });

    it('mostra contagem de caracteres na bio', async () => {
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => {
            // Bio carregada do mock tem X caracteres, verifica "/500"
            expect(screen.getByText(/\/500/)).toBeInTheDocument();
        });
    });

    // --- Tabs ---

    it('muda para aba Contribuições e carrega lista', async () => {
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => expect(mockGetMyProfile).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: /contribuições/i }));

        await waitFor(() => {
            expect(screen.getByText('Meu comentário de teste sobre NCM')).toBeInTheDocument();
        });

        expect(screen.getByText('ncm-8517.12.31')).toBeInTheDocument();
        expect(mockGetMyContributions).toHaveBeenCalledWith(
            expect.objectContaining({ page: 1, page_size: 15 }),
        );
    });

    it('filtra contribuições por busca', async () => {
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => expect(mockGetMyProfile).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: /contribuições/i }));
        await waitFor(() => expect(mockGetMyContributions).toHaveBeenCalled());

        // Digita na busca
        const searchInput = screen.getByPlaceholderText(/buscar/i);
        fireEvent.change(searchInput, { target: { value: 'NCM' } });

        await waitFor(() => {
            expect(mockGetMyContributions).toHaveBeenCalledWith(
                expect.objectContaining({ search: 'NCM', page: 1 }),
            );
        });
    });

    it('muda para aba Sessões e exibe Clerk UserProfile', async () => {
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => expect(mockGetMyProfile).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: /sessões/i }));

        // Clerk UserProfile é renderizado para sessões
        expect(screen.getByTestId('clerk-user-profile')).toBeInTheDocument();
    });

    // --- Tab Organização (admin only) ---

    it('não exibe aba Organização para usuários comuns', async () => {
        isAdminRef.value = false;
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => expect(mockGetMyProfile).toHaveBeenCalled());

        expect(screen.queryByText(/organização/i)).not.toBeInTheDocument();
    });

    it('não exibe aba Contribuições para usuários não autorizados', async () => {
        userEmailRef.value = 'joao@example.com';
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => expect(mockGetMyProfile).toHaveBeenCalled());

        expect(screen.queryByRole('button', { name: /contribuições/i })).not.toBeInTheDocument();
    });

    it('exibe aba Organização para administradores', async () => {
        isAdminRef.value = true;
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => expect(mockGetMyProfile).toHaveBeenCalled());

        expect(screen.getByRole('button', { name: /organização/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /organização/i }));
        expect(screen.getByTestId('clerk-org-profile')).toBeInTheDocument();
    });

    // --- Delete Account (double-confirmation) ---

    it('exibe zona de perigo com botão de desativação', async () => {
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /desativar minha conta/i })).toBeInTheDocument();
        });
    });

    it('primeiro clique no delete mostra o modal de confirmação', async () => {
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => expect(mockGetMyProfile).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: /desativar minha conta/i }));

        expect(screen.getByText('⚠️ Desativar Conta')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sim, continuar' })).toBeInTheDocument();
    });

    it('segundo passo do delete exige digitar "deletar"', async () => {
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => expect(mockGetMyProfile).toHaveBeenCalled());

        // Passo 1
        fireEvent.click(screen.getByRole('button', { name: /desativar minha conta/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Sim, continuar' }));

        // Passo 2 — input de confirmação
        expect(screen.getByText('🚨 Confirmação Final')).toBeInTheDocument();
        const confirmBtn = screen.getByRole('button', { name: /desativar conta/i });

        // Botão deve estar desativado enquanto texto errado
        expect(confirmBtn).toBeDisabled();

        // Digita texto correto
        fireEvent.change(screen.getByPlaceholderText(/digite "deletar"/i), {
            target: { value: 'deletar' },
        });

        expect(confirmBtn).not.toBeDisabled();
    });

    it('cancela o modal de deleção ao clicar Cancelar', async () => {
        render(<UserProfilePage isOpen={true} onClose={vi.fn()} />);

        await waitFor(() => expect(mockGetMyProfile).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: /desativar minha conta/i }));
        expect(screen.getByText('⚠️ Desativar Conta')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

        expect(screen.queryByText('⚠️ Desativar Conta')).not.toBeInTheDocument();
        expect(mockDeleteMyAccount).not.toHaveBeenCalled();
    });

    it('executa deleção após confirmar com "deletar"', async () => {
        const onClose = vi.fn();
        render(<UserProfilePage isOpen={true} onClose={onClose} />);

        await waitFor(() => expect(mockGetMyProfile).toHaveBeenCalled());

        // Fluxo completo de deleção
        fireEvent.click(screen.getByRole('button', { name: /desativar minha conta/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Sim, continuar' }));
        fireEvent.change(screen.getByPlaceholderText(/digite "deletar"/i), {
            target: { value: 'deletar' },
        });
        fireEvent.click(screen.getByRole('button', { name: /desativar conta/i }));

        await waitFor(() => {
            expect(mockDeleteMyAccount).toHaveBeenCalledTimes(1);
        });
    });
});

