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
// Note@mention sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Note@mention". 19 real cases in the Diagram > Notes module. Merged
// into 4 tests covering 5 rows explicitly; ~10 rows are conceptually
// covered by the same code-path assertions; ~7 rows skipped.
//
// The sheet covers two unrelated feature areas:
//   1. @mention notifications (R01-R07) — mentioning a user in a note
//      triggers an in-app + email notification with a redirect link.
//      Requires a second seeded recipient user, inbox access, and
//      cross-user login flows. Out of scope for this pass.
//   2. 5000-character limit on notes (R08-R18) — counter, typing
//      behavior, cap enforcement, "cannot edit or delete after
//      creation" hint. Non-destructive if we type into the textarea
//      without clicking Save.
//
// Live-vs-Excel drift:
//   - Excel R08 describes the counter as "5000 count under the notes";
//     live app renders "Characters Left: {left} / 5000".
//   - The 5000 cap is enforced by the native `maxlength="5000"`
//     attribute on the textarea — this is what stops keyboard input at
//     5000 chars. JS `value=` setters can bypass it (the DOM allows
//     over-limit values programmatically); the test asserts the
//     attribute is present rather than trying to keystroke-type 5000+
//     characters.
//
// Skipped (documented — cross-user fixture, redundant, or destructive):
//   - R01-R07 — @mention notifications need a recipient user account,
//     notification-panel inspection, and email access.
//   - R12-R16 — same 5000-char limit exercised in SR / test-case /
//     info / task / actions / status panels. All bind to the same
//     Angular form control; asserting the limit in the threats note
//     validates the same code path.
//   - R18 — verify limit across all model types: same code path.
// =============================================================================

const NM = testdata.noteAtMention;
const SEL = NM.selectors;
const EXP = NM.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function openDisposableModelAndFirstThreatNotes(page: Page): Promise<string> {
  await login(page);
  await gotoTMList(page);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  const { modelName } = await createDisposableModel(page, NM.modelPrefix);
  await page.waitForTimeout(3000);
  await page.evaluate(() =>
    document
      .querySelectorAll("ngx-guided-tour, .guided-tour-user-input-mask, .k-overlay, .tour-backdrop, tm-release-note")
      .forEach((el) => el.remove()),
  );
  await clearBlockingOverlays(page);

  // Open the threats side panel.
  await page.locator(SEL.threatsSideMenu).click();
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    document.querySelectorAll(".gray-block, .colored-block").forEach((el) => el.remove()),
  );
  // Expand the threats panel to full width (icon toggles the size).
  await page.locator(SEL.threatsExpandIcon).click().catch(() => {});
  await page.waitForTimeout(800);
  await page.evaluate(() =>
    document.querySelectorAll(".gray-block, .colored-block").forEach((el) => el.remove()),
  );

  // Expand the first threat row → its inline notes area renders.
  // The Expand-Details link is styled `visibility:hidden` until the
  // grid row is hovered/focused (kendo shows expand icons on hover),
  // so Playwright's default click waits fail. JS-dispatching the
  // click bypasses the visibility check — the click handler itself
  // works regardless.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    el?.click();
  }, SEL.expandThreatDetails);
  await expect(page.locator(SEL.noteTextarea).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  return modelName;
}

// Set the textarea value via the browser's native value setter + input
// event so Angular's form control updates its bound length, refreshing
// the "Characters Left" counter.
async function setNoteValue(page: Page, value: string): Promise<void> {
  await page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel) as HTMLTextAreaElement | null;
      if (!el) throw new Error(`no textarea for ${sel}`);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { sel: SEL.noteTextarea, val: value },
  );
  await page.waitForTimeout(400);
}

async function counterText(page: Page): Promise<string> {
  return ((await page.locator(SEL.characterCounter).first().textContent()) ?? "").trim();
}

test.describe.configure({ mode: "serial" });

test.describe("Note@mention — Diagram > Notes", () => {
  // Disposable-model archive + permanent-delete takes 90-120s on this
  // tenant; per-test timeout raised to 10 min so setup + test +
  // cleanup all fit.
  test.setTimeout(600000);

  test("character_count_shows_5000_initial: empty textarea shows 'Characters Left: 5000 / 5000'", async ({ page }, info) => {
    caseIds(info, "NM.R08");
    const modelName = await openDisposableModelAndFirstThreatNotes(page);
    try {
      const text = await counterText(page);
      expect(text, `counter must read initial 5000 — got "${text}"`).toContain(EXP.initialCounterText);
      await step(page, info, 1, "counter-initial");

      // The `maxlength` attribute is the authoritative browser-side
      // cap; verify it's set to the expected limit.
      const ml = await page.locator(SEL.noteTextarea).first().getAttribute("maxlength");
      expect(Number(ml), `maxlength attribute must equal ${EXP.characterLimit}`).toBe(EXP.characterLimit);
      await step(page, info, 2, "maxlength-verified");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("character_count_updates_on_type_and_delete: counter reflects value length in real time", async ({ page }, info) => {
    caseIds(info, "NM.R09", "NM.R10");
    const modelName = await openDisposableModelAndFirstThreatNotes(page);
    try {
      // Type 11 chars → counter drops by 11.
      const typed = "Hello world";
      await setNoteValue(page, typed);
      let text = await counterText(page);
      const expectedTypedLeft = EXP.characterLimit - typed.length;
      expect(text, `after typing ${typed.length} chars, counter must show ${expectedTypedLeft}`).toContain(
        `${expectedTypedLeft} / ${EXP.characterLimit}`,
      );
      await step(page, info, 1, "counter-after-type");

      // Delete 6 chars ("Hello ") → counter jumps back up by 6.
      const shorter = typed.slice(6);
      await setNoteValue(page, shorter);
      text = await counterText(page);
      const expectedShorterLeft = EXP.characterLimit - shorter.length;
      expect(text, `after deleting, counter must show ${expectedShorterLeft}`).toContain(
        `${expectedShorterLeft} / ${EXP.characterLimit}`,
      );
      await step(page, info, 2, "counter-after-delete");

      // Fully clear → counter returns to 5000 / 5000.
      await setNoteValue(page, "");
      text = await counterText(page);
      expect(text, "clearing text must restore counter to full").toContain(EXP.initialCounterText);
      await step(page, info, 3, "counter-cleared");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("character_limit_enforced_at_5000: textarea has maxlength=5000; keyboard typing is capped", async ({ page }, info) => {
    caseIds(info, "NM.R11");
    const modelName = await openDisposableModelAndFirstThreatNotes(page);
    try {
      const textarea = page.locator(SEL.noteTextarea).first();

      // Native `maxlength` attribute is the browser-enforced cap.
      const ml = await textarea.getAttribute("maxlength");
      expect(Number(ml), "maxlength attribute must be 5000").toBe(EXP.characterLimit);

      // JS `value=` setters can bypass the attribute, but a real
      // user's keystrokes cannot. Simulate real input by using
      // page.locator.fill() (which types the value) and confirm the
      // browser truncates at the cap. We limit the fill string to
      // slightly over the cap; anything longer would inflate the
      // wall-clock cost.
      const overCap = "x".repeat(EXP.characterLimit + 50);
      await textarea.fill(overCap);
      await page.waitForTimeout(400);
      const val = (await textarea.inputValue()) ?? "";
      expect(
        val.length,
        `textarea must cap at ${EXP.characterLimit} chars — got ${val.length}`,
      ).toBeLessThanOrEqual(EXP.characterLimit);
      // The counter should read 0 / 5000 at the cap.
      const text = await counterText(page);
      expect(text, "counter must reach 0 when field is at cap").toContain(`0 / ${EXP.characterLimit}`);
      await step(page, info, 1, "cap-enforced");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("notes_cannot_be_edited_hint_visible: 'Notes cannot be edited or deleted after creation' hint is shown", async ({ page }, info) => {
    caseIds(info, "NM.R17");
    const modelName = await openDisposableModelAndFirstThreatNotes(page);
    try {
      const hint = page.locator(SEL.notesHintContainer).filter({
        hasText: new RegExp(EXP.notesHintText, "i"),
      });
      await expect(hint.first(), "immutability hint must be visible in the notes area").toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });
      await step(page, info, 1, "hint-visible");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });
});
