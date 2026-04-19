import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComparatorModal } from '../../src/components/ComparatorModal';
import styles from '../../src/components/ComparatorModal.module.css';
import { searchNCM, searchNCMFull, searchTipi } from '../../src/services/api';

const refs = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  searchLocalMock: vi.fn(),
  localDbStatus: 'unsupported',
}));

vi.mock('../../src/services/api', () => ({
  searchNCM: vi.fn(),
  searchNCMFull: vi.fn(),
  searchTipi: vi.fn(),
}));

vi.mock('../../src/context/SettingsContext', () => ({
  useSettings: () => ({ tipiViewMode: 'family' }),
}));

vi.mock('../../src/context/LocalDatabaseContext', () => ({
  useLocalDatabase: () => ({
    status: refs.localDbStatus,
    searchLocal: refs.searchLocalMock,
  }),
}));

vi.mock('../../src/components/MarkdownPane', () => ({
  MarkdownPane: ({ markdown }: { markdown: string }) => (
    <div data-testid="markdown-pane">{markdown}</div>
  ),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: refs.toastErrorMock,
  },
}));

describe('ComparatorModal', () => {
  beforeEach(() => {
    vi.mocked(searchNCM).mockReset();
    vi.mocked(searchNCMFull).mockReset();
    vi.mocked(searchTipi).mockReset();
    refs.toastErrorMock.mockReset();
    refs.searchLocalMock.mockReset();
    refs.searchLocalMock.mockResolvedValue(null);
    refs.localDbStatus = 'unsupported';
    document.body.style.overflow = '';
  });

  it('renders nothing while closed', () => {
    render(<ComparatorModal isOpen={false} onClose={vi.fn()} />);

    expect(screen.queryByText(/Comparar NCMs/i)).not.toBeInTheDocument();
  });

  it('locks body scroll while open, resets form state on reopen, and closes on escape/backdrop', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <ComparatorModal isOpen={true} onClose={onClose} defaultDoc="tipi" />,
    );

    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.change(screen.getByLabelText('NCM Esquerda'), { target: { value: '8517' } });
    fireEvent.change(screen.getByLabelText('NCM Direita'), { target: { value: '8471' } });
    fireEvent.click(screen.getByRole('button', { name: 'NESH' }));

    fireEvent.keyDown(window, { key: 'Escape' });

    const overlay = container.firstElementChild as HTMLElement | null;
    expect(overlay).not.toBeNull();
    if (overlay) {
      fireEvent.mouseDown(overlay, { target: overlay, currentTarget: overlay });
    }

    rerender(<ComparatorModal isOpen={false} onClose={onClose} defaultDoc="tipi" />);
    expect(document.body.style.overflow).toBe('');

    rerender(<ComparatorModal isOpen={true} onClose={onClose} defaultDoc="tipi" />);
    expect(screen.getByRole('button', { name: 'TIPI' })).toHaveClass(styles.docButtonActive);
    expect(screen.getByLabelText('NCM Esquerda')).toHaveValue('');
    expect(screen.getByLabelText('NCM Direita')).toHaveValue('');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('validates required fields before comparing', async () => {
    render(<ComparatorModal isOpen={true} onClose={vi.fn()} />);

    const compareButton = screen.getByRole('button', { name: /Comparar$/i });
    expect(compareButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('NCM Esquerda'), { target: { value: '8517' } });
    expect(compareButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('NCM Direita'), { target: { value: '8471' } });
    expect(compareButton).not.toBeDisabled();
  });

  it('compares both sides using NESH by default and renders the returned markdown', async () => {
    vi.mocked(searchNCMFull)
      .mockResolvedValueOnce({ markdown: '# Left result' })
      .mockResolvedValueOnce({ markdown: '# Right result' });

    render(<ComparatorModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('NCM Esquerda'), { target: { value: '8517' } });
    fireEvent.change(screen.getByLabelText('NCM Direita'), { target: { value: '8471' } });
    fireEvent.click(screen.getByRole('button', { name: /Comparar$/i }));

    await waitFor(() => {
      expect(searchNCMFull).toHaveBeenNthCalledWith(1, '8517');
      expect(searchNCMFull).toHaveBeenNthCalledWith(2, '8471');
    });
    expect(screen.getByText('NESH 8517')).toBeInTheDocument();
    expect(screen.getByText('NESH 8471')).toBeInTheDocument();
    expect(screen.getAllByTestId('markdown-pane')).toHaveLength(2);
  });

  it('renders local offline NESH code results without sending objects to MarkdownPane', async () => {
    refs.localDbStatus = 'ready';
    refs.searchLocalMock
      .mockResolvedValueOnce({
        searchType: 'code',
        results: {
          '85': {
            capitulo: '85',
            ncm_buscado: '8512',
            posicao_alvo: '8512',
            posicoes: [
              { codigo: '85.12', descricao: 'Aparelhos elétricos de iluminação', anchor_id: 'pos-85-12' },
            ],
            notas_gerais: null,
            notas_parseadas: {},
            conteudo: '85.12 - Aparelhos elétricos de iluminação ou de sinalização visual',
            real_content_found: true,
            erro: null,
          },
        },
      })
      .mockResolvedValueOnce({
        searchType: 'code',
        results: {
          '85': {
            capitulo: '85',
            ncm_buscado: '85',
            posicao_alvo: null,
            posicoes: [
              { codigo: '85.12', descricao: 'Aparelhos elétricos de iluminação', anchor_id: 'pos-85-12' },
            ],
            notas_gerais: null,
            notas_parseadas: {},
            conteudo: '85.12 - Aparelhos elétricos de iluminação ou de sinalização visual',
            real_content_found: true,
            erro: null,
          },
        },
      });

    render(<ComparatorModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('NCM Esquerda'), { target: { value: '8512' } });
    fireEvent.change(screen.getByLabelText('NCM Direita'), { target: { value: '85' } });
    fireEvent.click(screen.getByRole('button', { name: /Comparar$/i }));

    await waitFor(() => {
      expect(refs.searchLocalMock).toHaveBeenNthCalledWith(1, 'nesh', '8512', undefined);
      expect(refs.searchLocalMock).toHaveBeenNthCalledWith(2, 'nesh', '85', undefined);
    });

    expect(searchNCM).not.toHaveBeenCalled();
    expect(searchNCMFull).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('markdown-pane')).toHaveLength(2);
    expect(screen.getAllByText(/Capítulo 85/i)).toHaveLength(2);
    expect(refs.toastErrorMock).not.toHaveBeenCalled();
  });

  it('renders local offline TIPI code results before falling back to the API', async () => {
    refs.localDbStatus = 'ready';
    refs.searchLocalMock
      .mockResolvedValueOnce({
        searchType: 'code',
        results: {
          '22': {
            capitulo: '22',
            titulo: 'Bebidas, líquidos alcoólicos e vinagres',
            posicao_alvo: '2203',
            posicoes: [
              { codigo: '2203.00.00', ncm: '22030000', descricao: 'Cervejas de malte', aliquota: '6.5', nivel: 1 },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        searchType: 'code',
        results: {
          '22': {
            capitulo: '22',
            titulo: 'Bebidas, líquidos alcoólicos e vinagres',
            posicao_alvo: '2204',
            posicoes: [
              { codigo: '2204.10.10', ncm: '22041010', descricao: 'Vinhos espumantes', aliquota: '10', nivel: 1 },
            ],
          },
        },
      });

    render(<ComparatorModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'TIPI' }));
    fireEvent.change(screen.getByLabelText('NCM Esquerda'), { target: { value: '2203' } });
    fireEvent.change(screen.getByLabelText('NCM Direita'), { target: { value: '2204' } });
    fireEvent.click(screen.getByRole('button', { name: /Comparar$/i }));

    await waitFor(() => {
      expect(refs.searchLocalMock).toHaveBeenNthCalledWith(1, 'tipi', '2203', 'family');
      expect(refs.searchLocalMock).toHaveBeenNthCalledWith(2, 'tipi', '2204', 'family');
    });

    expect(searchTipi).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('markdown-pane')).toHaveLength(2);
    expect(screen.getAllByText(/Bebidas, líquidos alcoólicos e vinagres/i)).toHaveLength(2);
    expect(refs.toastErrorMock).not.toHaveBeenCalled();
  });

  it('falls back to the full NESH API response when local offline search returns no result', async () => {
    refs.localDbStatus = 'ready';
    refs.searchLocalMock.mockResolvedValue(null);
    vi.mocked(searchNCMFull)
      .mockResolvedValueOnce({ markdown: '# Left full result' })
      .mockResolvedValueOnce({ markdown: '# Right full result' });

    render(<ComparatorModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('NCM Esquerda'), { target: { value: '8512' } });
    fireEvent.change(screen.getByLabelText('NCM Direita'), { target: { value: '85' } });
    fireEvent.click(screen.getByRole('button', { name: /Comparar$/i }));

    await waitFor(() => {
      expect(refs.searchLocalMock).toHaveBeenNthCalledWith(1, 'nesh', '8512', undefined);
      expect(refs.searchLocalMock).toHaveBeenNthCalledWith(2, 'nesh', '85', undefined);
      expect(searchNCMFull).toHaveBeenNthCalledWith(1, '8512');
      expect(searchNCMFull).toHaveBeenNthCalledWith(2, '85');
    });

    expect(searchNCM).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('markdown-pane')).toHaveLength(2);
  });

  it('uses TIPI search when that document is selected and reports compare failures', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.mocked(searchTipi).mockRejectedValue(new Error('backend offline'));

      render(<ComparatorModal isOpen={true} onClose={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'TIPI' }));
      fireEvent.change(screen.getByLabelText('NCM Esquerda'), { target: { value: '2203' } });
      fireEvent.change(screen.getByLabelText('NCM Direita'), { target: { value: '2204' } });
      fireEvent.click(screen.getByRole('button', { name: /Comparar$/i }));

      await waitFor(() => {
        expect(searchTipi).toHaveBeenNthCalledWith(1, '2203', 'family');
        expect(searchTipi).toHaveBeenNthCalledWith(2, '2204', 'family');
      });
      await waitFor(() => {
        expect(refs.toastErrorMock).toHaveBeenCalledWith('Erro ao comparar. Verifique a API.');
      });
      expect(screen.getByText('TIPI 2203')).toBeInTheDocument();
      expect(screen.getByText('TIPI 2204')).toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
