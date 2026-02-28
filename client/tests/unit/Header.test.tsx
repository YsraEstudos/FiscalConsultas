import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Header } from '../../src/components/Header';
import styles from '../../src/components/Header.module.css';


const {
  signOutMock,
  userNameRef,
  userEmailRef,
  isAdminRef,
} = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  userNameRef: { value: 'Usuário Teste' as string | null },
  userEmailRef: { value: 'teste@demo.com' as string | null },
  isAdminRef: { value: true },
}));

vi.mock('@clerk/clerk-react', () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedOut: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  UserButton: () => <div data-testid="user-button" />,
  OrganizationSwitcher: () => <div data-testid="org-switcher" />,
  SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useClerk: () => ({ signOut: signOutMock }),
}));

vi.mock('../../src/components/SearchBar', () => ({
  SearchBar: ({ onSearch }: { onSearch: (term: string) => void }) => (
    <button onClick={() => onSearch('8517')} data-testid="search-bar-trigger">
      search
    </button>
  ),
}));

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    userName: userNameRef.value,
    userEmail: userEmailRef.value,
  }),
}));

vi.mock('../../src/hooks/useIsAdmin', () => ({
  useIsAdmin: () => isAdminRef.value,
}));

function renderHeader() {
  return render(
    <Header
      onSearch={vi.fn()}
      doc="nesh"
      setDoc={vi.fn()}
      searchKey="search-1"
      onOpenSettings={vi.fn()}
      onOpenTutorial={vi.fn()}
      onOpenStats={vi.fn()}
      onOpenComparator={vi.fn()}
      onOpenModerate={vi.fn()}
      onOpenProfile={vi.fn()}
      history={[]}
      onClearHistory={vi.fn()}
      onRemoveHistory={vi.fn()}
      onMenuOpen={vi.fn()}
    />,
  );
}

describe('Header', () => {
  beforeEach(() => {
    signOutMock.mockReset();
    userNameRef.value = 'Usuário Teste';
    userEmailRef.value = 'teste@demo.com';
    isAdminRef.value = true;
  });

  it('switches document type and triggers mobile menu action', () => {
    const setDoc = vi.fn();
    const onMenuOpen = vi.fn();

    render(
      <Header
        onSearch={vi.fn()}
        doc="nesh"
        setDoc={setDoc}
        searchKey="search-1"
        onOpenSettings={vi.fn()}
        onOpenTutorial={vi.fn()}
        onOpenStats={vi.fn()}
        onOpenComparator={vi.fn()}
        onOpenModerate={vi.fn()}
        onOpenProfile={vi.fn()}
        history={[]}
        onClearHistory={vi.fn()}
        onRemoveHistory={vi.fn()}
        onMenuOpen={onMenuOpen}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'TIPI' }));
    fireEvent.click(screen.getByRole('button', { name: 'NESH' }));
    fireEvent.click(screen.getByLabelText('Abrir Navegação'));

    expect(setDoc).toHaveBeenCalledWith('tipi');
    expect(setDoc).toHaveBeenCalledWith('nesh');
    expect(onMenuOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Notas Explicativas do Sistema Harmonizado')).toBeInTheDocument();
  });

  it('opens menu, calls actions and closes when clicking outside', async () => {
    const onOpenSettings = vi.fn();
    const onOpenTutorial = vi.fn();
    const onOpenStats = vi.fn();
    const onOpenComparator = vi.fn();

    render(
      <Header
        onSearch={vi.fn()}
        doc="tipi"
        setDoc={vi.fn()}
        searchKey="search-1"
        onOpenSettings={onOpenSettings}
        onOpenTutorial={onOpenTutorial}
        onOpenStats={onOpenStats}
        onOpenComparator={onOpenComparator}
        onOpenModerate={vi.fn()}
        onOpenProfile={vi.fn()}
        history={[]}
        onClearHistory={vi.fn()}
        onRemoveHistory={vi.fn()}
        onMenuOpen={vi.fn()}
      />,
    );

    const menuButton = screen.getByRole('button', { name: /menu/i });
    fireEvent.click(menuButton);
    expect(menuButton.className).toContain(styles.menuTriggerActive);

    fireEvent.click(screen.getByRole('button', { name: /comparar ncms/i }));
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole('button', { name: /configurações/i }));
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole('button', { name: /ajuda \/ tutorial/i }));
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole('button', { name: /estatísticas/i }));

    expect(onOpenComparator).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenTutorial).toHaveBeenCalledTimes(1);
    expect(onOpenStats).toHaveBeenCalledTimes(1);

    fireEvent.click(menuButton);
    expect(menuButton.className).toContain(styles.menuTriggerActive);
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(menuButton.className).not.toContain(styles.menuTriggerActive);
    });

    expect(screen.getByText('Tabela de Incidência do IPI')).toBeInTheDocument();
  });

  it('renders fallback user labels when auth profile is missing', () => {
    userNameRef.value = null;
    userEmailRef.value = null;
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: /menu/i }));
    expect(screen.getByText('Usuário')).toBeInTheDocument();
    expect(screen.getByText('Conta autenticada')).toBeInTheDocument();
  });

  it('confirms logout, blocks duplicate requests and closes modal on completion', async () => {
    let resolveSignOut: (() => void) | null = null;
    signOutMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSignOut = resolve;
        }),
    );

    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: /menu/i }));
    fireEvent.click(screen.getByRole('button', { name: /sair da conta/i }));
    expect(screen.getByText('Confirmar saída')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText('Confirmar saída')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /menu/i }));
    fireEvent.click(screen.getByRole('button', { name: /sair da conta/i }));
    const confirmButton = screen.getByRole('button', { name: 'Sair' });

    fireEvent.click(confirmButton);
    const loadingButton = screen.getByRole('button', { name: 'Saindo...' });
    expect(loadingButton).toBeDisabled();
    fireEvent.click(loadingButton);
    expect(signOutMock).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('Confirmar saída')).toBeInTheDocument();

    await act(async () => {
      resolveSignOut?.();
    });
    expect(screen.queryByText('Confirmar saída')).not.toBeInTheDocument();
  });
});
