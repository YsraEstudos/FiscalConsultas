import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Header } from '../../src/components/Header';
import styles from '../../src/components/Header.module.css';


const {
  signOutMock,
  isSignedInRef,
  userNameRef,
  userEmailRef,
  isAdminRef,
} = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  isSignedInRef: { value: true },
  userNameRef: { value: 'Usuário Teste' as string | null },
  userEmailRef: { value: 'teste@demo.com' as string | null },
  isAdminRef: { value: true },
}));

vi.mock('@clerk/react', () => ({
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
    isSignedIn: isSignedInRef.value,
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
      onOpenServices={vi.fn()}
      onOpenModerate={vi.fn()}
      onOpenProfile={vi.fn()}
      history={[]}
      onClearHistory={vi.fn()}
      onRemoveHistory={vi.fn()}
      onMenuOpen={vi.fn()}
    />,
  );
}

function getMenuButton() {
  return screen.getByRole('button', { name: /menu/i });
}

function openMenu() {
  const menuButton = getMenuButton();
  fireEvent.click(menuButton);
  return menuButton;
}

describe('Header', () => {
  beforeEach(() => {
    signOutMock.mockReset();
    isSignedInRef.value = true;
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
        onOpenServices={vi.fn()}
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

  it('uses NBS and NEBS in the selector when the active document is a service tab', () => {
    const setDoc = vi.fn();

    render(
      <Header
        onSearch={vi.fn()}
        doc="nbs"
        setDoc={setDoc}
        searchKey="search-1"
        onOpenSettings={vi.fn()}
        onOpenTutorial={vi.fn()}
        onOpenStats={vi.fn()}
        onOpenComparator={vi.fn()}
        onOpenServices={vi.fn()}
        onOpenModerate={vi.fn()}
        onOpenProfile={vi.fn()}
        history={[]}
        onClearHistory={vi.fn()}
        onRemoveHistory={vi.fn()}
        onMenuOpen={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'NEBS' }));

    expect(setDoc).toHaveBeenCalledWith('nebs');
    expect(screen.getByText('Classificação Brasileira de Serviços')).toBeInTheDocument();
  });

  it('opens menu, calls actions and closes when clicking outside', async () => {
    const onOpenSettings = vi.fn();
    const onOpenTutorial = vi.fn();
    const onOpenStats = vi.fn();
    const onOpenComparator = vi.fn();
    const onOpenServices = vi.fn();

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
        onOpenServices={onOpenServices}
        onOpenModerate={vi.fn()}
        onOpenProfile={vi.fn()}
        history={[]}
        onClearHistory={vi.fn()}
        onRemoveHistory={vi.fn()}
        onMenuOpen={vi.fn()}
      />,
    );

    const menuButton = openMenu();
    expect(menuButton.className).toContain(styles.menuTriggerActive);

    fireEvent.click(screen.getByText('Comparar NCMs').closest('button') as HTMLButtonElement);
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByText('Serviços (NBS)').closest('button') as HTMLButtonElement);
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByText('Configurações').closest('button') as HTMLButtonElement);
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByText('Ajuda / Tutorial').closest('button') as HTMLButtonElement);
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByText('Estatísticas').closest('button') as HTMLButtonElement);

    expect(onOpenComparator).toHaveBeenCalledTimes(1);
    expect(onOpenServices).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenTutorial).toHaveBeenCalledTimes(1);
    expect(onOpenStats).toHaveBeenCalledTimes(1);

    fireEvent.click(menuButton);
    expect(menuButton.className).toContain(styles.menuTriggerActive);
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    await waitFor(() => {
      expect(menuButton).not.toHaveClass(styles.menuTriggerActive);
    });

    expect(screen.getByText('Tabela de Incidência do IPI')).toBeInTheDocument();
  });

  it('shows menu shortcuts to return to NESH and TIPI from service tabs', () => {
    const setDoc = vi.fn();

    render(
      <Header
        onSearch={vi.fn()}
        doc="nebs"
        setDoc={setDoc}
        searchKey="search-1"
        onOpenSettings={vi.fn()}
        onOpenTutorial={vi.fn()}
        onOpenStats={vi.fn()}
        onOpenComparator={vi.fn()}
        onOpenServices={vi.fn()}
        onOpenModerate={vi.fn()}
        onOpenProfile={vi.fn()}
        history={[]}
        onClearHistory={vi.fn()}
        onRemoveHistory={vi.fn()}
        onMenuOpen={vi.fn()}
      />,
    );

    openMenu();
    fireEvent.click(screen.getByText('Voltar para NESH').closest('button') as HTMLButtonElement);
    fireEvent.click(getMenuButton());
    fireEvent.click(screen.getByText('Ir para TIPI').closest('button') as HTMLButtonElement);

    expect(setDoc).toHaveBeenNthCalledWith(1, 'nesh');
    expect(setDoc).toHaveBeenNthCalledWith(2, 'tipi');
  });

  it('renders fallback user labels when auth profile is missing', () => {
    userNameRef.value = null;
    userEmailRef.value = null;
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: /menu/i }));
    expect(screen.getByText('Usuário')).toBeInTheDocument();
    expect(screen.getByText('Conta autenticada')).toBeInTheDocument();
  });

  it('renders sign-in entry when the user is signed out', () => {
    isSignedInRef.value = false;
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: /menu/i }));

    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sair da conta/i })).not.toBeInTheDocument();
  });

  it('confirms logout, blocks duplicate requests and closes modal on completion', { timeout: 15000 }, async () => {
    let resolveSignOut: (() => void) | null = null;
    signOutMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSignOut = () => queueMicrotask(resolve);
        }),
    );

    renderHeader();

    openMenu();
    fireEvent.click(screen.getByText('Sair da conta').closest('button') as HTMLButtonElement);
    expect(screen.getByText('Confirmar saída')).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: 'Sair' });

    fireEvent.click(confirmButton);
    const loadingButton = screen.getByRole('button', { name: 'Saindo...' });
    expect(loadingButton).toBeDisabled();
    fireEvent.click(loadingButton);
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledWith({ redirectUrl: '/' });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('Confirmar saída')).toBeInTheDocument();

    await act(async () => {
      resolveSignOut?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText('Confirmar saída')).not.toBeInTheDocument();
  });
});
