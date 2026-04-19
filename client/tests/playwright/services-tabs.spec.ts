import { expect, test, type Page } from '@playwright/test';

import { installServicesMock, makeNbsDetail } from './fixtures/service-mocks';
import { openServicesModal, searchServices } from './fixtures/services-ui';

async function setNavigationBehavior(page: Page, mode: 'same-tab' | 'new-tab') {
  await page.getByRole('button', { name: /Menu/, exact: true }).click();
  await page.getByRole('button', { name: /Configurações/ }).click();

  const modal = page.locator('dialog[aria-labelledby="settings-modal-title"]');
  await expect(modal).toBeVisible();

  const targetButton = mode === 'new-tab'
    ? modal.getByRole('button', { name: 'Em nova aba', exact: true })
    : modal.getByRole('button', { name: 'Na mesma aba', exact: true });

  if ((await targetButton.getAttribute('aria-pressed')) !== 'true') {
    await targetButton.click();
  }

  await expect(targetButton).toHaveAttribute('aria-pressed', 'true');
  await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(modal).not.toBeVisible();
}

async function openNbsWithSmartLink(page: Page, targetCode = '1.0101.12.00') {
  const detailWithSmartLink = makeNbsDetail('1.0101.11.00');
  detailWithSmartLink.nebs = {
    ...detailWithSmartLink.nebs,
    body_markdown: `Consulte também o código ${targetCode} para serviço correlato.`,
  };

  await installServicesMock(page, {
    nbsDetailResponses: {
      '1.0101.11.00': detailWithSmartLink,
    },
  });

  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');
  await setNavigationBehavior(page, 'same-tab');

  return page.locator(`.service-smart-link[data-service-code="${targetCode}"]`).first();
}

test.beforeEach(async ({ page }) => {
  await installServicesMock(page);
});

test('loads NBS search results and the linked detail panel', async ({ page }) => {
  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');

  await expect(page.getByRole('heading', { name: 'Resultados NBS' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Serviços de construção de edificações residenciais/ })).toBeVisible();
  await expect(page.getByText('NOTAS EXPLICATIVAS')).toBeVisible();
  await expect(page.getByRole('button', { name: /Ver NEBS/ })).toBeVisible();
});

test('switches from an NBS detail to the linked NEBS detail', async ({ page }) => {
  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');

  const nebsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nebs/search')
    && new URL(request.url()).searchParams.get('q') === '1.0101.11.00',
  );

  await page.getByRole('button', { name: /Ver NEBS/ }).click();
  await nebsRequest;

  await expect(page.getByRole('heading', { name: 'Resultados NEBS' })).toBeVisible();
  await expect(page.getByText('Origem').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir item NBS relacionado' })).toBeVisible();
});

test('returns from a NEBS detail to the linked NBS detail', async ({ page }) => {
  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');
  await page.getByRole('button', { name: /Ver NEBS/ }).click();
  await expect(page.getByRole('heading', { name: 'Resultados NEBS' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir item NBS relacionado' })).toBeVisible();

  const nbsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nbs/search')
    && new URL(request.url()).searchParams.get('q') === '1.0101.11.00',
  );

  await page.getByRole('button', { name: 'Abrir item NBS relacionado' }).click();
  await nbsRequest;

  await expect(page.getByRole('heading', { name: 'Resultados NBS' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ver NEBS/ })).toBeVisible();
});

test('updates NBS detail when clicking an ancestor in the hierarchy', async ({ page }) => {
  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');

  const activeNode = page.locator('[data-service-state="active"]');
  await expect(activeNode).toContainText('1.0101.11.00');

  const detailRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nbs/1.01'),
  );

  await page.getByRole('button', { name: /1\.01 - Serviços de construção/ }).first().click();
  await detailRequest;

  await expect(activeNode).toContainText('1.01 - Serviços de construção');
});

test('updates NBS detail when clicking a child node in the hierarchy', async ({ page }) => {
  const detailWithChild = makeNbsDetail('1.0101.11.00');
  detailWithChild.children = [
    {
      code: '1.0101.11.01',
      code_clean: '101011101',
      description: 'Serviços complementares residenciais',
      parent_code: '1.0101.11.00',
      level: 4,
      has_nebs: true,
    },
  ];

  await installServicesMock(page, {
    nbsDetailResponses: {
      '1.0101.11.00': detailWithChild,
      '1.0101.11.01': makeNbsDetail('1.0101.11.01'),
    },
  });

  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');

  const activeNode = page.locator('[data-service-state="active"]');
  await expect(activeNode).toContainText('1.0101.11.00');

  const detailRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nbs/1.0101.11.01'),
  );

  await page.getByRole('button', { name: /1\.0101\.11\.01 - Serviços complementares residenciais/ }).click();
  await detailRequest;

  await expect(activeNode).toContainText('1.0101.11.01');
});

test('opens and closes chapter notes from NBS hierarchy panel', async ({ page }) => {
  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');

  const chapterButton = page.getByRole('button', { name: /Capítulo 01|Explicações do capítulo/ });
  await expect(chapterButton).toBeEnabled();
  await chapterButton.click();

  const chapterDialog = page.getByRole('dialog', { name: /Capítulo 01 - Serviços de construção/ });
  await expect(chapterDialog).toBeVisible();
  await expect(chapterDialog.getByText('NOTAS DO CAPÍTULO')).toBeVisible();

  await chapterDialog.getByRole('button', { name: 'Fechar explicações do capítulo' }).click();
  await expect(chapterDialog).not.toBeVisible();
});

test('follows smart-link codes from NBS notes to NEBS results', async ({ page }) => {
  const smartLink = await openNbsWithSmartLink(page, '1.0101.12.00');
  await expect(smartLink).toBeVisible();

  const nebsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nebs/search')
    && new URL(request.url()).searchParams.get('q') === '1.0101.12.00',
  );

  await smartLink.click();
  await nebsRequest;

  await expect(page.getByRole('heading', { name: 'Resultados NEBS' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir item NBS relacionado' })).toBeVisible();
});

test('opens smart-link target in a new tab with Ctrl/Cmd click', async ({ page }) => {
  const smartLink = await openNbsWithSmartLink(page, '1.0101.12.00');
  await expect(smartLink).toBeVisible();

  const initialTabCount = await page.locator('div[draggable="true"][data-document]').count();
  const nebsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nebs/search')
    && new URL(request.url()).searchParams.get('q') === '1.0101.12.00',
  );

  await smartLink.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await nebsRequest;

  await expect(page.locator('div[draggable="true"][data-document]')).toHaveCount(initialTabCount + 1);
  await expect(page.getByRole('heading', { name: 'Resultados NEBS' })).toBeVisible();
});

test('opens smart-link target in a new tab with middle-click', async ({ page }) => {
  const smartLink = await openNbsWithSmartLink(page, '1.0101.12.00');
  await expect(smartLink).toBeVisible();

  const initialTabCount = await page.locator('div[draggable="true"][data-document]').count();
  const nebsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nebs/search')
    && new URL(request.url()).searchParams.get('q') === '1.0101.12.00',
  );

  await smartLink.click({ button: 'middle' });
  await nebsRequest;

  await expect(page.locator('div[draggable="true"][data-document]')).toHaveCount(initialTabCount + 1);
  await expect(page.getByRole('heading', { name: 'Resultados NEBS' })).toBeVisible();
});

test('navigates from NEBS breadcrumbs back to NBS detail in the same tab', async ({ page }) => {
  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');
  await page.getByRole('button', { name: /Ver NEBS/ }).click();
  await expect(page.getByRole('heading', { name: 'Resultados NEBS' })).toBeVisible();

  const nbsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nbs/search')
    && new URL(request.url()).searchParams.get('q') === '1.01',
  );

  await page.locator('[aria-label="Hierarquia NBS"]').getByRole('button', { name: /^1\.01$/ }).click();
  await nbsRequest;

  await expect(page.getByRole('heading', { name: 'Resultados NBS' })).toBeVisible();
});

test('opens NEBS breadcrumb navigation in a new tab when preference is enabled', async ({ page }) => {
  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');
  await page.getByRole('button', { name: /Ver NEBS/ }).click();
  await expect(page.getByRole('heading', { name: 'Resultados NEBS' })).toBeVisible();

  const initialTabCount = await page.locator('div[draggable="true"][data-document]').count();
  await setNavigationBehavior(page, 'new-tab');

  const nbsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nbs/search')
    && new URL(request.url()).searchParams.get('q') === '1.01',
  );

  await page.locator('[aria-label="Hierarquia NBS"]').getByRole('button', { name: /^1\.01$/ }).click();
  await nbsRequest;

  await expect(page.locator('div[draggable="true"][data-document]')).toHaveCount(initialTabCount + 1);
  await expect(page.getByRole('heading', { name: 'Resultados NBS' })).toBeVisible();
});

test('opens linked NBS detail in a new tab when preference is enabled', async ({ page }) => {
  await openServicesModal(page);
  await searchServices(page, '1.0101.11.00');
  await page.getByRole('button', { name: /Ver NEBS/ }).click();
  await expect(page.getByRole('heading', { name: 'Resultados NEBS' })).toBeVisible();

  const initialTabCount = await page.locator('div[draggable="true"][data-document]').count();
  await setNavigationBehavior(page, 'new-tab');

  const nbsRequest = page.waitForRequest((request) =>
    request.url().includes('/api/services/nbs/search')
    && new URL(request.url()).searchParams.get('q') === '1.0101.11.00',
  );

  await page.getByRole('button', { name: 'Abrir item NBS relacionado' }).click();
  await nbsRequest;

  await expect(page.locator('div[draggable="true"][data-document]')).toHaveCount(initialTabCount + 1);
  await expect(page.getByRole('heading', { name: 'Resultados NBS' })).toBeVisible();
});
