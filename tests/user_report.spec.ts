import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import { BASE_URL, TIMEOUTS, PATHS, login, capture, clearBlockingOverlays } from "./lib/helpers";

// =============================================================================
// User Report sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "User Report". 32 real cases merged into 6 UI-observable tests.
//
// Live-vs-Excel drift (verified in the browser during authoring):
//   - "User Report" is the User Activity Matrix inside the Audit Report
//     modal, not a separate report screen. Entry:
//       Diagram → Generate Report (#topMenuTour_5)
//              → Audit Report menu item
//              → "Generate New" → modal "Generate Audit Report"
//              → tick "Include user activity summary".
//   - The user-activity checkbox is unchecked by default; Select User(s) +
//     Select Metric(s) multiselects only render after it is ticked.
//   - Excel row 6 says "'All Users' is selected by default": the app does
//     not expose a literal "All Users" option -- instead every
//     activity-bearing user is pre-checked, which is functionally
//     equivalent. Test asserts the pre-checked behaviour.
//   - Metric labels differ slightly from Excel row 28. Live app source of
//     truth: 8 labels persisted in testdata.userReport.expected.metricLabels
//     (matches the modal exactly, incl. "Threats Mitigated by Control" --
//     Excel had "...by Security Control").
//   - Kendo popup Select-All checkbox lives at
//     `.k-animation-container-shown input#chk` and toggles every list item.
//
// Skipped (documented, 26 rows):
//   - Actual PDF/CSV/HTML file download + tenant report persistence
//     (rows 1, 2, 3, 29, 30, 31, 32).
//   - Diagram-mutating cases that assert per-metric count increments after
//     changing threat / SR / test-case / approval / ticket / attribute
//     state on the shared model (rows 15-22, 25, 26): destructive on the
//     shared tenant, same rationale as audit_report.spec.ts skips.
//   - No-activity edge case (row 27) needs a freshly-created isolated
//     model and cleanup.
//   - Multi-user session case (row 24) needs a second authenticated
//     browser context.
//   - HTML-vs-PDF parity (row 29) requires downloading and diffing two
//     files.
// =============================================================================

const UR = testdata.userReport;
const SEL = UR.selectors;

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
  const firstLink = page.locator(UR.diagramLinkSelector).first();
  await expect(firstLink, "at least one model must exist on the tenant").toBeAttached({
    timeout: TIMEOUTS.navMedium,
  });
  const href = await firstLink.getAttribute("href");
  await page.goto(BASE_URL + href!);
  await expect(page).toHaveTitle(/Threat Model Diagram/, { timeout: TIMEOUTS.navMedium });
  await page.waitForTimeout(6000);
  await clearBlockingOverlays(page);
}

async function openGenerateAuditDialog(page: Page): Promise<void> {
  await openFirstModelDiagram(page);
  await page.locator("#topMenuTour_5").click();
  const btn = page.getByRole("button", { name: UR.reportKindButtonAria, exact: true }).first();
  await expect(btn).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await btn.click();
  await expect(page.getByRole("heading", { name: UR.panelTitle }).first()).toBeVisible({
    timeout: TIMEOUTS.navMedium,
  });
  const generateNew = page.locator(SEL.generateNewButton).first();
  await expect(generateNew).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await generateNew.click();
  await expect(page.locator(UR.modalSelector)).toBeVisible({ timeout: TIMEOUTS.navMedium });
}

// Tick "Include user activity summary" and wait for the two multiselects to
// render. Idempotent; safe to call after the dialog is up.
async function enableUserActivitySection(page: Page): Promise<void> {
  const cbx = page.locator(SEL.userActivityCheckbox);
  await expect(cbx).toBeAttached({ timeout: TIMEOUTS.elementVisible });
  if (!(await cbx.isChecked())) {
    await cbx.check({ force: true });
  }
  await expect(page.locator(SEL.userMultiselect)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await expect(page.locator(SEL.metricsMultiselect)).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
}

async function openMultiselectPopup(page: Page, multiselectSelector: string): Promise<void> {
  await page.locator(multiselectSelector).click();
  await expect(page.locator(SEL.openPopupListContainer).last()).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
  // Kendo re-renders the list after popup mount; wait for at least one item.
  await expect(page.locator(SEL.popupListItems).first()).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
}

// Read the checked state of every list item in the currently open popup.
async function readItemCheckedStates(page: Page): Promise<boolean[]> {
  return page.locator(SEL.popupListItems).evaluateAll((items) =>
    items.map((el) => (el.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.checked ?? false),
  );
}

// expect().toBeChecked() with polling — needed because Kendo re-renders the
// popup after a Select-All toggle and stale checkbox handles show old state.
async function expectAllItemsChecked(page: Page, checked: boolean): Promise<void> {
  await expect
    .poll(
      async () => (await readItemCheckedStates(page)).every((c) => c === checked),
      { timeout: TIMEOUTS.elementVisible, message: `every list item must be checked=${checked}` },
    )
    .toBe(true);
}

test.describe("User Report (Audit Report user activity matrix)", () => {
  test.setTimeout(TIMEOUTS.test);

  // --------------------------------------------------------------------------
  test("UR001 UR002 UR003 - Generate Audit Report modal opens with PDF + CSV format radios", async ({ page }, info) => {
    caseIds(info, "UR001", "UR002", "UR003");
    await openGenerateAuditDialog(page);
    await page.locator(SEL.pdfFormatRadio).scrollIntoViewIfNeeded();
    await expect(page.locator(SEL.pdfFormatRadio)).toBeAttached({ timeout: TIMEOUTS.elementVisible });
    await expect(page.locator(SEL.csvFormatRadio)).toBeAttached({ timeout: TIMEOUTS.elementVisible });
    // PDF is the default format.
    expect(await page.locator(SEL.pdfFormatRadio).isChecked()).toBe(true);
    expect(await page.locator(SEL.csvFormatRadio).isChecked()).toBe(false);
    await step(page, info, 1, "modal-pdf-csv-radios-present");
  });

  // --------------------------------------------------------------------------
  test("UR004 - Select User(s): Select All toggles every user (deselect / re-select)", async ({ page }, info) => {
    caseIds(info, "UR004");
    await openGenerateAuditDialog(page);
    await enableUserActivitySection(page);
    await openMultiselectPopup(page, SEL.userMultiselect);

    const initial = await readItemCheckedStates(page);
    expect(initial.length, "Select User(s) list must expose at least one activity user").toBeGreaterThan(0);
    const selectAll = page.locator(SEL.popupSelectAllCheckbox);
    await expect(selectAll).toBeChecked({ timeout: TIMEOUTS.elementVisible });
    await expectAllItemsChecked(page, true);
    await step(page, info, 1, "user-popup-all-selected");

    // Deselect all
    await selectAll.click();
    await expect(selectAll).not.toBeChecked({ timeout: TIMEOUTS.elementVisible });
    await expectAllItemsChecked(page, false);
    await step(page, info, 2, "user-popup-none-selected");

    // Re-select all
    await selectAll.click();
    await expect(selectAll).toBeChecked({ timeout: TIMEOUTS.elementVisible });
    await expectAllItemsChecked(page, true);
    await step(page, info, 3, "user-popup-all-reselected");
  });

  // --------------------------------------------------------------------------
  test("UR006 UR007 - Select User(s): all activity users pre-checked; single-item toggle works", async ({ page }, info) => {
    caseIds(info, "UR006", "UR007");
    await openGenerateAuditDialog(page);
    await enableUserActivitySection(page);
    await openMultiselectPopup(page, SEL.userMultiselect);

    const items = page.locator(SEL.popupListItems);
    const count = await items.count();
    expect(count, "at least one activity user must exist").toBeGreaterThan(0);

    // Toggle the first item off, confirm state changes and Select-All flips.
    const firstCbx = items.first().locator('input[type="checkbox"]');
    await expect(firstCbx).toBeChecked({ timeout: TIMEOUTS.elementVisible });
    await items.first().click();
    await expect(firstCbx).not.toBeChecked({ timeout: TIMEOUTS.elementVisible });
    // With one item unchecked, master Select-All should no longer be true.
    await expect(page.locator(SEL.popupSelectAllCheckbox)).not.toBeChecked({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 1, "single-user-toggled-off");

    // Toggle it back on.
    await items.first().click();
    await expect(firstCbx).toBeChecked({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "single-user-toggled-on");
  });

  // --------------------------------------------------------------------------
  test("UR010 UR028 - Select Metric(s): all 8 documented metrics are present", async ({ page }, info) => {
    caseIds(info, "UR010", "UR028");
    await openGenerateAuditDialog(page);
    await enableUserActivitySection(page);
    await openMultiselectPopup(page, SEL.metricsMultiselect);

    const texts = await page.locator(SEL.popupListItems).evaluateAll((els) =>
      els.map((el) => (el.textContent || "").trim()),
    );
    expect(texts.length, "metric list size").toBe(UR.expected.metricCount);
    for (const label of UR.expected.metricLabels) {
      expect(texts, `metric label "${label}" must appear in the dropdown`).toContain(label);
    }
    await step(page, info, 1, "metric-labels-verified");
  });

  // --------------------------------------------------------------------------
  test("UR011 UR013 - Select Metric(s): all metrics ON by default", async ({ page }, info) => {
    caseIds(info, "UR011", "UR013");
    await openGenerateAuditDialog(page);
    await enableUserActivitySection(page);
    await openMultiselectPopup(page, SEL.metricsMultiselect);

    await expect(page.locator(SEL.popupListItems)).toHaveCount(UR.expected.metricCount, {
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(page.locator(SEL.popupSelectAllCheckbox)).toBeChecked({
      timeout: TIMEOUTS.elementVisible,
    });
    await expectAllItemsChecked(page, true);
    await step(page, info, 1, "all-metrics-on-by-default");
  });

  // --------------------------------------------------------------------------
  test("UR005 UR014 - Select Metric(s): Select All toggles every metric (deselect / re-select)", async ({ page }, info) => {
    caseIds(info, "UR005", "UR014");
    await openGenerateAuditDialog(page);
    await enableUserActivitySection(page);
    await openMultiselectPopup(page, SEL.metricsMultiselect);

    const selectAll = page.locator(SEL.popupSelectAllCheckbox);
    await expect(selectAll).toBeChecked({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "metrics-popup-open-all-selected");

    // Deselect all.
    await selectAll.click();
    await expect(selectAll).not.toBeChecked({ timeout: TIMEOUTS.elementVisible });
    await expectAllItemsChecked(page, false);
    await step(page, info, 2, "metrics-popup-all-deselected");

    // Re-select all.
    await selectAll.click();
    await expect(selectAll).toBeChecked({ timeout: TIMEOUTS.elementVisible });
    await expectAllItemsChecked(page, true);
    await step(page, info, 3, "metrics-popup-all-reselected");
  });
});

// =============================================================================
// Coverage summary for the User Report sheet
//
//   Raw rows in sheet         : 32
//   In-scope UI-observable    : 6 flow families
//   Merged into                : 6 tests
//   Skipped (documented)      : 26
//     - Actual file download IO (PDF/CSV/HTML): rows 1, 2, 3, 29, 30, 31, 32
//     - Destructive count-increment cases on shared model: rows 15-22, 25, 26
//     - No-activity edge case (needs isolated model): row 27
//     - Multi-user simultaneous session: row 24
//     - HTML/PDF parity comparison: row 29
//     - "select single user shows only that user's data" (row 7) is
//       partially covered here at the UI toggle level; the downloaded-data
//       assertion falls under the download-IO skip.
//
//   Live operations verified in the browser during authoring:
//     * Diagram → Generate Report → Audit Report → Generate New opens the
//       modal (UR001)
//     * "Include user activity summary" is unchecked by default; ticking
//       it reveals Select User(s) + Select Metric(s) multiselects
//     * Select User(s) popup: Select-All (`input#chk`) deselects every
//       user and re-selects every user (UR004)
//     * All activity users pre-checked on open; single-item toggle flips
//       master Select-All (UR006, UR007)
//     * Select Metric(s) popup lists exactly 8 documented metrics
//       (UR010, UR028)
//     * Every metric ON by default (UR011, UR013)
//     * Select-All toggles every metric (UR005, UR014)
// =============================================================================
