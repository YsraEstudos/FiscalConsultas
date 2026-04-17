import { expect, test } from "@playwright/test";

import { installServicesMock } from "./fixtures/service-mocks";

test("keeps navigation behavior controls inside the settings modal on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installServicesMock(page, { unmatchedApiStrategy: "continue" });

  await page.goto("/");
  await page.getByRole("button", { name: /Menu/, exact: true }).click();
  await page.getByRole("button", { name: /Configurações/ }).click();

  const modal = page.locator('dialog[aria-labelledby="settings-modal-title"]');
  await expect(modal).toBeVisible();

  const row = page.getByTestId("navigation-behavior-item");
  await expect(row).toBeVisible();

  const modalHasHorizontalOverflow = await modal.evaluate(
    (element) => element.scrollWidth > element.clientWidth,
  );
  expect(modalHasHorizontalOverflow).toBe(false);

  const rowHasHorizontalOverflow = await row.evaluate(
    (element) => element.scrollWidth > element.clientWidth,
  );
  expect(rowHasHorizontalOverflow).toBe(false);

  const modalBox = await modal.boundingBox();
  if (!modalBox) {
    throw new Error("Settings modal bounding box was not available");
  }

  const toggleGroup = row.getByTestId("navigation-behavior-toggle-group");
  const toggleGroupBox = await toggleGroup.boundingBox();
  if (!toggleGroupBox) {
    throw new Error("Navigation toggle group bounding box was not available");
  }

  expect(toggleGroupBox.x).toBeGreaterThanOrEqual(modalBox.x + 8);
  expect(toggleGroupBox.x + toggleGroupBox.width).toBeLessThanOrEqual(
    modalBox.x + modalBox.width - 8,
  );

  const buttons = row.getByRole("button");
  await expect(buttons).toHaveCount(2);

  for (let index = 0; index < 2; index += 1) {
    const buttonBox = await buttons.nth(index).boundingBox();
    if (!buttonBox) {
      throw new Error(`Button bounding box was not available at index ${index}`);
    }

    expect(buttonBox.x).toBeGreaterThanOrEqual(modalBox.x + 8);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(
      modalBox.x + modalBox.width - 8,
    );
  }
});
