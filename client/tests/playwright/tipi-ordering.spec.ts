import { expect, test } from '@playwright/test';

import { installServicesMock, makeTipiChapterData } from './fixtures/service-mocks';

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
    tipiSearchResponses: [
      {
        body: {
          success: true,
          type: 'code',
          query: '11',
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
              {
                ncm: '1101.00.10',
                codigo: '1101.00.10',
                descricao: 'De trigo',
                aliquota: '0%',
                nivel: 2,
                anchor_id: 'pos-1101-00-10',
              },
              {
                ncm: '11.02',
                codigo: '11.02',
                descricao: 'Farinhas de cereais, exceto de trigo ou de mistura de trigo com centeio (méteil).',
                aliquota: '0%',
                nivel: 1,
                anchor_id: 'pos-11-02',
              },
              {
                ncm: '11.07',
                codigo: '11.07',
                descricao: 'Malte, mesmo torrado.',
                aliquota: '0%',
                nivel: 1,
                anchor_id: 'pos-11-07',
              },
            ]),
          },
          total: 1,
          total_capitulos: 1,
        },
      },
    ],
  });
});

test('renders TIPI chapter 11 search results in order', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();
  await page.getByRole('button', { name: 'TIPI' }).click();
  await expect(page.getByRole('button', { name: 'TIPI' })).toHaveClass(/docButtonActive/);

  const searchRequest = page.waitForRequest((request) =>
    request.url().includes('/api/tipi/search')
    && new URL(request.url()).searchParams.get('ncm') === '11',
  );

  await page.locator('#ncmInput').fill('11');
  await page.locator('#ncmInput').press('Enter');
  await searchRequest;

  await expect.poll(async () => {
    return page.locator('article.tipi-position').evaluateAll((articles) => {
      return articles
        .map((article) => (article.querySelector('.tipi-ncm')?.textContent || '').trim())
        .filter(Boolean);
    });
  }).toEqual(['1101', '1101.00.10', '11.02', '11.07']);
});