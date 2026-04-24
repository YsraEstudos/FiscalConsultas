import { expect, test, type Page } from '@playwright/test';

import { installServicesMock, makeNeshChapterData } from './fixtures/service-mocks';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(globalThis, 'SharedArrayBuffer', {
        value: undefined,
        configurable: true,
      });
    } catch {
      // Ignore environments where this global cannot be redefined.
    }

    try {
      const storage = navigator.storage as unknown as { getDirectory?: unknown } | undefined;
      if (storage) {
        Object.defineProperty(storage, 'getDirectory', {
          value: undefined,
          configurable: true,
        });
      }
    } catch {
      // Ignore environments where navigator.storage is read-only.
    }
  });

  await installServicesMock(page, {
    neshSearchResponses: [
      {
        body: {
          success: true,
          type: 'code',
          query: '8404',
          normalized: null,
          results: {
            '84': makeNeshChapterData(
              '84',
              [
                {
                  codigo: '84.05',
                  descricao: 'Geradores de gás.',
                  anchor_id: 'pos-84-05',
                },
                {
                  codigo: '8404.10.10',
                  descricao: 'Parte de aparelho auxiliar.',
                  anchor_id: 'pos-8404-10-10',
                },
                {
                  codigo: '8404',
                  descricao: 'Aparelhos auxiliares.',
                  anchor_id: 'pos-84-04',
                },
                {
                  codigo: '84.03',
                  descricao: 'Caldeiras centrais.',
                  anchor_id: 'pos-84-03',
                },
              ],
              {
                ncm_buscado: '8404',
                posicao_alvo: '84.04',
              },
            ),
          },
          total_capitulos: 1,
          markdown: [
            '<div id="cap-84">',
            '  <h2>Capítulo 84</h2>',
            '  <article id="pos-84-03" data-ncm="84.03">84.03 - Caldeiras para aquecimento central.</article>',
            '  <article id="pos-84-04" data-ncm="84.04">84.04 - Aparelhos auxiliares para caldeiras.</article>',
            ...Array.from(
              { length: 48 },
              (_, index) => `<p>Trecho técnico de contexto ${index + 1} para validar navegação por âncora.</p>`,
            ),
            '  <article id="pos-84-05" data-ncm="84.05">84.05 - Geradores de gás.</article>',
            '</div>',
          ].join(''),
        },
      },
    ],
  });
});

async function waitForScrollToSettle(page: Page, containerSelector: string) {
  const container = page.locator(containerSelector);
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

test('renders NESH chapter 84 navigation items in order', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'NESH' })).toHaveClass(/docButtonActive/);

  const searchRequest = page.waitForRequest((request) =>
    request.url().includes('/api/search')
    && new URL(request.url()).searchParams.get('ncm') === '8404',
  );

  await page.locator('#ncmInput').fill('8404');
  await page.locator('#ncmInput').press('Enter');
  await searchRequest;

  await expect.poll(async () => {
    const targetCodes = new Set(['84.03', '8404', '8404.10.10', '84.05']);
    const codes = await page.locator('span[class*="itemCode"]').allTextContents();
    return codes.map((code) => code.trim()).filter((code) => targetCodes.has(code));
  }).toEqual(['84.03', '8404', '8404.10.10', '84.05']);
});

test('navigates to a NESH position from sidebar click and highlights target anchor', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();

  const searchRequest = page.waitForRequest((request) =>
    request.url().includes('/api/search')
    && new URL(request.url()).searchParams.get('ncm') === '8404',
  );

  await page.locator('#ncmInput').fill('8404');
  await page.locator('#ncmInput').press('Enter');
  await searchRequest;

  const resultsContainer = page.locator('#results-content-tab-1');
  const targetAnchor = page.locator('#pos-84-05');

  await expect(resultsContainer).toBeVisible();
  await expect(targetAnchor).toBeVisible();
  await waitForScrollToSettle(page, '#results-content-tab-1');

  await resultsContainer.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect.poll(async () => (
    resultsContainer.evaluate((element) => element.scrollTop)
  )).toBe(0);

  await page.getByRole('button', { name: /84\.05\s*Geradores de gás\./i }).click();

  await expect(targetAnchor).toHaveClass(/flash-highlight/);
  await waitForScrollToSettle(page, '#results-content-tab-1');
});

test('auto-scrolls to target position right after NESH search in real browser flow', async ({ page, context }) => {
  await context.unroute('**/api/**');
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
                {
                  codigo: '84.03',
                  descricao: 'Caldeiras para aquecimento central.',
                  anchor_id: 'pos-84-03',
                },
                {
                  codigo: '84.04',
                  descricao: 'Aparelhos auxiliares para caldeiras.',
                  anchor_id: 'pos-84-04',
                },
                {
                  codigo: '84.05',
                  descricao: 'Geradores de gás.',
                  anchor_id: 'pos-84-05',
                },
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
            '  <article id="pos-84-03" data-ncm="84.03">84.03 - Caldeiras para aquecimento central.</article>',
            ...Array.from(
              { length: 80 },
              (_, index) => `<p>Contexto adicional ${index + 1} para auto-scroll.</p>`,
            ),
            '  <article id="pos-84-04" data-ncm="84.04">84.04 - Aparelhos auxiliares para caldeiras.</article>',
            '  <article id="pos-84-05" data-ncm="84.05">84.05 - Geradores de gás.</article>',
            '</div>',
          ].join(''),
        },
      },
    ],
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();

  const searchRequest = page.waitForRequest((request) =>
    request.url().includes('/api/search')
    && new URL(request.url()).searchParams.get('ncm') === '8405',
  );

  await page.locator('#ncmInput').fill('8405');
  await page.locator('#ncmInput').press('Enter');
  await searchRequest;

  const resultsContainer = page.locator('#results-content-tab-1');
  const targetAnchor = page.locator('#pos-84-05');

  await expect(resultsContainer).toBeVisible();
  await expect(targetAnchor).toHaveClass(/flash-highlight/);
  await waitForScrollToSettle(page, '#results-content-tab-1');
});
