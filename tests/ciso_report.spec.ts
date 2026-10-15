import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import { BASE_URL, TIMEOUTS, PATHS, login, capture, clearBlockingOverlays } from "./lib/helpers";

// =============================================================================
// CISO Report sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "CISO Report". 69 real cases in 7 modules. Merged into 8 UI-observable
// tests covering ~10 non-destructive cases; ~60 rows skipped with reason.
//
// Live-vs-Excel drift:
//   - CISO Report opens as a side drawer on the diagram screen, same
//     pattern as Custom Report and Audit Report. Entry point:
//       Generate Report top-menu (#topMenuTour_5) → CISO Report menu item.
//   - Excel R010 says "pop up message showing correct when click on
//     generate report" — the live app has NO confirmation dialog. Clicking
//     "Generate New" immediately creates a real CISO Report and adds it to
//     the "Ready to Download" list. That click is skipped to avoid tenant
//     residue.
//   - Panel has minimal id coverage — only `#reportCount` inside the
//     panel. Located by role + text (heading "CISO Report") and by
//     aria-label ("Generate New", "Toggle Ready to Download section").
//   - Excel expects the panel to show "generated" chart sections (SR
//     Status Summary pie, Threats Status Summary pie, Threat Mitigation
//     Over Time line, Top 10 Open SR table, Traceability Matrix, Overall
//     SR). Those live inside the DOWNLOADED report (PDF/HTML) — not in
//     the drawer UI itself. This suite covers the drawer/list UI only.
//
// Skipped (documented):
//   - Chart/section content verification (R012-R023, R024-R033, R034-R040,
//     R042-R049, R050-R055, R060-R071, ~40 cases): live in the generated
//     PDF/HTML output; requires downloading the file.
//   - Actual PDF/HTML/CSV download (R006 full, R058, R072-R074): file IO
//     and creates report records.
//   - Chart tooltip hover contents (R015, R031, R063): hover-dependent.
//   - Change SR/threat status → chart update (R022, R037, R047, R048,
//     R052, R055, R069): destructive on shared models.
//   - Nested model verification (R017, R029, R038, R065): needs fixtures.
//   - Manual add SR/threats (R018, R030, R039, R066): destructive.
//   - Email template verification (R072-R073): external inbox.
//   - Clicking "Generate New" itself (R004, R005, R010): creates a real
//     persistent CISO Report on the tenant with no confirmation dialog.
// =============================================================================

const CISO = testdata.cisoReport;
const SEL = CISO.selectors;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function openFirstModelDiagram(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + PATHS.threatModels);
  await clearBlockingOverlays(page);
  const firstLink = page.locator(CISO.diagramLinkSelector).first();
  await expect(firstLink, "at least one model must exist on the tenant").toBeAttached({
    timeout: TIMEOUTS.navMedium,
  });
  const href = await firstLink.getAttribute("href");
  await page.goto(BASE_URL + href!);
  await expect(page).toHaveTitle(/Threat Model Diagram/, { timeout: TIMEOUTS.navMedium });
  await page.waitForTimeout(6000);
  await clearBlockingOverlays(page);
}

async function openCISOReportPanel(page: Page): Promise<void> {
  await openFirstModelDiagram(page);
  await page.locator("#topMenuTour_5").click();
  const btn = page.getByRole("button", { name: CISO.reportKindButtonAria, exact: true }).first();
  await expect(btn).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await btn.click();
  await expect(page.getByRole("heading", { name: CISO.panelTitle }).first()).toBeVisible({
    timeout: TIMEOUTS.navMedium,
  });
}

test.describe("CISO Report", () => {
  test.setTimeout(TIMEOUTS.test);

  // --------------------------------------------------------------------------
  test("R003 R008 - navigate from diagram → Generate Report → CISO Report opens", async ({ page }, info) => {
    caseIds(info, "C110873", "R003", "R008");
    await openCISOReportPanel(page);
    await step(page, info, 1, "ciso-report-panel-open");
  });

  // --------------------------------------------------------------------------
  test("R008 - Generate Report menu exposes 'CISO Report' as one of its options", async ({ page }, info) => {
    caseIds(info, "C110874", "R008");
    await openFirstModelDiagram(page);
    await page.locator("#topMenuTour_5").click();
    await expect(
      page.getByRole("button", { name: CISO.reportKindButtonAria, exact: true }).first(),
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "ciso-report-menu-item-visible");
  });

  // --------------------------------------------------------------------------
  test("R009 - CISO Report panel exposes Generate New button", async ({ page }, info) => {
    caseIds(info, "C110875", "R009");
    await openCISOReportPanel(page);
    await expect(page.locator(SEL.generateNewButton).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "generate-new-visible");
  });

  // --------------------------------------------------------------------------
  test("R005 R056 - Panel renders either an empty state OR a Ready to Download section", async ({ page }, info) => {
    caseIds(info, "C110876", "R005", "R056");
    await openCISOReportPanel(page);
    // Either the empty-state text is present OR the "Ready to Download"
    // section is present — assert at least one.
    const empty = page.getByText(CISO.labels.emptyStateText).first();
    const ready = page.getByText(CISO.labels.readyToDownloadHeader).first();
    const emptyVisible = await empty.isVisible().catch(() => false);
    const readyVisible = await ready.isVisible().catch(() => false);
    expect(
      emptyVisible || readyVisible,
      `panel should show either empty state or Ready to Download; empty=${emptyVisible}, ready=${readyVisible}`,
    ).toBeTruthy();
    await step(page, info, 1, emptyVisible ? "empty-state-visible" : "ready-to-download-visible");
  });

  // --------------------------------------------------------------------------
  test("R005 - When at least one report exists, reportCount shows a numeric badge", async ({ page }, info) => {
    caseIds(info, "C110877", "R005");
    await openCISOReportPanel(page);
    // Skip gracefully if the panel is in empty state (no prior generation
    // done on this tenant for this model).
    const count = page.locator(SEL.reportCount).first();
    if (!(await count.isVisible().catch(() => false))) {
      test.skip(true, "No reports exist for this model — reportCount is only shown when reports are present.");
    }
    const text = (await count.innerText()).trim();
    expect(text, `reportCount should be numeric; got "${text}"`).toMatch(/^\d+$/);
    await step(page, info, 1, "report-count-numeric");
  });

  // --------------------------------------------------------------------------
  test("R006 R058 - Existing report rows expose PDF + HTML download options", async ({ page }, info) => {
    caseIds(info, "C110878", "R006", "R058");
    await openCISOReportPanel(page);
    // Reachable only when at least one report exists.
    const ready = page.getByText(CISO.labels.readyToDownloadHeader).first();
    if (!(await ready.isVisible().catch(() => false))) {
      test.skip(true, "No reports exist for this model.");
    }
    // The panel contains sibling spans "PDF" and "HTML" per report row.
    const panel = page.locator(CISO.panelContainerClass);
    await expect(panel.getByText("PDF", { exact: true }).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(panel.getByText("HTML", { exact: true }).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "pdf-html-buttons-visible");
  });

  // --------------------------------------------------------------------------
  test("R005 - Report row carries version chip (V N) + timestamp", async ({ page }, info) => {
    caseIds(info, "C110879", "R005");
    await openCISOReportPanel(page);
    const ready = page.getByText(CISO.labels.readyToDownloadHeader).first();
    if (!(await ready.isVisible().catch(() => false))) {
      test.skip(true, "No reports exist for this model.");
    }
    const panelText = (await page.locator(CISO.panelContainerClass).innerText()).replace(/\s+/g, " ");
    // Version chip like "V 2".
    expect(panelText, "expected V-N version chip on report row").toMatch(/V\s?\d+/);
    // Timestamp like "July 16, 2026 07:12 PM" (any month/hour combination).
    expect(panelText, "expected a timestamp on report row").toMatch(
      /\w+ \d{1,2}, \d{4} \d{1,2}:\d{2} (AM|PM)/,
    );
    await step(page, info, 1, "version-and-timestamp-verified");
  });

  // --------------------------------------------------------------------------
  test("R008 - Ready to Download section header is toggleable", async ({ page }, info) => {
    caseIds(info, "C110880", "R008");
    await openCISOReportPanel(page);
    const toggle = page.locator(SEL.readyToDownloadToggle).first();
    if (!(await toggle.isVisible().catch(() => false))) {
      test.skip(true, "No reports exist for this model.");
    }
    await expect(toggle).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    // Click to collapse — header remains present; skip verifying visual collapse.
    await toggle.click();
    await expect(toggle).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "ready-to-download-toggle-click");
  });
});

// =============================================================================
// Coverage summary for the CISO Report sheet
//
//   Raw rows in sheet         : 69 (blank rows excluded)
//   In-scope UI-observable    : ~10
//   Merged into                : 8 tests (some auto-skip if the model has
//                                          no prior generated CISO reports)
//   Skipped (documented)      : ~60
//     - Chart/section content verification (~40): lives in the downloaded
//       PDF/HTML; requires file IO
//     - Actual PDF/HTML/CSV downloads: file IO + persistent report records
//     - Chart tooltip hover contents: hover-dependent
//     - Change SR/threat status → chart update: destructive
//     - Nested model verification: needs fixtures
//     - Manual add SR/threats: destructive
//     - Email template verification: external inbox
//     - Clicking Generate New itself (R004, R005, R010): creates a real
//       persistent CISO Report on the tenant with no confirmation dialog
//
//   Live operations verified in the browser during authoring:
//     * Diagram → Generate Report → CISO Report opens the panel (R003, R008)
//     * Generate Report menu exposes "CISO Report" (R008)
//     * Panel exposes Generate New button (R009)
//     * Panel renders empty state OR Ready to Download section (R005, R056)
//     * When reports exist: reportCount badge is numeric (R005)
//     * When reports exist: PDF + HTML download options render per row
//       (R006, R058)
//     * When reports exist: report row shows V-N + timestamp (R005)
//     * Ready to Download header toggles (R008)
// =============================================================================
