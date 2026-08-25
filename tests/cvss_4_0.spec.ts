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
// CVSS 4.0 sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "CVSS 4.0". 16 real cases in the Diagram > Threats-CVSS module.
// Ships 1 non-destructive test covering R01. The remaining 15 rows
// are documented as skipped or deferred below.
//
// The feature has two areas:
//   1. Configuration > Threat Model Defaults > CVSS Version dropdown
//      (R01/R02). Options: CVSS 3.1 (default), CVSS 4.0.
//   2. Diagram > Threats > Actions > Calculate CVSS Score dialog
//      (R03-R16). Individual threat scoring, save/reset/cancel, edit,
//      upgrade 3.1 → 4.0, reports parity, cross-version.
//
// Live-vs-Excel — no drift on R01; live confirms two options + 3.1
// default. R02 says "select and save" — that's a tenant-wide
// destructive config change (flips the default CVSS version for
// every user), so skipped.
//
// Skipped (documented):
//   - R02 — tenant-wide destructive Save of config.
//   - R03-R16 — Calculate CVSS Score dialog. The Threats grid groups
//     rows by Source and hides row checkboxes until the group is
//     expanded; the top-level Actions dropdown collides with a
//     view-size dropdown that also carries the `.dropdown-menu.show`
//     class. Reaching a threat's Calculate-CVSS action reliably
//     requires more selector work than fits this pass. Deferred to a
//     future pass with a dedicated threat-selection helper.
// =============================================================================

const CV = testdata.cvss40;
const SEL = CV.selectors;
const EXP = CV.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function gotoThreatModelDefaults(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + CV.configPath);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  await expect(page.locator(SEL.threatModelDefaultsTab)).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
  await page.locator(SEL.threatModelDefaultsTab).click();
  await expect(page.locator(SEL.threatModelDefaultsSection)).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
}

test.describe("CVSS 4.0 — Configuration > Threat Model Defaults", () => {
  test.setTimeout(TIMEOUTS.test);

  test("cvss_config_dropdown_shown_with_options: dropdown has 'CVSS 3.1' + 'CVSS 4.0' with 3.1 default", async ({ page }, info) => {
    caseIds(info, "CV.R01");
    await gotoThreatModelDefaults(page);
    await step(page, info, 1, "on-threat-model-defaults");

    // R01 — the CVSS Version dropdown must be present with the two
    // known options and CVSS 3.1 selected as the default.
    const dropdown = page.locator(SEL.cvssVersionDropdown);
    await expect(dropdown, "CVSS Version dropdown must render").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(dropdown, `default option must be ${EXP.defaultSelected}`).toContainText(EXP.defaultSelected);
    await step(page, info, 2, "default-selected");

    // Open the dropdown popup and assert the option list.
    await dropdown.click();
    // The popup is portalled outside the dropdown — check the
    // animation container at the document level.
    for (const opt of EXP.expectedOptions) {
      await expect(
        page.locator(".k-animation-container-shown").locator(SEL.dropdownOption).filter({ hasText: opt }).first(),
        `option "${opt}" must appear in the popup`,
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    }
    await step(page, info, 3, "options-listed");

    // Close the popup — DO NOT change the selection. Escape restores
    // the state without triggering a save.
    await page.keyboard.press("Escape");
  });
});
