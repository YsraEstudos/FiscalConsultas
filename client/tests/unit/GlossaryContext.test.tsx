import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import { GlossaryProvider, useGlossary } from '../../src/context/GlossaryContext';
import { getGlossaryTerm } from '../../src/services/api';

const refs = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}));

vi.mock('../../src/services/api', () => ({
  getGlossaryTerm: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: refs.toastErrorMock,
  },
}));

vi.mock('../../src/components/GlossaryModal', () => ({
  GlossaryModal: ({
    isOpen,
    onClose,
    term,
    definition,
    loading,
  }: {
    isOpen: boolean;
    onClose: () => void;
    term: string;
    definition: string | null;
    loading: boolean;
  }) => (
    isOpen ? (
      <div
        data-testid="glossary-modal"
        data-term={term}
        data-definition={definition ?? ''}
        data-loading={String(loading)}
      >
        <button onClick={onClose} type="button">
          fechar glossário
        </button>
      </div>
    ) : null
  ),
}));

function GlossaryConsumer() {
  const { openGlossary } = useGlossary();
  return (
    <button onClick={() => void openGlossary('drawback')} type="button">
      abrir glossário
    </button>
  );
}

describe('GlossaryContext', () => {
  beforeEach(() => {
    vi.mocked(getGlossaryTerm).mockReset();
    refs.toastErrorMock.mockReset();
  });

  it('throws when useGlossary is used outside the provider', () => {
    expect(() => renderHook(() => useGlossary())).toThrow('useGlossary must be used within a GlossaryProvider');
  });

  it('opens glossary terms from delegated document clicks and resolves data', async () => {
    let resolveRequest: ((value: { found: boolean; data: string }) => void) | null = null;
    vi.mocked(getGlossaryTerm).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    render(
      <GlossaryProvider>
        <button className="glossary-term" data-term="NCM" type="button">
          termo
        </button>
      </GlossaryProvider>,
    );

    fireEvent.click(screen.getByText('termo'));

    const modal = await screen.findByTestId('glossary-modal');
    expect(vi.mocked(getGlossaryTerm)).toHaveBeenCalledWith('NCM');
    expect(modal).toHaveAttribute('data-term', 'NCM');
    expect(modal).toHaveAttribute('data-loading', 'true');

    resolveRequest?.({ found: true, data: 'Nomenclatura Comum' });

    await waitFor(() => {
      expect(screen.getByTestId('glossary-modal')).toHaveAttribute('data-loading', 'false');
    });
    expect(screen.getByTestId('glossary-modal')).toHaveAttribute('data-definition', 'Nomenclatura Comum');
  });

  it('keeps the modal open with an empty definition when the glossary term is not found and supports close', async () => {
    vi.mocked(getGlossaryTerm).mockResolvedValue({ found: false, data: null });

    render(
      <GlossaryProvider>
        <GlossaryConsumer />
      </GlossaryProvider>,
    );

    fireEvent.click(screen.getByText('abrir glossário'));

    await waitFor(() => {
      expect(screen.getByTestId('glossary-modal')).toHaveAttribute('data-loading', 'false');
    });
    expect(screen.getByTestId('glossary-modal')).toHaveAttribute('data-definition', '');

    fireEvent.click(screen.getByText('fechar glossário'));
    expect(screen.queryByTestId('glossary-modal')).not.toBeInTheDocument();
  });

  it('shows a toast when glossary lookup fails', async () => {
    vi.mocked(getGlossaryTerm).mockRejectedValue(new Error('network'));

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <GlossaryProvider>
          <GlossaryConsumer />
        </GlossaryProvider>,
      );

      fireEvent.click(screen.getByText('abrir glossário'));

      await waitFor(() => {
        expect(refs.toastErrorMock).toHaveBeenCalledWith('Erro ao buscar termo.');
      });
      expect(screen.getByTestId('glossary-modal')).toHaveAttribute('data-loading', 'false');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
