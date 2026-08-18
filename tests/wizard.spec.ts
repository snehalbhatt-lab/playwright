import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import {
  TIMEOUTS,
  login,
  capture,
  clearBlockingOverlays,
  dismissPostLoginOverlays,
} from "./lib/helpers";
import { gotoTMList } from "./lib/tm-helpers";

// =============================================================================
// Wizard sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Wizard". 45+ real cases split between Threat Framework > Wizard
// management (R02-R11) and Create New Model > Wizard tab
// (R12, R23-R28+).
//
// Ships 3 non-destructive dialog-interaction tests over the Create
// New Model > Wizard tab. No model is created — Cancel closes the
// dialog before any Create step, so the tenant sees no residue.
//
// Skipped (documented):
//   - R02-R11 — Threat Framework > Wizard management (edit / delete /
//     copy / deep-copy / hide are all destructive on shared wizard
//     library).
//   - R12, R24, R28 — actual model creation via wizard (destructive
//     tenant mutation).
//   - R13-R22 — canvas Q&A editing / add-action / add-component in
//     the wizard framework canvas (destructive on shared library).
//   - R26, R27 — multi-wizard / multi-answer switching (requires
//     selected state whose reset is destructive).
//   - R29-R46 — cross-view diagram, reports, and attribute-in-model
//     verification.
// =============================================================================

const WZ = testdata.wizard;
const SEL = WZ.selectors;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function openCreateModelDialog(page: Page): Promise<void> {
  await login(page);
  await gotoTMList(page);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  await page.locator(SEL.createNewMenuButton).click();
  await page.getByRole("menuitem", { name: SEL.threatModelMenuItem }).click();
  await expect(page.locator(SEL.createModelDialog)).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
}

async function openWizardTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: SEL.wizardTab }).click();
  // The wizard search input only renders when the Wizard tab is active.
  await expect(page.locator(SEL.wizardSearchInput)).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
}

test.describe.configure({ mode: "serial" });

test.describe("Wizard — Create New Model > Wizard tab", () => {
  test.setTimeout(TIMEOUTS.test);

  test("wizard_tab_shows_list_and_count_and_search: default UI has cards + count + search", async ({ page }, info) => {
    caseIds(info, "WZ.R25");
    await openCreateModelDialog(page);
    await openWizardTab(page);
    await step(page, info, 1, "wizard-tab-open");

    // Default view — at least one wizard card must render.
    const cards = page.locator(SEL.wizardCards);
    const initialCount = await cards.count();
    expect(initialCount, "wizard tab must show at least one wizard card by default").toBeGreaterThan(0);
    await step(page, info, 2, "cards-visible");

    // The overview-count element reflects the current filtered count.
    const countLabel = page.locator(SEL.wizardCount).first();
    await expect(countLabel, "wizard count must render").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 3, "count-visible");

    // Search input must be reachable and act as a filter.
    await page.locator(SEL.wizardSearchInput).fill(WZ.searchKeyword);
    // After typing "AWS" the list must shrink (and every remaining card
    // must contain the keyword).
    await expect
      .poll(async () => await cards.count(), {
        message: `search "${WZ.searchKeyword}" must reduce the wizard list`,
        timeout: TIMEOUTS.elementVisible,
      })
      .toBeLessThan(initialCount);
    const filteredCount = await cards.count();
    expect(
      filteredCount,
      `search "${WZ.searchKeyword}" must return at least one match`,
    ).toBeGreaterThan(0);
    const filteredLabels = await cards.allTextContents();
    for (const label of filteredLabels) {
      expect(
        label.trim().toUpperCase(),
        `filtered card "${label}" must contain the search keyword`,
      ).toContain(WZ.searchKeyword.toUpperCase());
    }
    await step(page, info, 4, "search-filtered");

    // Close the dialog without saving.
    await page.locator(SEL.cancelButton).click();
    await expect(page.locator(SEL.createModelDialog)).toBeHidden({
      timeout: TIMEOUTS.dialogHidden,
    });
  });

  test("wizard_next_and_prev_disabled_on_empty_form: navigation blocked without name/version/answer", async ({ page }, info) => {
    caseIds(info, "WZ.R23");
    await openCreateModelDialog(page);
    await openWizardTab(page);
    await step(page, info, 1, "wizard-tab-open");

    // With no name / version / wizard-answer chosen, Next must stay
    // disabled and Prev must stay disabled as well (we're on step 1).
    await expect(
      page.locator(SEL.nextButton),
      "Next must be disabled without name/version/answer",
    ).toBeDisabled({ timeout: TIMEOUTS.elementVisible });
    await expect(
      page.locator(SEL.prevButton),
      "Prev must be disabled on the first step",
    ).toBeDisabled({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "next-prev-disabled");

    await page.locator(SEL.cancelButton).click();
    await expect(page.locator(SEL.createModelDialog)).toBeHidden({
      timeout: TIMEOUTS.dialogHidden,
    });
  });

  test("wizard_cancel_closes_dialog_cleanly: Cancel closes without creating a model", async ({ page }, info) => {
    caseIds(info, "WZ.R23");
    await openCreateModelDialog(page);
    await openWizardTab(page);
    await step(page, info, 1, "wizard-tab-open");

    await page.locator(SEL.cancelButton).click();
    await expect(
      page.locator(SEL.createModelDialog),
      "Cancel must close the Create New Model dialog",
    ).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
    await step(page, info, 2, "dialog-closed");

    // The user is still on the Threat Models list (URL unchanged) —
    // no navigation to /threatmodeldiagram/... which would mean a
    // model was accidentally created.
    expect(page.url(), "URL must remain on threatmodels list").toContain("/threatmodels");
  });
});
