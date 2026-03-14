import type { Page, Route } from '@playwright/test';

import type {
  NebsEntry,
  NebsDetailResponse,
  NebsSearchResponse,
  NbsDetailResponse,
  NbsSearchResponse,
  NbsServiceItem,
} from '../../../src/types/api.types';

type MockResponseEntry = {
  abort?: boolean;
  body?: unknown;
  status?: number;
};

type MockResponseQueue = MockResponseEntry[];

export type ServicesMockOptions = {
  nebsSearchResponses?: MockResponseEntry[];
  nbsSearchResponses?: MockResponseEntry[];
  unmatchedApiStrategy?: 'abort' | 'continue';
};

function makeEmptySearchResponse(query = '') {
  return {
    success: true,
    query,
    normalized: query,
    results: [],
    total: 0,
  };
}

function makeItem(code = '1.0101.11.00', overrides: Partial<NbsServiceItem> = {}): NbsServiceItem {
  return {
    code,
    code_clean: code.replace(/\D/g, ''),
    description: 'Serviços de construção de edificações residenciais de um e dois pavimentos',
    parent_code: '1.0101.1',
    level: 3,
    has_nebs: true,
    ...overrides,
  };
}

function makeNebsEntry(code = '1.0101.11.00'): NebsEntry {
  return {
    code,
    code_clean: code.replace(/\D/g, ''),
    title: 'Serviços de construção de edificações residenciais de um e dois pavimentos',
    title_normalized: 'servicos de construcao de edificacoes residenciais de um e dois pavimentos',
    body_text: 'Conteudo da nota',
    body_markdown: 'Conteudo da nota',
    body_normalized: 'conteudo da nota',
    section_title: 'SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO',
    page_start: 12,
    page_end: 13,
    parser_status: 'trusted',
    parse_warnings: null,
    source_hash: `fixture-${code.replace(/\D/g, '')}`,
    updated_at: '2026-03-13T00:00:00.000Z',
  };
}

export function makeNbsSearch(query = '1.0101.11.00'): NbsSearchResponse {
  return {
    success: true,
    query,
    normalized: query,
    results: [makeItem(query)],
    total: 1,
  };
}

export function makeNebsSearch(query = '1.0101.11.00'): NebsSearchResponse {
  return {
    success: true,
    query,
    normalized: query,
    results: [
      {
        code: query,
        title: 'Serviços de construção de edificações residenciais de um e dois pavimentos',
        excerpt: 'Esta subposição inclui serviços de novas construções e reparo.',
        page_start: 12,
        page_end: 13,
        section_title: 'SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO',
      },
    ],
    total: 1,
  };
}

export function makeNbsDetail(code = '1.0101.11.00'): NbsDetailResponse {
  const root = makeItem('1.0101', {
    code_clean: '10101',
    description: 'Serviços de construção de edificações',
    parent_code: '1.01',
    level: 1,
    has_nebs: false,
  });
  const parent = makeItem('1.0101.1', {
    code_clean: '101011',
    description: 'Serviços de construção de edificações residenciais',
    parent_code: '1.0101',
    level: 2,
    has_nebs: false,
  });
  const leaf = makeItem(code, {
    code_clean: code.replace(/\D/g, ''),
  });

  return {
    success: true,
    item: leaf,
    ancestors: [
      makeItem('1.01', {
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
    nebs: makeNebsEntry(leaf.code),
  };
}

export function makeNebsDetail(code = '1.0101.11.00'): NebsDetailResponse {
  return {
    success: true,
    item: makeItem(code),
    ancestors: [
      makeItem('1.01', {
        code_clean: '101',
        description: 'Serviços de construção',
        parent_code: null,
        level: 0,
        has_nebs: false,
      }),
      makeItem('1.0101', {
        code_clean: '10101',
        description: 'Serviços de construção de edificações',
        parent_code: '1.01',
        level: 1,
        has_nebs: false,
      }),
      makeItem('1.0101.1', {
        code_clean: '101011',
        description: 'Serviços de construção de edificações residenciais',
        parent_code: '1.0101',
        level: 2,
        has_nebs: false,
      }),
    ],
    entry: makeNebsEntry(code),
  };
}

async function fulfillSearchRoute(
  route: Route,
  query: string,
  queue: MockResponseQueue,
  makeResponse: (requestedQuery: string) => NbsSearchResponse | NebsSearchResponse,
) {
  const trimmedQuery = query.trim();
  const next = trimmedQuery ? queue.shift() : undefined;
  if (next?.abort) {
    await route.abort('failed');
    return;
  }

  await route.fulfill({
    status: next?.status ?? 200,
    contentType: 'application/json',
    body: JSON.stringify(next?.body ?? (trimmedQuery ? makeResponse(trimmedQuery) : makeEmptySearchResponse(trimmedQuery))),
  });
}

async function handleNbsSearch(route: Route, query: string, nbsQueue: MockResponseQueue) {
  await fulfillSearchRoute(route, query, nbsQueue, makeNbsSearch);
}

async function handleNebsSearch(route: Route, query: string, nebsQueue: MockResponseQueue) {
  await fulfillSearchRoute(route, query, nebsQueue, makeNebsSearch);
}

async function handleNbsDetail(route: Route, code: string) {
  await route.fulfill({ json: makeNbsDetail(code) });
}

async function handleNebsDetail(route: Route, code: string) {
  await route.fulfill({ json: makeNebsDetail(code) });
}

function getDetailCode(path: string, doc: 'nbs' | 'nebs'): string | null {
  const match = path.match(new RegExp(`^/api/services/${doc}/([^/]+)$`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function installServicesMock(page: Page, options: ServicesMockOptions = {}) {
  const nbsQueue = [...(options.nbsSearchResponses ?? [])];
  const nebsQueue = [...(options.nebsSearchResponses ?? [])];

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const query = url.searchParams.get('q') ?? '';

    if (path.endsWith('/services/nbs/search')) {
      await handleNbsSearch(route, query, nbsQueue);
      return;
    }

    if (path.endsWith('/services/nebs/search')) {
      await handleNebsSearch(route, query, nebsQueue);
      return;
    }

    const nbsCode = getDetailCode(path, 'nbs');
    if (nbsCode) {
      await handleNbsDetail(route, nbsCode);
      return;
    }

    const nebsCode = getDetailCode(path, 'nebs');
    if (nebsCode) {
      await handleNebsDetail(route, nebsCode);
      return;
    }

    if (options.unmatchedApiStrategy === 'continue') {
      await route.continue();
      return;
    }

    await route.abort('failed');
  });
}
