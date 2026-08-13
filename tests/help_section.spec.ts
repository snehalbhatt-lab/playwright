import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import {
  BASE_URL,
  PATHS,
  TIMEOUTS,
  login,
  capture,
  clearBlockingOverlays,
  dismissPostLoginOverlays,
} from "./lib/helpers";

// =============================================================================
// Help Section sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Help Section". 22 real cases mixed across two unrelated feature areas
// — the Help dialog (rows 1-3) and the Threats-panel STRIDE saved view
// (rows 5-22). Only the Help dialog portion is shipped; the STRIDE
// tests were attempted then deferred (see the block at the bottom of
// this file for details). Ships 2 tests covering 3 rows.
//
// Live-vs-Excel drift:
//   - Excel calls the Threats popover "My Views > Saved Filters"; live
//     app labels it "My Views > Saved Views (44)".
//   - STRIDE is NOT a distinct first-class feature — it is one of ~44
//     named saved views. On fresh disposable models, the enclosing
//     "My Views" button does not appear at all (verified 2026-08-13),
//     so the whole downstream STRIDE flow is unreachable from a clean
//     tenant state.
//   - Excel row 4 is a Jira link note (TMDEV-6484), not a test case.
// =============================================================================

const HS = testdata.helpSection;
const SEL = HS.selectors;
const EXP = HS.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function gotoAppLanding(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + PATHS.threatModels);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
}

test.describe.configure({ mode: "serial" });

test.describe("Help Section — Home Screen + Threats STRIDE view", () => {
  test.setTimeout(TIMEOUTS.test);

  test("help_dialog_opens_with_sections: header help icon opens the popup with 3 sections and hyperlink icons", async ({ page }, info) => {
    caseIds(info, "HS.R01", "HS.R02");
    await gotoAppLanding(page);
    await step(page, info, 1, "landing");

    await page.locator(SEL.helpButton).click();
    const popup = page.locator(SEL.helpPopup);
    await expect(popup).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "popup-open");

    // R01 — heading + all three section titles present.
    await expect(page.locator(SEL.helpHeading)).toContainText(EXP.helpHeadingText);
    for (const title of EXP.sectionTitles) {
      await expect(popup).toContainText(title);
    }

    // R02 — every option carries an `.external-link` icon (either an
    // "open new tab" arrow or a download arrow for IaC Assist). Assert
    // the same count of icons as we have identifiable options.
    const optionSelectors = [
      SEL.helpAcademy,
      SEL.helpDocumentation,
      SEL.helpIacAssist,
      SEL.helpTMLink,
      SEL.helpLicense,
      SEL.helpSupport,
    ];
    for (const opt of optionSelectors) {
      const el = page.locator(opt);
      await expect(el, `option ${opt} must be visible`).toBeVisible();
      await expect(
        el.locator(SEL.helpExternalIcon),
        `option ${opt} must render a hyperlink/external-link icon`,
      ).toHaveCount(1);
    }
    await step(page, info, 3, "options-verified");
  });

  test("help_dialog_link_targets: external links have expected hrefs (not followed)", async ({ page }, info) => {
    caseIds(info, "HS.R03");
    await gotoAppLanding(page);
    await page.locator(SEL.helpButton).click();
    await expect(page.locator(SEL.helpPopup)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "popup-open");

    // R03 — external-link options carry expected hrefs. We assert on
    // the attribute rather than actually opening tabs — following the
    // link would race the test tab and adds no signal (the destination
    // is a static third-party page).
    for (const [key, expected] of Object.entries(EXP.helpLinkHrefs)) {
      const el = page.locator((SEL as Record<string, string>)[key]);
      const href = await el.getAttribute("href");
      expect(href, `${key} href must exist`).toBeTruthy();
      expect(href!.toLowerCase(), `${key} href must contain "${expected}"`).toContain(
        expected.toLowerCase(),
      );
    }
    await step(page, info, 2, "hrefs-verified");
  });

  // STRIDE saved-view tests (Excel rows R05-R22) were attempted but
  // deferred after Phase-2 exploration hit two blockers that Playwright
  // can't work around cleanly for this tenant:
  //
  //   1. Fresh disposable models (which we own and can edit) do NOT
  //      render the "My Views" button on the Threats panel — the button
  //      only appears once a model has a non-trivial threat set. A
  //      newly-created HelpTM has 2 default Attacker threats and the
  //      button is absent from the header (verified live 2026-08-13,
  //      screenshot in test-results\help_section-...disposable-model).
  //   2. Pre-existing tenant models on this account often land as
  //      Read-Only / submission-cancelled, which hides the same
  //      controls.
  //
  // Both paths mean there is no reliable, tenant-independent way to
  // reach the STRIDE saved view via automation from a clean starting
  // state. Documented as skipped rather than shipping a flaky flow.
  //
  // Excel rows deferred by this decision:
  //   R05, R06, R07, R08, R09 — STRIDE presence/apply/reset/others/
  //     grouping in Threats panel Saved Views.
  //   R10-R19 — STRIDE column / column-filter / nested/manual/framework
  //     interaction tests (all downstream of R05/R06 being reachable).
  //   R21, R22 — STRIDE absence on SR / Test Cases panels.
});
