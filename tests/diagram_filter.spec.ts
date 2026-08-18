import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import {
  TIMEOUTS,
  login,
  capture,
  clearBlockingOverlays,
  dismissPostLoginOverlays,
} from "./lib/helpers";
import { gotoTMList, createDisposableModel, cleanupDisposableModel } from "./lib/tm-helpers";

// =============================================================================
// Cloudmodeler diagram filter sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Cloudmodeler diagram filter". ~35 real cases in the Diagram >
// Diagram Filter module.
//
// Ships 2 non-destructive tests over the filter panel + Save Filter
// subform. No filter is actually persisted.
//
// Skipped (documented):
//   - R02-R15 — Apply/Save filter actually persists a saved filter
//     to the tenant filter library.
//   - R16, R17 — read-only permission (needs second seeded user).
//   - R18, R19 — edit/delete saved filter (destructive on shared
//     library).
//   - R20-R34 — cross-model / cross-visibility persistence.
// =============================================================================

const DF = testdata.diagramFilter;
const SEL = DF.selectors;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function setupModel(page: Page): Promise<{ modelName: string }> {
  await login(page);
  await gotoTMList(page);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  return await createDisposableModel(page, DF.modelPrefix);
}

async function openFilterPanel(page: Page): Promise<void> {
  await clearBlockingOverlays(page);
  await page.locator(SEL.filterTriggerButton).click();
  await expect(page.locator(SEL.filterPanel)).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
}

test.describe.configure({ mode: "serial" });

test.describe("Cloudmodeler diagram filter — Diagram > Diagram Filter panel", () => {
  // Disposable-model archive + permanent-delete on this tenant runs
  // ~90-120s; per-test timeout raised so setup + test + cleanup all
  // fit even after login retries.
  test.setTimeout(600000);

  test("filter_panel_shows_expected_controls: Resources + Tags multiselects + Cancel + Save Filter + Apply + Saved Filters", async ({ page }, info) => {
    caseIds(info, "DF.R01");
    const { modelName } = await setupModel(page);
    try {
      await openFilterPanel(page);
      await step(page, info, 1, "filter-panel-open");

      // R01 — the two filter dropdowns (Resources + Tags) render.
      await expect(page.locator(SEL.resourcesMultiselect).first()).toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });
      await expect(page.locator(SEL.tagsMultiselect).first()).toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });

      // Action row: Cancel + Save Filter + Apply.
      await expect(page.locator(SEL.cancelButton)).toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });
      await expect(page.locator(SEL.saveFilterButton)).toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });
      await expect(page.locator(SEL.applyButton)).toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });

      // Saved Filters section is present (tenant already has a set of
      // saved filters — count varies, so only assert visibility of
      // the expansion panel).
      await expect(page.locator(SEL.savedFiltersExpansion)).toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });
      await step(page, info, 2, "filter-controls-verified");

      // Close via the main filter's Cancel to leave no state.
      await page.locator(SEL.cancelButton).click();
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("save_filter_submit_disabled_until_name_provided: mandatory name gates the save subform", async ({ page }, info) => {
    caseIds(info, "DF.R28");
    const { modelName } = await setupModel(page);
    try {
      await openFilterPanel(page);
      await step(page, info, 1, "filter-panel-open");

      // Click Save Filter to reveal the inline save subform.
      await page.locator(SEL.saveFilterButton).click();
      const nameInput = page.locator(SEL.saveFormNameInput);
      await expect(
        nameInput,
        "Save Filter subform must expose an Enter-filter-Name input",
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await step(page, info, 2, "save-subform-open");

      // The save subform has its own Save Filter button (role-based,
      // no stable ID). It must be disabled with an empty name.
      const submitBtn = page
        .getByRole("button", { name: SEL.saveFormSubmitName })
        .last();
      await expect(
        submitBtn,
        "Save subform submit must be disabled until a name is provided",
      ).toBeDisabled({ timeout: TIMEOUTS.elementVisible });
      await step(page, info, 3, "submit-disabled-initial");

      await nameInput.fill(DF.probeName);
      await expect(
        submitBtn,
        "Save subform submit must enable once a name is provided",
      ).toBeEnabled({ timeout: TIMEOUTS.buttonEnabled });
      await step(page, info, 4, "submit-enabled");

      // Do NOT click submit — cancel via the subform's Cancel to
      // discard the pending state.
      await page
        .getByRole("button", { name: SEL.saveFormCancelName })
        .last()
        .click();
      await expect(
        nameInput,
        "subform Cancel must dismiss the Enter-filter-Name input",
      ).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
      await step(page, info, 5, "subform-cancelled");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });
});
