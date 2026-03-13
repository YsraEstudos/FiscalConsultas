import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServicesTabContent } from '../../src/components/ServicesTabContent';
import type {
  NbsDetailResponse,
  NbsSearchResponse,
  NbsServiceItem,
  NebsDetailResponse,
  NebsSearchResponse,
  ServiceDocType,
} from '../../src/types/api.types';

const refs = vi.hoisted(() => ({
  getNbsServiceDetailMock: vi.fn(),
  getNebsEntryDetailMock: vi.fn(),
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
    error: vi.fn(),
  },
}));

function makeItem(overrides: Partial<NbsServiceItem> = {}): NbsServiceItem {
  return {
    code: '1.0101.11.00',
    code_clean: '10101100',
    description: 'Serviços de construção de edificações residenciais de um e dois pavimentos',
    parent_code: '1.0101.1',
    level: 3,
    has_nebs: true,
    ...overrides,
  };
}

function makeNbsSearch(query = '1.0101.11.00'): NbsSearchResponse {
  return {
    success: true,
    query,
    normalized: query,
    results: [makeItem({ code: query, code_clean: query.replace(/\D/g, '') || '10101100' })],
    total: 1,
  };
}

function makeNebsSearch(query = '1.0101.11.00'): NebsSearchResponse {
  return {
    success: true,
    query,
    normalized: query,
    results: [{
      code: query,
      title: 'Serviços de construção de edificações residenciais de um e dois pavimentos',
      excerpt: 'Esta subposição inclui serviços de novas construções e reparo.',
      page_start: 12,
      page_end: 13,
      section_title: 'SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO',
    }],
    total: 1,
  };
}

function makeNbsDetail(code = '1.0101.11.00'): NbsDetailResponse {
  const root = makeItem({
    code: '1.0101',
    code_clean: '10101',
    description: 'Serviços de construção de edificações',
    parent_code: '1.01',
    level: 1,
    has_nebs: false,
  });
  const parent = makeItem({
    code: '1.0101.1',
    code_clean: '101011',
    description: 'Serviços de construção de edificações residenciais',
    parent_code: '1.0101',
    level: 2,
    has_nebs: false,
  });
  const leaf = makeItem({
    code,
    code_clean: code.replace(/\D/g, ''),
    has_nebs: true,
  });

  return {
    success: true,
    item: leaf,
    ancestors: [
      makeItem({
        code: '1.01',
        code_clean: '101',
        description: 'Serviços de construção',
        parent_code: null,
        level: 0,
        has_nebs: false,
      }),
      root,
      parent,
    ],
    children: [],
    chapter_root: root,
    chapter_items: [root, parent, leaf],
    nebs: {
      code: leaf.code,
      code_clean: leaf.code_clean,
      title: leaf.description,
      title_normalized: 'servicos de construcao de edificacoes residenciais de um e dois pavimentos',
      body_text: 'Esta subposição inclui serviços de novas construções e reparo.',
      body_markdown: 'Esta subposição inclui serviços de novas construções e reparo.',
      body_normalized: 'esta subposicao inclui servicos de novas construcoes e reparo',
      section_title: 'SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO',
      page_start: 12,
      page_end: 13,
    },
  };
}

function makeNebsDetail(code = '1.0101.11.00'): NebsDetailResponse {
  return {
    success: true,
    item: makeItem({
      code,
      code_clean: code.replace(/\D/g, ''),
    }),
    ancestors: [
      makeItem({
        code: '1.01',
        code_clean: '101',
        description: 'Serviços de construção',
        parent_code: null,
        level: 0,
        has_nebs: false,
      }),
      makeItem({
        code: '1.0101',
        code_clean: '10101',
        description: 'Serviços de construção de edificações',
        parent_code: '1.01',
        level: 1,
        has_nebs: false,
      }),
      makeItem({
        code: '1.0101.1',
        code_clean: '101011',
        description: 'Serviços de construção de edificações residenciais',
        parent_code: '1.0101',
        level: 2,
        has_nebs: false,
      }),
    ],
    entry: {
      code,
      code_clean: code.replace(/\D/g, ''),
      title: 'Serviços de construção de edificações residenciais de um e dois pavimentos',
      title_normalized: 'servicos de construcao de edificacoes residenciais de um e dois pavimentos',
      body_text: 'Esta subposição inclui serviços de novas construções e reparo.',
      body_markdown: 'Esta subposição inclui serviços de novas construções e reparo.',
      body_normalized: 'esta subposicao inclui servicos de novas construcoes e reparo',
      section_title: 'SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO',
      page_start: 12,
      page_end: 13,
    },
  };
}

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
}: {
  initialDoc?: ServiceDocType;
  initialQuery?: string;
}) {
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

  const openInNewTab = (doc: ServiceDocType, query: string) => {
    const nextId = `tab-${tabs.length + 1}`;
    setTabs((current) => [...current, makeTab(nextId, doc, query)]);
    setActiveTabId(nextId);
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
        onContentReady={() => {}}
        onSwitchDoc={(doc, query) => updateActiveTab(doc, query || '')}
        onOpenDocInNewTab={(doc, query) => openInNewTab(doc, query || '')}
      />
    </div>
  );
}

describe('services tabs flow', () => {
  beforeEach(() => {
    refs.getNbsServiceDetailMock.mockReset();
    refs.getNebsEntryDetailMock.mockReset();
    refs.getNbsServiceDetailMock.mockImplementation(async (code: string) => makeNbsDetail(code));
    refs.getNebsEntryDetailMock.mockImplementation(async (code: string) => makeNebsDetail(code));
  });

  it('opens NEBS in a new tab from the inline hierarchy action and keeps the original NBS tab intact', async () => {
    render(<ServicesTabsHarness initialDoc="nbs" initialQuery="1.0101.11.00" />);

    await screen.findByText('Estrutura completa');
    fireEvent.click(screen.getByText('Ver NEBS'));

    await waitFor(() => {
      expect(screen.getByTestId('tab-list')).toHaveAttribute('data-count', '2');
    });
    expect(screen.getByTestId('active-tab-meta')).toHaveTextContent('nebs:1.0101.11.00');
    expect(await screen.findByText('Conteudo da nota')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tab-button-tab-1'));

    await waitFor(() => {
      expect(screen.getByTestId('active-tab-meta')).toHaveTextContent('nbs:1.0101.11.00');
    });
    expect(screen.getByText('Estrutura completa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver na aba NEBS' })).toBeInTheDocument();
  });

  it('reuses the same tab when opening NEBS through the primary NBS action', async () => {
    render(<ServicesTabsHarness initialDoc="nbs" initialQuery="1.0101.11.00" />);

    await screen.findByText('Nota explicativa publicada');
    fireEvent.click(screen.getByRole('button', { name: 'Ver na aba NEBS' }));

    await waitFor(() => {
      expect(screen.getByTestId('tab-list')).toHaveAttribute('data-count', '1');
      expect(screen.getByTestId('active-tab-meta')).toHaveTextContent('nebs:1.0101.11.00');
    });
    expect(await screen.findByText('Conteudo da nota')).toBeInTheDocument();
  });

  it('switches back to NBS in the same tab when the user clicks the NEBS breadcrumb code', async () => {
    render(<ServicesTabsHarness initialDoc="nebs" initialQuery="1.0101.11.00" />);

    await screen.findByText('Conteudo da nota');
    fireEvent.click(screen.getByRole('button', { name: '1.0101.11.00' }));

    await waitFor(() => {
      expect(screen.getByTestId('tab-list')).toHaveAttribute('data-count', '1');
      expect(screen.getByTestId('active-tab-meta')).toHaveTextContent('nbs:1.0101.11.00');
    });
    expect(await screen.findByText('Estrutura completa')).toBeInTheDocument();
  });
});
