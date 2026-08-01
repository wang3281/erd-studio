import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MARKETPLACE_DDL = readFileSync(
  new URL("../../examples/marketplace-platform.sql", import.meta.url),
  "utf8",
);
const EVIDENCE_DIR = resolve(
  process.cwd(),
  "../artifacts/release-readiness-0.1.0-alpha/playwright",
);

async function importMarketplace(page: Page) {
  const ddlButton = page.getByRole("button", { name: "DDL Import", exact: true });
  await expect(ddlButton).toBeEnabled();
  await ddlButton.click();

  const dialog = page.getByRole("dialog", { name: "Import DDL", exact: true });
  await dialog.getByRole("textbox", { name: "DDL input", exact: true }).fill(MARKETPLACE_DDL);
  await dialog.getByRole("radio", { name: "Replace current diagram", exact: true }).check();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();

  const status = page.getByRole("status");
  await expect(status).toContainText("Entities: 26");
  await expect(status).toContainText("Relations: 47");
  await expect(status).toContainText("Zoom: 25%");
}

test("realistic large ERD remains navigable, accessible, and local-only offline", async ({ page }) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("erd-tool:welcome-dismissed", "1");
    localStorage.setItem("erd-edit-token", "legacy-password");
    localStorage.setItem("erd-edit-role", "admin");
  });

  const projectWrites: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/projects(?:\/|$)/.test(request.url()) && request.method() !== "GET") {
      projectWrites.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Local draft — Export JSON to keep");
  expect(await page.evaluate(() => ({
    token: localStorage.getItem("erd-edit-token"),
    role: localStorage.getItem("erd-edit-role"),
  }))).toEqual({ token: null, role: null });

  await importMarketplace(page);
  expect(await page.locator('button[tabindex="-1"]').count()).toBe(0);
  expect(await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({
    path: resolve(EVIDENCE_DIR, "large-erd-1440x900.png"),
    animations: "disabled",
  });

  await page.locator(".canvas-container > canvas").press("Control+k");
  const navigator = page.getByRole("dialog", { name: "Find an entity", exact: true });
  const search = navigator.getByRole("combobox", { name: "Search tables and columns", exact: true });
  await search.fill("tracking_number");
  await expect(navigator.getByRole("option")).toHaveCount(1);
  await expect(navigator.getByRole("option")).toContainText("shipments");
  await search.press("Enter");

  await expect(page.getByRole("status")).toContainText("Zoom: 75%");
  await expect(page.locator(".editor > fieldset > label:first-of-type input")).toHaveValue("shipments");

  const columnSearch = page.getByLabel("Search columns", { exact: true });
  await columnSearch.fill("status");
  await expect(page.locator(".column-search span")).toHaveText("1 of 11");
  await expect(page.locator(".column-editor-block")).toHaveCount(1);

  await page.setViewportSize({ width: 1024, height: 768 });
  expect(await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({
    path: resolve(EVIDENCE_DIR, "navigator-1024x768.png"),
    animations: "disabled",
  });

  await expect(page.getByRole("button", { name: "Open", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.waitForTimeout(500);
  expect(projectWrites).toEqual([]);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({ id: violation.id, impact: violation.impact })),
  ).toEqual([]);
});
