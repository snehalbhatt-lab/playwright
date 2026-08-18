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
// Dashboard1 sheet suite (Threat / Overview Dashboard)
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Dashboard1". ~50 real cases across Threat Dashboard, Top 10
// Threats/SR Portfolio, Compliance Summary, and Filter panel.
//
// Ships 3 read-only DOM assertions covering navigation + Compliance
// Summary structure + Model Status filter default. No mutation.
//
// Skipped (documented):
//   - R01-R04 — count consistency of stat cards against tenant data
//     (non-deterministic).
//   - R05-R17 — Top 10 Threats / SR portfolio dialogs — dependent on
//     per-model interaction and tenant data.
//   - R19-R43 — compliance expand + SR portfolio drilldown; several
//     paths mutate SR status.
//   - R44-R49, R55 — apply filter and verify all panels update.
//     Depend on tenant data & filter side-effects.
//   - R46 — date-picker validation.
// =============================================================================

const TD = testdata.threatDashboard;
const SEL = TD.selectors;
const EXPECTED_STATUSES = TD.expectedModelStatuses;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function gotoThreatDashboard(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + TD.path);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  await expect(page).toHaveTitle(new RegExp(SEL.dashboardHeader), {
    timeout: TIMEOUTS.navMedium,
  });
}

test.describe.configure({ mode: "serial" });

test.describe("Threat Dashboard — landmarks + Compliance Summary + Model Status filter", () => {
  test.setTimeout(TIMEOUTS.test);

  test("dashboard_landmarks_render: filter button + traceability matrix + top-10 + compliance sections", async ({ page }, info) => {
    caseIds(info, "TD.H1", "TD.R00");
    await gotoThreatDashboard(page);
    await step(page, info, 1, "on-dashboard");

    await expect(page).toHaveURL(new RegExp(TD.path), { timeout: TIMEOUTS.navMedium });
    await expect(
      page.locator(SEL.filterButton),
      "filter button must be present on the dashboard",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(
      page.locator(SEL.traceabilityMatrix),
      "Traceability Matrix section must render",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(
      page.locator(SEL.top10Section),
      "Top 10 section must render",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(
      page.locator(SEL.complianceSection),
      "Compliance Summary section must render",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "landmarks-verified");
  });

  test("compliance_summary_shows_three_status_categories: Compliant / Non-Compliant / Partially Compliant", async ({ page }, info) => {
    caseIds(info, "TD.R18");
    await gotoThreatDashboard(page);
    await step(page, info, 1, "on-dashboard");

    // Section heading present.
    await expect(page.locator(SEL.complianceSummaryHeading)).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });

    // Three status divs and three labels — Compliant / Non-Compliant /
    // Partially Compliant. Labels use a Cyrillic С (U+0421) instead of
    // Latin C in the app text, so we assert visibility of the ID-scoped
    // label div rather than text-matching a Latin string.
    for (const idSel of [
      SEL.complianceOverCompliant,
      SEL.complianceOverNonCompliant,
      SEL.complianceOverPartially,
      SEL.complianceCompliantLabel,
      SEL.complianceNonCompliantLabel,
      SEL.compliancePartiallyLabel,
    ]) {
      await expect(
        page.locator(idSel),
        `compliance status element ${idSel} must render`,
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    }
    await step(page, info, 2, "three-status-verified");
  });

  test("model_status_filter_defaults_to_all_and_lists_core_statuses: opening dropdown shows the 6 built-in statuses", async ({ page }, info) => {
    caseIds(info, "TD.R54", "TD.R56");
    await gotoThreatDashboard(page);
    await step(page, info, 1, "on-dashboard");

    // Open the filter sidebar so the Model Status control renders.
    await page.locator(SEL.filterButton).click();
    await expect(page.locator(SEL.filterSidebar)).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 2, "filter-open");

    const statusInput = page.locator(SEL.modelStatusMultiselect);
    // R56 — the placeholder is "All", which is how the tenant conveys
    // "all statuses selected by default".
    await expect(
      statusInput,
      "model status input must be reachable in the filter sidebar",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    const placeholder = await statusInput.getAttribute("placeholder");
    expect(
      placeholder,
      `default status placeholder must be "${SEL.statusDefaultPlaceholder}"`,
    ).toBe(SEL.statusDefaultPlaceholder);
    await step(page, info, 3, "default-all-verified");

    // R54 — dropdown must include the six built-in statuses. The
    // tenant also carries custom test statuses beyond these six, so
    // we assert containment rather than an exact-set match.
    await statusInput.click();
    const items = page.locator(SEL.popupItems);
    await expect(items.first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    const labels = (await items.allTextContents()).map((s) => s.trim());
    for (const expected of EXPECTED_STATUSES) {
      expect(
        labels,
        `Model Status dropdown must include "${expected}"`,
      ).toContain(expected);
    }
    await step(page, info, 4, "core-statuses-verified");

    // Close the popup without changing the filter.
    await page.keyboard.press("Escape");
  });
});
