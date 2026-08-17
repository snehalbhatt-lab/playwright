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
// Create model sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Create model". 8 real cases in the Diagram > Version history module.
// Merged into 3 non-destructive tests covering 3 rows; 5 rows skipped.
//
// The feature: from the Version History panel, an old version row has
// a (+) icon that opens a "Create Model" dialog. Clicking Save creates
// a NEW threat model on the tenant using the source version's canvas.
// Only the dialog-visibility path is exercised here — Save is
// destructive on the tenant.
//
// Setup requirement: the (+) icon only appears next to OLD versions. A
// fresh disposable model starts with only the current version, so each
// test creates a version first (via the Create Version dialog covered
// by tests/version_history.spec.ts) to promote the initial version to
// "old" status. That version + parent model are all deleted at test
// end via cleanupDisposableModel.
//
// Live-vs-Excel drift:
//   - Excel R02 says the dialog title is "Create new model"; live app
//     titles it "Create Model".
//   - Excel R03 says clicking "cancel icon" collapses the dialog. The
//     live dialog has NO explicit Cancel button — the titlebar X is
//     the cancel path.
//
// Skipped (documented — destructive):
//   - R04 — clicking Save creates a real child threat model on the
//     tenant. Each execution leaves persistent state.
//   - R05 — duplicate-version error: requires R04 first + a second
//     Save attempt.
//   - R06, R07, R08 — verify child-model content parity with source
//     version. All downstream of R04 having succeeded.
// =============================================================================

const CM = testdata.createModel;
const SEL = CM.selectors;
const EXP = CM.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function openVersionHistoryWithOldVersion(page: Page): Promise<string> {
  await login(page);
  await gotoTMList(page);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  const { modelName } = await createDisposableModel(page, CM.modelPrefix);
  await page.waitForTimeout(3000);
  await page.evaluate(() =>
    document
      .querySelectorAll("ngx-guided-tour, .guided-tour-user-input-mask, .k-overlay, .tour-backdrop, tm-release-note")
      .forEach((el) => el.remove()),
  );
  await clearBlockingOverlays(page);

  // Open Version History panel.
  await page.locator(SEL.versionHistoryIcon).click();
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    document.querySelectorAll(".gray-block, .colored-block").forEach((el) => el.remove()),
  );

  // Create a new version so the initial 1.0 becomes an "old" version.
  await page.locator(SEL.createVersionButton).click();
  await page.waitForTimeout(1000);
  await page.evaluate(
    ({ vSel, nSel, v, n }) => {
      const vEl = document.querySelector(vSel) as HTMLInputElement | null;
      const nEl = document.querySelector(nSel) as HTMLTextAreaElement | null;
      if (!vEl || !nEl) throw new Error("create-version fields missing");
      const setterI = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      const setterT = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setterI.call(vEl, v);
      vEl.dispatchEvent(new Event("input", { bubbles: true }));
      vEl.dispatchEvent(new Event("change", { bubbles: true }));
      setterT.call(nEl, n);
      nEl.dispatchEvent(new Event("input", { bubbles: true }));
      nEl.dispatchEvent(new Event("change", { bubbles: true }));
    },
    {
      vSel: SEL.createVersionInput,
      nSel: SEL.createVersionNotesInput,
      v: CM.newVersion,
      n: CM.createVersionNotes,
    },
  );
  await expect(page.locator(SEL.createVersionSubmit)).toBeEnabled({ timeout: TIMEOUTS.buttonEnabled });
  await page.locator(SEL.createVersionSubmit).click();
  await page.waitForTimeout(3500);
  return modelName;
}

test.describe.configure({ mode: "serial" });

test.describe("Create model — Diagram > Version history", () => {
  // Setup (create model + create version) + cleanup runs 3-4 min per
  // test; per-test timeout raised to 10 min so tests don't tear down
  // in the middle of cleanup.
  test.setTimeout(600000);

  test("create_model_icon_shown_next_to_old_version: (+) icon appears on the old version row", async ({ page }, info) => {
    caseIds(info, "CM.R01");
    const modelName = await openVersionHistoryWithOldVersion(page);
    try {
      // R01 — the (+) icon must render on the old version's row.
      // Panel accordion should now list a "1.0" row with the plus icon.
      const plusIcon = page.locator(SEL.createModelIcon).first();
      await expect(plusIcon, "(+) Create Model icon must render on old version row").toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });
      await step(page, info, 1, "plus-icon-visible");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("create_new_model_dialog_opens_autofilled: click (+) opens Create Model dialog with name + version prefilled", async ({ page }, info) => {
    caseIds(info, "CM.R02");
    const modelName = await openVersionHistoryWithOldVersion(page);
    try {
      await page.locator(SEL.createModelIcon).first().click();
      const dialog = page.locator(SEL.createModelDialog).first();
      await expect(dialog, "Create Model dialog must open").toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });
      await step(page, info, 1, "dialog-open");

      // R02 — name and version should be autofilled with the source
      // model's name and the OLD version we clicked (initial "1.0").
      const nameValue = ((await page.locator(SEL.nameInputInner).inputValue()) ?? "").trim();
      const versionValue = ((await page.locator(SEL.versionInputInner).inputValue()) ?? "").trim();
      expect(
        nameValue,
        `Name must be autofilled with source model name (got "${nameValue}")`,
      ).toContain(CM.modelPrefix);
      expect(
        versionValue,
        `Version must be autofilled with the old version (${CM.sourceInitialVersion})`,
      ).toBe(CM.sourceInitialVersion);
      // Save button must be present (whether or not enabled).
      await expect(page.locator(SEL.saveButton)).toBeVisible();
      await step(page, info, 2, "autofilled-verified");

      // Close the dialog without clicking Save.
      await page.locator(SEL.dialogCloseX).first().click();
      await expect(dialog).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("cancel_closes_create_model_dialog: dialog X closes without creating a model", async ({ page }, info) => {
    caseIds(info, "CM.R03");
    const modelName = await openVersionHistoryWithOldVersion(page);
    try {
      await page.locator(SEL.createModelIcon).first().click();
      const dialog = page.locator(SEL.createModelDialog).first();
      await expect(dialog).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await step(page, info, 1, "dialog-open");

      // R03 — clicking the titlebar X (the cancel path on this
      // dialog — there is no explicit Cancel button) hides the dialog
      // without triggering a Save.
      await page.locator(SEL.dialogCloseX).first().click();
      await expect(dialog, "dialog must be dismissed after X click").toBeHidden({
        timeout: TIMEOUTS.dialogHidden,
      });
      await step(page, info, 2, "dialog-closed");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });
});
