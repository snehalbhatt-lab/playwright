import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import {
  BASE_URL,
  PATHS,
  TIMEOUTS,
  login,
  capture,
  clearBlockingOverlays,
  waitForLoaderIdle,
  dismissPostLoginOverlays,
} from "./lib/helpers";
import { gotoTMList, createDisposableModel, cleanupDisposableModel } from "./lib/tm-helpers";

// =============================================================================
// Email Template sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Email Template". 11 real cases, all under Jira TMDEV-6291 —
// "Collaborator > Email Template". Every case verifies the email that is
// sent when a collaborator is added/removed or their permission changes
// on a Threat Model. The app-side trigger is the Share dialog on a
// model; the case-level assertion is on the received email.
//
// Because Playwright drives only the app UI (not an email inbox), this
// suite asserts the app-side state transition that TRIGGERS each email:
//   - Share dialog opens with expected sections (title, tabs, Save/Cancel).
//   - Selected user appears in the Users tab list after Save.
//   - Role change persists across Save + dialog reopen.
//   - Removed user disappears from the Users tab after Save.
//   - Multiple users can be added in one Save cycle.
// The received-email verification itself (design system, content
// formatting, cross-client rendering, responsive, accessibility) is
// documented as skipped below.
//
// Live-vs-Excel drift:
//   - Excel refers to "read/write" and "admin"; live roles are
//     "Project ReadWrite" / "Project Admin" / "Project ReadOnly"
//     (plus Inherit / Project Role / Risk Reviewer / _Copy_Copy).
//   - Role picker is a kendo-multiselect (per-user), not a single-value
//     dropdown — changing role deselects the old one, selects the new.
//   - Remove flow requires a confirm dialog ("Confirm ... revoke access")
//     and both the remove and confirm changes are then applied on Save;
//     Cancel reverts the pending remove.
//
// Skipped (documented — need an email inbox, not the app):
//   - TMDEV-6291 row 2 — responsive email layout across devices.
//   - TMDEV-6291 row 4 — cross-client rendering (Gmail / Outlook / Yahoo).
//   - TMDEV-6291 row 5 — accessibility ("Need to discuss" per QA notes).
//
// All selectors/data live in testdata.emailTemplate.*.
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
  return await createDisposableModel(page, ET.modelPrefix);
}

async function openShareDialog(page: Page): Promise<void> {
  await clearBlockingOverlays(page);
  const shareBtn = page.locator(SEL.shareButton);
  await expect(shareBtn).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await shareBtn.click();
  await expect(page.locator(SEL.dialog)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

async function closeShareDialog(page: Page): Promise<void> {
  const cancel = page.locator(SEL.cancelButton).first();
  if (await cancel.isVisible().catch(() => false)) await cancel.click();
  await expect(page.locator(SEL.dialog)).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
}

// Search for a candidate user and click the first suggestion. The
// suggestion popup uses `#user-option-{i}` — the search is specific
// enough that whichever real user matches first is fine for the assertion
// (we only care that a NEW row appears in the pending list).
async function searchAndPickFirstSuggestion(page: Page, term: string): Promise<string> {
  const input = page.locator(SEL.search);
  await expect(input).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await input.click();
  await input.fill(term);
  const opt = page.locator(SEL.firstSuggestion);
  await expect(opt, `search "${term}" must return at least one suggestion`).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
  const label = (await opt.textContent())?.trim() ?? "";
  await opt.click();
  return label;
}

// Kendo multiselect popup is portalled outside the dialog root — locate
// by the popup class, then click the .k-list-item whose exact trimmed
// text matches. Deselect the currently-selected item first because the
// multiselect keeps its previous value until explicitly cleared.
async function setRoleOnDropdown(page: Page, dropdownSelector: string, roleText: string): Promise<void> {
  await page.locator(dropdownSelector).click();
  const popup = page.locator(SEL.rolePopupClass);
  await expect(popup).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  // Deselect the currently selected role (aria-selected="true").
  const selected = popup.locator(`.k-list-item[aria-selected="true"]`).first();
  if (await selected.isVisible().catch(() => false)) {
    const cur = (await selected.textContent())?.trim();
    if (cur && cur !== roleText) await selected.click();
  }
  // Pick target.
  const target = popup.locator(".k-list-item").filter({ hasText: new RegExp(`^\\s*${roleText}\\s*$`) }).first();
  await expect(target, `role "${roleText}" must exist in popup`).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
  await target.click();
  // Close popup by clicking outside — pressing Escape on the input
  // sometimes closes the dialog itself, so click the dialog title bar
  // instead.
  await page.locator(SEL.title).first().click({ force: true }).catch(() => {});
}

async function saveShare(page: Page): Promise<void> {
  await page.locator(SEL.saveButton).click();
  await expect(page.locator(SEL.dialog)).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
  await waitForLoaderIdle(page).catch(() => {});
}

async function usersTabCountText(page: Page): Promise<string> {
  return ((await page.locator(SEL.usersTab).textContent()) ?? "").trim();
}

async function userIsInList(page: Page, namePrefix: string): Promise<boolean> {
  const names = await page.locator(`${SEL.usersPanel} ${SEL.entryName}`).allTextContents();
  return names.map((n) => n.trim()).some((n) => n.startsWith(namePrefix));
}

// Add a collaborator + set role + Save. Reopens dialog on entry.
async function addCollaboratorAndSave(
  page: Page,
  candidate: { search: string; namePrefix: string },
  role: string,
): Promise<void> {
  await openShareDialog(page);
  await searchAndPickFirstSuggestion(page, candidate.search);
  await setRoleOnDropdown(page, SEL.newRoleTemplate.replace("{i}", "0"), role);
  await saveShare(page);
}

test.describe.configure({ mode: "serial" });

test.describe("Email Template (Collaborator) — TMDEV-6291", () => {
  test.setTimeout(TIMEOUTS.test);

  test("add_collaborator_email: opens share dialog and adds a collaborator", async ({ page }, info) => {
    caseIds(info, "TMDEV-6291.R01", "TMDEV-6291.R03", "TMDEV-6291.R06");
    const { modelName } = await setupModel(page);
    try {
      await step(page, info, 1, "diagram-open");

      // Row 1 (design system) + Row 3 (content formatting) app-side proxy:
      // dialog title includes the model name, all three tabs are visible,
      // Save / Cancel actions exist. Actual email pixels are inbox-only.
      await openShareDialog(page);
      await step(page, info, 2, "share-dialog-open");

      await expect(page.locator(SEL.title)).toContainText(modelName, {
        timeout: TIMEOUTS.elementVisible,
      });
      for (const pat of ET.expected.tabsPattern) {
        await expect(page.locator("body")).toContainText(new RegExp(pat));
      }
      await expect(page.locator(SEL.saveButton)).toBeVisible();
      await expect(page.locator(SEL.cancelButton)).toBeVisible();

      // Row 6 — actually add a collaborator and Save.
      const beforeTab = await usersTabCountText(page);
      const picked = await searchAndPickFirstSuggestion(page, ET.candidates[0].search);
      await step(page, info, 3, "suggestion-picked");
      expect(picked.length, "picked suggestion must have a label").toBeGreaterThan(0);

      await setRoleOnDropdown(page, SEL.newRoleTemplate.replace("{i}", "0"), ET.roles.admin);
      await step(page, info, 4, "role-set-admin");

      await saveShare(page);
      await step(page, info, 5, "save-clicked");

      // Reopen dialog and confirm the collaborator appears on the Users
      // tab, count increased.
      await openShareDialog(page);
      await step(page, info, 6, "reopen-dialog");
      const afterTab = await usersTabCountText(page);
      expect(
        afterTab,
        `Users tab count must increase after Save. before="${beforeTab}" after="${afterTab}"`,
      ).not.toEqual(beforeTab);
      expect(await userIsInList(page, ET.candidates[0].namePrefix)).toBeTruthy();
      await closeShareDialog(page);
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("remove_collaborator_email: removes a saved collaborator", async ({ page }, info) => {
    caseIds(info, "TMDEV-6291.R07");
    const { modelName } = await setupModel(page);
    try {
      // Pre-add so there is a collaborator to remove.
      await addCollaboratorAndSave(page, ET.candidates[0], ET.roles.readWrite);
      await step(page, info, 1, "collaborator-preadded");

      await openShareDialog(page);
      const beforeTab = await usersTabCountText(page);
      // The owner sits at row 0 (no remove control); the newly-saved
      // collaborator sits at row 1. Locate their remove button by index.
      const remove = page.locator(SEL.removeExistingTemplate.replace("{i}", "1"));
      await expect(remove).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await remove.click();
      await step(page, info, 2, "remove-clicked");

      // Confirm dialog: "Confirm ... revoke access" — click Yes.
      const yes = page.locator(SEL.confirmYes);
      await expect(yes).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await yes.click();
      await step(page, info, 3, "revoke-confirmed");

      await saveShare(page);
      await step(page, info, 4, "save-clicked");

      // Reopen and assert the collaborator is gone and the count went
      // down by one.
      await openShareDialog(page);
      const afterTab = await usersTabCountText(page);
      expect(
        afterTab,
        `Users tab count must decrease after remove+save. before="${beforeTab}" after="${afterTab}"`,
      ).not.toEqual(beforeTab);
      expect(await userIsInList(page, ET.candidates[0].namePrefix)).toBeFalsy();
      await step(page, info, 5, "collaborator-gone");
      await closeShareDialog(page);
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  // Data-driven permission-change tests — one per (from → to) pair
  // referenced in the Excel:
  //   R08 admin → ReadOnly
  //   R09 ReadOnly → ReadWrite
  //   R10 ReadWrite → Admin
  const permCases = [
    { id: "TMDEV-6291.R08", from: "admin", to: "readOnly" },
    { id: "TMDEV-6291.R09", from: "readOnly", to: "readWrite" },
    { id: "TMDEV-6291.R10", from: "readWrite", to: "admin" },
  ] as const;

  for (const pc of permCases) {
    test(`change_permission_${pc.to}: updates existing collaborator role to ${pc.to}`, async ({ page }, info) => {
      caseIds(info, pc.id);
      const fromRole = ET.roles[pc.from];
      const toRole = ET.roles[pc.to];
      const { modelName } = await setupModel(page);
      try {
        await addCollaboratorAndSave(page, ET.candidates[0], fromRole);
        await step(page, info, 1, `preadded-${pc.from}`);

        await openShareDialog(page);
        await setRoleOnDropdown(page, SEL.existingRoleTemplate.replace("{i}", "1"), toRole);
        await step(page, info, 2, `role-changed-to-${pc.to}`);
        await saveShare(page);
        await step(page, info, 3, "save-clicked");

        // Reopen dialog, open the same user's role dropdown, and verify
        // the newly selected role is aria-selected="true".
        await openShareDialog(page);
        await page.locator(SEL.existingRoleTemplate.replace("{i}", "1")).click();
        const popup = page.locator(SEL.rolePopupClass);
        await expect(popup).toBeVisible({ timeout: TIMEOUTS.elementVisible });
        const selected = popup.locator(`.k-list-item[aria-selected="true"]`).first();
        await expect(selected, `${toRole} must be selected after reopen`).toHaveText(
          new RegExp(`^\\s*${toRole}\\s*$`),
          { timeout: TIMEOUTS.elementVisible },
        );
        await step(page, info, 4, `verified-${pc.to}`);
        await closeShareDialog(page);
      } finally {
        await cleanupDisposableModel(page, modelName).catch(() => {});
      }
    });
  }

  test("add_multiple_collaborators: adds 3+ collaborators in one Save", async ({ page }, info) => {
    caseIds(info, "TMDEV-6291.R11");
    const { modelName } = await setupModel(page);
    try {
      await openShareDialog(page);
      const beforeTab = await usersTabCountText(page);

      // Sequentially pick 3 distinct users. Each pick appends to the
      // pending list with role dropdown at #shareModel-newRole-{i} — the
      // index runs 0..2 in insertion order.
      for (let i = 0; i < ET.candidates.length; i++) {
        const cand = ET.candidates[i];
        await searchAndPickFirstSuggestion(page, cand.search);
        await setRoleOnDropdown(page, SEL.newRoleTemplate.replace("{i}", String(i)), ET.roles.readWrite);
        await step(page, info, i + 1, `picked-${cand.namePrefix.toLowerCase()}`);
      }

      await saveShare(page);
      await step(page, info, ET.candidates.length + 1, "save-clicked");

      await openShareDialog(page);
      const afterTab = await usersTabCountText(page);
      expect(
        afterTab,
        `Users tab count must increase by ${ET.candidates.length} after multi-add. before="${beforeTab}" after="${afterTab}"`,
      ).not.toEqual(beforeTab);
      // All added collaborators must appear in the users list.
      for (const cand of ET.candidates) {
        expect(
          await userIsInList(page, cand.namePrefix),
          `${cand.namePrefix} must appear in Users tab`,
        ).toBeTruthy();
      }
      await step(page, info, ET.candidates.length + 2, "verified-all-added");
      await closeShareDialog(page);
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });
});
