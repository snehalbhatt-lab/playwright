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
// On form validation sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// " On form validation" (note leading space). 22 rows in the sheet but
// only 6 have content — rows 7-22 are empty placeholders left behind
// from an earlier draft. Real cases (all in the "Create new model"
// module) merged into 3 tests covering all 6 rows.
//
// Live-vs-Excel drift:
//   - Excel R03 expected "Threat model name is a required field" —
//     live app renders "Threat Model Name is a required field" (title
//     case). Excel R04 expected "Threat model Version is..." — live
//     renders "Threat Model Version is a required field". Excel R01
//     said "A threat model with this name already exists"; live shows
//     "Threat Model with same Name & Version already exists."
//     Assertions match the live text, not the Excel wording.
//   - Excel R05/R06 reference "tabs" for different creation types —
//     the live app uses a kendo-tabstrip with Blank / Template /
//     Import File / CloudModeler / Solutions Hub / Wizard tabs. Name
//     and Version values persist across tab switches, and the
//     duplicate error remains visible.
// =============================================================================

const OFV = testdata.onFormValidation;
const SEL = OFV.selectors;
const EXP = OFV.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

// Open the Create New Threat Model dialog from the top-nav
// "Create new menu" button.
async function openCreateDialog(page: Page): Promise<void> {
  // The tenant's release-note dialog also renders as role="dialog" and
  // trips strict-mode selectors that expect a single dialog on the
  // page. Remove it explicitly before opening the Create dialog.
  await page.evaluate(() =>
    document.querySelectorAll("tm-release-note").forEach((el) => el.remove()),
  );
  await clearBlockingOverlays(page);
  await page.locator(SEL.createNewMenu).click();
  // The menuitem's accessible name concatenates the leading logo alt
  // ("Tm logo") with the visible label, so exact-match on
  // "Threat Model" misses it. Match a trailing "Threat Model" instead.
  const menuItem = page.getByRole("menuitem", { name: /Threat Model$/ });
  await expect(menuItem).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await menuItem.click();
  const dialog = page.locator(SEL.createNewDialog);
  await expect(dialog).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await expect(page.locator(SEL.nameInputInner)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

// Close the dialog by pressing Escape — the titlebar close button's
// selector is fragile (multiple close buttons on the page) and Escape
// works consistently on kendo dialogs.
async function closeCreateDialog(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

// Set a value on the name / version input. Both inputs are inside a
// kendo-textbox — reactive-form binding requires input + change events
// so the model updates before validation runs. Skipping change here
// makes the duplicate-check race the assertion.
async function setDialogField(page: Page, innerSelector: string, value: string): Promise<void> {
  await page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) throw new Error(`no input for ${sel}`);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    },
    { sel: innerSelector, val: value },
  );
  await page.waitForTimeout(1000);
}

test.describe.configure({ mode: "serial" });

// Shared disposable model — the duplicate-name assertion needs a
// pre-existing model on the tenant to collide with. Create one before
// the tests run and clean it up after. Using a shared model instead of
// per-test disposables keeps the ~30-45s create + ~60-90s cleanup cost
// paid once.
let dupModelName = "";
let dupModelVersion = "1.0";

// Disposable-model create + cleanup on this tenant runs ~90-120s each,
// so the hook timeout must be raised well above Playwright's 30s default.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(TIMEOUTS.test);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page);
    await gotoTMList(page);
    await dismissPostLoginOverlays(page);
    await clearBlockingOverlays(page);
    const created = await createDisposableModel(page, OFV.modelPrefix);
    dupModelName = created.modelName;
  } finally {
    await page.close();
    await context.close();
  }
});

test.afterAll(async ({ browser }) => {
  test.setTimeout(TIMEOUTS.test);
  if (!dupModelName) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page);
    await cleanupDisposableModel(page, dupModelName);
  } catch {
    // Best-effort cleanup — the shared model isn't test state.
  } finally {
    await page.close();
    await context.close();
  }
});

test.describe("On form validation — Create new model", () => {
  test.setTimeout(TIMEOUTS.test);

  test("duplicate_name_shows_error: existing name + version renders inline duplicate error", async ({ page }, info) => {
    caseIds(info, "OFV.R01", "OFV.R02");
    await login(page);
    await page.goto((testdata as { baseUrl: string }).baseUrl + testdata.paths.threatModels);
    await dismissPostLoginOverlays(page);
    await clearBlockingOverlays(page);
    await openCreateDialog(page);
    await step(page, info, 1, "dialog-open");

    // R01 — enter the shared disposable model's name + version.
    await setDialogField(page, SEL.nameInputInner, dupModelName);
    await setDialogField(page, SEL.versionInputInner, dupModelVersion);
    await expect(
      page.locator(SEL.formError).filter({ hasText: new RegExp(EXP.duplicateError, "i") }).first(),
      "duplicate error must render on the name field",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "duplicate-error-shown");

    // R02 — the error must persist on other creation-type tabs. The
    // Blank/Template/Import/Cloud/Solutions/Wizard tabs share the same
    // Name/Version form field, so the duplicate check applies across
    // all of them. Verify at least one of the other tabs keeps the
    // error visible.
    for (const tabName of OFV.tabSwitchTargets) {
      const tab = page.getByRole("tab", { name: new RegExp(`^${tabName}$`) }).first();
      if (!(await tab.isVisible().catch(() => false))) continue;
      await tab.click();
      await page.waitForTimeout(600);
      await expect(
        page.locator(SEL.formError).filter({ hasText: new RegExp(EXP.duplicateError, "i") }).first(),
        `duplicate error must persist on the ${tabName} tab`,
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await step(page, info, 3, `duplicate-persists-${tabName.toLowerCase().replace(/\s+/g, "-")}`);
      // One tab is enough to satisfy R02 — the switch mechanic is the
      // same for all six tabs.
      break;
    }
    await closeCreateDialog(page);
  });

  test("required_field_errors: clearing name and version each shows the required-field error", async ({ page }, info) => {
    caseIds(info, "OFV.R03", "OFV.R04");
    await login(page);
    await page.goto((testdata as { baseUrl: string }).baseUrl + testdata.paths.threatModels);
    await dismissPostLoginOverlays(page);
    await clearBlockingOverlays(page);
    await openCreateDialog(page);
    await step(page, info, 1, "dialog-open");

    // R03 — type name, clear, verify required-field error.
    await setDialogField(page, SEL.nameInputInner, "TempName");
    await setDialogField(page, SEL.nameInputInner, "");
    await expect(
      page.locator(SEL.formError).filter({ hasText: new RegExp(EXP.nameRequiredError, "i") }).first(),
      "name required-field error must appear when field is cleared",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "name-required-shown");

    // R04 — same for version.
    await setDialogField(page, SEL.versionInputInner, "1.0");
    await setDialogField(page, SEL.versionInputInner, "");
    await expect(
      page.locator(SEL.formError).filter({ hasText: new RegExp(EXP.versionRequiredError, "i") }).first(),
      "version required-field error must appear when field is cleared",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 3, "version-required-shown");

    await closeCreateDialog(page);
  });

  test("error_persists_across_tabs: duplicate error remains after switching tabs and coming back", async ({ page }, info) => {
    caseIds(info, "OFV.R05", "OFV.R06");
    await login(page);
    await page.goto((testdata as { baseUrl: string }).baseUrl + testdata.paths.threatModels);
    await dismissPostLoginOverlays(page);
    await clearBlockingOverlays(page);
    await openCreateDialog(page);
    await step(page, info, 1, "dialog-open");

    // Enter the duplicate name + version on the Blank tab.
    await setDialogField(page, SEL.nameInputInner, dupModelName);
    await setDialogField(page, SEL.versionInputInner, dupModelVersion);
    await expect(
      page.locator(SEL.formError).filter({ hasText: new RegExp(EXP.duplicateError, "i") }).first(),
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "blank-error-shown");

    // R05 — switch to another tab; error still visible.
    const otherTab = page
      .getByRole("tab", { name: new RegExp(`^${OFV.tabSwitchTargets[0]}$`) })
      .first();
    await otherTab.click();
    await page.waitForTimeout(600);
    await expect(
      page.locator(SEL.formError).filter({ hasText: new RegExp(EXP.duplicateError, "i") }).first(),
      `duplicate error must remain visible on ${OFV.tabSwitchTargets[0]} tab`,
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 3, "other-tab-error-persists");

    // R06 — switch back to Blank; error still there, values preserved.
    const blankTab = page.getByRole("tab", { name: /^Blank$/ }).first();
    await blankTab.click();
    await page.waitForTimeout(600);
    await expect(page.locator(SEL.nameInputInner)).toHaveValue(dupModelName);
    await expect(page.locator(SEL.versionInputInner)).toHaveValue(dupModelVersion);
    await expect(
      page.locator(SEL.formError).filter({ hasText: new RegExp(EXP.duplicateError, "i") }).first(),
      "duplicate error must remain visible after switching back to Blank",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 4, "back-to-blank-error-persists");

    await closeCreateDialog(page);
  });
});
