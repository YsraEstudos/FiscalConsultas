import { expect, test, type Page, type Request, type Route } from '@playwright/test';

import { makeNeshChapterData, installServicesMock } from './fixtures/service-mocks';

test.use({
  viewport: { width: 1440, height: 900 },
});

type AuthSessionPayload = {
  authenticated: boolean;
  can_use_ai_chat: boolean;
  can_use_restricted_ui: boolean;
};

type CommentStatus = 'pending' | 'approved' | 'rejected' | 'private';

type MockComment = {
  id: number;
  tenant_id: string;
  user_id: string;
  anchor_key: string;
  selected_text: string;
  body: string;
  status: CommentStatus;
  created_at: string;
  updated_at: string;
  moderated_by: string | null;
  moderated_at: string | null;
  user_name: string | null;
  user_image_url: string | null;
};

type CommentApiState = {
  comments: MockComment[];
  nextId: number;
  createdRequests: Array<{
    anchor_key: string;
    selected_text: string;
    body: string;
    is_private: boolean;
  }>;
  updatedRequests: Array<{
    id: number;
    body: string;
  }>;
  deletedRequests: number[];
  moderatedRequests: Array<{
    id: number;
    action: 'approve' | 'reject';
    note: string | null;
  }>;
};

function buildNeshCodeSearchResponse() {
  return {
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
        '  <article id="pos-84-04" data-anchor-id="pos-84-04" data-ncm="84.04">',
        '    84.04 - Aparelhos auxiliares para caldeiras. Este trecho é suficiente para seleção e comentários.',
        '  </article>',
        '</div>',
      ].join('\n'),
    },
  };
}

function createCommentResponse(overrides: Partial<MockComment> = {}): MockComment {
  const now = '2026-03-13T12:00:00.000Z';
  return {
    id: 1,
    tenant_id: 'tenant_e2e',
    user_id: 'user_e2e',
    anchor_key: 'pos-84-04',
    selected_text: '84.04 - Aparelhos auxiliares para caldeiras. Este trecho é suficiente para seleção e comentários.',
    body: 'Comentário de teste',
    status: 'approved',
    created_at: now,
    updated_at: now,
    moderated_by: null,
    moderated_at: null,
    user_name: 'E2E User',
    user_image_url: null,
    ...overrides,
  };
}

function installAuthSessionMock(page: Page, payload: AuthSessionPayload) {
  return page.context().route('**/api/auth/me*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function handlePendingComments(route: Route, state: CommentApiState) {
  await fulfillJson(
    route,
    200,
    state.comments.filter((comment) => comment.status === 'pending'),
  );
}

async function handleAdminModeration(route: Route, request: Request, commentId: number, state: CommentApiState) {
  const payload = request.postDataJSON() as { action: 'approve' | 'reject'; note?: string };
  const current = state.comments.find((comment) => comment.id === commentId);

  state.moderatedRequests.push({
    id: commentId,
    action: payload.action,
    note: typeof payload.note === 'string' ? payload.note : null,
  });

  if (!current) {
    await fulfillJson(route, 404, {});
    return;
  }

  const updated: MockComment = {
    ...current,
    status: payload.action === 'approve' ? 'approved' : 'rejected',
    moderated_by: 'user_e2e',
    moderated_at: '2026-03-13T12:03:00.000Z',
    updated_at: '2026-03-13T12:03:00.000Z',
  };
  state.comments = state.comments.map((comment) => (comment.id === commentId ? updated : comment));

  await fulfillJson(route, 200, updated);
}

async function handleCommentAnchors(route: Route, state: CommentApiState) {
  const anchors = [...new Set(
    state.comments
      .filter((comment) => comment.status !== 'rejected')
      .map((comment) => comment.anchor_key),
  )];

  await fulfillJson(route, 200, anchors);
}

async function handleAnchorComments(route: Route, path: string, state: CommentApiState) {
  const anchorKey = decodeURIComponent(path.split('/anchor/')[1] || '');
  const comments = state.comments.filter((comment) => comment.anchor_key === anchorKey);

  await fulfillJson(route, 200, comments);
}

async function handleCreateComment(route: Route, request: Request, state: CommentApiState) {
  const payload = request.postDataJSON() as {
    anchor_key: string;
    selected_text: string;
    body: string;
    is_private: boolean;
  };

  state.createdRequests.push(payload);

  const created = createCommentResponse({
    id: state.nextId++,
    anchor_key: payload.anchor_key,
    selected_text: payload.selected_text,
    body: payload.body,
    status: payload.is_private ? 'private' : 'pending',
    created_at: '2026-03-13T12:01:00.000Z',
    updated_at: '2026-03-13T12:01:00.000Z',
    user_id: 'user_e2e',
    user_name: 'E2E User',
  });

  state.comments.push(created);

  await fulfillJson(route, 201, created);
}

async function handleUpdateComment(route: Route, request: Request, commentId: number, state: CommentApiState) {
  const payload = request.postDataJSON() as { body: string };

  state.updatedRequests.push({
    id: commentId,
    body: payload.body,
  });

  const current = state.comments.find((comment) => comment.id === commentId);
  if (!current) {
    await fulfillJson(route, 404, {});
    return;
  }

  const updated: MockComment = {
    ...current,
    body: payload.body,
    updated_at: '2026-03-13T12:02:00.000Z',
  };
  state.comments = state.comments.map((comment) => (comment.id === commentId ? updated : comment));

  await fulfillJson(route, 200, updated);
}

async function handleDeleteComment(route: Route, commentId: number, state: CommentApiState) {
  state.deletedRequests.push(commentId);
  state.comments = state.comments.filter((comment) => comment.id !== commentId);

  await route.fulfill({ status: 204, body: '' });
}

function installCommentApiMock(page: Page, state: CommentApiState) {
  return page.context().route('**/api/comments/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path.endsWith('/comments/admin/pending') && method === 'GET') {
      await handlePendingComments(route, state);
      return;
    }

    const adminCommentMatch = /\/comments\/admin\/(\d+)$/.exec(path);
    if (adminCommentMatch && method === 'PATCH') {
      await handleAdminModeration(route, request, Number(adminCommentMatch[1]), state);
      return;
    }

    if (path.endsWith('/comments/anchors') && method === 'GET') {
      await handleCommentAnchors(route, state);
      return;
    }

    if (path.includes('/comments/anchor/') && method === 'GET') {
      await handleAnchorComments(route, path, state);
      return;
    }

    if (path.endsWith('/comments/') && method === 'POST') {
      await handleCreateComment(route, request, state);
      return;
    }

    const commentIdMatch = /\/comments\/(\d+)$/.exec(path);
    if (commentIdMatch && method === 'PATCH') {
      await handleUpdateComment(route, request, Number(commentIdMatch[1]), state);
      return;
    }

    if (commentIdMatch && method === 'DELETE') {
      await handleDeleteComment(route, Number(commentIdMatch[1]), state);
      return;
    }

    await route.fallback();
  });
}

async function openNeshCodeSearch(page: Page, query: string) {
  const request = page.waitForRequest((candidate) => {
    if (!candidate.url().includes('/api/search')) return false;
    if (candidate.url().includes('/api/services/')) return false;
    return new URL(candidate.url()).searchParams.get('ncm') === query;
  });

  await page.locator('#ncmInput').fill(query);
  await page.locator('#ncmInput').press('Enter');
  await request;
}

async function enableComments(page: Page) {
  await page.getByRole('button', { name: 'Ativar comentários' }).click();
  await expect(page.getByRole('button', { name: 'Desativar comentários' })).toBeVisible();
}

async function prepareCommentJourney(page: Page, options: { comments?: MockComment[] } = {}) {
  const state: CommentApiState = {
    comments: [...(options.comments ?? [])],
    nextId: (options.comments?.reduce((max, comment) => Math.max(max, comment.id), 0) ?? 0) + 1,
    createdRequests: [],
    updatedRequests: [],
    deletedRequests: [],
    moderatedRequests: [],
  };

  await installServicesMock(page, {
    neshSearchResponses: [buildNeshCodeSearchResponse()],
  });
  await installAuthSessionMock(page, {
    authenticated: true,
    can_use_ai_chat: true,
    can_use_restricted_ui: true,
  });
  await installCommentApiMock(page, state);

  const authMeResponse = page.waitForResponse((response) =>
    response.url().includes('/api/auth/me') && response.request().method() === 'GET',
  );

  await page.goto('/');
  await authMeResponse;
  await expect(page.getByRole('heading', { name: 'FiscalConsultas' })).toBeVisible();

  return state;
}

test('desktop comment panel loads, edits, and removes an owned comment', async ({ page }) => {
  const state = await prepareCommentJourney(page, {
    comments: [
      createCommentResponse({
        id: 1,
        body: 'Comentário inicial',
        status: 'approved',
      }),
    ],
  });

  await test.step('Open the NESH result and enable comments', async () => {
    await openNeshCodeSearch(page, '8404');
    await expect(page.locator('#pos-84-04')).toBeVisible();

    await enableComments(page);
    await expect(page.locator('#pos-84-04')).toHaveClass(/has-comment/);
  });

  await test.step('Load the existing comment from the highlighted anchor', async () => {
    const loadRequest = page.waitForRequest((request) =>
      request.url().includes('/api/comments/anchor/pos-84-04') && request.method() === 'GET',
    );

    await page.locator('#pos-84-04').click();
    await loadRequest;

    const commentCard = page.locator('[data-comment-card-id="1"]');
    await expect(commentCard).toBeVisible();
    await expect(commentCard).toContainText('Comentário inicial');
  });

  await test.step('Edit the comment through the panel', async () => {
    const commentCard = page.locator('[data-comment-card-id="1"]');
    await commentCard.hover();
    await commentCard.getByRole('button', { name: 'Editar comentário' }).click();

    const editTextarea = page.getByRole('textbox', { name: 'Editar comentário' });
    await expect(editTextarea).toBeVisible();
    await editTextarea.fill('Comentário inicial revisado');

    const patchRequest = page.waitForRequest((request) =>
      request.url().includes('/api/comments/1') && request.method() === 'PATCH',
    );

    await commentCard.getByRole('button', { name: 'Salvar' }).click();
    await patchRequest;

    await expect(commentCard).toContainText('Comentário inicial revisado');
  });

  await test.step('Remove the comment from the panel', async () => {
    const commentCard = page.locator('[data-comment-card-id="1"]');
    await commentCard.hover();

    const deleteRequest = page.waitForRequest((request) =>
      request.url().includes('/api/comments/1') && request.method() === 'DELETE',
    );

    await commentCard.getByRole('button', { name: 'Excluir comentário' }).click();
    await page.getByRole('button', { name: 'Sim, excluir' }).click();
    await deleteRequest;

    await expect(commentCard).toHaveCount(0);
  });

  expect(state.createdRequests).toHaveLength(0);
  expect(state.updatedRequests).toEqual([
    {
      id: 1,
      body: 'Comentário inicial revisado',
    },
  ]);
  expect(state.deletedRequests).toEqual([1]);
});

test('mobile comment drawer creates a private comment from selected text', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  const state = await prepareCommentJourney(page);

  await test.step('Open the NESH result and enable comments', async () => {
    await openNeshCodeSearch(page, '8404');
    await expect(page.locator('#pos-84-04')).toBeVisible();

    await enableComments(page);
    await expect(page.getByLabel(/Abrir comentários/)).toBeVisible();
  });

  await test.step('Select text and open the comment drawer', async () => {
    const position = page.locator('#pos-84-04');
    await position.scrollIntoViewIfNeeded();
    await position.selectText();
    await position.evaluate((el) => {
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    });

    const bubble = page.getByLabel('Adicionar comentário ao trecho selecionado');
    await expect(bubble).toBeVisible();
    await bubble.click();

    await expect(page.getByRole('heading', { name: 'Comentários' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Texto do comentário' }).last()).toBeVisible();
  });

  await test.step('Submit a private comment and verify the payload', async () => {
    const createRequest = page.waitForRequest((request) =>
      request.url().includes('/api/comments/') && request.method() === 'POST',
    );

    const drawerTextarea = page.getByRole('textbox', { name: 'Texto do comentário' }).last();
    const drawerPrivateToggle = page.getByRole('checkbox', { name: 'Comentário privado' }).last();
    const drawerSubmit = page.getByRole('button', { name: 'Comentar' }).last();

    await expect(drawerTextarea).toBeVisible();
    await drawerTextarea.fill('Comentário privado criado no drawer');
    await drawerPrivateToggle.check();
    await drawerSubmit.click();

    const request = await createRequest;
    expect(request.postDataJSON()).toMatchObject({
      anchor_key: 'pos-84-04',
      selected_text: '84.04 - Aparelhos auxiliares para caldeiras. Este trecho é suficiente para seleção e comentários.',
      body: 'Comentário privado criado no drawer',
      is_private: true,
    });

    const visibleCommentBody = page.getByText('Comentário privado criado no drawer').last();
    await expect(visibleCommentBody).toBeVisible();
  });

  expect(state.createdRequests).toEqual([
    {
      anchor_key: 'pos-84-04',
      selected_text: '84.04 - Aparelhos auxiliares para caldeiras. Este trecho é suficiente para seleção e comentários.',
      body: 'Comentário privado criado no drawer',
      is_private: true,
    },
  ]);
  expect(state.updatedRequests).toHaveLength(0);
  expect(state.deletedRequests).toHaveLength(0);
});

async function openAdminModerationModal(page: Page) {
  await page.getByRole('button', { name: /Menu/, exact: true }).click();
  await page.getByRole('button', { name: /Moderar Comentários/ }).click();
  await expect(page.getByRole('heading', { name: /Moderar Comentários/ })).toBeVisible();
}

test('admin moderation modal approves a pending comment with notes', async ({ page }) => {
  const state = await prepareCommentJourney(page, {
    comments: [
      createCommentResponse({
        id: 11,
        status: 'pending',
        body: 'Comentário pendente para aprovar',
      }),
    ],
  });

  await openAdminModerationModal(page);

  const moderationDialog = page.getByRole('dialog', { name: /Moderar Comentários/ });
  await expect(moderationDialog.getByText('Comentário pendente para aprovar')).toBeVisible();

  const noteField = moderationDialog.getByPlaceholder('Nota de moderação (opcional)…');
  await noteField.fill('Conferido pela auditoria');

  const moderateRequest = page.waitForRequest((request) =>
    request.url().includes('/api/comments/admin/11') && request.method() === 'PATCH',
  );

  await moderationDialog.getByRole('button', { name: /Aprovar/ }).click();
  await moderateRequest;

  expect(state.moderatedRequests).toEqual([
    {
      id: 11,
      action: 'approve',
      note: 'Conferido pela auditoria',
    },
  ]);
  await expect(moderationDialog.getByText('Nenhum comentário pendente de moderação')).toBeVisible();
});

test('admin moderation modal rejects a pending comment without notes', async ({ page }) => {
  const state = await prepareCommentJourney(page, {
    comments: [
      createCommentResponse({
        id: 12,
        status: 'pending',
        body: 'Comentário pendente para rejeitar',
      }),
    ],
  });

  await openAdminModerationModal(page);

  const moderationDialog = page.getByRole('dialog', { name: /Moderar Comentários/ });
  await expect(moderationDialog.getByText('Comentário pendente para rejeitar')).toBeVisible();

  const moderateRequest = page.waitForRequest((request) =>
    request.url().includes('/api/comments/admin/12') && request.method() === 'PATCH',
  );

  await moderationDialog.getByRole('button', { name: /Rejeitar/ }).click();
  await moderateRequest;

  expect(state.moderatedRequests).toEqual([
    {
      id: 12,
      action: 'reject',
      note: null,
    },
  ]);
  await expect(moderationDialog.getByText('Nenhum comentário pendente de moderação')).toBeVisible();
});
