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
// Notification sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Notification". 41 real cases in the Configurations > Notifications
// admin page. Every case falls into one of four buckets:
//
//   - UI shell (R2, R3, R7, R8, R9) — page renders, section
//     headings, tooltip, sub-toggle fields.
//   - Save/Discard state (R4, R5, R6).
//   - Email-behaviour verification (R10-R37, R41, R42, ~30 rows) —
//     each row toggles a specific setting and asserts an email is
//     sent to the right party for the triggering action. Requires
//     SMTP inbox capture + often cross-user setups.
//   - Permission gating (R38, R39, R40) — Enterprise Admin only.
//
// Ships 2 non-destructive tests over the read-only shell (T1-T2).
// The rest are skipped for reasons documented below.
//
// Live vs Excel drift:
//   - Excel R8 lists the 4 parts as: Threat Model Collaborator
//     Management, Threat Model Activity, User Management, and
//     **Site Management**. Live tmdev (7.4.1) exposes the 4th
//     section as **General**, not Site Management. T1 pins the live
//     name so future rename drift is caught, and this drift is
//     called out in the assertion message.
//   - On this account (sbhatt), all four sections come up with
//     `aria-disabled="true"` on their accordion headers — the
//     panels are read-only. Excel R38-R40 imply that only Enterprise
//     Admin can edit; sbhatt does see the page (contra Excel R40)
//     but cannot expand or toggle. That gates R5, R6, R7, R9 out of
//     scope for this pass without an EA fixture.
//
// Skipped (documented):
//   - R3          : subjective UI/UX check.
//   - R5, R6      : require toggling — sections accordion-disabled
//                   for sbhatt (see drift note above).
//   - R7          : tooltip on the (i) info icon — no info-icon is
//                   rendered inside the Notifications section on
//                   this build.
//   - R9          : 9 collaborator sub-fields — inside a collapsed +
//                   disabled accordion; not observable without EA.
//   - R10-R37,
//     R41, R42    : each row asserts an email was sent. No SMTP
//                   inbox capture in this test environment. Same
//                   class of skip as email_template.spec.ts's
//                   inbox-dependent rows.
//   - R38, R39,
//     R40         : role-gated (Enterprise Admin / non-EA).
// =============================================================================

const NF = testdata.notification;
const SEL = NF.selectors;
const EXP = NF.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function gotoNotificationsTab(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + NF.path);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  const tab = page.locator(SEL.notificationsTab);
  await expect(tab).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await tab.click();
  // The active-state class attaches to the tab element itself once
  // Angular finishes routing to the notifications view.
  await expect(tab).toHaveClass(new RegExp(SEL.activeTabClass), {
    timeout: TIMEOUTS.elementVisible,
  });
}

test.describe("Notification — Configurations > Notifications shell", () => {
  test.setTimeout(TIMEOUTS.test);

  test("notifications_tab_opens_with_four_sections: activates tab and renders the four accordion panels", async ({ page }, info) => {
    caseIds(info, "NF.R02", "NF.R08");
    await gotoNotificationsTab(page);
    await step(page, info, 1, "notifications-tab-active");

    // Excel R08 expected four parts including "Site Management".
    // Live shows "General" as the 4th. `expected.sectionHeadings`
    // pins the live names — any future rename to "Site Management"
    // would need this assertion updated.
    for (const heading of EXP.sectionHeadings) {
      await expect(
        page.locator(SEL.panelbarItem).filter({ hasText: heading }).first(),
        `Notifications page must render the "${heading}" accordion panel (Excel R08 lists "Site Management" as the 4th; live shows "General" — drift)`,
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    }
    await step(page, info, 2, "four-sections-verified");
  });

  test("notifications_save_button_disabled_when_no_changes: Save renders disabled on load", async ({ page }, info) => {
    caseIds(info, "NF.R04");
    await gotoNotificationsTab(page);
    await step(page, info, 1, "notifications-tab-active");

    // The tenant's Save button (`#config-notification-save-button`)
    // starts disabled and only enables when a toggle is flipped —
    // the toggle path is not reachable on this account, so we only
    // verify the initial disabled state (which is what R04
    // describes).
    const save = page.locator(SEL.saveButton);
    await expect(save, "Notifications Save button must render").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(save, "Save must be disabled while no changes are made").toBeDisabled({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 2, "save-disabled-initial");
  });
});

// =============================================================================
// Coverage summary
//
//   Raw rows in sheet         : 41 real (43 total with blanks)
//   Merged into                : 2 tests
//   Skipped (documented)      : 39
//     - R3                    : subjective UI/UX check.
//     - R5, R6                : toggle-dependent — accordion is
//                               aria-disabled for this account.
//     - R7                    : no info-icon on this build.
//     - R9                    : sub-fields inside collapsed+
//                               disabled accordion.
//     - R10-R37, R41, R42     : SMTP inbox capture out of scope.
//     - R38, R39, R40         : Enterprise Admin role fixture
//                               needed.
// =============================================================================
