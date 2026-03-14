import type { Page } from '@playwright/test';

import type {
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
    chapter_root: root,
    chapter_items: [root, parent, leaf],
    nebs: {
      code: leaf.code,
      code_clean: leaf.code_clean,
      title: leaf.description,
      title_normalized: 'servicos de construcao de edificacoes residenciais de um e dois pavimentos',
      body_text: 'Conteudo da nota',
      body_markdown: 'Conteudo da nota',
      body_normalized: 'conteudo da nota',
      section_title: 'SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO',
      page_start: 12,
      page_end: 13,
    },
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
    entry: {
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
    },
  };
}

export async function installServicesMock(page: Page, options: ServicesMockOptions = {}) {
  const nbsQueue = [...(options.nbsSearchResponses ?? [])];
  const nebsQueue = [...(options.nebsSearchResponses ?? [])];

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const query = url.searchParams.get('q') ?? '';
    const trimmedQuery = query.trim();

    if (path.endsWith('/services/nbs/search')) {
      const next = trimmedQuery ? nbsQueue.shift() : undefined;
      if (next?.abort) {
        await route.abort('failed');
        return;
      }

      await route.fulfill({
        status: next?.status ?? 200,
        contentType: 'application/json',
        body: JSON.stringify(next?.body ?? (trimmedQuery ? makeNbsSearch(query) : makeEmptySearchResponse(query))),
      });
      return;
    }

    if (path.endsWith('/services/nebs/search')) {
      const next = trimmedQuery ? nebsQueue.shift() : undefined;
      if (next?.abort) {
        await route.abort('failed');
        return;
      }

      await route.fulfill({
        status: next?.status ?? 200,
        contentType: 'application/json',
        body: JSON.stringify(next?.body ?? (trimmedQuery ? makeNebsSearch(query) : makeEmptySearchResponse(query))),
      });
      return;
    }

    if (path.includes('/services/nbs/')) {
      const code = decodeURIComponent(path.split('/services/nbs/')[1]);
      await route.fulfill({ json: makeNbsDetail(code) });
      return;
    }

    if (path.includes('/services/nebs/')) {
      const code = decodeURIComponent(path.split('/services/nebs/')[1]);
      await route.fulfill({ json: makeNebsDetail(code) });
      return;
    }

    if (options.unmatchedApiStrategy === 'continue') {
      await route.continue();
      return;
    }

    await route.abort('failed');
  });
}
