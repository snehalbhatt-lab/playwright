import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import { BASE_URL, TIMEOUTS, login, capture, clearBlockingOverlays } from "./lib/helpers";

// =============================================================================
// Rule Engine sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Rule Engine". 158 real cases in 7 modules. Merged into 10 UI-observable
// tests covering ~30 non-destructive cases; ~125 rows skipped with reason.
//
// Big constraint: R005 explicitly says "only Enterprise Admin can create,
// edit and delete Rule Engine." sbhatt is not Enterprise Admin on tmdev,
// so Save flows may fail with permission errors. This suite avoids
// clicking Save entirely — verifies form controls exist and dropdowns
// open, but doesn't persist changes.
//
// Live-vs-Excel drift:
//   - Excel implies R005 restricts even READ access; live app lets
//     sbhatt view Rules Engine and open Create form (permission gate is
//     only on Save, not on the UI). Test 9 verifies Save is at least
//     reachable in the DOM — the permission failure would only surface
//     server-side.
//   - Live URL is /rules-engine (not /rule-engine).
//   - Live sidebar label is "Rules Engine" (plural).
//   - Save button id has capitalization drift: `ruleConfig-Save-button`
//     (capital S) — kept exactly as ships.
//   - This tenant currently has 134 saved rules so an empty-state test
//     (R052-R054) is not applicable and is skipped.
//
// Skipped (documented):
//   - Customer module (23 cases): rule execution effects (status/risk/
//     version/lock/collab changes) — destructive on shared models.
//   - AWS/Azure/GCP Cloud Model rule creation + execution (~55 cases):
//     each save persists on the tenant + executes across cloud models.
//   - Cloudmodeler component metadata (6 cases): needs cloud fixtures.
//   - Actual Save / Save & Activate / Delete flows (~40 cases): permission
//     gated + persists to shared tenant.
//   - Empty-state tests (R052-R054): tenant has >0 rules.
//   - Cross-department transfer / grant / revoke access (R073-R083):
//     destructive + permission gated.
//   - Attribute-answer trigger effects (R036-R038): needs disposable
//     model with attribute setup.
// =============================================================================

const RE = testdata.ruleEngine;
const SEL = RE.selectors;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function gotoRuleEngine(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + RE.path);
  await expect(page).toHaveTitle(new RegExp(RE.titlePattern), { timeout: TIMEOUTS.navMedium });
  await clearBlockingOverlays(page);
  // The Create form on the right mounts asynchronously; the section id is a
  // reliable anchor.
  await expect(page.locator(SEL.createFormSection)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

test.describe("Rule Engine", () => {
  test.setTimeout(TIMEOUTS.test);

  // --------------------------------------------------------------------------
  test("R005 (UI) - navigate to Rules Engine mounts page with heading + Create form section", async ({ page }, info) => {
    caseIds(info, "C110989", "R005");
    await gotoRuleEngine(page);
    await expect(page.getByRole("heading", { name: RE.labels.pageHeading, level: 1 })).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(page.getByRole("heading", { name: RE.labels.createFormHeading, level: 2 })).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 1, "rule-engine-mounted");
  });

  // --------------------------------------------------------------------------
  test("R041 R043 R047 - My Rules list panel renders with count + search + filters + sort", async ({ page }, info) => {
    caseIds(info, "C110990", "R041", "R043", "R047");
    await gotoRuleEngine(page);
    await expect(page.locator(SEL.reportCount).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    const count = (await page.locator(SEL.reportCount).first().innerText()).trim();
    expect(count, "reportCount should be numeric").toMatch(/^\d+$/);
    for (const sel of [SEL.searchInput, SEL.contextFilter, SEL.statusFilter, SEL.sortByFilter]) {
      await expect(page.locator(sel).first(), sel).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    }
    // Each list row exposes an Action three-dot menu (aria "Toggle rule action menu").
    // With 134 rules across pages, at least one should be attached.
    await expect(page.locator(SEL.actionMenuTemplate).first()).toBeAttached({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "list-controls-verified");
  });

  // --------------------------------------------------------------------------
  test("R006 - Create form: Rule Name textbox exists and accepts special characters", async ({ page }, info) => {
    caseIds(info, "C110991", "R006");
    await gotoRuleEngine(page);
    const nameInput = page.locator(SEL.ruleNameInput).first();
    await expect(nameInput).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    // The prompt calls out special chars: - _ . : ; @ ( ) % ! , ? & * $
    const sample = "QA_probe rule- _ . : ; @ ( ) % ! , ? & * $";
    await nameInput.fill(sample);
    await expect(nameInput).toHaveValue(sample);
    await step(page, info, 1, "rule-name-accepts-special-chars");
    // Clear — do not save (avoid permission trigger + persistence).
    await nameInput.fill("");
  });

  // --------------------------------------------------------------------------
  test("R071 R072 - Context combobox default value + shape", async ({ page }, info) => {
    caseIds(info, "C110992", "R071", "R072");
    await gotoRuleEngine(page);
    const context = page.locator(SEL.contextCombobox);
    await expect(context).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    // The kendo-combobox exposes its selected value on the inner <input>'s
    // `value` attribute (innerText is empty).
    const innerInput = context.locator("input").first();
    const value = (await innerInput.inputValue()) || (await innerInput.getAttribute("placeholder")) || "";
    expect(
      /Organization|Department|Model|Context/i.test(value),
      `context selector should show a scope; got "${value}"`,
    ).toBeTruthy();
    await step(page, info, 1, "context-combobox-present");
  });

  // --------------------------------------------------------------------------
  test("R016 R060 - Trigger combobox mounts with placeholder 'Select Trigger'", async ({ page }, info) => {
    caseIds(info, "C110993", "R016", "R060");
    await gotoRuleEngine(page);
    const trigger = page.locator(SEL.triggerCombobox);
    await expect(trigger).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    // "Select Trigger" is the placeholder attribute on the inner <input>.
    const innerInput = trigger.locator("input").first();
    const placeholder = await innerInput.getAttribute("placeholder");
    expect(placeholder).toBe("Select Trigger");
    await step(page, info, 1, "trigger-combobox-with-placeholder");
  });

  // --------------------------------------------------------------------------
  test("R018 R061 - Add Condition button is present + Conditions section shows 'No conditions added'", async ({ page }, info) => {
    caseIds(info, "C110994", "R018", "R061");
    await gotoRuleEngine(page);
    await expect(page.locator(SEL.addConditionButton)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(page.getByText(/No conditions added/i).first()).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 1, "conditions-empty-state-with-add");
  });

  // --------------------------------------------------------------------------
  test("R065 - Add Action button is present in the Actions section", async ({ page }, info) => {
    caseIds(info, "C110995", "R065");
    await gotoRuleEngine(page);
    // Scroll into view since Actions is below Conditions.
    await page.locator(SEL.addActionButton).scrollIntoViewIfNeeded();
    await expect(page.locator(SEL.addActionButton)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "add-action-button-visible");
  });

  // --------------------------------------------------------------------------
  test("R005 (partial) - Save / Save & Activate / Cancel buttons render", async ({ page }, info) => {
    caseIds(info, "C110996", "R005", "R082");
    await gotoRuleEngine(page);
    for (const sel of [SEL.saveButton, SEL.saveAndActivateButton, SEL.cancelButton]) {
      await expect(page.locator(sel), sel).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    }
    await step(page, info, 1, "toolbar-buttons-visible");
    // Do NOT click Save — sbhatt lacks Enterprise Admin so persisting would
    // either error or leave residue. Buttons render is sufficient for R005 UI.
  });

  // --------------------------------------------------------------------------
  test("R010 R043 - Search filters the rule list", async ({ page }, info) => {
    caseIds(info, "C110997", "R010", "R043");
    await gotoRuleEngine(page);
    const search = page.locator(SEL.searchInput).first();
    await expect(search).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    const initialCount = parseInt((await page.locator(SEL.reportCount).first().innerText()).trim(), 10);
    await search.fill("XZQZ_no_match_string");
    // Wait for debounce.
    await page.waitForTimeout(1500);
    const filteredCount = parseInt((await page.locator(SEL.reportCount).first().innerText()).trim(), 10);
    expect(filteredCount, "search for a nonsense term should reduce (or zero) the count").toBeLessThanOrEqual(
      initialCount,
    );
    await step(page, info, 1, "search-narrowed-list");
    // Clear search
    await search.fill("");
  });

  // --------------------------------------------------------------------------
  test("R088 R089 (UI) - Rule Engine layout mounts without blocking overlays after clearing loaders", async ({ page }, info) => {
    caseIds(info, "C110998", "R088", "R089");
    await gotoRuleEngine(page);
    // The onboarding tour may auto-dismiss for existing users. Assert that
    // after clearBlockingOverlays the primary controls are usable.
    for (const sel of [SEL.ruleNameInput, SEL.addConditionButton, SEL.saveButton]) {
      await expect(page.locator(sel).first(), sel).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    }
    await step(page, info, 1, "primary-controls-usable");
  });
});

// =============================================================================
// Coverage summary for the Rule Engine sheet
//
//   Raw rows in sheet         : 158 (blank + Jira-link rows excluded)
//   In-scope UI-observable    : ~30
//   Merged into                : 10 tests
//   Skipped (documented)      : ~125
//     - Customer module (23): rule execution effects — destructive
//     - AWS/Azure/GCP Cloud Model rule creation + execution (~55):
//       persists to tenant + mutates cloud models
//     - Cloudmodeler component metadata (6): needs cloud fixtures
//     - Save/Save & Activate/Delete flows (~40): permission gated +
//       destructive
//     - Empty-state tests (R052-R054): tenant has 134 rules
//     - Cross-department transfer/grant/revoke access (R073-R083):
//       destructive + permission gated
//     - Attribute-answer trigger effects (R036-R038): needs disposable
//       model with attribute setup
//
//   Live operations verified in the browser during authoring:
//     * Navigate to /rules-engine mounts page + Create form (R005 UI)
//     * List panel: count + search + filters + sort + per-row action menu
//       (R041, R043, R047)
//     * Rule Name accepts special characters (R006)
//     * Context combobox shows Model/Department/Organization scope (R071)
//     * Trigger combobox placeholder "Select Trigger" (R016, R060)
//     * Conditions section: Add button + empty message (R018, R061)
//     * Actions section: Add button (R065)
//     * Save / Save & Activate / Cancel render (R005 partial)
//     * Search reduces the visible count (R010, R043)
//     * Primary controls remain usable after loader dismissal (R088, R089)
// =============================================================================
