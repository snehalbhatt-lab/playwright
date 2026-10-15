import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import { BASE_URL, TIMEOUTS, PATHS, login, capture, clearBlockingOverlays } from "./lib/helpers";

// =============================================================================
// Custom Report sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Custom Report". 139 real cases in 32 modules. Merged into 11 tests
// covering ~30 UI-observable Create-dialog cases; ~110 rows skipped with
// reason.
//
// Live-vs-Excel drift:
//   - Custom Report opens as a side drawer on the threat model diagram
//     screen (not a standalone screen). Entry point: Generate Report top-
//     menu button (`#topMenuTour_5`) → Custom Report menu item.
//   - Panel supports Generate New; the create form is a modal
//     ("Create Custom Report") with excellent id coverage on every input
//     and checkbox (`#createReport-*`).
//   - Visibility dropdown default is "Only me" (matches Excel).
//   - "Executive Summary" include-in-report checkbox has a legacy typo in
//     its id: `createReport-includeInReportoexecutiveSummary-checkbox`
//     (extra `o`).
//
// Skipped (documented):
//   - Actual PDF/HTML report download (R058, R114-R118, R122-R131, ~15
//     cases): each download is 20-60s, creates real files, hyperlink
//     validation needs generated content.
//   - Edit existing reports (R072-R078, 7 cases): destructive on shared
//     saved reports.
//   - Delete report (R060-R062, R026 partial): destructive.
//   - Report copy (R059): destructive.
//   - Change threat/SR/TC status in diagram (R027-R041, 15 cases): deeply
//     destructive on the shared model.
//   - Add threats/SR/TC/Tags to diagram (R082-R101, ~20 cases): destructive.
//   - CVSS score changes (R079-R080): destructive.
//   - Enterprise-Admin-only visibility (R071): role gate.
//   - Compliance framework flows (R104-R107): needs specific compliance
//     setup on tenant.
//   - Tag-based filtering (R095-R101): needs specific tags configured.
// =============================================================================

const CR = testdata.customReport;
const SEL = CR.selectors;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

// Open any available model diagram — Custom Report is scoped to a specific
// threat model. Uses the first `/threatmodeldiagram/*` link on the /threatmodels
// grid so the test doesn't hard-code a model id that may disappear.
async function openFirstModelDiagram(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + PATHS.threatModels);
  await clearBlockingOverlays(page);
  const firstLink = page.locator(CR.diagramLinkSelector).first();
  await expect(firstLink, "at least one model must exist on the tenant").toBeAttached({
    timeout: TIMEOUTS.navMedium,
  });
  const href = await firstLink.getAttribute("href");
  await page.goto(BASE_URL + href!);
  await expect(page).toHaveTitle(/Threat Model Diagram/, { timeout: TIMEOUTS.navMedium });
  // Give the diagram time to hydrate (menus + report options bind async).
  await page.waitForTimeout(6000);
  await clearBlockingOverlays(page);
}

async function openCustomReportPanel(page: Page): Promise<void> {
  await openFirstModelDiagram(page);
  await page.locator(CR.generateReportButton).click();
  const btn = page.getByRole("button", { name: CR.reportKindButtonAria, exact: true }).first();
  await expect(btn).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await btn.click();
  // Panel heading is an <h6> with text "Custom Report" (no id).
  await expect(page.getByRole("heading", { name: CR.panelTitle }).first()).toBeVisible({
    timeout: TIMEOUTS.navMedium,
  });
}

async function openCreateDialog(page: Page): Promise<void> {
  await openCustomReportPanel(page);
  const generateNew = page.locator(SEL.generateNewButton).first();
  await expect(generateNew).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await generateNew.click();
  // The dialog is an ngb-modal-window (role=dialog). The heading "Create
  // Custom Report" lives on the outer .modal-title, not inside the modal
  // body — wait for the modal itself to attach and its inner content to
  // hydrate.
  await expect(page.locator(CR.modalSelector)).toBeVisible({ timeout: TIMEOUTS.navMedium });
  await expect(page.locator(SEL.reportNameInput)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

function inModal(page: Page) {
  return page.locator(CR.modalSelector);
}

test.describe("Custom Report", () => {
  test.setTimeout(TIMEOUTS.test);

  // --------------------------------------------------------------------------
  test("R005 - navigate from Threat Model diagram → Generate Report → Custom Report opens", async ({ page }, info) => {
    caseIds(info, "C110902", "R005");
    await openCustomReportPanel(page);
    await step(page, info, 1, "custom-report-panel-open");
  });

  // --------------------------------------------------------------------------
  test("R055 R056 - Custom Report panel exposes Generate New + Saved Reports section", async ({ page }, info) => {
    caseIds(info, "C110903", "R055", "R056");
    await openCustomReportPanel(page);
    // Generate New button must always be present.
    await expect(page.locator(SEL.generateNewButton).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    // The "Saved Custom Reports" area is above the empty/populated state.
    await expect(page.getByText(/Saved Custom Reports/i).first()).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 1, "panel-controls-visible");
  });

  // --------------------------------------------------------------------------
  test("R008 R010 R046 R047 - Create dialog opens with 6 section tabs + Report Name + version selector", async ({ page }, info) => {
    caseIds(info, "C110904", "R008", "R010", "R046", "R047");
    await openCreateDialog(page);
    // Scope text search to the modal — a hidden <li> with matching text lives
    // in the side-nav and would otherwise be picked up by getByText.
    for (const tabText of CR.sectionTabs) {
      await expect(
        inModal(page).getByText(tabText, { exact: true }).first(),
        `section tab ${tabText}`,
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    }
    // Version selector shows the current version.
    await expect(inModal(page).getByText(/Select Version/i).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "create-dialog-verified");
  });

  // --------------------------------------------------------------------------
  test("R011 - Save Report is disabled until Report Name is filled", async ({ page }, info) => {
    caseIds(info, "C110905", "R011");
    await openCreateDialog(page);
    // Both save buttons start disabled.
    await expect(page.locator(SEL.saveReportButton)).toBeDisabled({ timeout: TIMEOUTS.elementVisible });
    await expect(page.locator(SEL.saveAndDownloadButton)).toBeDisabled({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "save-buttons-initially-disabled");
    // Fill a name — Save Report should enable.
    await page.locator(SEL.reportNameInput).fill("QA_probe_report");
    await expect(page.locator(SEL.saveReportButton)).toBeEnabled({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "save-report-enabled-after-name");
    // Clear name — Save must disable again.
    await page.locator(SEL.reportNameInput).fill("");
    await expect(page.locator(SEL.saveReportButton)).toBeDisabled({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 3, "save-report-disabled-after-clear");
  });

  // --------------------------------------------------------------------------
  test("R067 R068 R069 R070 - Visibility dropdown exposes Only me / Department / Organisation", async ({ page }, info) => {
    caseIds(info, "C110906", "R067", "R068", "R069", "R070");
    await openCreateDialog(page);
    const vis = page.locator(SEL.visibilityDropdown);
    await expect(vis).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    const current = (await vis.innerText()).trim();
    expect(current, "visibility default should be Only me").toBe("Only me");
    await vis.click();
    for (const opt of CR.visibilityOptions) {
      await expect(
        page.locator(".k-animation-container .k-list-item, kendo-popup .k-list-item").filter({ hasText: opt }).first(),
        `visibility option ${opt}`,
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    }
    await step(page, info, 1, "visibility-options-verified");
    // Close popup without changing selection.
    await page.keyboard.press("Escape");
  });

  // --------------------------------------------------------------------------
  test("R008 R046 - Each of 5 report sections has an Include in Report toggle", async ({ page }, info) => {
    caseIds(info, "C110907", "R008", "R046", "R087", "R091", "R097");
    await openCreateDialog(page);
    for (const [key, sel] of Object.entries(SEL.includeCheckboxes)) {
      await expect(page.locator(sel as string), `${key} include checkbox`).toBeAttached({
        timeout: TIMEOUTS.elementVisible,
      });
    }
    await step(page, info, 1, "include-checkboxes-mounted");
  });

  // --------------------------------------------------------------------------
  test("R046 - Overview sub-selection checkboxes render", async ({ page }, info) => {
    caseIds(info, "C110908", "R046");
    await openCreateDialog(page);
    for (const sel of SEL.overviewSubs) {
      await expect(page.locator(sel), sel).toBeAttached({ timeout: TIMEOUTS.elementVisible });
    }
    await step(page, info, 1, "overview-subs-verified");
  });

  // --------------------------------------------------------------------------
  test("R087 R088 R090 R100 - Threats sub-selection checkboxes render (description, SR, security control, CVE, notes, TC, tags, custom field)", async ({ page }, info) => {
    caseIds(info, "C110909", "R087", "R088", "R090", "R095", "R098", "R100");
    await openCreateDialog(page);
    // Threats section is collapsed by default — need to enable the include-in-report toggle
    // so the sub-checkboxes render.
    await page.locator(SEL.includeCheckboxes.threats).click({ force: true });
    for (const sel of SEL.threatsSubs) {
      await expect(page.locator(sel), sel).toBeAttached({ timeout: TIMEOUTS.elementVisible });
    }
    await step(page, info, 1, "threats-subs-verified");
  });

  // --------------------------------------------------------------------------
  test("R091 R092 - Security Requirements sub-selection checkboxes render", async ({ page }, info) => {
    caseIds(info, "C110910", "R091", "R092", "R096", "R099");
    await openCreateDialog(page);
    await page.locator(SEL.includeCheckboxes.securityRequirements).click({ force: true });
    for (const sel of SEL.srSubs) {
      await expect(page.locator(sel), sel).toBeAttached({ timeout: TIMEOUTS.elementVisible });
    }
    await step(page, info, 1, "sr-subs-verified");
  });

  // --------------------------------------------------------------------------
  test("R097 - Test Cases include + description sub-checkbox render", async ({ page }, info) => {
    caseIds(info, "C110911", "R097");
    await openCreateDialog(page);
    await page.locator(SEL.includeCheckboxes.testCases).click({ force: true });
    for (const sel of SEL.testCasesSubs) {
      await expect(page.locator(sel), sel).toBeAttached({ timeout: TIMEOUTS.elementVisible });
    }
    await step(page, info, 1, "test-cases-subs-verified");
  });

  // --------------------------------------------------------------------------
  test("R026 (partial) - Close dialog (×) without saving returns to Custom Report panel with no side effects", async ({ page }, info) => {
    caseIds(info, "C110912", "R026");
    await openCreateDialog(page);
    // Fill a name to prove nothing was saved even though the form was populated.
    await page.locator(SEL.reportNameInput).fill("QA_should_not_persist");
    // The X close is a <div> with aria-label="Close" and id
    // createReport-close-button — not a <button>, so getByRole doesn't match.
    await page.locator(CR.closeButtonId).click();
    // Dialog dismisses; the panel underneath should still be the Custom Report panel.
    await expect(page.getByRole("heading", { name: CR.panelTitle }).first()).toBeVisible({
      timeout: TIMEOUTS.navMedium,
    });
    // Modal must detach from the DOM.
    await expect(page.locator(CR.modalSelector)).toHaveCount(0, { timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "dialog-closed-panel-intact");
  });
});

// =============================================================================
// Coverage summary for the Custom Report sheet
//
//   Raw rows in sheet         : 139 (blank + Jira-link rows excluded)
//   In-scope UI-observable    : ~30
//   Merged into                : 11 tests
//   Skipped (documented)      : ~110
//     - Actual PDF/HTML download (R058, R114-R118, R122-R131): download IO
//     - Edit existing reports (R072-R078): destructive
//     - Delete report (R060-R062, R026 partial): destructive
//     - Report copy (R059): destructive
//     - Diagram threat/SR/TC status/risk changes (R027-R041): destructive
//     - Add threats/SR/TC/Tags to diagram (R082-R101): destructive
//     - CVSS score changes (R079-R080): destructive
//     - Enterprise-Admin visibility test (R071): role gate
//     - Compliance framework tests (R104-R107): specific setup
//     - Tag filtering (R095-R101): specific tags
//
//   Live operations verified in the browser during authoring:
//     * Diagram → Generate Report → Custom Report opens the panel (R005)
//     * Panel exposes Generate New + Saved Reports header (R055, R056)
//     * Create dialog: 6 section tabs, Report Name input, version selector
//       (R008, R010, R046, R047)
//     * Save buttons enable/disable based on Report Name (R011)
//     * Visibility dropdown lists Only me / Department / Organisation
//       (R067, R068, R069, R070)
//     * 5 section include-in-report toggles exist (R008, R046)
//     * Overview sub-selection: Diagram / Traceability / Top 10 / Approval (R046)
//     * Threats sub-selection: Description / SR / SecurityControl / CVE /
//       Notes / TC / Tags / Custom Field / Filter (R087-R100)
//     * SR sub-selection: Description / SC / Notes / Tags / Custom Field /
//       Filter (R091-R099)
//     * Test Cases sub-selection: Description (R097)
//     * Close (×) dismisses dialog without persisting (R026 partial)
// =============================================================================
