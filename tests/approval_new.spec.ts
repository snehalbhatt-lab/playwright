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
// Approval New sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Approval New". 5 real cases in the Diagram > Approval Workflow
// module (row 1 is a Jira link labelled "Uploaded on TestRail", not a
// test case). Merged into 2 tests covering 2 rows explicitly; 3 rows
// skipped with reason.
//
// Live-vs-Excel drift:
//   - The "list of approvers" control is not a dropdown as Excel
//     describes — it's a kendo-panelbar accordion (`#kendoaprroved`,
//     app-side typo — "aprroved") that expands to reveal approver
//     rows.
//   - The Submit-for-Approval button id is also mistyped in the app:
//     `#diagram-arroval-submitForApproval-button` ("arroval" not
//     "approval"). Asserted as-is.
//   - A yellow warning line reads "Approvers are view-only and cannot
//     be assigned to the model from here." — asserted as UI evidence
//     the section rendered.
//
// Skipped (documented — Excel-unsure, cross-user, or destructive):
//   - R03 — "super user in approver list": Excel expected result reads
//     literally "Need to check"; QA has no defined expectation.
//   - R04 — Configuration > "Bypass" toggle: tenant-wide destructive
//     config change that would affect every user of the tenant.
//   - R05 — add a new user + grant approver permission via Access
//     Management: destructive user + permission fixture setup.
// =============================================================================

const AN = testdata.approvalNew;
const SEL = AN.selectors;
const EXP = AN.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function openDisposableModelAndSubmitDialog(page: Page): Promise<string> {
  await login(page);
  await gotoTMList(page);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  const { modelName } = await createDisposableModel(page, AN.modelPrefix);
  await page.waitForTimeout(3000);
  await page.evaluate(() =>
    document
      .querySelectorAll("ngx-guided-tour, .guided-tour-user-input-mask, .k-overlay, .tour-backdrop, tm-release-note")
      .forEach((el) => el.remove()),
  );
  await clearBlockingOverlays(page);

  await page.locator(SEL.approvalWorkflowIcon).click();
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    document.querySelectorAll(".gray-block, .colored-block").forEach((el) => el.remove()),
  );
  await page.locator(SEL.submitForApprovalButton).click();
  await expect(page.locator(SEL.dialog).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  return modelName;
}

test.describe.configure({ mode: "serial" });

test.describe("Approval New — Diagram > Approval Workflow", () => {
  // Disposable-model create + archive + permanent-delete on this
  // tenant runs 90-120s per test — bump per-test timeout to 10 min so
  // setup + test + cleanup all fit.
  test.setTimeout(600000);

  test("submit_for_approval_dialog_shows_approvers_section: dialog renders 'List of Approvers' with warning text", async ({ page }, info) => {
    caseIds(info, "AN.R01");
    const modelName = await openDisposableModelAndSubmitDialog(page);
    try {
      await step(page, info, 1, "dialog-open");

      // R01 — the Submit-for-Approval dialog carries a "List of
      // Approvers" section and the "view-only" warning line.
      const approversPanel = page.locator(SEL.approversPanel);
      await expect(approversPanel, "'List of Approvers' section must render").toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });
      await expect(approversPanel).toContainText(EXP.approversHeading);
      await expect(page.locator(SEL.warningText)).toContainText(EXP.warningTextSnippet);
      // The dialog also carries Cancel + Submit buttons; Submit is
      // disabled until an approver is selected (submit picking is
      // out of scope here).
      await expect(page.locator(SEL.cancelButton)).toBeVisible();
      await expect(page.locator(SEL.submitButton)).toBeVisible();
      await step(page, info, 2, "approvers-section-visible");

      // Cancel the dialog so we exit cleanly.
      await page.locator(SEL.cancelButton).click();
      await expect(page.locator(SEL.dialog).first()).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
      await step(page, info, 3, "dialog-closed");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("approvers_panelbar_expands_and_lists_entries: clicking 'List of Approvers' expands the panel", async ({ page }, info) => {
    caseIds(info, "AN.R02");
    const modelName = await openDisposableModelAndSubmitDialog(page);
    try {
      const item = page.locator(SEL.approversPanelbarItem);
      await expect(item).toHaveAttribute("aria-expanded", "false", { timeout: TIMEOUTS.elementVisible });
      await step(page, info, 1, "panelbar-collapsed");

      // R02 — clicking the panelbar link expands it. Kendo panelbars
      // require the click to hit the inner `.k-link`, not the outer
      // treeitem.
      await page.locator(SEL.approversPanelbarLink).click();
      await expect(item, "panelbar must expand after clicking the header link").toHaveAttribute(
        "aria-expanded",
        "true",
        { timeout: TIMEOUTS.elementVisible },
      );
      await step(page, info, 2, "panelbar-expanded");

      // With the panel expanded, the section text now includes more
      // than just the heading — it also carries the approver rows
      // ("Approver Level : ..." per entry) or a "no approvers"
      // fallback. Assert the expanded body has grown, not the exact
      // roster (which depends on tenant approver config).
      const panelText = ((await page.locator(SEL.approversPanel).textContent()) ?? "").trim();
      expect(
        panelText.length,
        "expanded panel body must render additional content beyond just the heading",
      ).toBeGreaterThan(EXP.approversHeading.length + 5);
      await step(page, info, 3, "expanded-body-present");

      await page.locator(SEL.cancelButton).click();
      await expect(page.locator(SEL.dialog).first()).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });
});
