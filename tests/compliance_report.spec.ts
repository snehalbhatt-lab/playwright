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
// Ships 2 non-destructive dialog-interaction tests covering R01+R02+R03
// (dialog opens with framework dropdown + Cancel closes) and
// R04+R05 (selecting a framework surfaces its sections that are
// editable). No report is actually generated.
//
// Skipped (documented):
//   - R06 — scheduler-time text depends on the last backend job.
//   - R07 — actual PDF download (destructive: adds a row to Report
//     History that we don't clean up).
//   - R08 — email delivery verification (needs a mailbox).
//   - R09 — download from Report History (destructive).
//   - R10-R30 — content-of-downloaded-PDF assertions (24 rows).
// =============================================================================

const CR = testdata.complianceReport;
const SEL = CR.selectors;

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
});
