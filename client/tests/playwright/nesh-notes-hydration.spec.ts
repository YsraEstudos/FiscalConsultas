import { expect, test } from '@playwright/test';

import { installServicesMock, makeNeshChapterData } from './fixtures/service-mocks';

test.beforeEach(async ({ page }) => {
  await installServicesMock(page, {
    unmatchedApiStrategy: 'continue',
    neshSearchResponses: [
      {
        body: {
          success: true,
          type: 'code',
          query: '8413',
          normalized: null,
          results: {
            '84': makeNeshChapterData(
              '84',
              [
                {
                  codigo: '84.13',
                  descricao: 'Bombas para líquidos, mesmo com dispositivo medidor.',
                  anchor_id: 'pos-84-13',
                },
              ],
              {
                ncm_buscado: '8413',
                posicao_alvo: '84.13',
                conteudo: '',
                notas_parseadas: {},
              },
            ),
          },
          total_capitulos: 1,
        },
      },
    ],
  });

  await page.context().route('**/api/search/chapter/84/body', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        capitulo: '84',
        conteudo: [
          '<div id="cap-84">',
          '  <h2>Capítulo 84</h2>',
          '  <h3 id="pos-84-13" data-ncm="8413">84.13</h3>',
          '  <ol class="nesh-list">',
          '    <li>Bombas para líquidos conforme a <button type="button" class="note-ref" data-note="4">Nota 4</button>.</li>',
          '  </ol>',
          '</div>',
        ].join(''),
        notas_parseadas: {
          '4': 'Nota 4 hidratada',
        },
        notas_gerais: null,
      }),
    });
  });
});

test('opens hydrated local notes after chapter body enrichment', async ({ page }) => {
  await page.goto('/');

  await page.locator('#ncmInput').fill('8413');
  await page.locator('#ncmInput').press('Enter');

  const noteRef = page.locator('.note-ref[data-note="4"]').first();
  await expect(noteRef).toBeVisible();

  await noteRef.click();

  const notePanel = page.locator('aside[aria-label="Nota 4 do Capítulo 84"]');
  await expect(notePanel).toBeVisible();
  await expect(notePanel).toContainText('Nota 4 hidratada');
  await expect(page.getByText('Nota 4 não encontrada. Mostrando notas do capítulo.')).toHaveCount(0);
});
