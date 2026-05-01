import { expect, test, type Page } from '@playwright/test';

import {
  installServicesMock,
  makeNeshChapterData,
  makeTipiChapterData,
} from './fixtures/service-mocks';

async function searchNesh(page: Page, query: string) {
  const request = page.waitForRequest((candidate) => {
    if (!candidate.url().includes('/api/search')) return false;
    if (candidate.url().includes('/api/services/')) return false;
    return new URL(candidate.url()).searchParams.get('ncm') === query;
  });

  await page.locator('#ncmInput').fill(query);
  await page.locator('#ncmInput').press('Enter');
  await request;
}

async function searchTipi(page: Page, query: string, expectedViewMode?: 'chapter' | 'family') {
  const request = page.waitForRequest((candidate) => {
    if (!candidate.url().includes('/api/tipi/search')) return false;
    const parsed = new URL(candidate.url());
    if (parsed.searchParams.get('ncm') !== query) return false;
    if (!expectedViewMode) return true;
    return parsed.searchParams.get('view_mode') === expectedViewMode;
  });

  await page.locator('#ncmInput').fill(query);
  await page.locator('#ncmInput').press('Enter');
  await request;
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: /Menu/, exact: true }).click();
  await page.getByRole('button', { name: /Configurações/ }).click();
  const modal = page.locator('dialog[aria-labelledby="settings-modal-title"]');
  await expect(modal).toBeVisible();
  return modal;
}

async function setTipiViewMode(page: Page, mode: 'chapter' | 'family') {
  const modal = await openSettings(page);
  const target = mode === 'chapter'
    ? modal.getByRole('button', { name: /Capítulo Completo/ })
    : modal.getByRole('button', { name: /Família NCM/ });

  await target.click();
  await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(modal).not.toBeVisible();
}

test('renders NESH text results and opens selected item as code search in a new tab', async ({ page }) => {
  await installServicesMock(page, {
    neshSearchResponses: [
      {
        body: {
          success: true,
          type: 'text',
          query: 'caldeiras',
          normalized: 'caldeiras',
          match_type: 'all_words',
          warning: null,
          total_capitulos: 1,
          results: [
            {
              ncm: '8404',
              descricao: 'Aparelhos auxiliares para caldeiras.',
              tipo: 'position',
              relevancia: 1,
              score: 97,
              tier: 1,
              tier_label: 'Exato',
            },
          ],
        },
      },
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
                  codigo: '84.04',
                  descricao: 'Aparelhos auxiliares para caldeiras.',
                  anchor_id: 'pos-84-04',
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
            '  <article id="pos-84-04" data-ncm="84.04">84.04 - Aparelhos auxiliares para caldeiras.</article>',
            '</div>',
          ].join(''),
        },
      },
    ],
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();

  const initialTabCount = await page.locator('div[draggable="true"][data-document]').count();
  await searchNesh(page, 'caldeiras');

  await expect(page.getByText('Busca textual')).toBeVisible();
  await expect(page.getByRole('button', { name: /8404\s+Resultado 1/i })).toBeVisible();

  const codeRequest = page.waitForRequest((candidate) => {
    if (!candidate.url().includes('/api/search')) return false;
    if (candidate.url().includes('/api/services/')) return false;
    return new URL(candidate.url()).searchParams.get('ncm') === '8404';
  });

  await page.getByRole('button', { name: /8404\s+Resultado 1/i }).click();
  await codeRequest;

  await expect(page.locator('div[draggable="true"][data-document]')).toHaveCount(initialTabCount + 1);
  await expect(page.locator('#pos-84-04')).toBeVisible();
});

test('shows empty state for NESH text search with no matches', async ({ page }) => {
  await installServicesMock(page, {
    neshSearchResponses: [
      {
        body: {
          success: true,
          type: 'text',
          query: 'zzzz sem resultado',
          normalized: 'zzzz sem resultado',
          match_type: 'all_words',
          warning: null,
          total_capitulos: 0,
          results: [],
        },
      },
    ],
  });

  await page.goto('/');
  await searchNesh(page, 'zzzz sem resultado');

  await expect(page.getByText('Nenhum resultado encontrado')).toBeVisible();
});

test('recovers NESH search after transient request failure', async ({ page }) => {
  await installServicesMock(page, {
    neshSearchResponses: [
      { abort: true },
      {
        body: {
          success: true,
          type: 'text',
          query: 'falha nesh',
          normalized: 'falha nesh',
          match_type: 'all_words',
          warning: null,
          total_capitulos: 1,
          results: [
            {
              ncm: '8405',
              descricao: 'Geradores de gás.',
              tipo: 'position',
              relevancia: 1,
              score: 92,
              tier: 1,
              tier_label: 'Exato',
            },
          ],
        },
      },
    ],
  });

  await page.goto('/');
  await searchNesh(page, 'falha nesh');

  await expect(page.getByRole('heading', { name: 'Erro' })).toBeVisible();
  await expect(
    page.getByText('Não foi possível carregar os dados agora. Tente novamente em instantes.').first(),
  ).toBeVisible();

  await searchNesh(page, 'falha nesh');
  await expect(page.getByText('Busca textual')).toBeVisible();
  await expect(page.getByRole('button', { name: /8405\s+Resultado 1/i })).toBeVisible();
});

test('renders TIPI text results and opens selected item as code search in a new tab', async ({ page }) => {
  await installServicesMock(page, {
    tipiSearchResponses: [
      {
        body: {
          success: true,
          type: 'text',
          query: 'farinha',
          normalized: 'farinha',
          match_type: 'text',
          warning: null,
          total: 1,
          results: [
            {
              ncm: '1101',
              capitulo: '11',
              descricao: 'Farinhas de trigo.',
              aliquota: '0%',
            },
          ],
        },
      },
      {
        body: {
          success: true,
          type: 'code',
          query: '1101',
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
            ]),
          },
          total: 1,
          total_capitulos: 1,
        },
      },
    ],
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'TIPI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'TIPI', exact: true })).toHaveClass(/docButtonActive/);

  const initialTabCount = await page.locator('div[draggable="true"][data-document]').count();
  await searchTipi(page, 'farinha');

  await expect(page.getByText('Busca textual')).toBeVisible();
  await expect(page.getByRole('button', { name: /1101\s+Resultado 1/i })).toBeVisible();

  const codeRequest = page.waitForRequest((candidate) => {
    if (!candidate.url().includes('/api/tipi/search')) return false;
    return new URL(candidate.url()).searchParams.get('ncm') === '1101';
  });

  await page.getByRole('button', { name: /1101\s+Resultado 1/i }).click();
  await codeRequest;

  await expect(page.locator('div[draggable="true"][data-document]')).toHaveCount(initialTabCount + 1);
  await expect(page.locator('article.tipi-position')).toHaveCount(1);
  await expect(page.locator('#pos-1101')).toBeVisible();
});

test('sends TIPI view_mode according to settings selection (chapter and family)', async ({ page }) => {
  await installServicesMock(page, {
    tipiSearchResponses: [
      {
        body: {
          success: true,
          type: 'code',
          query: '1101',
          results: {
            '11': makeTipiChapterData('11', [
              {
                ncm: '1101',
                codigo: '1101',
                descricao: 'Farinhas de trigo.',
                aliquota: '0%',
                nivel: 1,
                anchor_id: 'pos-1101',
              },
            ]),
          },
          total: 1,
          total_capitulos: 1,
        },
      },
      {
        body: {
          success: true,
          type: 'code',
          query: '1201',
          results: {
            '12': makeTipiChapterData('12', [
              {
                ncm: '1201',
                codigo: '1201',
                descricao: 'Sementes de soja, mesmo trituradas.',
                aliquota: '0%',
                nivel: 1,
                anchor_id: 'pos-1201',
              },
            ]),
          },
          total: 1,
          total_capitulos: 1,
        },
      },
    ],
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'TIPI', exact: true }).click();

  await setTipiViewMode(page, 'chapter');
  const chapterRequest = page.waitForRequest((candidate) => {
    if (!candidate.url().includes('/api/tipi/search')) return false;
    return new URL(candidate.url()).searchParams.get('ncm') === '1101';
  });
  await searchTipi(page, '1101');
  const chapterUrl = (await chapterRequest).url();
  expect(new URL(chapterUrl).searchParams.get('view_mode')).toBe('chapter');
  await expect(page.locator('#pos-1101')).toBeVisible();

  await setTipiViewMode(page, 'family');
  const familyRequest = page.waitForRequest((candidate) => {
    if (!candidate.url().includes('/api/tipi/search')) return false;
    return new URL(candidate.url()).searchParams.get('ncm') === '1201';
  });
  await searchTipi(page, '1201');
  const familyUrl = (await familyRequest).url();
  expect(new URL(familyUrl).searchParams.get('view_mode')).toBe('family');
  await expect(page.locator('#pos-1201')).toBeVisible();
});
