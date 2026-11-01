import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const SMALL_DDL = `
CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  email VARCHAR(255) NOT NULL
);
CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id)
);
`;

async function importSmallSchema(page: Page) {
  await page.getByRole("button", { name: "DDL Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import DDL", exact: true });
  await dialog.getByRole("textbox", { name: "DDL input", exact: true }).fill(SMALL_DDL);
  await dialog.getByRole("radio", { name: "Replace current diagram", exact: true }).check();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Entities: 2");
}

async function readDraftSlot(page: Page): Promise<unknown> {
  return page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("erd-studio", 1);
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction("drafts", "readonly").objectStore("drafts").get("current");
      get.onsuccess = () => { db.close(); resolve(get.result ?? null); };
      get.onerror = () => { db.close(); resolve(null); };
    };
    req.onerror = () => resolve(null);
  }));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("erd-tool:welcome-dismissed", "1");
  });
});

test("offline edits survive a reload and can be restored", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Local draft — kept in this browser");
  await expect(page.getByRole("region", { name: "Unsaved draft" })).toHaveCount(0);

  await importSmallSchema(page);
  await expect.poll(() => readDraftSlot(page), { timeout: 5_000 }).not.toBeNull();

  await page.reload();
  const banner = page.getByRole("region", { name: "Unsaved draft" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("(2 tables)");
  // Nothing is restored until the user asks for it.
  await expect(page.getByRole("status")).toContainText("Entities: 0");

  const axe = await new AxeBuilder({ page }).include(".draft-banner").analyze();
  expect(axe.violations).toEqual([]);

  await banner.getByRole("button", { name: "Restore draft", exact: true }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Entities: 2");
  await expect(page.getByRole("status")).toContainText("Relations: 1");

  // The restored draft is still unsaved work and keeps being backed up.
  await page.reload();
  await expect(page.getByRole("region", { name: "Unsaved draft" })).toContainText("(2 tables)");
});

test("discarding the offered draft removes it", async ({ page }) => {
  await page.goto("/");
  await importSmallSchema(page);
  await expect.poll(() => readDraftSlot(page), { timeout: 5_000 }).not.toBeNull();

  await page.reload();
  const banner = page.getByRole("region", { name: "Unsaved draft" });
  await banner.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => readDraftSlot(page), { timeout: 5_000 }).toBeNull();

  await page.reload();
  await expect(page.getByRole("status")).toContainText("Entities: 0");
  await expect(page.getByRole("region", { name: "Unsaved draft" })).toHaveCount(0);
});

test("a confirmed server save clears the browser draft", async ({ page }) => {
  let savedBody: unknown = null;
  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, canEdit: true, editorRole: "editor", canUseAI: false, user: null }),
  }));
  await page.route("**/api/projects/**", async (route) => {
    if (route.request().method() === "PUT") {
      savedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: '"2026-11-01T13:00:00.000Z"' },
        body: JSON.stringify({ updatedAt: "2026-11-01T13:00:00.000Z" }),
      });
      return;
    }
    await route.fulfill({ status: 404, body: "{}" });
  });

  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("New draft — Save As required");
  await importSmallSchema(page);
  await expect.poll(() => readDraftSlot(page), { timeout: 5_000 }).not.toBeNull();

  await page.getByRole("button", { name: "Save As", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save As", exact: true });
  await dialog.getByRole("textbox", { name: "Project name", exact: true }).fill("shop");
  await dialog.getByRole("button", { name: "Save Copy", exact: true }).click();
  // Scope to the status bar: the success toast is also a status region.
  await expect(page.locator(".statusbar")).toContainText("Saved");
  expect(savedBody).not.toBeNull();

  await expect.poll(() => readDraftSlot(page), { timeout: 5_000 }).toBeNull();
  await page.reload();
  await expect(page.getByRole("region", { name: "Unsaved draft" })).toHaveCount(0);
});
