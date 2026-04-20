import type { Page, Route } from '@playwright/test';

import type {
  ChapterData,
  ChapterPosition,
  CodeSearchResponse,
  NebsEntry,
  NebsDetailResponse,
  NebsSearchResponse,
  NbsDetailResponse,
  NbsSearchResponse,
  NbsServiceItem,
  TipiCodeSearchResponse,
  TipiChapterData,
  TipiPosition,
} from '../../../src/types/api.types';

type MockResponseEntry = {
  abort?: boolean;
  body?: unknown;
  status?: number;
};

type MockResponseQueue = MockResponseEntry[];

export type ServicesMockOptions = {
  neshSearchResponses?: MockResponseEntry[];
  nebsSearchResponses?: MockResponseEntry[];
  nbsSearchResponses?: MockResponseEntry[];
  tipiSearchResponses?: MockResponseEntry[];
  statusResponses?: MockResponseEntry[];
  nbsDetailResponses?: Record<string, NbsDetailResponse>;
  nebsDetailResponses?: Record<string, NebsDetailResponse>;
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

function makeOnlineStatusResponse() {
  return {
    status: 'online',
    database: { status: 'online', latency_ms: 1 },
    tipi: { status: 'online' },
    nbs: { status: 'online' },
    nebs: { status: 'online' },
    catalogs: {
      nesh: { status: 'online', latency_ms: 1 },
      tipi: { status: 'online' },
      nbs: { status: 'online' },
      nebs: { status: 'online' },
    },
  };
}

function makeItem(code = '1.0101.11.00', overrides: Partial<NbsServiceItem> = {}): NbsServiceItem {
  return {
    code,
    code_clean: code.replaceAll(/\D/g, ''),
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
    code_clean: code.replaceAll(/\D/g, ''),
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
    source_hash: `fixture-${code.replaceAll(/\D/g, '')}`,
    updated_at: '2026-03-13T00:00:00.000Z',
  };
}

function makeTipiSearchResponse(query = '11'): TipiCodeSearchResponse {
  return {
    success: true,
    type: 'code',
    query,
    results: {},
    total: 0,
    total_capitulos: 0,
  };
}

function makeNeshCodeSearchResponse(query = '8404'): CodeSearchResponse {
  return {
    success: true,
    type: 'code',
    query,
    normalized: null,
    results: {},
    total_capitulos: 0,
  };
}

export function makeNeshChapterData(
  capitulo: string,
  posicoes: ChapterPosition[],
  overrides: Partial<ChapterData> = {},
): ChapterData {
  return {
    ncm_buscado: capitulo,
    capitulo,
    posicao_alvo: null,
    posicoes,
    notas_gerais: null,
    notas_parseadas: {},
    conteudo: '',
    real_content_found: false,
    erro: null,
    ...overrides,
  };
}

export function makeTipiChapterData(
  capitulo: string,
  posicoes: TipiPosition[],
  overrides: Partial<TipiChapterData> = {},
): TipiChapterData {
  return {
    capitulo,
    titulo: `Capítulo ${capitulo}`,
    notas_gerais: null,
    posicao_alvo: null,
    posicoes,
    ...overrides,
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
    code_clean: code.replaceAll(/\D/g, ''),
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
    chapter_root: root,
    chapter_items: [root, parent, leaf],
    chapter_page: {
      items: [root, parent, leaf],
      page: 1,
      page_size: 50,
      total: 3,
      has_more: false,
    },
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

async function fulfillSearchRoute<TResponse>(
  route: Route,
  query: string,
  queue: MockResponseQueue,
  makeResponse: (requestedQuery: string) => TResponse,
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

async function handleTipiSearch(route: Route, query: string, tipiQueue: MockResponseQueue) {
  await fulfillSearchRoute(route, query, tipiQueue, makeTipiSearchResponse);
}

async function handleNeshSearch(route: Route, query: string, neshQueue: MockResponseQueue) {
  await fulfillSearchRoute(route, query, neshQueue, makeNeshCodeSearchResponse);
}

async function handleNbsDetail(
  route: Route,
  code: string,
  detailResponses: Record<string, NbsDetailResponse>,
) {
  await route.fulfill({ json: detailResponses[code] ?? makeNbsDetail(code) });
}

async function handleNebsDetail(
  route: Route,
  code: string,
  detailResponses: Record<string, NebsDetailResponse>,
) {
  await route.fulfill({ json: detailResponses[code] ?? makeNebsDetail(code) });
}

function getDetailCode(path: string, doc: 'nbs' | 'nebs'): string | null {
  const match = new RegExp(`^/api/services/${doc}/([^/]+)$`).exec(path);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function installServicesMock(page: Page, options: ServicesMockOptions = {}) {
  const neshQueue = [...(options.neshSearchResponses ?? [])];
  const nbsQueue = [...(options.nbsSearchResponses ?? [])];
  const nebsQueue = [...(options.nebsSearchResponses ?? [])];
  const tipiQueue = [...(options.tipiSearchResponses ?? [])];
  const statusQueue = [...(options.statusResponses ?? [])];
  const nbsDetailResponses = options.nbsDetailResponses ?? {};
  const nebsDetailResponses = options.nebsDetailResponses ?? {};

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const isCodeCatalogSearch = path.endsWith('/tipi/search') || (path.endsWith('/search') && !path.includes('/services/'));
    const queryParam = isCodeCatalogSearch ? 'ncm' : 'q';
    const query = url.searchParams.get(queryParam) ?? '';

    if (path.endsWith('/status')) {
      const next = statusQueue.shift();
      if (next?.abort) {
        await route.abort('failed');
        return;
      }

      await route.fulfill({
        status: next?.status ?? 200,
        contentType: 'application/json',
        body: JSON.stringify(next?.body ?? makeOnlineStatusResponse()),
      });
      return;
    }

    if (path.endsWith('/services/nbs/search')) {
      await handleNbsSearch(route, query, nbsQueue);
      return;
    }

    if (path.endsWith('/services/nebs/search')) {
      await handleNebsSearch(route, query, nebsQueue);
      return;
    }

    if (path.endsWith('/tipi/search')) {
      await handleTipiSearch(route, query, tipiQueue);
      return;
    }

    if (path.endsWith('/search') && !path.includes('/services/')) {
      await handleNeshSearch(route, query, neshQueue);
      return;
    }

    const nbsCode = getDetailCode(path, 'nbs');
    if (nbsCode) {
      await handleNbsDetail(route, nbsCode, nbsDetailResponses);
      return;
    }

    const nebsCode = getDetailCode(path, 'nebs');
    if (nebsCode) {
      await handleNebsDetail(route, nebsCode, nebsDetailResponses);
      return;
    }

    if (options.unmatchedApiStrategy === 'continue') {
      await route.continue();
      return;
    }

    await route.abort('failed');
  });
}
