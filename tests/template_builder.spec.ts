import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import {
  BASE_URL,
  TIMEOUTS,
  login,
  capture,
  clearBlockingOverlays,
  dismissPostLoginOverlays,
} from "./lib/helpers";

// =============================================================================
// Template Builder sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Template Builder". ~70+ real cases across the Template Builder
// list page + New Template dialog + template canvas editor.
//
// Ships 4 non-destructive tests over the list page + New Template
// dialog. No template is created, so the shared library stays clean.
//
// Skipped (documented):
//   - R04-R06 — cross-department verification (needs multi-user).
//   - R09-R11 — actually create templates (destructive on shared
//     library).
//   - R14-R16 — Select-all + Delete (destructive).
//   - R17-R38+ — open the template canvas + edit + save + undo/redo
//     (destructive + canvas-heavy).
// =============================================================================

const TB = testdata.templateBuilder;
const SEL = TB.selectors;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function gotoTemplateBuilder(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + TB.path);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  await expect(
    page.getByRole("heading", { name: SEL.pageHeading, level: 1 }),
  ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

async function openNewTemplateDialog(page: Page): Promise<void> {
  await clearBlockingOverlays(page);
  await page.locator(SEL.createMenuButton).click();
  // The Create menu shows a "Template" button on the Template Builder
  // page. Use exact match — otherwise "Template Builder" nav link
  // matches too.
  await page
    .getByRole("button", { name: SEL.templateMenuItemName, exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText(SEL.dialogHeadingName, { exact: true }),
    "New Template dialog must render",
  ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

test.describe.configure({ mode: "serial" });

test.describe("Template Builder — list page + New Template dialog", () => {
  test.setTimeout(TIMEOUTS.test);

  test("template_builder_landmarks_render: list + search + delete + department filter + preview", async ({ page }, info) => {
    caseIds(info, "TB.R01", "TB.R02");
    await gotoTemplateBuilder(page);
    await step(page, info, 1, "on-template-builder");

    // At least one saved template card should render (tenant has 9).
    const cards = page.locator(SEL.templateCards);
    const count = await cards.count();
    expect(
      count,
      "Template Builder must render at least one saved template card",
    ).toBeGreaterThan(0);

    await expect(page.locator(SEL.searchInput)).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(page.locator(SEL.deleteButton)).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(page.locator(SEL.departmentFilterButton)).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(page.locator(SEL.selectAllCheckbox)).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    // Preview panel placeholder shows when no template is selected.
    await expect(page.getByText(SEL.previewPlaceholderText)).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 2, "landmarks-verified");
  });

  test("new_template_dialog_opens_and_close_x_dismisses: dialog opens with Name field + Close is non-destructive", async ({ page }, info) => {
    caseIds(info, "TB.R03", "TB.R07");
    await gotoTemplateBuilder(page);
    await openNewTemplateDialog(page);
    await step(page, info, 1, "dialog-open");

    await expect(
      page.locator(SEL.nameInput),
      "mandatory Template Name field must render",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });

    // Close via the X.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: SEL.closeButtonName })
      .click();
    await expect(
      page.getByRole("dialog").getByText(SEL.dialogHeadingName, { exact: true }),
    ).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
    await step(page, info, 2, "dialog-closed");
  });

  test("create_button_disabled_until_name_provided: mandatory name gates Create", async ({ page }, info) => {
    caseIds(info, "TB.R08");
    await gotoTemplateBuilder(page);
    await openNewTemplateDialog(page);

    const createBtn = page.locator(SEL.createButton);
    await expect(
      createBtn,
      "Create must start disabled with empty name",
    ).toBeDisabled({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "create-disabled-initial");

    await page.locator(SEL.nameInput).fill("NonPersistentProbeName");
    await expect(
      createBtn,
      "Create must enable once a Template Name is provided",
    ).toBeEnabled({ timeout: TIMEOUTS.buttonEnabled });
    await step(page, info, 2, "create-enabled");

    // Do NOT click Create — close via X to avoid persisting a template.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: SEL.closeButtonName })
      .click();
    await expect(
      page.getByRole("dialog").getByText(SEL.dialogHeadingName, { exact: true }),
    ).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
  });

  test("search_filters_template_list: typing narrows the visible cards", async ({ page }, info) => {
    caseIds(info, "TB.R12");
    await gotoTemplateBuilder(page);

    const cards = page.locator(SEL.templateCards);
    const initialCount = await cards.count();
    expect(
      initialCount,
      "must have at least one card before filtering",
    ).toBeGreaterThan(0);
    await step(page, info, 1, "initial-count-verified");

    await page.locator(SEL.searchInput).fill(TB.searchKeyword);
    // The list must shrink — every remaining card's label contains
    // the keyword (case-insensitive).
    await expect
      .poll(async () => await cards.count(), {
        message: `search "${TB.searchKeyword}" must reduce the template list`,
        timeout: TIMEOUTS.elementVisible,
      })
      .toBeLessThan(initialCount);
    const filteredCount = await cards.count();
    expect(
      filteredCount,
      `search "${TB.searchKeyword}" must return at least one match`,
    ).toBeGreaterThan(0);
    const labels = (await cards.allTextContents()).map((s) => s.trim().toLowerCase());
    for (const label of labels) {
      expect(
        label,
        `filtered card "${label}" must contain "${TB.searchKeyword}"`,
      ).toContain(TB.searchKeyword.toLowerCase());
    }
    await step(page, info, 2, "filter-applied");
  });
});
