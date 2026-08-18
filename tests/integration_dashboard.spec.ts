import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import {
  BASE_URL,
  TIMEOUTS,
  login,
  capture,
  clearBlockingOverlays,
  dismissPostLoginOverlays,
} from "./lib/helpers";

// =============================================================================
// Integration Dashboard sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Integration Dashboard". ~40 real cases.
//
// Ships 3 read-only DOM assertions over the dashboard page. No
// disposable model or mutation is needed — the dashboard is a
// pure read view.
//
// Skipped (documented):
//   - R04-R19 — require pre-existing Jira/Azure/ServiceNow tickets
//     + external integration state that can be mutated from the
//     3rd-party side. Not deterministic in this environment.
//   - R20, R21 — new-tab navigation to external URLs.
//   - R22, R26, R29-R41 — file download + PDF/Excel content check.
//   - R24, R27 — column filter combined with export.
//   - R32, R33 — column sort/filter across every column.
//   - R47-R49 — 7-day vs 90-day data-range verification against the
//     tenant history.
// =============================================================================

const IN = testdata.integrationDashboard;
const SEL = IN.selectors;
const EXP = IN.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function gotoIntegrationDashboard(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + IN.path);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  await expect(
    page.getByRole("heading", { name: SEL.dashboardHeader, level: 1 }),
  ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

test.describe.configure({ mode: "serial" });

test.describe("Integration Dashboard — page UI + export dropdown + duration default", () => {
  test.setTimeout(TIMEOUTS.test);

  test("dashboard_ui_landmarks_render: header + summary + integration + duration + data grid", async ({ page }, info) => {
    caseIds(info, "IN.R03");
    await gotoIntegrationDashboard(page);
    await step(page, info, 1, "on-dashboard");

    // Page header.
    await expect(
      page.getByRole("heading", { name: SEL.dashboardHeader, level: 1 }),
      "Integration Dashboard header must render",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });

    // Security Issue Summary section header (role="heading" span, not a real h2).
    await expect(
      page.getByRole("heading", { name: SEL.securityIssueSummary }),
      "Security Issue Summary heading must render",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });

    // Select Integration control.
    await expect(
      page.getByRole("heading", { name: SEL.selectIntegrationHeading }),
      "Select Integration heading must render",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });

    // Filter by Duration label + data grid.
    await expect(page.locator(SEL.durationLabel).first()).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(
      page.locator(SEL.dataGrid),
      "data table grid must render",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "landmarks-verified");
  });

  test("export_dropdown_shows_excel_and_pdf_options: menu opens with two icon options", async ({ page }, info) => {
    caseIds(info, "IN.R45");
    await gotoIntegrationDashboard(page);
    await step(page, info, 1, "on-dashboard");

    // The export "button" is a <div id="exportFieldDropdown">.
    const trigger = page.locator(SEL.exportDropdownTrigger);
    await expect(trigger).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await trigger.click();
    await step(page, info, 2, "dropdown-open");

    const menu = page.locator(SEL.exportMenu);
    await expect(
      menu,
      "export dropdown menu must open",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });

    const excel = page.locator(SEL.exportOptionExcel);
    const pdf = page.locator(SEL.exportOptionPdf);
    await expect(excel, "Excel option must be visible").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(pdf, "PDF option must be visible").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    // Each option must include its icon so users can access it "through
    // a clearly visible button" per R36.
    await expect(
      excel.locator("img"),
      "Excel option must include its icon",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(
      pdf.locator("img"),
      "PDF option must include its icon",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 3, "options-verified");

    // Close the dropdown without exporting.
    await page.keyboard.press("Escape");
  });

  test("duration_filter_defaults_to_90_days: dashboard opens with Last 90 Days preselected", async ({ page }, info) => {
    caseIds(info, "IN.R46");
    await gotoIntegrationDashboard(page);

    const durationSection = page.locator(SEL.durationLabel).locator("..");
    await expect(
      durationSection,
      "duration filter section must display the default 90-day selection",
    ).toContainText(SEL.durationDefault, { timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "duration-default-verified");
  });
});
