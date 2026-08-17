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
// Share(collaborator) sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Share(collaborator)". 20 real cases in the Diagram > Share module.
// Ships 5 non-destructive dialog-interaction tests covering 5 rows
// explicitly; ~15 rows skipped or documented as already covered by
// tests/email_template.spec.ts.
//
// This spec is complementary to tests/email_template.spec.ts. That
// spec covered save-side flows (add + save, change permission, remove
// via Yes + save, add multiple, model-side state changes). This spec
// exercises the *dialog interaction* side (cancel, permissions
// dropdown structure, search suggestions, pending-list behavior,
// cancel-doesn't-persist) — nothing here calls Save.
//
// Selectors + candidate users are reused from testdata.emailTemplate
// to avoid duplicating a large block.
//
// Skipped (documented — destructive, cross-user, or duplicated):
//   - R06 — add + save: covered by email_template.spec.ts.
//   - R07/R08 — change perm + cross-user verify: change perm covered
//     in email_template; cross-user needs a second seeded user.
//   - R09-R12 — remove confirmation dialog + Yes/No paths + cross-user:
//     Yes path covered in email_template; No path is new but sets up
//     saved-collaborator state that needs cleanup.
//   - R13-R15 — RO/RW/Admin permission cross-user verify: need second
//     user account.
//   - R16 — other-department user filtering: needs multi-department
//     fixture.
//   - R17-R20 — group collaborators + user-in-group edge cases: need
//     seeded groups + cross-user.
// =============================================================================

const ET = testdata.emailTemplate;
const SEL = ET.selectors;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function setupModel(page: Page): Promise<{ modelName: string }> {
  await login(page);
  await gotoTMList(page);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  return await createDisposableModel(page, "ShareTM");
}

async function openShareDialog(page: Page): Promise<void> {
  await clearBlockingOverlays(page);
  const shareBtn = page.locator(SEL.shareButton);
  await expect(shareBtn).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await shareBtn.click();
  await expect(page.locator(SEL.dialog)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

async function usersTabCountText(page: Page): Promise<string> {
  return ((await page.locator(SEL.usersTab).textContent()) ?? "").trim();
}

test.describe.configure({ mode: "serial" });

test.describe("Share(collaborator) — Diagram > Share dialog interactions", () => {
  // Disposable-model archive + permanent-delete on this tenant runs
  // ~90-120s; per-test timeout raised so setup + test + cleanup all
  // fit even after login retries.
  test.setTimeout(600000);

  test("share_dialog_cancels_via_button: Cancel closes the dialog cleanly", async ({ page }, info) => {
    caseIds(info, "SC.R01");
    const { modelName } = await setupModel(page);
    try {
      await openShareDialog(page);
      await step(page, info, 1, "dialog-open");
      await page.locator(SEL.cancelButton).first().click();
      await expect(page.locator(SEL.dialog)).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
      await step(page, info, 2, "dialog-closed");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("permissions_dropdown_lists_expected_options: role popup carries Project ReadOnly / ReadWrite / Admin", async ({ page }, info) => {
    caseIds(info, "SC.R02");
    const { modelName } = await setupModel(page);
    try {
      await openShareDialog(page);
      // Add a candidate so we get a "new entry" row with a role
      // dropdown to inspect.
      const search = page.locator(SEL.search);
      await search.click();
      await search.fill(ET.candidates[0].search);
      await expect(page.locator(SEL.firstSuggestion)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await page.locator(SEL.firstSuggestion).click();
      await step(page, info, 1, "user-added-to-pending");

      // Open the role kendo-multiselect for the new row.
      const roleSel = SEL.newRoleTemplate.replace("{i}", "0");
      await page.locator(roleSel).click();
      const popup = page.locator(SEL.rolePopupClass);
      await expect(popup).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      // Assert the three core permission options from the Excel
      // R02 expected result: Read only / Read+Write / Admin.
      for (const roleKey of ["readOnly", "readWrite", "admin"] as const) {
        const label = ET.roles[roleKey];
        await expect(
          popup.locator(".k-list-item").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first(),
          `role popup must include "${label}"`,
        ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      }
      await step(page, info, 2, "permissions-listed");

      // Close popup by pressing Escape on the input; then close the
      // dialog without saving.
      await page.keyboard.press("Escape");
      await page.locator(SEL.cancelButton).first().click();
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("search_filters_user_suggestions: typing shows matching suggestions in the listbox", async ({ page }, info) => {
    caseIds(info, "SC.R03");
    const { modelName } = await setupModel(page);
    try {
      await openShareDialog(page);
      const search = page.locator(SEL.search);
      await search.click();
      await search.fill(ET.candidates[0].search);
      const opt = page.locator(SEL.firstSuggestion);
      await expect(
        opt,
        `search "${ET.candidates[0].search}" must return at least one suggestion`,
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      const label = ((await opt.textContent()) ?? "").trim();
      expect(label.length, "first suggestion must have a non-empty label").toBeGreaterThan(0);
      await step(page, info, 1, "suggestion-shown");
      await page.locator(SEL.cancelButton).first().click();
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("selecting_user_adds_to_pending_list: clicking a suggestion appends a new-entry row with role + remove controls", async ({ page }, info) => {
    caseIds(info, "SC.R04");
    const { modelName } = await setupModel(page);
    try {
      await openShareDialog(page);
      const beforeTab = await usersTabCountText(page);

      const search = page.locator(SEL.search);
      await search.click();
      await search.fill(ET.candidates[0].search);
      await expect(page.locator(SEL.firstSuggestion)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await page.locator(SEL.firstSuggestion).click();
      await step(page, info, 1, "user-picked");

      // A "new entry" row appears with a role kendo-multiselect at
      // #shareModel-newRole-0 and a remove button
      // #shareModel-removeNew-0.
      await expect(page.locator(SEL.newRoleTemplate.replace("{i}", "0"))).toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });
      await expect(page.locator(SEL.removePendingTemplate.replace("{i}", "0"))).toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });
      await step(page, info, 2, "pending-row-verified");

      // The Users tab count is unchanged — nothing is persisted until
      // Save is clicked.
      const afterTab = await usersTabCountText(page);
      expect(
        afterTab,
        `Users tab count must NOT change while the user is only pending. before="${beforeTab}" after="${afterTab}"`,
      ).toBe(beforeTab);
      await step(page, info, 3, "users-tab-unchanged");

      await page.locator(SEL.cancelButton).first().click();
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("cancel_after_add_does_not_persist: adding a user then Cancel leaves the Users tab unchanged", async ({ page }, info) => {
    caseIds(info, "SC.R05");
    const { modelName } = await setupModel(page);
    try {
      await openShareDialog(page);
      const initialTab = await usersTabCountText(page);
      const search = page.locator(SEL.search);
      await search.click();
      await search.fill(ET.candidates[0].search);
      await expect(page.locator(SEL.firstSuggestion)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await page.locator(SEL.firstSuggestion).click();
      await step(page, info, 1, "user-added-to-pending");

      // Cancel without saving.
      await page.locator(SEL.cancelButton).first().click();
      await expect(page.locator(SEL.dialog)).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
      await step(page, info, 2, "cancelled");

      // Reopen dialog and confirm the Users tab count matches the
      // initial state — the picked user was never persisted.
      await openShareDialog(page);
      const reopenedTab = await usersTabCountText(page);
      expect(
        reopenedTab,
        `Users tab count must NOT change after Cancel. initial="${initialTab}" reopened="${reopenedTab}"`,
      ).toBe(initialTab);
      await step(page, info, 3, "users-tab-unchanged");

      await page.locator(SEL.cancelButton).first().click();
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });
});
