import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DatabaseInstaller from '../../src/components/DatabaseInstaller';

const installMock = vi.fn();
const removeMock = vi.fn();

const localDatabaseState = {
  status: 'not_installed',
  progress: 0,
  progressStep: '',
  localVersion: null,
  remoteVersion: null,
  updateAvailable: false,
  error: null,
  dbSizeBytes: null,
  isSupported: true,
  isRemoving: false,
  install: installMock,
  remove: removeMock,
  refreshAvailability: vi.fn(),
  searchLocal: vi.fn(),
  getNbsDetailLocal: vi.fn(),
  getNebsDetailLocal: vi.fn(),
};

vi.mock('../../src/context/LocalDatabaseContext', () => ({
  useLocalDatabase: () => localDatabaseState,
}));

describe('DatabaseInstaller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(localDatabaseState, {
      status: 'not_installed',
      progress: 0,
      progressStep: '',
      localVersion: null,
      remoteVersion: null,
      updateAvailable: false,
      error: null,
      dbSizeBytes: null,
      isSupported: true,
      isRemoving: false,
    });
  });

  it('renders the unsupported browser message', () => {
    localDatabaseState.isSupported = false;

    render(<DatabaseInstaller />);

    expect(screen.getByText('Busca Offline')).toBeInTheDocument();
    expect(screen.getByText(/Seu navegador não suporta os recursos necessários/i)).toBeInTheDocument();
    expect(screen.getByText(/Indisponível/)).toBeInTheDocument();
  });

  it('renders the checking state', () => {
    localDatabaseState.status = 'checking';

    render(<DatabaseInstaller />);

    expect(screen.getByText(/Verificando banco de dados local/i)).toBeInTheDocument();
    expect(screen.getByText(/Verificando…/)).toBeInTheDocument();
  });

  it('renders the installing state with progress and known step labels', () => {
    localDatabaseState.status = 'installing';
    localDatabaseState.progress = 1;
    localDatabaseState.progressStep = 'downloading';

    render(<DatabaseInstaller />);

    expect(screen.getByText(/Instalando…/)).toBeInTheDocument();
    expect(screen.getByText('Baixando banco de dados…')).toBeInTheDocument();
    expect(screen.getByText('1%')).toBeInTheDocument();
  });

  it('renders the updating state and falls back to the raw step when unknown', () => {
    localDatabaseState.status = 'updating';
    localDatabaseState.progress = 48;
    localDatabaseState.progressStep = 'custom_step';

    render(<DatabaseInstaller />);

    expect(screen.getByText(/Atualizando…/)).toBeInTheDocument();
    expect(screen.getByText('custom_step')).toBeInTheDocument();
    expect(screen.getByText('48%')).toBeInTheDocument();
  });

  it('renders the ready state without update information', () => {
    localDatabaseState.status = 'ready';
    localDatabaseState.localVersion = '2026.04';
    localDatabaseState.dbSizeBytes = 1_572_864;

    render(<DatabaseInstaller />);

    expect(screen.getByText(/Ativa/)).toBeInTheDocument();
    expect(screen.getByText(/Versão:/)).toBeInTheDocument();
    expect(screen.getByText('2026.04')).toBeInTheDocument();
    expect(screen.getByText('1.5 MB')).toBeInTheDocument();
    expect(screen.queryByText(/Nova versão:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Atualizar Banco Offline/i })).not.toBeInTheDocument();
  });

  it('renders the ready state with update information and handles install/remove clicks', async () => {
    localDatabaseState.status = 'ready';
    localDatabaseState.localVersion = '2026.04';
    localDatabaseState.remoteVersion = '2026.05';
    localDatabaseState.updateAvailable = true;

    render(<DatabaseInstaller />);

    fireEvent.click(screen.getByRole('button', { name: /Atualizar Banco Offline/i }));
    fireEvent.click(screen.getByRole('button', { name: /Remover Dados Locais/i }));

    expect(screen.getByText(/Nova versão:/)).toBeInTheDocument();
    expect(screen.getByText('2026.05')).toBeInTheDocument();
    expect(installMock).toHaveBeenCalledTimes(1);
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it('renders the removing label while the remove action is in progress', () => {
    localDatabaseState.status = 'ready';
    localDatabaseState.isRemoving = true;

    render(<DatabaseInstaller />);

    expect(screen.getByRole('button', { name: /Removendo…/i })).toBeDisabled();
  });

  it('renders the error state and retries installation', () => {
    localDatabaseState.status = 'error';
    localDatabaseState.error = 'Falha ao baixar o banco';

    render(<DatabaseInstaller />);

    expect(screen.getByText(/Falha ao baixar o banco/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tentar Novamente/i }));
    expect(installMock).toHaveBeenCalledTimes(1);
  });

  it('renders the default install state and starts installation', () => {
    render(<DatabaseInstaller />);

    expect(screen.getByText(/Instale o banco de dados localmente/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Instalar Busca Instantânea/i }));
    expect(installMock).toHaveBeenCalledTimes(1);
  });
});
