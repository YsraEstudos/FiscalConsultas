import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComparatorModal } from '../../src/components/ComparatorModal';

const refs = vi.hoisted(() => ({
  searchLocalMock: vi.fn(),
  toastErrorMock: vi.fn(),
  searchNCMFullMock: vi.fn(),
  searchTipiMock: vi.fn(),
}));

vi.mock('../../src/services/api', () => ({
  searchNCMFull: refs.searchNCMFullMock,
  searchTipi: refs.searchTipiMock,
}));

vi.mock('../../src/context/LocalDatabaseContext', () => ({
  useLocalDatabase: () => ({
    status: 'ready',
    searchLocal: refs.searchLocalMock,
  }),
}));

vi.mock('../../src/context/SettingsContext', () => ({
  useSettings: () => ({
    tipiViewMode: 'family',
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: refs.toastErrorMock,
  },
}));

vi.mock('../../src/components/MarkdownPane', () => ({
  MarkdownPane: ({ markdown }: { markdown: string }) => (
    <div data-testid="markdown-pane">{markdown}</div>
  ),
}));

describe('ComparatorModal', () => {
  beforeEach(() => {
    refs.searchLocalMock.mockReset();
    refs.toastErrorMock.mockReset();
    refs.searchNCMFullMock.mockReset();
    refs.searchTipiMock.mockReset();
  });

  it('does not render when closed', () => {
    render(<ComparatorModal isOpen={false} onClose={vi.fn()} />);

    expect(screen.queryByText('Comparar NCMs')).not.toBeInTheDocument();
  });

  it('compares using local worker results without backend API calls', async () => {
    refs.searchLocalMock.mockResolvedValue({
      searchType: 'code',
      results: {
        '85': {
          capitulo: '85',
          ncm_buscado: '8517',
          real_content_found: true,
          conteudo: 'Conteúdo local',
          posicoes: [],
        },
      },
      markdown: '<h1>Conteúdo local</h1>',
    });

    render(<ComparatorModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('NCM Esquerda'), {
      target: { value: '8517' },
    });
    fireEvent.change(screen.getByLabelText('NCM Direita'), {
      target: { value: '8471' },
    });
    fireEvent.click(screen.getByRole('button', { name: /comparar/i }));

    await waitFor(() => {
      expect(screen.getAllByTestId('markdown-pane')).toHaveLength(2);
    });

    expect(refs.searchLocalMock).toHaveBeenNthCalledWith(1, 'nesh', '8517', undefined);
    expect(refs.searchLocalMock).toHaveBeenNthCalledWith(2, 'nesh', '8471', undefined);
    expect(refs.searchNCMFullMock).not.toHaveBeenCalled();
    expect(refs.searchTipiMock).not.toHaveBeenCalled();
    expect(refs.toastErrorMock).not.toHaveBeenCalled();
  });

  it('shows local install guidance when local comparison has no renderable content', async () => {
    refs.searchLocalMock.mockResolvedValue(null);

    render(<ComparatorModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('NCM Esquerda'), {
      target: { value: '8517' },
    });
    fireEvent.change(screen.getByLabelText('NCM Direita'), {
      target: { value: '8471' },
    });
    fireEvent.click(screen.getByRole('button', { name: /comparar/i }));

    await waitFor(() => {
      expect(refs.toastErrorMock).toHaveBeenCalledWith(
        'Instale as bases locais para comparar NCMs sem backend.',
      );
    });

    expect(refs.searchNCMFullMock).not.toHaveBeenCalled();
    expect(refs.searchTipiMock).not.toHaveBeenCalled();
  });
});
