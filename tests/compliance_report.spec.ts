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
// NewCompliance Report sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "NewCompliance Report". ~30 real cases in the Diagram > Reports >
// Compliance Report module.
//
// Ships 4 non-destructive dialog-interaction tests:
//   T1 (R01+R02+R03) — dialog opens with framework dropdown + Cancel closes.
//   T2 (R04+R05)     — selecting a framework surfaces its sections that
//                      are editable.
//   T3 (R33)         — Clear (×) on the sections multiselect deselects
//                      every chip (block-2 refinement).
//   T4 (R36)         — removing one chip decrements the selected count
//                      (block-2 refinement).
//
// No report is actually generated.
//
// Skipped (documented):
//   - R06                — scheduler-time text depends on the last
//                          backend job.
//   - R07                — actual PDF download (destructive: adds a
//                          row to Report History that we don't clean
//                          up).
//   - R08                — email delivery verification (needs a
//                          mailbox).
//   - R09                — download from Report History (destructive).
//   - R10-R30            — content-of-downloaded-PDF assertions.
//   - R34, R35           — dropdown-open ordering (list virtualisation
//                          makes the assertion brittle).
//   - R38-R40            — CSV/PDF download from Report History
//                          (destructive).
//   - R42-R45            — assigned/unassigned framework gating (needs
//                          tenant configuration change).
//   - R47, R49-R51,
//     R55-R59            — HTML fallback (needs >30s PDF delay).
//   - R53, R54           — hyperlink navigation inside downloaded PDF.
//   - R61                — custom field content parity.
// =============================================================================

const CR = testdata.complianceReport;
const SEL = CR.selectors;
const MS = testdata.complianceReportSectionsMultiselect;

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
  return await createDisposableModel(page, CR.modelPrefix);
}

async function openComplianceReportDialog(page: Page): Promise<void> {
  await clearBlockingOverlays(page);
  await page.getByRole("button", { name: SEL.generateReportToolbarButton }).click();
  await page.locator(SEL.complianceReportCard).click();
  // Fresh model = empty Report History → "Generate New" opens the dialog.
  await page.getByRole("button", { name: SEL.generateNewButton }).click();
  await expect(
    page.getByRole("heading", { name: SEL.dialogHeading }),
    "Generate Compliance Report dialog must open",
  ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

test.describe.configure({ mode: "serial" });

test.describe("NewCompliance Report — Diagram > Reports > Compliance Report dialog", () => {
  // Disposable-model archive + permanent-delete on this tenant runs
  // ~90-120s; per-test timeout raised so setup + test + cleanup all
  // fit even after login retries.
  test.setTimeout(600000);

  test("compliance_report_dialog_opens_with_framework_dropdown_and_cancel_closes: dialog shell renders + Cancel is non-destructive", async ({ page }, info) => {
    caseIds(info, "CR.R01", "CR.R02", "CR.R03");
    const { modelName } = await setupModel(page);
    try {
      await openComplianceReportDialog(page);
      await step(page, info, 1, "dialog-open");

      // R03 — Framework dropdown must be present.
      const framework = page.getByRole("combobox", { name: "Select" }).first();
      await expect(framework, "framework dropdown must render").toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });

      // R01 — the report format radios and Cancel + Generate buttons render.
      await expect(page.locator(SEL.pdfRadio)).toBeChecked({
        timeout: TIMEOUTS.elementVisible,
      });
      await expect(page.locator(SEL.csvRadio)).toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });
      await expect(
        page.locator(SEL.generateButton),
        "Generate must start disabled with no framework chosen",
      ).toBeDisabled({ timeout: TIMEOUTS.elementVisible });
      await step(page, info, 2, "controls-verified");

      // R03 — opening the dropdown lists at least one framework.
      await framework.click();
      const items = page.locator(SEL.popupItems);
      await expect(items.first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      const optionCount = await items.count();
      expect(
        optionCount,
        "framework dropdown must list at least one compliance framework",
      ).toBeGreaterThan(0);
      await step(page, info, 3, "framework-list-verified");

      // Close popup, then R02 — Cancel closes the dialog cleanly.
      await page.keyboard.press("Escape");
      await page.locator(SEL.cancelButton).click();
      await expect(
        page.getByRole("heading", { name: SEL.dialogHeading }),
        "Cancel must close the Generate Compliance Report dialog",
      ).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
      await step(page, info, 4, "cancel-closes-dialog");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("selecting_framework_surfaces_sections_and_enables_generate: sections list appears + Generate enables", async ({ page }, info) => {
    caseIds(info, "CR.R04", "CR.R05");
    const { modelName } = await setupModel(page);
    try {
      await openComplianceReportDialog(page);
      await step(page, info, 1, "dialog-open");

      // Select the first framework.
      const framework = page.getByRole("combobox", { name: "Select" }).first();
      await framework.click();
      const items = page.locator(SEL.popupItems);
      await expect(items.first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await items.first().click();
      await step(page, info, 2, "framework-selected");

      // R04 — "Compliance Framework Sections" heading appears with
      // section chips inside a multi-select.
      await expect(
        page.getByText(SEL.sectionHeading),
        "sections label must appear once a framework is chosen",
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });

      // R05 — Sections are pre-selected as chips; user can toggle.
      // Assert Generate becomes enabled (chips present = valid state).
      await expect(
        page.locator(SEL.generateButton),
        "Generate must enable after a framework is selected",
      ).toBeEnabled({ timeout: TIMEOUTS.buttonEnabled });
      await step(page, info, 3, "sections-and-generate-verified");

      // Do NOT click Generate — cancel out to avoid tenant-visible
      // report generation.
      await page.locator(SEL.cancelButton).click();
      await expect(
        page.getByRole("heading", { name: SEL.dialogHeading }),
      ).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  // ---- Block-2 extensions (R33, R36) ------------------------------------
  //
  // Sheet appends a second content block starting at R31 that covers
  // 7.4-era refinements to the Compliance Report sections
  // multiselect. R33 and R36 are non-destructive and only require
  // opening the dialog with a framework preselected.
  //
  // Skipped from block 2:
  //   R34, R35 — dropdown-open ordering (selected-on-top). The list
  //     virtualisation makes the assertion brittle without seeded
  //     order.
  //   R38, R39, R40 — CSV/PDF download from Report History
  //     (destructive).
  //   R42-R45 — assigned/unassigned framework gating (needs tenant
  //     configuration change).
  //   R47, R49-R51, R55-R59 — HTML fallback (needs >30s PDF delay).
  //   R53, R54 — hyperlink navigation inside downloaded PDF.
  //   R61 — custom field content parity.

  test("sections_multiselect_clear_all_removes_all_chips: Clear (×) on selected chips deselects every section", async ({ page }, info) => {
    caseIds(info, "CR.R33");
    const { modelName } = await setupModel(page);
    try {
      await openComplianceReportDialog(page);
      await page.getByRole("combobox", { name: "Select" }).first().click();
      const items = page.locator(SEL.popupItems);
      await expect(items.first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await items.first().click();
      await step(page, info, 1, "framework-selected");

      const multiselect = page.locator(MS.kendoScope);
      await expect(
        multiselect.locator(MS.chip).first(),
        "at least one section chip must be present after framework selection",
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      const chipCountBefore = await multiselect.locator(MS.chip).count();
      expect(
        chipCountBefore,
        "framework must preselect at least one section by default",
      ).toBeGreaterThan(0);
      await step(page, info, 2, "chips-present");

      // R33 — Clear (×) on the multiselect wipes every chip.
      await multiselect.locator(MS.clearAll).click();
      await expect(
        multiselect.locator(MS.chip),
        "Clear must remove every section chip",
      ).toHaveCount(0, { timeout: TIMEOUTS.elementVisible });
      await step(page, info, 3, "all-chips-cleared");

      await page.locator(SEL.cancelButton).click();
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("sections_multiselect_chip_remove_reduces_count: removing one chip decrements the selected count", async ({ page }, info) => {
    caseIds(info, "CR.R36");
    const { modelName } = await setupModel(page);
    try {
      await openComplianceReportDialog(page);
      await page.getByRole("combobox", { name: "Select" }).first().click();
      const items = page.locator(SEL.popupItems);
      await expect(items.first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await items.first().click();
      await step(page, info, 1, "framework-selected");

      const multiselect = page.locator(MS.kendoScope);
      const chipCountBefore = await multiselect.locator(MS.chip).count();
      expect(
        chipCountBefore,
        "test requires at least one preselected chip to remove",
      ).toBeGreaterThanOrEqual(1);
      await step(page, info, 2, `chips-before-${chipCountBefore}`);

      // R36 — removing a single chip decrements the count by one.
      await multiselect.locator(MS.chip).first().locator(MS.chipRemoveAction).click();
      await expect(
        multiselect.locator(MS.chip),
        `chip count must drop from ${chipCountBefore} to ${chipCountBefore - 1} after removing one chip`,
      ).toHaveCount(chipCountBefore - 1, { timeout: TIMEOUTS.elementVisible });
      await step(page, info, 3, `chips-after-${chipCountBefore - 1}`);

      await page.locator(SEL.cancelButton).click();
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });
});
