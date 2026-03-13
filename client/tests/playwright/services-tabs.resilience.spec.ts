import { expect, Page, test } from '@playwright/test';

function makeNbsSearch(query = '1.0101.11.00') {
  const code = query || '1.0101.11.00';
  return {
    success: true,
    query: code,
    normalized: code,
    results: [
      {
        code,
        code_clean: code.replace(/\D/g, ''),
        description: `Servico ${code}`,
        parent_code: '1.0101.1',
        level: 3,
        has_nebs: true,
      },
    ],
    total: 1,
  };
}

function makeNebsSearch(query = '1.0101.11.00') {
  const code = query || '1.0101.11.00';
  return {
    success: true,
    query: code,
    normalized: code,
    results: [
      {
        code,
        title: `Nota ${code}`,
        excerpt: `Resumo ${code}`,
        page_start: 12,
        page_end: 13,
        section_title: 'SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO',
      },
    ],
    total: 1,
  };
}

function makeNbsDetail(code = '1.0101.11.00') {
  return {
    success: true,
    item: {
      code,
      code_clean: code.replace(/\D/g, ''),
      description: `Servico ${code}`,
      parent_code: '1.0101.1',
      level: 3,
      has_nebs: true,
    },
    ancestors: [
      {
        code: '1.01',
        code_clean: '101',
        description: 'Serviços de construção',
        parent_code: null,
        level: 0,
        has_nebs: false,
      },
      {
        code: '1.0101',
        code_clean: '10101',
        description: 'Serviços de construção de edificações',
        parent_code: '1.01',
        level: 1,
        has_nebs: false,
      },
    ],
    children: [],
    chapter_root: {
      code: '1.0101',
      code_clean: '10101',
      description: 'Serviços de construção de edificações',
      parent_code: '1.01',
      level: 1,
      has_nebs: false,
    },
    chapter_items: [
      {
        code: '1.0101',
        code_clean: '10101',
        description: 'Serviços de construção de edificações',
        parent_code: '1.01',
        level: 1,
        has_nebs: false,
      },
      {
        code,
        code_clean: code.replace(/\D/g, ''),
        description: `Servico ${code}`,
        parent_code: '1.0101',
        level: 3,
        has_nebs: true,
      },
    ],
    nebs: {
      code,
      code_clean: code.replace(/\D/g, ''),
      title: `Nota ${code}`,
      title_normalized: `nota ${code}`,
      body_text: `Conteudo ${code}`,
      body_markdown: `Conteudo ${code}`,
      body_normalized: `conteudo ${code}`,
      section_title: 'SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO',
      page_start: 12,
      page_end: 13,
    },
  };
}

function makeNebsDetail(code = '1.0101.11.00') {
  return {
    success: true,
    item: {
      code,
      code_clean: code.replace(/\D/g, ''),
      description: `Servico ${code}`,
      parent_code: '1.0101.1',
      level: 3,
      has_nebs: true,
    },
    ancestors: [
      {
        code: '1.01',
        code_clean: '101',
        description: 'Serviços de construção',
        parent_code: null,
        level: 0,
        has_nebs: false,
      },
      {
        code: '1.0101',
        code_clean: '10101',
        description: 'Serviços de construção de edificações',
        parent_code: '1.01',
        level: 1,
        has_nebs: false,
      },
    ],
    entry: {
      code,
      code_clean: code.replace(/\D/g, ''),
      title: `Nota ${code}`,
      title_normalized: `nota ${code}`,
      body_text: `Conteudo ${code}`,
      body_markdown: `Conteudo ${code}`,
      body_normalized: `conteudo ${code}`,
      section_title: 'SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO',
      page_start: 12,
      page_end: 13,
    },
  };
}

async function installServicesMock(page: Page, options?: {
  nbsSearchResponses?: Array<{ status?: number; body?: unknown; abort?: boolean }>;
  nebsSearchResponses?: Array<{ status?: number; body?: unknown; abort?: boolean }>;
}) {
  const nbsQueue = [...(options?.nbsSearchResponses || [])];
  const nebsQueue = [...(options?.nebsSearchResponses || [])];

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const q = url.searchParams.get('q') || '';

    if (path.endsWith('/services/nbs/search')) {
      const next = nbsQueue.shift();
      if (next?.abort) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({
        status: next?.status || 200,
        contentType: 'application/json',
        body: JSON.stringify(next?.body ?? makeNbsSearch(q)),
      });
      return;
    }

    if (path.endsWith('/services/nebs/search')) {
      const next = nebsQueue.shift();
      if (next?.abort) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({
        status: next?.status || 200,
        contentType: 'application/json',
        body: JSON.stringify(next?.body ?? makeNebsSearch(q)),
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

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });
}

async function openServices(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Serviços \(NBS\)/ }).click();
}

async function searchCurrentTab(page: Page, query: string) {
  await page.locator('#ncmInput').fill(query);
  await page.getByRole('button', { name: /Buscar/ }).click();
}

test('keeps the current NBS content when switching to NEBS fails', async ({ page }) => {
  await installServicesMock(page, {
    nebsSearchResponses: [{ abort: true }],
  });

  await openServices(page);
  await searchCurrentTab(page, '1.0101.11.00');
  await expect(page.getByText('Servico 1.0101.11.00')).toBeVisible();

  await page.getByRole('button', { name: 'Ver na aba NEBS' }).click();

  await expect(page.locator('[data-document="nbs"]')).toHaveCount(1);
  await expect(page.locator('[data-document="nebs"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Estrutura completa' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Servico 1.0101.11.00' })).toBeVisible();
});

test('shows an error after a failed search and recovers on retry', async ({ page }) => {
  await installServicesMock(page, {
    nbsSearchResponses: [
      { abort: true },
      { body: makeNbsSearch('1.0101.12.00') },
    ],
  });

  await openServices(page);
  await searchCurrentTab(page, '1.0101.12.00');

  await expect(page.getByRole('heading', { name: 'Erro' })).toBeVisible();
  await expect(page.getByText(/Não foi possível conectar à API|Erro ao buscar dados|Tempo limite na requisição/).first()).toBeVisible();

  await searchCurrentTab(page, '1.0101.12.00');
  await expect(page.getByText('Servico 1.0101.12.00')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Erro' })).toHaveCount(0);
});

test('covers empty states for NBS and NEBS searches', async ({ page }) => {
  await installServicesMock(page, {
    nbsSearchResponses: [{ body: { success: true, query: 'sem resultado', normalized: 'sem resultado', results: [], total: 0 } }],
    nebsSearchResponses: [{ body: { success: true, query: 'sem nota', normalized: 'sem nota', results: [], total: 0 } }],
  });

  await openServices(page);
  await searchCurrentTab(page, 'sem resultado');
  await expect(page.getByText('Nenhum servico encontrado')).toBeVisible();

  await page.getByRole('button', { name: '+' }).click();
  await page.getByRole('button', { name: 'NEBS', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Pronto para buscar' })).toBeVisible();

  await searchCurrentTab(page, 'sem nota');
  await expect(page.getByText('Nenhuma nota encontrada')).toBeVisible();
});

test('preserves content across multiple open service tabs', async ({ page }) => {
  await installServicesMock(page);

  await openServices(page);
  await searchCurrentTab(page, '1.0101.11.00');
  await expect(page.getByText('Servico 1.0101.11.00')).toBeVisible();

  await page.getByRole('button', { name: '+' }).click();
  await searchCurrentTab(page, '1.0101.12.00');
  await expect(page.getByText('Servico 1.0101.12.00')).toBeVisible();

  await page.locator('[data-document="nbs"]').first().click();
  await page.getByRole('button', { name: 'Ver NEBS' }).click();
  await expect(page.locator('[data-document]')).toHaveCount(3);
  await expect(page.locator('[data-document="nebs"]')).toHaveCount(1);
  await expect(page.getByText('Conteudo da nota')).toBeVisible();

  await page.locator('[data-document="nbs"]').first().click();
  await expect(page.getByRole('heading', { name: 'Servico 1.0101.11.00' })).toBeVisible();

  await page.locator('[data-document="nebs"]').click();
  await expect(page.getByRole('heading', { name: 'Nota 1.0101.11.00' })).toBeVisible();

  await page.locator('[data-document="nbs"]').nth(1).click();
  await expect(page.getByRole('heading', { name: 'Servico 1.0101.12.00' })).toBeVisible();
});
