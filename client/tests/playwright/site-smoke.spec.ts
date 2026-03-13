import { expect, Page, test } from '@playwright/test';

function makeNbsSearch(query = '1.0101.11.00') {
  return {
    success: true,
    query,
    normalized: query,
    results: [
      {
        code: '1.0101.11.00',
        code_clean: '101011100',
        description: 'Serviços de construção de edificações residenciais de um e dois pavimentos',
        parent_code: '1.0101.1',
        level: 3,
        has_nebs: true,
      },
      {
        code: '1.0101.12.00',
        code_clean: '101011200',
        description: 'Serviços de construção de edificações residenciais com mais de dois pavimentos',
        parent_code: '1.0101.1',
        level: 3,
        has_nebs: true,
      },
    ],
    total: 2,
  };
}

function makeNebsSearch(query = '1.0101.11.00') {
  return {
    success: true,
    query,
    normalized: query,
    results: [
      {
        code: '1.0101.11.00',
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

async function mockApi(page: Page) {
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
      body: JSON.stringify({
        success: true,
        results: [],
        query: q,
        total: 0,
      }),
    });
  });
}

const suspiciousMarkers = [
  'hacked by',
  'owned by',
  'pwned',
  'telegram',
  'defaced',
  'click here for bitcoin',
  'crypto drainer',
  'casino bonus',
];

test('main surfaces render without obvious visual breakage or defacement', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'unknown'}`);
  });

  await mockApi(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'NESH' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'TIPI' })).toBeVisible();

  const homeText = (await page.locator('body').innerText()).toLowerCase();
  for (const marker of suspiciousMarkers) {
    expect(homeText).not.toContain(marker);
  }

  await page.screenshot({ path: 'test-results/site-smoke-home.png', fullPage: true });

  await page.getByRole('button', { name: /TIPI/ }).click();
  await expect(page.getByRole('button', { name: 'TIPI' })).toHaveClass(/docButtonActive/);

  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Configurações/ }).click();
  await expect(page.getByRole('heading', { name: /Configurações/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/site-smoke-settings.png', fullPage: true });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Ajuda \/ Tutorial/ }).click();
  await expect(page.getByText(/Como usar/)).toBeVisible();
  await page.screenshot({ path: 'test-results/site-smoke-tutorial.png', fullPage: true });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Comparar NCMs/ }).click();
  await expect(page.getByRole('heading', { name: /Comparar NCMs/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/site-smoke-comparator.png', fullPage: true });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('button', { name: /Serviços \(NBS\)/ }).click();
  await expect(page.getByRole('button', { name: 'NBS', exact: true }).first()).toBeVisible();

  const searchInput = page.locator('#ncmInput');
  await searchInput.fill('1.0101.11.00');
  await searchInput.press('Enter');

  await expect(page.getByText('Serviços de construção de edificações residenciais de um e dois pavimentos')).toBeVisible();
  await page.screenshot({ path: 'test-results/site-smoke-nbs.png', fullPage: true });

  await page.getByRole('button', { name: 'NEBS', exact: true }).first().click();
  await expect(page.getByText('SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/site-smoke-nebs.png', fullPage: true });

  expect(consoleErrors, `Console errors found:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(failedRequests, `Failed requests found:\n${failedRequests.join('\n')}`).toEqual([]);
});
