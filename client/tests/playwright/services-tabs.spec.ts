import { expect, Page, test } from '@playwright/test';

function makeNbsSearch(query = '1.0101.11.00') {
  return {
    success: true,
    query,
    normalized: query,
    results: [
      {
        code: query,
        code_clean: query.replace(/\D/g, ''),
        description: 'Serviços de construção de edificações residenciais de um e dois pavimentos',
        parent_code: '1.0101.1',
        level: 3,
        has_nebs: true,
      },
    ],
    total: 1,
  };
}

function makeNebsSearch(query = '1.0101.11.00') {
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

function makeNbsDetail(code = '1.0101.11.00') {
  return {
    success: true,
    item: {
      code,
      code_clean: code.replace(/\D/g, ''),
      description: 'Serviços de construção de edificações residenciais de um e dois pavimentos',
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
      {
        code: '1.0101.1',
        code_clean: '101011',
        description: 'Serviços de construção de edificações residenciais',
        parent_code: '1.0101',
        level: 2,
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
        code: '1.0101.1',
        code_clean: '101011',
        description: 'Serviços de construção de edificações residenciais',
        parent_code: '1.0101',
        level: 2,
        has_nebs: false,
      },
      {
        code,
        code_clean: code.replace(/\D/g, ''),
        description: 'Serviços de construção de edificações residenciais de um e dois pavimentos',
        parent_code: '1.0101.1',
        level: 3,
        has_nebs: true,
      },
    ],
    nebs: {
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

function makeNebsDetail(code = '1.0101.11.00') {
  return {
    success: true,
    item: {
      code,
      code_clean: code.replace(/\D/g, ''),
      description: 'Serviços de construção de edificações residenciais de um e dois pavimentos',
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
      {
        code: '1.0101.1',
        code_clean: '101011',
        description: 'Serviços de construção de edificações residenciais',
        parent_code: '1.0101',
        level: 2,
        has_nebs: false,
      },
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

async function mockServicesApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const q = url.searchParams.get('q') || '';

    if (path.endsWith('/services/nbs/search')) {
      await route.fulfill({ json: makeNbsSearch(q) });
      return;
    }

    if (path.endsWith('/services/nebs/search')) {
      await route.fulfill({ json: makeNebsSearch(q) });
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

async function openServicesAndSearch(page: Page, query = '1.0101.11.00') {
  await page.goto('/');
  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Serviços \(NBS\)/ }).click();
  await page.locator('#ncmInput').fill(query);
  await page.getByRole('button', { name: /Buscar/ }).click();
  await expect(page.getByRole('heading', { name: 'Estrutura completa' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockServicesApi(page);
});

test('opens NEBS in a new tab from the inline hierarchy action and keeps the original NBS tab intact', async ({ page }) => {
  await openServicesAndSearch(page);

  await page.getByRole('button', { name: 'Ver NEBS' }).click();

  await expect(page.locator('[data-document]')).toHaveCount(2);
  await expect(page.locator('[data-document="nebs"]')).toHaveCount(1);
  await expect(page.getByText('Conteudo da nota')).toBeVisible();

  await page.locator('[data-document="nbs"]').click();

  await expect(page.getByRole('heading', { name: 'Estrutura completa' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver na aba NEBS' })).toBeVisible();
});

test('reuses the same tab when opening NEBS through the primary NBS action', async ({ page }) => {
  await openServicesAndSearch(page);

  await page.getByRole('button', { name: 'Ver na aba NEBS' }).click();

  await expect(page.locator('[data-document]')).toHaveCount(1);
  await expect(page.locator('[data-document="nebs"]')).toHaveCount(1);
  await expect(page.getByText('Conteudo da nota')).toBeVisible();
});

test('switches back to NBS in the same tab when the user clicks the NEBS breadcrumb code', async ({ page }) => {
  await openServicesAndSearch(page);
  await page.getByRole('button', { name: 'Ver na aba NEBS' }).click();
  await expect(page.getByText('Conteudo da nota')).toBeVisible();

  await page.getByRole('button', { name: '1.0101.11.00', exact: true }).click();

  await expect(page.locator('[data-document]')).toHaveCount(1);
  await expect(page.locator('[data-document="nbs"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Estrutura completa' })).toBeVisible();
});
