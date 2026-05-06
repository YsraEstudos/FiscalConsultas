import { expect, test, type Page } from '@playwright/test';

import { installServicesMock, makeNeshChapterData } from './fixtures/service-mocks';

test.skip(true, 'Legacy search-backed auth capability flow retired; future coverage should use account APIs only.');

type AuthSessionPayload = {
  authenticated: boolean;
  can_use_ai_chat: boolean;
  can_use_restricted_ui: boolean;
};

async function installAuthSessionMock(page: Page, payload: AuthSessionPayload) {
  await page.context().route('**/api/auth/me*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

async function installNeshSearchMock(page: Page) {
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
}

async function runNeshSearch(page: Page, query: string) {
  const searchRequest = page.waitForRequest((request) => {
    if (!request.url().includes('/api/search')) return false;
    return new URL(request.url()).searchParams.get('ncm') === query;
  });

  await page.locator('#ncmInput').fill(query);
  await page.locator('#ncmInput').press('Enter');
  await searchRequest;
}

test('enables restricted UI and AI chat when /api/auth/me returns allowed capabilities', async ({ page }) => {
  await installNeshSearchMock(page);
  await installAuthSessionMock(page, {
    authenticated: true,
    can_use_ai_chat: true,
    can_use_restricted_ui: true,
  });

  const authMeResponse = page.waitForResponse((response) =>
    response.url().includes('/api/auth/me') && response.request().method() === 'GET',
  );

  await page.goto('/');
  await authMeResponse;

  await expect(page.getByTitle('Abrir Chat IA')).toBeVisible();

  await runNeshSearch(page, '8404');

  await expect(page.locator('#results-content-tab-1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ativar comentários' })).toBeVisible();
});

test('keeps restricted UI and AI chat hidden when /api/auth/me denies capabilities', async ({ page }) => {
  await installNeshSearchMock(page);
  await installAuthSessionMock(page, {
    authenticated: true,
    can_use_ai_chat: false,
    can_use_restricted_ui: false,
  });

  const authMeResponse = page.waitForResponse((response) =>
    response.url().includes('/api/auth/me') && response.request().method() === 'GET',
  );

  await page.goto('/');
  await authMeResponse;

  await expect(page.getByTitle('Abrir Chat IA')).toHaveCount(0);

  await runNeshSearch(page, '8404');

  await expect(page.locator('#results-content-tab-1')).toBeVisible();
  await expect(page.getByRole('button', { name: /comentários/i })).toHaveCount(0);
});
