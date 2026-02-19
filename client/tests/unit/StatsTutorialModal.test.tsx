import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { StatsModal } from '../../src/components/StatsModal';
import { TutorialModal } from '../../src/components/TutorialModal';
import { getSystemStatus } from '../../src/services/api';


vi.mock('../../src/services/api', () => ({
  getSystemStatus: vi.fn(),
}));


describe('StatsModal', () => {
  beforeEach(() => {
    vi.mocked(getSystemStatus).mockReset();
  });

  it('loads and renders online/offline status cards when open', async () => {
    vi.mocked(getSystemStatus).mockResolvedValue({
      status: 'online',
      version: '4.2',
      backend: 'FastAPI',
      database: { status: 'online', chapters: 97, positions: 1200, latency_ms: 8.1 },
      tipi: { status: 'error', chapters: 0, positions: 0, error: 'unavailable' },
    });

    const onClose = vi.fn();
    render(<StatsModal isOpen={true} onClose={onClose} />);

    expect(screen.getByText('Carregando status...')).toBeInTheDocument();
    expect(await screen.findByText('Versão')).toBeInTheDocument();
    expect(screen.getByText('FastAPI')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText('97 Capítulos')).toBeInTheDocument();
    expect(screen.queryByText('0 Capítulos')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('handles request errors and clears loading state', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getSystemStatus).mockRejectedValue(new Error('status failed'));

    render(<StatsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => expect(getSystemStatus).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.queryByText('Carregando status...')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Versão')).not.toBeInTheDocument();
    expect(errSpy).toHaveBeenCalled();
  });

  it('renders database error and TIPI online chapter count', async () => {
    vi.mocked(getSystemStatus).mockResolvedValue({
      status: 'online',
      version: '4.3',
      backend: 'FastAPI',
      database: { status: 'error', chapters: 0, positions: 0 },
      tipi: { status: 'online', chapters: 12, positions: 214 },
    } as any);

    render(<StatsModal isOpen={true} onClose={vi.fn()} />);

    expect(await screen.findByText('Versão')).toBeInTheDocument();
    expect(screen.getByText('Erro')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('12 Capítulos')).toBeInTheDocument();
  });

  it('does not request status when closed', () => {
    render(<StatsModal isOpen={false} onClose={vi.fn()} />);
    expect(getSystemStatus).not.toHaveBeenCalled();
    expect(screen.queryByText('Estatísticas do Sistema')).not.toBeInTheDocument();
  });
});


describe('TutorialModal', () => {
  it('renders tutorial content when open and closes on escape', async () => {
    const onClose = vi.fn();
    render(<TutorialModal isOpen={true} onClose={onClose} />);

    expect(screen.getByText('Como usar')).toBeInTheDocument();
    expect(screen.getByText(/Busca Inteligente/i)).toBeInTheDocument();
    expect(screen.getByText(/NESH vs TIPI/i)).toBeInTheDocument();
    expect(screen.getByText('/')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('renders nothing when closed', () => {
    render(<TutorialModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Como usar')).not.toBeInTheDocument();
  });
});
