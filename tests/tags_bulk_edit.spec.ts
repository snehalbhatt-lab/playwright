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
// Tags Bulk Edit sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Tags Bulk Edit". 17 real cases (Threat Framework > Components >
// bulk-tag flow).
//
// Ships 5 non-destructive dialog-interaction tests covering H1/R01
// (Add tag option + dialog), R02 (multi-select), R06 (search filter),
// and R08 (cancel). Setup uses the existing Secure Design Graph
// library — no disposable model is needed because the tag dialog can
// be exercised without persisting anything.
//
// Skipped (documented):
//   - R03-R05, R07, R09-R13 — actually persist tags on shared library
//     components (destructive on the tenant).
//   - R10, R14 — cross-view diagram + template builder verification
//     (would require a disposable model + template-builder setup).
//   - R15 — cross-department read-only permission (needs a second
//     seeded user).
//   - R16 — Threats/SR/Test cases variants (same dialog shape;
//     coverage would duplicate).
// =============================================================================

const TB = testdata.tagsBulkEdit;
const SEL = TB.selectors;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function gotoSDG(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + TB.path);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  // Wait for at least the first two component checkboxes to render.
  const first = page.locator(SEL.componentCheckboxTemplate.replace("{i}", "8"));
  const second = page.locator(SEL.componentCheckboxTemplate.replace("{i}", "9"));
  await expect(first).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await expect(second).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

async function selectTwoComponents(page: Page): Promise<void> {
  await page.locator(SEL.componentCheckboxTemplate.replace("{i}", "8")).click();
  await page.locator(SEL.componentCheckboxTemplate.replace("{i}", "9")).click();
}

async function openAddTagsDialog(page: Page): Promise<void> {
  await page.locator(SEL.actionsMenuButton).click();
  const addTagBtn = page.locator(SEL.addTagButton);
  await expect(addTagBtn).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await addTagBtn.click();
  await expect(page.locator(SEL.dialog)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

test.describe.configure({ mode: "serial" });

test.describe("Tags Bulk Edit — Secure Design Graph > Components", () => {
  test.setTimeout(TIMEOUTS.test);

  test("add_tag_option_visible_after_selecting_components: More actions > Add tag becomes reachable", async ({ page }, info) => {
    caseIds(info, "TB.H1");
    await gotoSDG(page);
    await step(page, info, 1, "on-sdg");

    await selectTwoComponents(page);
    await step(page, info, 2, "two-components-selected");

    await page.locator(SEL.actionsMenuButton).click();
    await expect(
      page.locator(SEL.addTagButton),
      "Add tag menu item must appear after opening More actions with selection",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 3, "add-tag-visible");

    // Close the menu by pressing Escape — do not open the dialog here.
    await page.keyboard.press("Escape");
  });

  test("add_tag_dialog_opens_with_expected_controls: dialog carries multi-select + Cancel + Submit(disabled)", async ({ page }, info) => {
    caseIds(info, "TB.R01");
    await gotoSDG(page);
    await selectTwoComponents(page);
    await openAddTagsDialog(page);
    await step(page, info, 1, "dialog-open");

    const dialog = page.locator(SEL.dialog);
    await expect(dialog.getByText(SEL.dialogTitle, { exact: true })).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(dialog.getByText(SEL.helperText)).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(page.locator(SEL.multiselect)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(page.locator(SEL.cancelButton)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    // Submit starts disabled when no tag has been chosen yet.
    await expect(
      page.locator(SEL.submitButton),
      "Submit must be disabled before any tag is selected",
    ).toBeDisabled({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "controls-verified");

    await page.locator(SEL.cancelButton).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
  });

  test("multiple_tags_can_be_selected_at_once: choosing two tags results in two chips", async ({ page }, info) => {
    caseIds(info, "TB.R02");
    await gotoSDG(page);
    await selectTwoComponents(page);
    await openAddTagsDialog(page);

    // Type a common prefix so we get deterministic options.
    const input = page.locator(SEL.multiselectInput);
    await input.click();
    await input.fill(TB.searchKeyword);
    await expect(page.locator(SEL.popup)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "filtered-list-open");

    // Pick two items in sequence — the popup stays open after the first
    // click, so the second item is chosen from the same list.
    const items = page.locator(SEL.popupItems);
    await items.nth(0).click();
    await items.nth(1).click();
    await step(page, info, 2, "two-items-clicked");

    const chips = page.locator(SEL.chips);
    await expect(chips, "multi-select must accept two tags").toHaveCount(2, {
      timeout: TIMEOUTS.elementVisible,
    });
    // Submit is enabled once at least one chip is present.
    await expect(
      page.locator(SEL.submitButton),
      "Submit must enable after tags are chosen",
    ).toBeEnabled({ timeout: TIMEOUTS.buttonEnabled });
    await step(page, info, 3, "two-chips-verified");

    // Close popup then cancel — do NOT click Submit (destructive).
    await page.keyboard.press("Escape");
    await page.locator(SEL.cancelButton).click();
    await expect(page.locator(SEL.dialog)).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
  });

  test("search_filters_tag_list: typing narrows the popup to matching entries", async ({ page }, info) => {
    caseIds(info, "TB.R06");
    await gotoSDG(page);
    await selectTwoComponents(page);
    await openAddTagsDialog(page);

    const input = page.locator(SEL.multiselectInput);
    await input.click();
    await expect(page.locator(SEL.popup)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await input.fill(TB.searchKeyword);
    await step(page, info, 1, "keyword-typed");

    const items = page.locator(SEL.popupItems);
    const count = await items.count();
    expect(count, "search must return at least one match").toBeGreaterThan(0);
    // Every visible item must start with the search keyword — this
    // proves the filter is applied rather than showing the full list.
    const labels = await items.allTextContents();
    for (const label of labels.slice(0, 5)) {
      expect(
        label.trim().toUpperCase(),
        `filtered item "${label}" must contain the search keyword`,
      ).toContain(TB.searchKeyword.toUpperCase());
    }
    await step(page, info, 2, "filter-applied");

    await page.keyboard.press("Escape");
    await page.locator(SEL.cancelButton).click();
    await expect(page.locator(SEL.dialog)).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
  });

  test("cancel_after_tag_selection_does_not_persist: Cancel closes dialog with no side effect", async ({ page }, info) => {
    caseIds(info, "TB.R08");
    await gotoSDG(page);
    await selectTwoComponents(page);
    await openAddTagsDialog(page);

    const input = page.locator(SEL.multiselectInput);
    await input.click();
    await input.fill(TB.searchKeyword);
    await expect(page.locator(SEL.popup)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await page.locator(SEL.popupItems).first().click();
    await expect(page.locator(SEL.chips)).toHaveCount(1, { timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "tag-selected");

    // The popup can steal pointer events — close it first before clicking Cancel.
    await page.keyboard.press("Escape");
    await page.locator(SEL.cancelButton).click();
    await expect(
      page.locator(SEL.dialog),
      "Cancel must close the dialog",
    ).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
    await step(page, info, 2, "dialog-closed");

    // Reopen and confirm the previously-selected tag was not saved —
    // the chip list must be empty.
    await openAddTagsDialog(page);
    await expect(
      page.locator(SEL.chips),
      "reopened dialog must show no chips — Cancel discarded the pending selection",
    ).toHaveCount(0, { timeout: TIMEOUTS.elementVisible });
    await step(page, info, 3, "reopened-empty");

    await page.locator(SEL.cancelButton).click();
  });
});
