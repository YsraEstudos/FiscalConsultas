import { expect, type Locator, Page, test } from '@playwright/test';

const liveEnv = {
  baseUrl: process.env.PLAYWRIGHT_LIVE_BASE_URL || '',
  email: process.env.PLAYWRIGHT_CLERK_EMAIL || '',
  password: process.env.PLAYWRIGHT_CLERK_PASSWORD || '',
  query: process.env.PLAYWRIGHT_LIVE_NBS_QUERY || '1.0101.11.00',
};

function hasLiveEnv(): boolean {
  return Boolean(liveEnv.baseUrl && liveEnv.email && liveEnv.password);
}

async function openMenu(page: Page) {
  await page.getByRole('button', { name: /Menu/ }).click();
}

async function findFirstVisibleLocator(page: Page, selectors: string[]) {
  const targets = [
    { root: page, label: 'page' },
    ...page.frames().map((frame, index) => ({ root: frame, label: `frame-${index}` })),
  ];

  for (const selector of selectors) {
    for (const target of targets) {
      const locator = target.root.locator(selector).first();
      if (await locator.count()) {
        return locator;
      }
    }
  }

  return null;
}

async function pollForLocator(
  page: Page,
  selectors: string[],
  options: { interval?: number; maxAttempts?: number } = {},
): Promise<Locator | null> {
  const {
    interval = 500,
    maxAttempts = 20,
  } = options;

  for (let i = 0; i < maxAttempts; i += 1) {
    const locator = await findFirstVisibleLocator(page, selectors);
    if (locator) {
      return locator;
    }
    await page.waitForTimeout(interval);
  }

  return null;
}

async function clickFirstVisibleButton(page: Page, labels: RegExp[]) {
  const targets = [page, ...page.frames()];
  for (const label of labels) {
    for (const target of targets) {
      const locator = target.getByRole('button', { name: label }).first();
      if (await locator.count()) {
        await locator.click();
        return true;
      }
    }
  }
  return false;
}

async function ensureSignedIn(page: Page) {
  await openMenu(page);
  const signInButton = page.getByRole('button', { name: /Entrar/i }).first();
  if (!(await signInButton.count())) {
    await expect(page.getByRole('button', { name: /Meu Perfil|Sair da conta/i }).first()).toBeVisible();
    return;
  }

  await signInButton.click();

  const emailInput = await test.step('find email field', async () => {
    const locator = await pollForLocator(page, [
      'input[name="identifier"]',
      'input[type="email"]',
      'input[autocomplete="username"]',
    ]);
    if (!locator) {
      throw new Error('Clerk email field not found');
    }
    return locator;
  });

  await emailInput.fill(liveEnv.email);
  await clickFirstVisibleButton(page, [/continue/i, /continuar/i, /next/i]);

  const passwordInput = await test.step('find password field', async () => {
    const locator = await pollForLocator(page, [
      'input[name="password"]',
      'input[type="password"]',
      'input[autocomplete="current-password"]',
    ]);
    if (!locator) {
      throw new Error('Clerk password field not found');
    }
    return locator;
  });

  await passwordInput.fill(liveEnv.password);
  await clickFirstVisibleButton(page, [/continue/i, /continuar/i, /entrar/i, /sign in/i]);

  await page.waitForLoadState('networkidle');
  await openMenu(page);
  await expect(page.getByRole('button', { name: /Meu Perfil|Sair da conta/i }).first()).toBeVisible();
}

test.describe('live services smoke', () => {
  test.skip(!hasLiveEnv(), 'Set PLAYWRIGHT_LIVE_BASE_URL, PLAYWRIGHT_CLERK_EMAIL and PLAYWRIGHT_CLERK_PASSWORD to run live smoke.');

  test('authenticates with Clerk and reaches real NBS/NEBS service routes', async ({ page }) => {
    await page.goto(liveEnv.baseUrl);
    await ensureSignedIn(page);

    await openMenu(page);
    await page.getByRole('button', { name: /Serviços \(NBS\)/ }).click();

    const nbsResponse = page.waitForResponse((response) =>
      response.url().includes('/api/services/nbs/search')
      && response.status() === 200,
    );

    await page.locator('#ncmInput').fill(liveEnv.query);
    await page.getByRole('button', { name: /Buscar/ }).click();
    await nbsResponse;

    await expect(page.getByRole('heading', { name: 'Erro' })).toHaveCount(0);
    await expect(page.locator('[data-document="nbs"]')).toHaveCount(1);
    await expect(page.getByText(/Resultados|Estrutura completa|Selecione um servico|Nenhum servico encontrado/).first()).toBeVisible();

    const nebsResponse = page.waitForResponse((response) =>
      response.url().includes('/api/services/nebs/search')
      && response.status() === 200,
    );

    await page.getByRole('button', { name: 'NEBS', exact: true }).first().click();
    await page.locator('#ncmInput').fill(liveEnv.query);
    await page.getByRole('button', { name: /Buscar/ }).click();
    await nebsResponse;

    await expect(page.getByRole('heading', { name: 'Erro' })).toHaveCount(0);
    await expect(page.locator('[data-document="nebs"]')).toHaveCount(1);
    await expect(page.getByText(/Selecione uma nota|Nenhuma nota encontrada|Conteudo da nota|Origem/).first()).toBeVisible();
  });
});
