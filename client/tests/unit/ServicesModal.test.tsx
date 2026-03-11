import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServicesModal } from '../../src/components/ServicesModal';
import type {
  NbsDetailResponse,
  NbsSearchResponse,
  NbsServiceItem,
  NebsDetailResponse,
  NebsSearchResponse,
  NebsSearchItem,
} from '../../src/types/api.types';

const refs = vi.hoisted(() => ({
  searchNbsServicesMock: vi.fn(),
  getNbsServiceDetailMock: vi.fn(),
  searchNebsEntriesMock: vi.fn(),
  getNebsEntryDetailMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../../src/services/api', () => ({
  searchNbsServices: refs.searchNbsServicesMock,
  getNbsServiceDetail: refs.getNbsServiceDetailMock,
  searchNebsEntries: refs.searchNebsEntriesMock,
  getNebsEntryDetail: refs.getNebsEntryDetailMock,
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: refs.toastErrorMock,
  },
}));

function makeServiceItem(overrides: Partial<NbsServiceItem> = {}): NbsServiceItem {
  return {
    code: '1.00.00',
    code_clean: '10000',
    description: 'Servico principal',
    parent_code: null,
    level: 1,
    has_nebs: false,
    ...overrides,
  };
}

function makeSearchResponse(results: NbsServiceItem[], query = ''): NbsSearchResponse {
  return {
    success: true,
    query,
    normalized: query,
    results,
    total: results.length,
  };
}

function makeDetailResponse(
  item: NbsServiceItem,
  overrides: Partial<Omit<NbsDetailResponse, 'success' | 'item'>> = {},
): NbsDetailResponse {
  return {
    success: true,
    item,
    ancestors: [],
    children: [],
    nebs: null,
    ...overrides,
  };
}

function makeNebsSearchItem(overrides: Partial<NebsSearchItem> = {}): NebsSearchItem {
  return {
    code: '1.0102.61',
    title: 'Serviços de construção de usinas de geração de energia',
    excerpt: 'Esta subposição inclui os serviços de construção para usinas de geração de energia.',
    page_start: 21,
    page_end: 22,
    section_title: 'SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO',
    ...overrides,
  };
}

function makeNebsSearchResponse(results: NebsSearchItem[], query = ''): NebsSearchResponse {
  return {
    success: true,
    query,
    normalized: query,
    results,
    total: results.length,
  };
}

function makeNebsDetailResponse(
  item: NbsServiceItem,
  overrides: Partial<Omit<NebsDetailResponse, 'success' | 'item' | 'entry'>> & {
    entry?: Partial<NebsDetailResponse['entry']>;
  } = {},
): NebsDetailResponse {
  const { entry, ancestors = [], ...rest } = overrides;
  return {
    success: true,
    item,
    ...rest,
    entry: {
      code: item.code,
      code_clean: item.code_clean,
      title: item.description,
      title_normalized: item.description.toLowerCase(),
      body_text: 'Texto integral da nota explicativa publicada.',
      body_markdown: 'Texto integral da nota explicativa publicada.',
      body_normalized: 'texto integral da nota explicativa publicada',
      section_title: 'SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO',
      page_start: 21,
      page_end: 22,
      parser_status: 'trusted',
      parse_warnings: null,
      source_hash: 'hash-1',
      updated_at: '2026-03-11T10:00:00+00:00',
      ...entry,
    },
    ancestors,
  };
}

function findResultButton(label: string): HTMLButtonElement {
  return screen
    .getAllByRole('button')
    .find((button) => button.textContent?.includes(label)) as HTMLButtonElement;
}

describe('ServicesModal', () => {
  beforeEach(() => {
    refs.searchNbsServicesMock.mockReset();
    refs.getNbsServiceDetailMock.mockReset();
    refs.searchNebsEntriesMock.mockReset();
    refs.getNebsEntryDetailMock.mockReset();
    refs.toastErrorMock.mockReset();
    document.body.style.overflow = '';
    vi.useRealTimers();
  });

  it('opens from a closed state, loads NBS by default, and closes via button, backdrop, and escape', async () => {
    const rootItem = makeServiceItem({
      code: '1.00.00',
      description: 'Consultoria aduaneira',
      has_nebs: true,
    });
    refs.searchNbsServicesMock.mockResolvedValue(makeSearchResponse([rootItem]));
    refs.getNbsServiceDetailMock.mockResolvedValue(makeDetailResponse(rootItem));

    const onClose = vi.fn();
    const { container, rerender } = render(<ServicesModal isOpen={false} onClose={onClose} />);

    expect(screen.queryByText('NBS 2.0')).not.toBeInTheDocument();

    rerender(<ServicesModal isOpen onClose={onClose} />);

    expect(document.body.style.overflow).toBe('hidden');

    await waitFor(() => {
      expect(refs.searchNbsServicesMock).toHaveBeenCalledWith('');
    });
    await waitFor(() => {
      expect(refs.getNbsServiceDetailMock).toHaveBeenCalledWith('1.00.00');
    });

    expect(screen.getByRole('heading', { name: 'Consultoria aduaneira' })).toBeInTheDocument();
    expect(screen.getByText('NEBS', { selector: 'span' })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Fechar'));
    fireEvent.mouseDown(container.firstElementChild as HTMLElement);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(3);

    rerender(<ServicesModal isOpen={false} onClose={onClose} />);
    expect(document.body.style.overflow).toBe('');
  });

  it('debounces typed NBS queries and shows empty states when no services are returned', async () => {
    vi.useFakeTimers();
    refs.searchNbsServicesMock.mockResolvedValue(makeSearchResponse([]));

    render(<ServicesModal isOpen onClose={vi.fn()} />);

    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });

    expect(refs.searchNbsServicesMock).toHaveBeenCalledWith('');

    refs.searchNbsServicesMock.mockClear();
    fireEvent.change(screen.getByLabelText('Buscar por codigo ou descricao'), {
      target: { value: 'construcao' },
    });

    await act(async () => {
      vi.advanceTimersByTime(219);
    });
    expect(refs.searchNbsServicesMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(refs.searchNbsServicesMock).toHaveBeenCalledWith('construcao');
    expect(screen.getByText('Nenhum servico encontrado')).toBeInTheDocument();
    expect(screen.getByText('Selecione um servico')).toBeInTheDocument();
  });

  it('keeps NEBS idle until a query is typed, then searches and shows note details', { timeout: 15000 }, async () => {
    const item = makeServiceItem({
      code: '1.0102.61',
      code_clean: '1010261',
      description: 'Serviços de construção de usinas de geração de energia',
      has_nebs: true,
    });
    const result = makeNebsSearchItem({ code: item.code, title: item.description });
    refs.searchNbsServicesMock.mockResolvedValue(makeSearchResponse([item]));
    refs.getNbsServiceDetailMock.mockResolvedValue(makeDetailResponse(item));
    refs.searchNebsEntriesMock.mockResolvedValue(makeNebsSearchResponse([result], 'energia'));
    refs.getNebsEntryDetailMock.mockResolvedValue(
      makeNebsDetailResponse(item, {
        entry: {
          body_markdown: 'Esta subposição inclui os serviços de:\n\n- Construção de usinas.',
        },
      }),
    );

    render(<ServicesModal isOpen onClose={vi.fn()} />);

    await waitFor(() => {
      expect(refs.searchNbsServicesMock).toHaveBeenCalledWith('');
    });

    fireEvent.click(screen.getByRole('button', { name: 'NEBS' }));

    expect(screen.getByText('Busque uma nota explicativa')).toBeInTheDocument();
    expect(refs.searchNebsEntriesMock).not.toHaveBeenCalled();

    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('Buscar por codigo ou termo da nota'), {
      target: { value: 'energia' },
    });

    await act(async () => {
      vi.advanceTimersByTime(220);
      await Promise.resolve();
    });

    vi.useRealTimers();

    await waitFor(() => {
      expect(refs.searchNebsEntriesMock).toHaveBeenCalledWith('energia');
    });
    await waitFor(() => {
      expect(refs.getNebsEntryDetailMock).toHaveBeenCalledWith(item.code);
    });

    expect(screen.getByRole('heading', { name: item.description })).toBeInTheDocument();
    expect(screen.getByText('Abrir item NBS relacionado')).toBeInTheDocument();
    expect(screen.getByText('Construção de usinas.')).toBeInTheDocument();
  });

  it('preserves tab state and opens the related NBS item from a NEBS detail', { timeout: 15000 }, async () => {
    const ancestor = makeServiceItem({
      code: '1.0102.6',
      code_clean: '101026',
      description: 'Serviços de construção de instalações industriais',
      level: 2,
    });
    const item = makeServiceItem({
      code: '1.0102.61',
      code_clean: '1010261',
      description: 'Serviços de construção de usinas de geração de energia',
      parent_code: ancestor.code,
      level: 3,
      has_nebs: true,
    });

    refs.searchNbsServicesMock
      .mockResolvedValueOnce(makeSearchResponse([item]))
      .mockResolvedValueOnce(makeSearchResponse([item], item.code));
    refs.getNbsServiceDetailMock
      .mockResolvedValueOnce(makeDetailResponse(item))
      .mockResolvedValueOnce(makeDetailResponse(item, { ancestors: [ancestor] }));
    refs.searchNebsEntriesMock.mockResolvedValue(makeNebsSearchResponse([makeNebsSearchItem({ code: item.code, title: item.description })], item.code));
    refs.getNebsEntryDetailMock.mockResolvedValue(makeNebsDetailResponse(item, { ancestors: [ancestor] }));

    render(<ServicesModal isOpen onClose={vi.fn()} />);

    await waitFor(() => {
      expect(refs.searchNbsServicesMock).toHaveBeenCalledWith('');
    });

    fireEvent.click(screen.getByRole('button', { name: 'NEBS' }));
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText('Buscar por codigo ou termo da nota'), {
      target: { value: item.code },
    });

    await act(async () => {
      vi.advanceTimersByTime(260);
      await Promise.resolve();
    });

    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.getByText('Abrir item NBS relacionado')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Abrir item NBS relacionado'));

    await waitFor(() => {
      expect(screen.getByText('Status NEBS')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue(item.code)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'NEBS' }));
    expect(screen.getByDisplayValue(item.code)).toBeInTheDocument();
  });

  it('reports NEBS errors without crashing the panel', async () => {
    const item = makeServiceItem({
      code: '1.0102.61',
      code_clean: '1010261',
      description: 'Serviços de construção de usinas de geração de energia',
      has_nebs: true,
    });
    refs.searchNbsServicesMock.mockResolvedValue(makeSearchResponse([item]));
    refs.getNbsServiceDetailMock.mockResolvedValue(makeDetailResponse(item));
    refs.searchNebsEntriesMock.mockRejectedValue(new Error('nebs failed'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(<ServicesModal isOpen onClose={vi.fn()} />);

      await waitFor(() => {
        expect(refs.searchNbsServicesMock).toHaveBeenCalledWith('');
      });

      fireEvent.click(screen.getByRole('button', { name: 'NEBS' }));
      vi.useFakeTimers();
      fireEvent.change(screen.getByLabelText('Buscar por codigo ou termo da nota'), {
        target: { value: 'energia' },
      });

      await act(async () => {
        vi.advanceTimersByTime(260);
        await Promise.resolve();
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(refs.toastErrorMock).toHaveBeenCalledWith('Erro ao carregar o catálogo NEBS.');
      });

      expect(screen.getByText('Nenhuma nota encontrada')).toBeInTheDocument();
      expect(screen.getByText('Selecione uma nota')).toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
