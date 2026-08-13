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
// Version history sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Version history". 15 real cases in the Diagram > Version History
// module. Merged into 5 non-destructive tests covering 6 rows; 9 rows
// skipped with reason.
//
// Live-vs-Excel drift:
//   - Excel R02 lists "New version, release notes, note, submit, cancel"
//     — live app has a New Version input, a Release Notes textarea
//     (which is the "note" field), a Submit button, and a Close (X)
//     button. There is no separate "Cancel" button; the X is the
//     Cancel path (R05).
//   - Excel R03 says "Submit disabled until mandatory fields filled" —
//     live confirms both New Version + Release Notes are mandatory;
//     Submit stays disabled until both are non-empty.
//
// Skipped (documented — destructive or need pre-existing old
// versions):
//   - R06 — actually submitting the dialog creates a persistent new
//     version on the model (not reversible without deleting the model).
//   - R07, R08, R09, R10, R14 — verify old-version behavior
//     (read-only, back-to-live, snapshot content, tooltips on old
//     rows). A fresh disposable model starts with only the current
//     version, so there is no "old" row to inspect.
//   - R11 — Compare Version needs 2+ versions.
//   - R12, R13 — Custom Report generation is destructive (creates a
//     report record + emails a PDF; content lives in the emailed
//     PDF).
// =============================================================================

const VH = testdata.versionHistory;
const SEL = VH.selectors;
const EXP = VH.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function openDisposableModelAndVersionPanel(page: Page): Promise<string> {
  await login(page);
  await gotoTMList(page);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  const { modelName } = await createDisposableModel(page, VH.modelPrefix);
  await page.waitForTimeout(3000);
  // Guided-tour and release-note overlays re-appear on the diagram
  // page and swallow pointer events on the side-nav icons. Wipe them
  // before touching the Version History button.
  await page.evaluate(() =>
    document
      .querySelectorAll("ngx-guided-tour, .guided-tour-user-input-mask, .k-overlay, .tour-backdrop, tm-release-note")
      .forEach((el) => el.remove()),
  );
  await clearBlockingOverlays(page);
  await page.locator(SEL.sideNavButton).click();
  await expect(page.locator(SEL.panel)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  return modelName;
}

// The New Version input is a plain HTML text input (not a kendo
// textbox); the Release Notes is a real textarea. Both bind on
// input+change and drive the Submit-enabled logic.
async function setDialogField(page: Page, selector: string, value: string): Promise<void> {
  await page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) throw new Error(`no field for ${sel}`);
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { sel: selector, val: value },
  );
  await page.waitForTimeout(500);
}

test.describe.configure({ mode: "serial" });

test.describe("Version history — Diagram > Version History", () => {
  test.setTimeout(TIMEOUTS.test);

  test("version_history_shows_current_version: panel current version matches header badge", async ({ page }, info) => {
    caseIds(info, "VH.R01", "VH.R15");
    const modelName = await openDisposableModelAndVersionPanel(page);
    try {
      await step(page, info, 1, "panel-open");
      // R01 / R15 — the panel's "Current Version" line and the header
      // "V x.y" badge should reflect the same version string. The
      // disposable model is created at 1.0 by createDisposableModel.
      const headerVersion = ((await page.locator(SEL.headerVersionBadge).textContent()) ?? "").trim();
      expect(headerVersion, "header must show a V prefix + version").toMatch(/^V\s*\d/);
      const panelText = ((await page.locator(SEL.panel).textContent()) ?? "").trim();
      expect(panelText, "panel must contain Current Version label").toContain("Current Version");
      // Extract the version number from the header (e.g. "V 1.0" -> "1.0")
      // and assert it appears in the panel body.
      const versionNumber = headerVersion.replace(/^V\s*/, "").trim();
      expect(panelText).toContain(versionNumber);
      await step(page, info, 2, "current-version-matches");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("create_version_dialog_structure: dialog opens with New Version + Release Notes + Submit + Close", async ({ page }, info) => {
    caseIds(info, "VH.R02");
    const modelName = await openDisposableModelAndVersionPanel(page);
    try {
      await page.locator(SEL.createVersionButton).click();
      await expect(page.locator(SEL.dialog).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await step(page, info, 1, "dialog-open");

      // R02 — dialog carries a New Version input, a Release Notes
      // textarea (the "note" field), a Submit button, and a Close X.
      await expect(page.locator(SEL.newVersionInput)).toBeVisible();
      await expect(page.locator(SEL.releaseNotesTextarea)).toBeVisible();
      await expect(page.locator(SEL.releaseNotesTextarea)).toHaveAttribute(
        "placeholder",
        EXP.notesPlaceholder,
      );
      await expect(page.locator(SEL.submitButton)).toBeVisible();
      await expect(page.locator(SEL.dialogCloseButton).first()).toBeVisible();
      await step(page, info, 2, "fields-verified");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("create_version_submit_disabled_without_mandatory: Submit stays disabled until both New Version and Release Notes are filled", async ({ page }, info) => {
    caseIds(info, "VH.R03");
    const modelName = await openDisposableModelAndVersionPanel(page);
    try {
      await page.locator(SEL.createVersionButton).click();
      await expect(page.locator(SEL.dialog).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });

      // R03 — Submit is disabled with an empty form.
      await expect(page.locator(SEL.submitButton)).toBeDisabled();
      await step(page, info, 1, "submit-disabled-empty");

      // Filling only the version keeps Submit disabled.
      await setDialogField(page, SEL.newVersionInput, VH.sampleNewVersion);
      await expect(page.locator(SEL.submitButton), "Submit must stay disabled with only New Version filled").toBeDisabled();
      await step(page, info, 2, "submit-disabled-partial");

      // Filling notes as well enables Submit.
      await setDialogField(page, SEL.releaseNotesTextarea, VH.sampleReleaseNotes);
      await expect(page.locator(SEL.submitButton), "Submit must enable once both fields are non-empty").toBeEnabled({
        timeout: TIMEOUTS.buttonEnabled,
      });
      await step(page, info, 3, "submit-enabled-full");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("create_version_cancel_closes_dialog: filling fields then Close X closes dialog without creating a version", async ({ page }, info) => {
    caseIds(info, "VH.R05");
    const modelName = await openDisposableModelAndVersionPanel(page);
    try {
      const versionBefore = ((await page.locator(SEL.headerVersionBadge).textContent()) ?? "").trim();

      await page.locator(SEL.createVersionButton).click();
      await expect(page.locator(SEL.dialog).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await setDialogField(page, SEL.newVersionInput, VH.sampleNewVersion);
      await setDialogField(page, SEL.releaseNotesTextarea, VH.sampleReleaseNotes);
      await step(page, info, 1, "form-filled");

      // R05 — Close (X) collapses the dialog and does not create a
      // new version. The Excel calls this "cancel"; the live app uses
      // an X icon for the cancel path.
      await page.locator(SEL.dialogCloseButton).first().click();
      await expect(page.locator(SEL.dialog).first()).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
      await step(page, info, 2, "dialog-closed");

      // The header version badge should still read the same version;
      // if the dialog had accidentally submitted, this would flip to
      // the sampleNewVersion.
      const versionAfter = ((await page.locator(SEL.headerVersionBadge).textContent()) ?? "").trim();
      expect(versionAfter, `no new version created — before="${versionBefore}" after="${versionAfter}"`).toBe(
        versionBefore,
      );
      await step(page, info, 3, "version-unchanged");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("current_version_shows_submitter_info: current-version row lists submitter name and Version Created timestamp", async ({ page }, info) => {
    caseIds(info, "VH.R04");
    const modelName = await openDisposableModelAndVersionPanel(page);
    try {
      const panelText = ((await page.locator(SEL.panel).textContent()) ?? "").trim();

      // R04 — the current-version row shows the submitter's display
      // name and a "Version Created:" prefix followed by a timestamp.
      // The Excel expects this for every version; on a fresh
      // disposable model there is only the current row, but the
      // rendering component is shared with older-version rows.
      expect(panelText, "submitter name must appear in panel").toContain(EXP.submitterName);
      expect(panelText, "'Version Created' label must appear in panel").toContain(EXP.versionCreatedPrefix);
      await step(page, info, 1, "submitter-info-visible");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });
});
