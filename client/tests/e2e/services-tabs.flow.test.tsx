import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServicesTabContent } from '../../src/components/ServicesTabContent';
import {
  makeNbsDetail,
  makeNbsSearch,
} from '../playwright/fixtures/service-mocks';
import type {
  NbsSearchResponse,
  ServiceDocType,
} from '../../src/types/api.types';

const refs = vi.hoisted(() => ({
  getNbsServiceDetailPageMock: vi.fn(),
  getNbsServiceTreePageMock: vi.fn(),
  getNbsDetailLocalMock: vi.fn(),
  toastErrorMock: vi.fn(),
  openNewTab: false,
}));

vi.mock('../../src/services/api', () => ({
  getNbsServiceDetailPage: refs.getNbsServiceDetailPageMock,
  getNbsServiceTreePage: refs.getNbsServiceTreePageMock,
}));

vi.mock('../../src/context/SettingsContext', () => ({
  useSettings: () => ({
    openNewTab: refs.openNewTab,
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: refs.toastErrorMock,
  },
}));

vi.mock('../../src/context/LocalDatabaseContext', () => ({
  useLocalDatabase: () => ({
    status: 'ready',
    searchLocal: vi.fn().mockResolvedValue(null),
    getNbsDetailLocal: refs.getNbsDetailLocalMock,
    progress: 0,
    progressStep: '',
    localVersion: null,
    remoteVersion: null,
    updateAvailable: false,
    error: null,
    dbSizeBytes: null,
    isSupported: false,
    install: vi.fn(),
    remove: vi.fn(),
    refreshAvailability: vi.fn().mockResolvedValue(null),
  }),
}));

type HarnessTab = {
  id: string;
  doc: ServiceDocType;
  query: string;
  data: NbsSearchResponse;
};

function makeTab(id: string, doc: ServiceDocType, query: string): HarnessTab {
  return {
    id,
    doc,
    query,
    data: makeNbsSearch(query),
  };
}

async function findInlineServiceCode(container: HTMLElement, code: string): Promise<HTMLElement> {
  const selector = `[data-testid="notes-content"] [data-service-code="${code}"]`;
  await waitFor(() => {
    const element = container.querySelector(selector);
    expect(element).toBeInstanceOf(HTMLElement);
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const noteCodeLink = container.querySelector(selector);
  if (!(noteCodeLink instanceof HTMLElement)) {
    throw new Error(`Expected service code link ${code} inside inline explanatory note`);
  }

  return noteCodeLink;
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
    refs.getNbsServiceDetailPageMock.mockReset();
    refs.getNbsServiceTreePageMock.mockReset();
    refs.getNbsDetailLocalMock.mockReset();
    refs.toastErrorMock.mockReset();
    refs.openNewTab = false;
    refs.getNbsDetailLocalMock.mockResolvedValue(makeNbsDetail());
    refs.getNbsServiceDetailPageMock.mockResolvedValue(makeNbsDetail());
    refs.getNbsServiceTreePageMock.mockResolvedValue({
      success: true,
      item: makeNbsDetail().item,
      chapter_root: makeNbsDetail().chapter_root,
      chapter_page: {
        items: makeNbsDetail().chapter_items || [],
        page: 1,
        page_size: 50,
        total: makeNbsDetail().chapter_items?.length || 0,
        has_more: false,
      },
    });
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
      expect(refs.getNbsDetailLocalMock).toHaveBeenCalledWith('1.0101.11.00', {
        page: 1,
        pageSize: 50,
      });
    });

    expect(await screen.findByText('NOTAS EXPLICATIVAS')).toBeInTheDocument();
    expect(onContentReady).toHaveBeenCalledTimes(1);
  });

  it('keeps service-code navigation from inline explanatory notes inside the NBS tab', async () => {
    const detail = makeNbsDetail();
    refs.getNbsDetailLocalMock.mockResolvedValue({
      ...detail,
      nebs: {
        ...detail.nebs!,
        body_markdown: null,
        body_text: 'Ver detalhes em 1.1703.2.',
      },
    });

    const { container } = render(<ServicesTabsHarness initialDoc="nbs" initialQuery="1.0101.11.00" />);

    const noteCodeLink = await findInlineServiceCode(container, '1.1703.2');
    fireEvent.click(noteCodeLink, { bubbles: true });

    await waitFor(() => {
      expect(screen.getByTestId('tab-list')).toHaveAttribute('data-count', '1');
      expect(screen.getByTestId('active-tab-meta')).toHaveTextContent('nbs:1.1703.2');
    });
  });

  it('opens service-code navigation from inline explanatory notes in a new tab when preference is enabled', async () => {
    const onOpenDocInNewTab = vi.fn();
    const detail = makeNbsDetail();
    refs.openNewTab = true;
    refs.getNbsDetailLocalMock.mockResolvedValue({
      ...detail,
      nebs: {
        ...detail.nebs!,
        body_markdown: null,
        body_text: 'Ver detalhes em 1.1703.2.',
      },
    });

    const { container } = render(
      <ServicesTabsHarness
        initialDoc="nbs"
        initialQuery="1.0101.11.00"
        onOpenDocInNewTab={onOpenDocInNewTab}
      />,
    );

    const noteCodeLink = await findInlineServiceCode(container, '1.1703.2');
    fireEvent.click(noteCodeLink, { bubbles: true, ctrlKey: true });

    await waitFor(() => {
      expect(onOpenDocInNewTab).toHaveBeenCalledWith('nbs', '1.1703.2');
    });
    expect(screen.getByTestId('active-tab-meta')).toHaveTextContent('nbs:1.0101.11.00');
  });

  it('maps local detail failures with local installation guidance', async () => {
    refs.getNbsDetailLocalMock.mockResolvedValue(null);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(<ServicesTabsHarness initialDoc="nbs" initialQuery="1.0101.11.00" />);

      await waitFor(() => {
        expect(refs.toastErrorMock).toHaveBeenCalledWith(
          'Instale a base NBS para abrir detalhes e hierarquia localmente.',
        );
      });

      expect(screen.getByText('Selecione um servico')).toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
