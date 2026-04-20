import { expect, test, type Page } from '@playwright/test';

import {
  installServicesMock,
  makeNeshChapterData,
  makeTipiChapterData,
} from './fixtures/service-mocks';

async function getActiveTabDocument(page: Page): Promise<string | null> {
  return page.locator('div[draggable="true"][data-document]').evaluateAll((tabs) => {
    const activeTab = tabs.find((tab): tab is HTMLElement => (
      tab.getAttribute('data-active') === 'true' && tab instanceof HTMLElement
    ));
    return activeTab?.dataset.document ?? null;
  });
}

async function getActiveResultsContainerId(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('div[id^="results-content-"]'));
    const visibleContainer = containers.find((container) => {
      if (!(container instanceof HTMLElement)) return false;
      return container.offsetParent !== null;
    });

    return visibleContainer?.id ?? null;
  });

  if (!id) {
    throw new Error('Could not resolve active results container id');
  }

  return id;
}

async function setAndCaptureScrollTop(page: Page, containerId: string, targetScrollTop: number): Promise<number> {
  const container = page.locator(`#${containerId}`);
  await expect(container).toBeVisible();

  const box = await container.boundingBox();
  if (!box) {
    throw new Error(`Could not resolve container bounds for ${containerId}`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(120, box.height / 2));

  let currentScrollTop = await container.evaluate((element) => element.scrollTop);
  let attempts = 0;

  while (currentScrollTop < targetScrollTop && attempts < 30) {
    await page.mouse.wheel(0, 200);
    currentScrollTop = await container.evaluate((element) => element.scrollTop);
    attempts += 1;
  }

  expect(currentScrollTop, `Expected #${containerId} to reach at least ${targetScrollTop}px`).toBeGreaterThanOrEqual(targetScrollTop);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  }));
  return currentScrollTop;
}

async function waitForInitialAutoScroll(page: Page, selector: string) {
  await expect(page.locator(selector)).toHaveClass(/flash-highlight/);
}

async function expectScrollTopNear(page: Page, selector: string, expectedScrollTop: number, tolerance = 1) {
  await expect.poll(async () => {
    const currentScrollTop = await page.locator(selector).evaluate((element) => element.scrollTop);
    return Math.abs(currentScrollTop - expectedScrollTop);
  }).toBeLessThanOrEqual(tolerance);
}

async function waitForScrollToSettle(page: Page, containerId: string) {
  const container = page.locator(`#${containerId}`);
  let lastScrollTop: number | null = null;
  let sawMovement = false;

  await expect.poll(async () => {
    const currentScrollTop = await container.evaluate((element) => element.scrollTop);

    if (lastScrollTop !== null && Math.abs(currentScrollTop - lastScrollTop) < 1) {
      return sawMovement;
    }

    if (lastScrollTop !== null && Math.abs(currentScrollTop - lastScrollTop) >= 1) {
      sawMovement = true;
    } else if (currentScrollTop > 0) {
      sawMovement = true;
    }

    lastScrollTop = currentScrollTop;
    return false;
  }, { timeout: 10_000 }).toBe(true);
}

async function installCodeCatalogMocks(page: Page) {
  await installServicesMock(page, {
    neshSearchResponses: [
      {
        body: {
          success: true,
          type: 'code',
          query: '8405',
          normalized: null,
          results: {
            '84': makeNeshChapterData(
              '84',
              [
                { codigo: '84.03', descricao: 'Caldeiras para aquecimento central.', anchor_id: 'pos-84-03' },
                { codigo: '84.04', descricao: 'Aparelhos auxiliares para caldeiras.', anchor_id: 'pos-84-04' },
                { codigo: '84.05', descricao: 'Geradores de gás.', anchor_id: 'pos-84-05' },
              ],
              {
                ncm_buscado: '8405',
                posicao_alvo: '84.05',
              },
            ),
          },
          total_capitulos: 1,
          markdown: [
            '<div id="cap-84">',
            '  <h2>Capítulo 84</h2>',
            '  <article id="pos-84-03">84.03 - Caldeiras para aquecimento central.</article>',
            '  <article id="pos-84-04">84.04 - Aparelhos auxiliares para caldeiras.</article>',
            ...Array.from({ length: 90 }, (_, index) => (
              `<p>Contexto técnico NESH ${index + 1} para validar restauração de scroll.</p>`
            )),
            '  <article id="pos-84-05">84.05 - Geradores de gás.</article>',
            '</div>',
          ].join(''),
        },
      },
    ],
    tipiSearchResponses: [
      {
        body: {
          success: true,
          type: 'code',
          query: '11.02.40',
          results: {
            '11': makeTipiChapterData('11', [
              {
                ncm: '1101',
                codigo: '1101',
                descricao: 'Farinhas de trigo ou de mistura de trigo com centeio (méteil).',
                aliquota: '0%',
                nivel: 1,
                anchor_id: 'pos-1101',
              },
              ...Array.from({ length: 80 }, (_, index) => {
                const sequence = String(index + 1).padStart(2, '0');
                return {
                  ncm: `11.02.${sequence}`,
                  codigo: `11.02.${sequence}`,
                  descricao: `Subitem TIPI ${index + 1}`,
                  aliquota: '0%',
                  nivel: 2,
                  anchor_id: `pos-11-02-${sequence}`,
                };
              }),
            ]),
          },
          total: 1,
          total_capitulos: 1,
        },
      },
    ],
  });
}

async function searchNeshInDefaultTab(page: Page) {
  const request = page.waitForRequest((candidate) =>
    candidate.url().includes('/api/search')
    && new URL(candidate.url()).searchParams.get('ncm') === '8405',
  );

  await page.locator('#ncmInput').fill('8405');
  await page.locator('#ncmInput').press('Enter');
  await request;
  await expect(page.locator('#results-content-tab-1')).toBeVisible();
  await waitForInitialAutoScroll(page, '#pos-84-05');
  await waitForScrollToSettle(page, 'results-content-tab-1');
}

async function createTipiTabAndSearch(page: Page) {
  await page.getByTitle('Nova aba').click();
  await page.getByRole('button', { name: 'TIPI', exact: true }).click();

  const request = page.waitForRequest((candidate) =>
    candidate.url().includes('/api/tipi/search')
    && new URL(candidate.url()).searchParams.get('ncm') === '11.02.40',
  );

  await page.locator('#ncmInput').fill('11.02.40');
  await page.locator('#ncmInput').press('Enter');
  await request;

  await expect.poll(async () => getActiveTabDocument(page)).toBe('tipi');
  await waitForInitialAutoScroll(page, '#pos-11-02-40');
  const tipiContainerId = await getActiveResultsContainerId(page);
  await waitForScrollToSettle(page, tipiContainerId);
}

test.beforeEach(async ({ page }) => {
  await installCodeCatalogMocks(page);
});

test('restores saved scroll when returning to a tab with a different document', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();

  await searchNeshInDefaultTab(page);
  const savedNeshScrollTop = await setAndCaptureScrollTop(page, 'results-content-tab-1', 620);

  await createTipiTabAndSearch(page);
  const tipiContainerId = await getActiveResultsContainerId(page);
  const savedTipiScrollTop = await setAndCaptureScrollTop(page, tipiContainerId, 540);

  await page.locator('div[draggable="true"][data-document="nesh"]').first().click();
  await expect.poll(async () => getActiveTabDocument(page)).toBe('nesh');

  await expectScrollTopNear(page, '#results-content-tab-1', savedNeshScrollTop);

  await page.locator('div[draggable="true"][data-document="tipi"]').first().click();
  await expect.poll(async () => getActiveTabDocument(page)).toBe('tipi');
  await expect(page.locator(`#${tipiContainerId}`)).toBeVisible();
  await expectScrollTopNear(page, `#${tipiContainerId}`, savedTipiScrollTop);
});

test('preserves independent scroll positions after rapid tab switching', async ({ page }) => {
  await page.goto('/');

  await searchNeshInDefaultTab(page);
  const savedNeshScrollTop = await setAndCaptureScrollTop(page, 'results-content-tab-1', 480);

  await createTipiTabAndSearch(page);
  const tipiContainerId = await getActiveResultsContainerId(page);
  const savedTipiScrollTop = await setAndCaptureScrollTop(page, tipiContainerId, 410);

  await page.locator('div[draggable="true"][data-document="nesh"]').first().click();
  await expect.poll(async () => getActiveTabDocument(page)).toBe('nesh');
  await expectScrollTopNear(page, '#results-content-tab-1', savedNeshScrollTop);

  await page.locator('div[draggable="true"][data-document="tipi"]').first().click();
  await expect.poll(async () => getActiveTabDocument(page)).toBe('tipi');
  await expect(page.locator(`#${tipiContainerId}`)).toBeVisible();
  await expectScrollTopNear(page, `#${tipiContainerId}`, savedTipiScrollTop);

  await page.locator('div[draggable="true"][data-document="nesh"]').first().click();
  await expectScrollTopNear(page, '#results-content-tab-1', savedNeshScrollTop);
});
