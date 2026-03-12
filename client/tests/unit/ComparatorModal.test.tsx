import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComparatorModal } from '../../src/components/ComparatorModal';
import styles from '../../src/components/ComparatorModal.module.css';
import { searchNCM, searchTipi } from '../../src/services/api';

const refs = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}));

vi.mock('../../src/services/api', () => ({
  searchNCM: vi.fn(),
  searchTipi: vi.fn(),
}));

vi.mock('../../src/context/SettingsContext', () => ({
  useSettings: () => ({ tipiViewMode: 'family' }),
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
    vi.mocked(searchTipi).mockReset();
    refs.toastErrorMock.mockReset();
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
    vi.mocked(searchNCM)
      .mockResolvedValueOnce({ markdown: '# Left result' })
      .mockResolvedValueOnce({ markdown: '# Right result' });

    render(<ComparatorModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('NCM Esquerda'), { target: { value: '8517' } });
    fireEvent.change(screen.getByLabelText('NCM Direita'), { target: { value: '8471' } });
    fireEvent.click(screen.getByRole('button', { name: /Comparar$/i }));

    await waitFor(() => {
      expect(searchNCM).toHaveBeenNthCalledWith(1, '8517');
      expect(searchNCM).toHaveBeenNthCalledWith(2, '8471');
    });
    expect(screen.getByText('NESH 8517')).toBeInTheDocument();
    expect(screen.getByText('NESH 8471')).toBeInTheDocument();
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
