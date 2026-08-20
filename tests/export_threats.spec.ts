import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import {
  BASE_URL,
  PATHS,
  TIMEOUTS,
  login,
  capture,
  clearBlockingOverlays,
  dismissPostLoginOverlays,
} from "./lib/helpers";

// =============================================================================
// Export threats sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Export threats". 31 real cases in two parallel modules:
//   - Threats-Export  (R1-R16, 16 cases): Threats panel → Actions →
//     Export dialog with CSV/Excel + Threats-only/With-associated-SRs.
//   - SR-Export       (R17-R31, 15 cases): Security Requirements
//     panel → Actions → Export dialog with CSV/Excel +
//     SR-only/With-associated-Threats.
//
// Ships 4 non-destructive tests covering the dialog shell + radio
// behaviour (T1-T2 for Threats, T3-T4 for SR). No test clicks the
// Download button so nothing writes back to the tenant or triggers a
// real file download.
//
// Reuses the Threats-panel path proven in cvss_score.spec.ts. Same
// caveat: `#diagram-*-selectAll-button` handlers only respond to real
// user-event clicks, not synthetic .click() dispatches. Playwright
// locator.click() sends real events so this works.
//
// Radio-group behaviour note: the report-type radios use different
// `name` attributes (name="csv" vs name="excel") — so HTML's native
// same-name radio-group exclusion does not apply. The app enforces
// exclusivity in JS (verified live). Both groups pass the "only one
// checked at a time" assertion in T1/T3.
//
// Skipped (25 rows, documented):
//   - R4-R15, R20-R31 — every case is a real file download whose
//     assertion is file-content parity (issue IDs, CVE attrs,
//     nested-model threats, manually-added items). Same class as
//     prior download-content skips (custom_report.spec.ts R058,
//     R114+, and the Excel/CSV export tests in
//     threat_models_screen.spec.ts).
//   - R16 — "same UI in old version history" needs a pre-existing
//     old version fixture; deferred with the version_history
//     skips.
// =============================================================================

const EX = testdata.exportThreats;
const SEL = EX.selectors;
const EXP = EX.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

// Same "first tenant model" pattern used by cvss_score + custom_report.
// The first tenant model is stable and always has threats + SRs, which
// both panels require before Actions > Export becomes usable.
async function openFirstPopulatedModel(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + PATHS.threatModels);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  const firstLink = page.locator(EX.diagramLinkSelector).first();
  await expect(firstLink, "at least one model must exist on the tenant").toBeAttached({
    timeout: TIMEOUTS.navMedium,
  });
  const href = await firstLink.getAttribute("href");
  await page.goto(BASE_URL + href!);
  await expect(page).toHaveTitle(/Threat Model Diagram/, { timeout: TIMEOUTS.navMedium });
  await page.waitForTimeout(6000);
  await clearBlockingOverlays(page);
}

async function openExportDialogFrom(
  page: Page,
  panelSel: string,
  selectAllSel: string,
  actionSel: string,
): Promise<void> {
  await clearBlockingOverlays(page);
  await page.locator(panelSel).click();
  // Wait for the panel to hydrate — the SelectAll button appears
  // together with the grid header.
  await expect(page.locator(selectAllSel)).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
  await page.locator(selectAllSel).click();
  await clearBlockingOverlays(page);
  await page.locator(actionSel).click();
  const exportItem = page
    .locator(SEL.actionMenuItem)
    .filter({ hasText: EXP.exportMenuItemText })
    .first();
  await expect(exportItem).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await exportItem.click();
  await expect(page.locator(SEL.modalDialog)).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
}

// A "no-download" guard: any successful Download click emits a
// page.download event. Every test attaches this listener and asserts
// the counter stays 0 when only Cancel/close is used.
function setupDownloadCounter(page: Page): () => number {
  let count = 0;
  page.on("download", () => {
    count += 1;
  });
  return () => count;
}

test.describe.configure({ mode: "serial" });

test.describe("Export threats — Diagram > Threats-Export + SR-Export dialogs", () => {
  test.setTimeout(TIMEOUTS.test);

  // ---- Module A: Threats-Export ------------------------------------------

  test("threats_export_dialog_structure_and_radio_behavior: CSV/Excel + Threats-only/With-SRs radios mutually exclude", async ({ page }, info) => {
    caseIds(info, "EX.R01", "EX.R03");
    const getDownloads = setupDownloadCounter(page);
    await openFirstPopulatedModel(page);
    await openExportDialogFrom(
      page,
      SEL.threatsPanelButton,
      SEL.threatsSelectAll,
      SEL.threatsActionButton,
    );
    await step(page, info, 1, "threats-export-dialog-open");

    // Title.
    await expect(
      page.locator(SEL.modalDialog).locator(SEL.modalTitle),
    ).toHaveText(EXP.threatsDialogTitle, { timeout: TIMEOUTS.elementVisible });

    // Initial state: CSV + Threats-only checked; Excel + Threats-and-SRs not.
    // Cancel + Download rendered.
    await expect(page.locator(SEL.radioCsv)).toBeChecked();
    await expect(page.locator(SEL.radioExcel)).not.toBeChecked();
    await expect(page.locator(SEL.radioThreatsOnly)).toBeChecked();
    await expect(page.locator(SEL.radioThreatsAndSrs)).not.toBeChecked();
    await expect(page.locator(SEL.threatsCancelButton)).toBeVisible();
    await expect(page.locator(SEL.threatsDownloadButton)).toBeVisible();
    await step(page, info, 2, "initial-state-verified");

    // R03 — report-type radios mutually exclude despite different
    // name attrs. Flip to Excel.
    await page.locator(SEL.radioExcel).click();
    await expect(page.locator(SEL.radioExcel)).toBeChecked();
    await expect(page.locator(SEL.radioCsv)).not.toBeChecked();
    await step(page, info, 3, "report-type-flipped-to-excel");

    // Preference radios mutually exclude — flip to Threats-and-SRs.
    await page.locator(SEL.radioThreatsAndSrs).click();
    await expect(page.locator(SEL.radioThreatsAndSrs)).toBeChecked();
    await expect(page.locator(SEL.radioThreatsOnly)).not.toBeChecked();
    await step(page, info, 4, "preference-flipped-to-with-srs");

    // Close via Cancel — leaves no state and does NOT fire a download.
    await page.locator(SEL.threatsCancelButton).click();
    await expect(page.locator(SEL.modalDialog)).toHaveCount(0, {
      timeout: TIMEOUTS.dialogHidden,
    });
    expect(getDownloads(), "no download must fire when only Cancel is clicked").toBe(0);
  });

  test("threats_export_cancel_dismisses_dialog: Cancel closes dialog with no download event", async ({ page }, info) => {
    caseIds(info, "EX.R02");
    const getDownloads = setupDownloadCounter(page);
    await openFirstPopulatedModel(page);
    await openExportDialogFrom(
      page,
      SEL.threatsPanelButton,
      SEL.threatsSelectAll,
      SEL.threatsActionButton,
    );
    await step(page, info, 1, "dialog-open");

    // Mutate options to prove Cancel discards a pending selection.
    await page.locator(SEL.radioExcel).click();
    await page.locator(SEL.radioThreatsAndSrs).click();
    await step(page, info, 2, "options-mutated");

    await page.locator(SEL.threatsCancelButton).click();
    await expect(page.locator(SEL.modalDialog)).toHaveCount(0, {
      timeout: TIMEOUTS.dialogHidden,
    });
    expect(getDownloads(), "Cancel must not fire a download").toBe(0);
    await step(page, info, 3, "dialog-dismissed");
  });

  // ---- Module B: SR-Export -----------------------------------------------

  test("sr_export_dialog_structure_and_radio_behavior: CSV/Excel + SR-only/With-Threats radios mutually exclude", async ({ page }, info) => {
    caseIds(info, "EX.R17", "EX.R19");
    const getDownloads = setupDownloadCounter(page);
    await openFirstPopulatedModel(page);
    await openExportDialogFrom(
      page,
      SEL.srPanelButton,
      SEL.srSelectAll,
      SEL.srActionButton,
    );
    await step(page, info, 1, "sr-export-dialog-open");

    await expect(
      page.locator(SEL.modalDialog).locator(SEL.modalTitle),
    ).toHaveText(EXP.srDialogTitle, { timeout: TIMEOUTS.elementVisible });

    await expect(page.locator(SEL.radioCsv)).toBeChecked();
    await expect(page.locator(SEL.radioExcel)).not.toBeChecked();
    await expect(page.locator(SEL.radioSrOnly)).toBeChecked();
    await expect(page.locator(SEL.radioSrAndThreats)).not.toBeChecked();
    await expect(page.locator(SEL.srCancelButton)).toBeVisible();
    await expect(page.locator(SEL.srDownloadButton)).toBeVisible();
    await step(page, info, 2, "initial-state-verified");

    await page.locator(SEL.radioExcel).click();
    await expect(page.locator(SEL.radioExcel)).toBeChecked();
    await expect(page.locator(SEL.radioCsv)).not.toBeChecked();
    await step(page, info, 3, "report-type-flipped-to-excel");

    await page.locator(SEL.radioSrAndThreats).click();
    await expect(page.locator(SEL.radioSrAndThreats)).toBeChecked();
    await expect(page.locator(SEL.radioSrOnly)).not.toBeChecked();
    await step(page, info, 4, "preference-flipped-to-with-threats");

    await page.locator(SEL.srCancelButton).click();
    await expect(page.locator(SEL.modalDialog)).toHaveCount(0, {
      timeout: TIMEOUTS.dialogHidden,
    });
    expect(getDownloads()).toBe(0);
  });

  test("sr_export_cancel_dismisses_dialog: Cancel closes dialog with no download event", async ({ page }, info) => {
    caseIds(info, "EX.R18");
    const getDownloads = setupDownloadCounter(page);
    await openFirstPopulatedModel(page);
    await openExportDialogFrom(
      page,
      SEL.srPanelButton,
      SEL.srSelectAll,
      SEL.srActionButton,
    );
    await step(page, info, 1, "dialog-open");

    await page.locator(SEL.radioExcel).click();
    await page.locator(SEL.radioSrAndThreats).click();
    await step(page, info, 2, "options-mutated");

    await page.locator(SEL.srCancelButton).click();
    await expect(page.locator(SEL.modalDialog)).toHaveCount(0, {
      timeout: TIMEOUTS.dialogHidden,
    });
    expect(getDownloads()).toBe(0);
    await step(page, info, 3, "dialog-dismissed");
  });
});

// =============================================================================
// Coverage summary
//
//   Raw rows in sheet         : 31 real (32 total with blanks)
//   Merged into                : 4 tests
//   Skipped (documented)      : 25
//     - R4-R15, R20-R31       : actual file downloads with content-
//                               parity assertions on CSV/Excel
//                               (issue IDs, CVE attrs, nested-model
//                               threats, manually-added items).
//                               Same class as prior download-content
//                               skips.
//     - R16                   : old-version-history dependency.
// =============================================================================
