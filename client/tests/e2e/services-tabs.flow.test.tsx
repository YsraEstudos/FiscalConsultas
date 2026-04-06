import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServicesTabContent } from '../../src/components/ServicesTabContent';
import {
  makeNebsDetail,
  makeNebsSearch,
  makeNbsDetail,
  makeNbsSearch,
} from '../playwright/fixtures/service-mocks';
import type {
  NbsSearchResponse,
  NebsSearchResponse,
  ServiceDocType,
} from '../../src/types/api.types';

const refs = vi.hoisted(() => ({
  getNbsServiceDetailMock: vi.fn(),
  getNebsEntryDetailMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../../src/services/api', () => ({
  getNbsServiceDetail: refs.getNbsServiceDetailMock,
  getNebsEntryDetail: refs.getNebsEntryDetailMock,
}));

vi.mock('../../src/context/SettingsContext', () => ({
  useSettings: () => ({
    tipiViewMode: 'chapter' as const,
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: refs.toastErrorMock,
  },
}));

type HarnessTab = {
  id: string;
  doc: ServiceDocType;
  query: string;
  data: NbsSearchResponse | NebsSearchResponse;
};

function makeTab(id: string, doc: ServiceDocType, query: string): HarnessTab {
  return {
    id,
    doc,
    query,
    data: doc === 'nbs' ? makeNbsSearch(query) : makeNebsSearch(query),
  };
}

function ServicesTabsHarness({
  initialDoc = 'nbs',
  initialQuery = '1.0101.11.00',
  onContentReady,
  onOpenDocInNewTab,
}: Readonly<{
  initialDoc?: ServiceDocType;
  initialQuery?: string;
  onContentReady?: () => void;
  onOpenDocInNewTab?: (doc: ServiceDocType, query?: string) => void;
}>) {
  const [tabs, setTabs] = useState<HarnessTab[]>([makeTab('tab-1', initialDoc, initialQuery)]);
  const [activeTabId, setActiveTabId] = useState('tab-1');
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );

  const updateActiveTab = (doc: ServiceDocType, query: string) => {
    setTabs((current) => current.map((tab) => (
      tab.id === activeTabId ? makeTab(tab.id, doc, query) : tab
    )));
  };

  return (
    <div>
      <div data-testid="tab-list" data-count={String(tabs.length)}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`tab-button-${tab.id}`}
            data-active={String(tab.id === activeTabId)}
            onClick={() => setActiveTabId(tab.id)}
          >
            {tab.doc}:{tab.query}
          </button>
        ))}
      </div>

      <div data-testid="active-tab-meta">
        {activeTab.doc}:{activeTab.query}
      </div>

      <ServicesTabContent
        doc={activeTab.doc}
        data={activeTab.data}
        onSwitchDoc={(doc, query) => updateActiveTab(doc, query || '')}
        onContentReady={onContentReady}
        onOpenDocInNewTab={onOpenDocInNewTab}
      />
    </div>
  );
}

describe('services tabs flow', () => {
  beforeEach(() => {
    refs.getNbsServiceDetailMock.mockReset();
    refs.getNebsEntryDetailMock.mockReset();
    refs.toastErrorMock.mockReset();
    refs.getNbsServiceDetailMock.mockResolvedValue(makeNbsDetail());
    refs.getNebsEntryDetailMock.mockResolvedValue(makeNebsDetail());
  });

  it('loads the first detail automatically and signals when the workspace is ready', async () => {
    const onContentReady = vi.fn();

    render(
      <ServicesTabsHarness
        initialDoc="nbs"
        initialQuery="1.0101.11.00"
        onContentReady={onContentReady}
      />,
    );

    await waitFor(() => {
      expect(refs.getNbsServiceDetailMock).toHaveBeenCalledWith('1.0101.11.00');
    });

    expect(await screen.findByText('Nota Explicativa (NEBS)')).toBeInTheDocument();
    expect(onContentReady).toHaveBeenCalledTimes(1);
  });

  it('switches from NBS results to NEBS results in the same tab', async () => {
    render(<ServicesTabsHarness initialDoc="nbs" initialQuery="1.0101.11.00" />);

    await screen.findByText('Resultados NBS');
    fireEvent.click(screen.getByRole('button', { name: 'Ver NEBS →' }));

    await waitFor(() => {
      expect(screen.getByTestId('tab-list')).toHaveAttribute('data-count', '1');
      expect(screen.getByTestId('active-tab-meta')).toHaveTextContent('nebs:1.0101.11.00');
    });
    expect(await screen.findByText('Resultados NEBS')).toBeInTheDocument();
    expect(screen.getByText('Esta subposição inclui serviços de novas construções e reparo.')).toBeInTheDocument();
  });

  it('switches back to NBS results when the user clicks the NEBS header action', async () => {
    render(<ServicesTabsHarness initialDoc="nebs" initialQuery="1.0101.11.00" />);

    await screen.findByText('Resultados NEBS');
    fireEvent.click(screen.getByRole('button', { name: '← Ver NBS' }));

    await waitFor(() => {
      expect(screen.getByTestId('tab-list')).toHaveAttribute('data-count', '1');
      expect(screen.getByTestId('active-tab-meta')).toHaveTextContent('nbs:1.0101.11.00');
    });
    expect(await screen.findByText('Resultados NBS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver NEBS →' })).toBeInTheDocument();
  });

  it('preserves the current query when toggling between NBS and NEBS results', async () => {
    render(<ServicesTabsHarness initialDoc="nbs" initialQuery="1.0101.11.00" />);

    await screen.findByText('Resultados NBS');
    fireEvent.click(screen.getByRole('button', { name: 'Ver NEBS →' }));

    await waitFor(() => {
      expect(screen.getByTestId('active-tab-meta')).toHaveTextContent('nebs:1.0101.11.00');
    });

    fireEvent.click(screen.getByRole('button', { name: '← Ver NBS' }));

    await waitFor(() => {
      expect(screen.getByTestId('active-tab-meta')).toHaveTextContent('nbs:1.0101.11.00');
    });
  });

  it('opens the related service in a new tab when the action is available', async () => {
    const onOpenDocInNewTab = vi.fn();

    render(
      <ServicesTabsHarness
        initialDoc="nebs"
        initialQuery="1.0101.11.00"
        onOpenDocInNewTab={onOpenDocInNewTab}
      />,
    );

    await screen.findByRole('button', { name: 'Abrir NBS em nova aba' });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir NBS em nova aba' }));

    expect(onOpenDocInNewTab).toHaveBeenCalledWith('nbs', '1.0101.11.00');
  });

  it('maps detail failures with the shared catalog copy instead of a generic toast', async () => {
    refs.getNbsServiceDetailMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 503 },
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(<ServicesTabsHarness initialDoc="nbs" initialQuery="1.0101.11.00" />);

      await waitFor(() => {
        expect(refs.toastErrorMock).toHaveBeenCalledWith(
          'Catálogo de serviços indisponível no momento. Tente novamente em instantes.',
        );
      });

      expect(screen.getByText('Selecione um servico')).toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
