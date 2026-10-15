import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import { BASE_URL, TIMEOUTS, PATHS, login, capture, clearBlockingOverlays } from "./lib/helpers";

// =============================================================================
// Audit Report sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Audit Report". 110 real cases in 3 modules. Merged into 10 UI-observable
// tests covering ~25 non-destructive Generate-dialog cases; ~85 rows
// skipped with reason.
//
// Live-vs-Excel drift:
//   - Audit Report opens as a side drawer on the model diagram screen,
//     same pattern as Custom Report. Entry point:
//       Generate Report top-menu (#topMenuTour_5) → Audit Report menu item.
//   - Empty state carries "No reports generated yet" + "Generate New" CTA.
//   - "+ Generate New" opens a modal ("Generate Audit Report") with fields
//     (Version, Time Frame, Action, Metrics, Transactions) and PDF/CSV
//     format radios; excellent id coverage on `#reportSelectPopup-*` and
//     `#reportAuditPopup-*`.
//   - `Include user activity summary` checkbox has id with spaces
//     (id="Include user activity summary"), only reachable via attribute
//     selector (a plain #id selector would fail).
//
// Skipped (documented):
//   - Diagram-action → audit-entry verification (~70 cases, R005-R055,
//     R069-R073, R101-R122): each test drags/deletes/renames/changes on
//     the shared model then checks the audit log — deeply destructive.
//   - Actual PDF/CSV/HTML download IO (R004, R079, R088, R091, R093,
//     R094): creates real files + persists a generated report record on
//     the tenant.
//   - Email template verification (R097-R099): needs reading an inbox.
//   - User permission changes on model (R035, R036): destructive.
//   - Compliance/Developer/Custom/CISO report generation (R117-R122):
//     creates real reports on shared models.
//   - Tag add/remove tracking (R101-R109): destructive tagging + entry
//     verification.
//   - Task manual/auto execution (R039-R041): destructive.
//   - CVSS score change verification (R069, R070): destructive.
// =============================================================================

const AR = testdata.auditReport;
const SEL = AR.selectors;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

// Open any available model diagram — Audit Report is scoped to a model.
async function openFirstModelDiagram(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + PATHS.threatModels);
  await clearBlockingOverlays(page);
  const firstLink = page.locator(AR.diagramLinkSelector).first();
  await expect(firstLink, "at least one model must exist on the tenant").toBeAttached({
    timeout: TIMEOUTS.navMedium,
  });
  const href = await firstLink.getAttribute("href");
  await page.goto(BASE_URL + href!);
  await expect(page).toHaveTitle(/Threat Model Diagram/, { timeout: TIMEOUTS.navMedium });
  await page.waitForTimeout(6000);
  await clearBlockingOverlays(page);
}

async function openAuditReportPanel(page: Page): Promise<void> {
  await openFirstModelDiagram(page);
  await page.locator("#topMenuTour_5").click();
  const btn = page.getByRole("button", { name: AR.reportKindButtonAria, exact: true }).first();
  await expect(btn).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await btn.click();
  await expect(page.getByRole("heading", { name: AR.panelTitle }).first()).toBeVisible({
    timeout: TIMEOUTS.navMedium,
  });
}

async function openGenerateDialog(page: Page): Promise<void> {
  await openAuditReportPanel(page);
  const generateNew = page.locator(SEL.generateNewButton).first();
  await expect(generateNew).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await generateNew.click();
  await expect(page.locator(AR.modalSelector)).toBeVisible({ timeout: TIMEOUTS.navMedium });
  await expect(page.locator(SEL.versionDropdown)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

function inModal(page: Page) {
  return page.locator(AR.modalSelector);
}

test.describe("Audit Report", () => {
  test.setTimeout(TIMEOUTS.test);

  // --------------------------------------------------------------------------
  test("R002 - navigate from diagram → Generate Report → Audit Report opens", async ({ page }, info) => {
    caseIds(info, "C110861", "R002");
    await openAuditReportPanel(page);
    await step(page, info, 1, "audit-report-panel-open");
  });

  // --------------------------------------------------------------------------
  test("R003 R063 - Audit Report panel: Generate New button visible", async ({ page }, info) => {
    caseIds(info, "C110862", "R003", "R063");
    await openAuditReportPanel(page);
    await expect(page.locator(SEL.generateNewButton).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "panel-controls-visible");
  });

  // --------------------------------------------------------------------------
  test("R056 - Generate Audit Report dialog opens with heading + close button", async ({ page }, info) => {
    caseIds(info, "C110863", "R056");
    await openGenerateDialog(page);
    // Dialog title lives in .modal-title (heading text is "Generate Audit Report").
    await expect(inModal(page).getByText(AR.dialogTitle).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(page.locator(SEL.closeButtonId)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "dialog-mounted");
  });

  // --------------------------------------------------------------------------
  test("R057 - Select Version dropdown mounts with current version value", async ({ page }, info) => {
    caseIds(info, "C110864", "R057");
    await openGenerateDialog(page);
    const ver = page.locator(SEL.versionDropdown);
    await expect(ver).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    // Text should follow the "V N" pattern (e.g. "V 2").
    const text = (await ver.innerText()).trim();
    expect(text, `version selector should show a "V N" value; got "${text}"`).toMatch(/V\s*\d+/);
    await step(page, info, 1, "version-dropdown-shows-current-version");
  });

  // --------------------------------------------------------------------------
  test("R058 - Select Time Frame dropdown defaults to 'Last 30 Days'", async ({ page }, info) => {
    caseIds(info, "C110865", "R058");
    await openGenerateDialog(page);
    const tf = page.locator(SEL.timeFrameDropdown);
    await expect(tf).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    const text = (await tf.innerText()).trim();
    expect(text).toContain(AR.expected.timeFrameDefault);
    await step(page, info, 1, "timeframe-default-verified");
  });

  // --------------------------------------------------------------------------
  test("R064 R065 R066 R067 R068 - Select Action dropdown defaults to 'All' and exposes Added / Removed / Updated", async ({ page }, info) => {
    caseIds(info, "C110866", "R064", "R065", "R066", "R067", "R068");
    await openGenerateDialog(page);
    const action = page.locator(SEL.actionDropdown);
    await expect(action).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    const current = (await action.innerText()).trim();
    expect(current, "default should be All").toBe(AR.expected.actionDefault);
    // Click to open — check for Added / Removed / Updated options.
    await action.click();
    for (const opt of ["Added", "Removed", "Updated", "All"]) {
      await expect(
        page.locator(".k-animation-container .k-list-item, kendo-popup .k-list-item").filter({ hasText: opt }).first(),
        `action option ${opt}`,
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    }
    await step(page, info, 1, "action-options-verified");
    // Close popup without changing selection.
    await page.keyboard.press("Escape");
  });

  // --------------------------------------------------------------------------
  test("R056 (partial) - Include user activity summary checkbox is present", async ({ page }, info) => {
    caseIds(info, "C110867", "R056");
    await openGenerateDialog(page);
    // The checkbox id contains spaces — attribute selector needed.
    await expect(page.locator(SEL.userActivityCheckbox)).toBeAttached({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "user-activity-checkbox-present");
  });

  // --------------------------------------------------------------------------
  test("R056 (partial) - Metrics multiselect + Transactions multiselect are present", async ({ page }, info) => {
    caseIds(info, "C110868", "R056");
    await openGenerateDialog(page);
    const metrics = page.locator(SEL.metricsMultiselect);
    await expect(metrics).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    // Metrics default: some items pre-selected — assert a tag-list is present.
    const metricsText = (await metrics.innerText()).trim();
    expect(metricsText, "metrics should show a selection tag").toMatch(/\d+ items? selected|Select Metrics/i);
    await expect(page.locator(SEL.transactionsMultiselect)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "metrics-transactions-multiselects-present");
  });

  // --------------------------------------------------------------------------
  test("R077 R078 - PDF + CSV format radios are present in the Generate dialog", async ({ page }, info) => {
    caseIds(info, "C110869", "R077", "R078");
    await openGenerateDialog(page);
    // Radios might be off-screen — scroll into view first.
    await page.locator(SEL.pdfFormatRadio).scrollIntoViewIfNeeded();
    await expect(page.locator(SEL.pdfFormatRadio)).toBeAttached({ timeout: TIMEOUTS.elementVisible });
    await expect(page.locator(SEL.csvFormatRadio)).toBeAttached({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "pdf-csv-radios-present");
  });

  // --------------------------------------------------------------------------
  test("R071 (partial) - Cancel button closes dialog without generating a report", async ({ page }, info) => {
    caseIds(info, "C110870", "R071");
    await openGenerateDialog(page);
    await expect(page.locator(SEL.cancelButton)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(page.locator(SEL.generateButton)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await page.locator(SEL.cancelButton).click();
    // Modal detaches.
    await expect(page.locator(AR.modalSelector)).toHaveCount(0, { timeout: TIMEOUTS.elementVisible });
    // Audit Report panel remains in view.
    await expect(page.getByRole("heading", { name: AR.panelTitle }).first()).toBeVisible({
      timeout: TIMEOUTS.navMedium,
    });
    await step(page, info, 1, "cancel-closed-dialog");
  });
});

// =============================================================================
// Coverage summary for the Audit Report sheet
//
//   Raw rows in sheet         : 110 (blank + Jira-link rows excluded)
//   In-scope UI-observable    : ~25
//   Merged into                : 10 tests
//   Skipped (documented)      : ~85
//     - Diagram-action → audit-entry verification (~70): destructive
//     - Actual PDF/CSV/HTML download IO: real file creation + report record
//     - Email template verification: needs external inbox
//     - User permission changes on model: destructive
//     - Cross-report-type generation (Compliance/Developer/Custom/CISO):
//       creates real reports
//     - Tag add/remove tracking + audit assertion: destructive
//     - Task manual/auto execution + audit assertion: destructive
//     - CVSS score changes: destructive
//
//   Live operations verified in the browser during authoring:
//     * Diagram → Generate Report → Audit Report opens the panel (R002)
//     * Panel exposes Generate New CTA (R003, R063)
//     * Generate Audit Report dialog: heading + close button (R056)
//     * Version dropdown shows "V N" (R057)
//     * Time Frame default = "Last 30 Days" (R058)
//     * Action default = "All"; opens Added/Removed/Updated options
//       (R064-R068)
//     * Include user activity summary checkbox present (R056 partial)
//     * Metrics + Transactions multi-selects present (R056 partial)
//     * PDF/CSV format radios present (R077, R078)
//     * Cancel closes dialog without persisting (R071 partial)
// =============================================================================
