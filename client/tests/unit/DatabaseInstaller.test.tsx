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
  supportReport: {
    supported: true,
    missingFeatures: [],
    canRecoverWithIsolationReload: false,
    isSecureContext: true,
    crossOriginIsolated: true,
  },
  isRemoving: false,
  install: installMock,
  remove: removeMock,
  refreshAvailability: vi.fn(),
  searchLocal: vi.fn(),
  getNbsDetailLocal: vi.fn(),
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
      supportReport: {
        supported: true,
        missingFeatures: [],
        canRecoverWithIsolationReload: false,
        isSecureContext: true,
        crossOriginIsolated: true,
      },
      isRemoving: false,
    });
  });

  it('renders the unsupported browser message', () => {
    localDatabaseState.isSupported = false;
    localDatabaseState.supportReport = {
      supported: false,
      missingFeatures: ['worker'],
      canRecoverWithIsolationReload: false,
      isSecureContext: true,
      crossOriginIsolated: true,
    };

    render(<DatabaseInstaller />);

    expect(screen.getByText('Busca local')).toBeInTheDocument();
    expect(screen.getByText(/Seu navegador não suporta todos os recursos/i)).toBeInTheDocument();
    expect(screen.getByText(/Indisponível/)).toBeInTheDocument();
  });

  it('renders a recoverable isolation message before marking Edge as incompatible', () => {
    localDatabaseState.isSupported = false;
    localDatabaseState.supportReport = {
      supported: false,
      missingFeatures: ['cross-origin-isolation', 'shared-array-buffer'],
      canRecoverWithIsolationReload: true,
      isSecureContext: true,
      crossOriginIsolated: false,
    };

    render(<DatabaseInstaller />);

    expect(screen.getByText(/Preparando/)).toBeInTheDocument();
    expect(screen.getByText(/precisa ativar o isolamento de origem/i)).toBeInTheDocument();
    expect(screen.queryByText(/Indisponível/)).not.toBeInTheDocument();
  });

  it('renders an insecure-origin message when the page is not in a secure context', () => {
    localDatabaseState.isSupported = false;
    localDatabaseState.supportReport = {
      supported: false,
      missingFeatures: ['secure-context', 'shared-array-buffer'],
      canRecoverWithIsolationReload: false,
      isSecureContext: false,
      crossOriginIsolated: false,
    };

    render(<DatabaseInstaller />);

    expect(screen.getByText(/precisa de uma origem segura/i)).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1:5173/i)).toBeInTheDocument();
  });

  it('renders an OPFS-specific message when browser storage is unavailable', () => {
    localDatabaseState.isSupported = false;
    localDatabaseState.supportReport = {
      supported: false,
      missingFeatures: ['opfs'],
      canRecoverWithIsolationReload: false,
      isSecureContext: true,
      crossOriginIsolated: true,
    };

    render(<DatabaseInstaller />);

    expect(screen.getByText(/não liberou OPFS/i)).toBeInTheDocument();
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
    expect(screen.getByText('Preparando base fiscal…')).toBeInTheDocument();
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
    localDatabaseState.localVersion = '2026.04.24.143558';
    localDatabaseState.dbSizeBytes = 1_572_864;

    render(<DatabaseInstaller />);

    expect(screen.getByText(/Pronta/)).toBeInTheDocument();
    expect(screen.getByText(/NBS, TIPI e NESH disponíveis neste computador/i)).toBeInTheDocument();
    expect(screen.getByText(/Atualização:/)).toBeInTheDocument();
    expect(screen.getByText('24/04/2026')).toBeInTheDocument();
    expect(screen.getByText('1.5 MB')).toBeInTheDocument();
    expect(screen.queryByText(/Nova versão:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Atualizar base local/i })).not.toBeInTheDocument();
  });

  it('renders the ready state with update information and handles update click', async () => {
    localDatabaseState.status = 'ready';
    localDatabaseState.localVersion = '2026.04';
    localDatabaseState.remoteVersion = '2026.05';
    localDatabaseState.updateAvailable = true;

    render(<DatabaseInstaller />);

    fireEvent.click(screen.getByRole('button', { name: /Atualizar base local/i }));

    expect(screen.getByText(/Nova versão:/)).toBeInTheDocument();
    expect(screen.getByText('2026.05')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remover Dados Locais/i })).not.toBeInTheDocument();
    expect(installMock).toHaveBeenCalledTimes(1);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('does not render remove action while the remove flag is set', () => {
    localDatabaseState.status = 'ready';
    localDatabaseState.isRemoving = true;

    render(<DatabaseInstaller />);

    expect(screen.queryByRole('button', { name: /Removendo…/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remover Dados Locais/i })).not.toBeInTheDocument();
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
