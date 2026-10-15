import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import { BASE_URL, TIMEOUTS, login, capture } from "./lib/helpers";

// =============================================================================
// Custom Risk Calculation sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Custom Risk Calculation". 101 real data rows across 20 group headers
// (Business Risk × Model Type × HVT-Authentication × Inherent Threat Risk).
//
// IMPORTANT SCOPE NOTE: This sheet is a FORMULA VERIFICATION TABLE, not a
// UI test suite. Each Excel row prescribes an input combination (Protected
// Resource, Model Type, Business Risk, Inherent Threat Risk, HVT with/
// without Authentication) and an Expected Result (computed risk level).
// Verifying each case via UI would require creating a threat model,
// configuring 5 parameter values, triggering recalculation, and asserting
// the output — deeply destructive on the shared tenant, and better suited
// to unit tests against the risk calculation function.
//
// This suite covers ~15 UI-observable structural cases with 6 tests
// focused on the Configuration screen's Custom Risk Calculation section;
// the 100 truth-table cases are documented as out of scope for UI e2e.
//
// Live UI structure (much simpler than the Excel table implies): the
// section shows Enable toggle + 3 range sliders (Authenticated,
// External/Internal Application, High Value Target) grouped under
// Likelihood + Impact categories. The Excel table is the OUTPUT of the
// formula defined by those slider values.
//
// Skipped (documented):
//   - All 100 truth-table input→output verification cases (R2-R120 data
//     rows): belong in unit tests against the risk calculation function.
// =============================================================================

const CRC = testdata.customRiskCalculation;
const SEL = CRC.selectors;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function gotoCRCSection(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + CRC.configPath);
  await expect(page).toHaveTitle(new RegExp(CRC.titlePattern), { timeout: TIMEOUTS.navMedium });
  const section = page.locator(CRC.sectionSelector);
  await expect(section).toBeAttached({ timeout: TIMEOUTS.elementVisible });
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

test.describe("Custom Risk Calculation", () => {
  test.setTimeout(TIMEOUTS.test);

  // --------------------------------------------------------------------------
  test("R1 group headers - Custom Risk Calculation section mounts with heading", async ({ page }, info) => {
    caseIds(info, "C110913", "R1-headers");
    await gotoCRCSection(page);
    // The h2 accessible name includes a nested info-tooltip button, so
    // `getByRole('heading', { name: 'Custom Risk Calculation', exact })`
    // matches nothing. Locate the h2 by tag scoped inside the section, and
    // assert the visible text starts with the section heading.
    const h2 = page.locator(`${CRC.sectionSelector} h2`).first();
    await expect(h2).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(h2).toContainText(CRC.sectionHeading);
    await step(page, info, 1, "crc-section-mounted");
  });

  // --------------------------------------------------------------------------
  test("Toggle Custom Risk Calculation switch is present with ON/OFF states", async ({ page }, info) => {
    caseIds(info, "C110914", "R2-toggle");
    await gotoCRCSection(page);
    const toggle = page.locator(SEL.enableToggle);
    await expect(toggle).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    const text = (await toggle.innerText()).trim();
    expect(text, `toggle should carry ON/OFF text; got "${text}"`).toMatch(/ON\s+OFF|OFF\s+ON|ON|OFF/);
    // Toggle label text nearby.
    await expect(
      page.locator(CRC.sectionSelector).getByText(CRC.labels.toggleLabel, { exact: false }).first(),
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "toggle-verified");
  });

  // --------------------------------------------------------------------------
  test("Parameters group renders Likelihood + Impact categories", async ({ page }, info) => {
    caseIds(info, "C110915");
    await gotoCRCSection(page);
    for (const category of CRC.labels.categories) {
      await expect(
        page.locator(CRC.sectionSelector).getByText(category, { exact: true }).first(),
        `category ${category} label must appear`,
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    }
    await step(page, info, 1, "categories-verified");
  });

  // --------------------------------------------------------------------------
  test("Three range sliders render (Authenticated, Application, High Value Target)", async ({ page }, info) => {
    caseIds(info, "C110916");
    await gotoCRCSection(page);
    for (const sel of [SEL.authenticatedRange, SEL.applicationRange, SEL.highValueRange]) {
      await expect(page.locator(sel), sel).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    }
    await step(page, info, 1, "sliders-mounted");
  });

  // --------------------------------------------------------------------------
  test("Slider labels: Authenticated / Application / HVT endpoint labels present", async ({ page }, info) => {
    caseIds(info, "C110917");
    await gotoCRCSection(page);
    const groups: Array<[string, string[]]> = [
      ["authenticated", CRC.labels.authenticated],
      ["application", CRC.labels.application],
      ["highValue", CRC.labels.highValue],
    ];
    for (const [name, labels] of groups) {
      for (const lbl of labels) {
        await expect(
          page.locator(CRC.sectionSelector).getByText(lbl, { exact: true }).first(),
          `${name} label "${lbl}"`,
        ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      }
    }
    await step(page, info, 1, "slider-labels-verified");
  });

  // --------------------------------------------------------------------------
  test("Save button is present (not clicked to avoid mutating shared tenant risk parameters)", async ({ page }, info) => {
    caseIds(info, "C110918");
    await gotoCRCSection(page);
    await expect(page.locator(SEL.saveButton)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    // Do NOT click Save — persisting a random slider value would change
    // risk calculation for every model on the tenant.
    await step(page, info, 1, "save-button-visible");
  });
});

// =============================================================================
// Coverage summary for the Custom Risk Calculation sheet
//
//   Raw rows in sheet         : 101 (across 20 truth-table group headers)
//   In-scope UI-observable    : ~15 (structural: section, toggle, categories,
//                                     sliders, endpoint labels, Save button)
//   Merged into                : 6 tests
//   Skipped (documented)      : ~100
//     - Every truth-table input→output formula case (R2-R120 data rows):
//       these are unit-test material against the risk calculation function,
//       not UI e2e. Verifying each via UI would require destructive per-
//       case model setup on the shared tenant.
//
//   Live operations verified in the browser during authoring:
//     * Configurations → Custom Risk Calculation section mounts
//     * Enable toggle carries ON/OFF states + label
//     * Likelihood + Impact category headings present
//     * 3 range sliders render: Authenticated / Application / High Value Target
//     * Endpoint labels for each slider present (Is/Is not Authenticated,
//       Internal/External, Is/Is not HVT)
//     * Save button visible (not clicked — would mutate shared-tenant risk
//       parameters for every model)
// =============================================================================
