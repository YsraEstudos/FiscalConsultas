import { expect, test, type Page } from '@playwright/test';

import { installServicesMock } from './fixtures/service-mocks';

async function getTabDocuments(page: Page): Promise<string[]> {
  return page.locator('div[draggable="true"][data-document]').evaluateAll((tabs) =>
    tabs.map((tab) => tab.getAttribute('data-document') ?? ''),
  );
}

async function getActiveTabDocument(page: Page): Promise<string | null> {
  return page.locator('div[draggable="true"][data-document]').evaluateAll((tabs) => {
    const activeTab = tabs.find((tab) => tab.getAttribute('data-active') === 'true');
    return activeTab?.getAttribute('data-document') ?? null;
  });
}

async function expectTabOrder(page: Page, expectedOrder: string[]) {
  await expect.poll(async () => getTabDocuments(page)).toEqual(expectedOrder);
}

async function createSeedTabs(page: Page) {
  await page.goto('/');
  await expect(page.locator('div[draggable="true"][data-document]')).toHaveCount(1);

  await page.getByTitle('Nova aba').click();
  await page.getByRole('button', { name: 'TIPI', exact: true }).click();

  await page.getByTitle('Nova aba').click();
  await page.getByRole('button', { name: /Menu/, exact: true }).click();
  await page.getByRole('button', { name: /Serviços \(NBS\)/ }).click();

  await expectTabOrder(page, ['nesh', 'tipi', 'nbs']);
  await expect.poll(async () => getActiveTabDocument(page)).toBe('nbs');
}

test.beforeEach(async ({ page }) => {
  await installServicesMock(page);
});

test('creates tabs with distinct docs and switches active tab on click', async ({ page }) => {
  await createSeedTabs(page);

  const tabs = page.locator('div[draggable="true"][data-document]');
  await tabs.nth(0).click();
  await expect.poll(async () => getActiveTabDocument(page)).toBe('nesh');

  await tabs.nth(1).click();
  await expect.poll(async () => getActiveTabDocument(page)).toBe('tipi');

  await tabs.nth(2).click();
  await expect.poll(async () => getActiveTabDocument(page)).toBe('nbs');
});

test('closes tabs via close button and middle-click while keeping the last tab open', async ({ page }) => {
  await createSeedTabs(page);

  const tabs = page.locator('div[draggable="true"][data-document]');
  await tabs.nth(1).getByTitle('Fechar aba').click();
  await expectTabOrder(page, ['nesh', 'nbs']);

  await tabs.nth(0).click({ button: 'middle' });
  await expectTabOrder(page, ['nbs']);

  await tabs.nth(0).getByTitle('Fechar aba').click();
  await expectTabOrder(page, ['nbs']);
});

test('reorders tabs with drag-and-drop', async ({ page }) => {
  await createSeedTabs(page);

  const tabs = page.locator('div[draggable="true"][data-document]');
  await tabs.nth(0).dragTo(tabs.nth(2));
  await expectTabOrder(page, ['tipi', 'nesh', 'nbs']);

  await tabs.nth(2).dragTo(tabs.nth(0));
  await expectTabOrder(page, ['nbs', 'tipi', 'nesh']);
});

test('switches tabs with Enter and Space keyboard interactions', async ({ page }) => {
  await createSeedTabs(page);

  const tabs = page.locator('div[draggable="true"][data-document]');

  await tabs.nth(0).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => getActiveTabDocument(page)).toBe('nesh');

  await tabs.nth(1).focus();
  await page.keyboard.press('Space');
  await expect.poll(async () => getActiveTabDocument(page)).toBe('tipi');
});
