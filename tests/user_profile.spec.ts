import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import {
  BASE_URL,
  TIMEOUTS,
  URL_PATTERNS,
  PATHS,
  login,
  capture,
  clearBlockingOverlays,
  dismissPostLoginOverlays,
} from "./lib/helpers";

// =============================================================================
// User Profile sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "User Profile". 34 real cases in a single "Profile" module. Merged into
// 9 tests covering ~24 cases; ~10 rows skipped with reason.
//
// Live-vs-Excel drift:
//   - Excel R31 says "Set Password" — the button on the profile page is
//     "Reset Password" (which expands an inline form with a submit button
//     labelled "Set Password"). Live wins.
//   - The Excel says Profile button navigates directly to /user-profile;
//     in the live app the header Profile avatar opens a dropdown menu
//     with "My Profile" and "Log Out" items — click My Profile.
//   - Excel R02 asks for a browser tooltip on hover; the live app uses
//     the accessible-name pattern (aria-label="Profile" on the button)
//     instead of a title tooltip. Verified via aria-label to keep the
//     test hover-independent.
//   - Excel R32-R34 expect inline error text; the live app also disables
//     the Set Password submit button while rules fail — both are
//     asserted.
//
// Skipped (documented):
//   - R18 — clicking Generate on the API key dialog creates a real
//     persistent API key on the tenant. Dialog structure is fully
//     covered by generate_api_key_dialog; skip the destructive final
//     click.
//   - R26, R29, R30 — require an Enterprise Admin fixture separate from
//     sbhatt to mutate a target user's role/permission/group + re-login
//     as that target. Cross-user fixture setup out of scope.
//   - R31 — actually changing the account password would break every
//     other test that uses sbhatt's credentials. Password error-state
//     coverage lives in set_password_validation (R32/R33/R34) which
//     does not submit.
// =============================================================================

const UP = testdata.userProfile;
const SEL = UP.selectors;
const EXP = UP.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function gotoProfile(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + UP.path);
  await dismissPostLoginOverlays(page);
  await expect(page).toHaveTitle(new RegExp(UP.titlePattern), { timeout: TIMEOUTS.navMedium });
  await expect(page.locator(SEL.profileSection)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

// The kendo textbox wraps the real <input> as its child — reads/writes
// need to hit the inner element via the ".. input" selector. `fill()`
// clears + types + fires the events kendo needs to flush the value into
// the reactive-form model (a raw JS value setter with just `input`/
// `blur` skips `change`, leaving the model at its pre-edit value even
// though the DOM shows the new value; Save then submits the stale
// value).
async function setInputValue(page: Page, containerSelector: string, value: string): Promise<void> {
  const input = page.locator(containerSelector);
  await input.fill("");
  if (value) await input.fill(value);
  await input.blur().catch(() => {});
}

test.describe.configure({ mode: "serial" });

test.describe("User Profile — Profile module", () => {
  test.setTimeout(TIMEOUTS.test);

  test("navigate_to_profile: header Profile menu opens /user-profile", async ({ page }, info) => {
    caseIds(info, "UP.R01", "UP.R02");
    await login(page);
    await page.goto(BASE_URL + PATHS.threatModels);
    await dismissPostLoginOverlays(page);
    await clearBlockingOverlays(page);
    await step(page, info, 1, "landing");

    // R02 — the profile button is announced via aria-label="Profile"
    // (the accessible-tooltip equivalent). Assert the attribute rather
    // than a browser tooltip so the test doesn't depend on hover.
    const profileBtn = page.locator(SEL.headerProfileButton);
    await expect(profileBtn).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(profileBtn).toHaveAttribute("aria-label", "Profile");

    // Open the dropdown, then click "My Profile" (R01).
    await profileBtn.click();
    const myProfile = page.locator(SEL.headerMyProfileLink);
    await expect(myProfile).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "profile-dropdown-open");
    await myProfile.click();

    await expect(page).toHaveURL(new RegExp("/user-profile"), { timeout: TIMEOUTS.navMedium });
    await expect(page).toHaveTitle(new RegExp(UP.titlePattern), { timeout: TIMEOUTS.navMedium });
    await expect(page.locator(SEL.profileSection)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 3, "on-profile-page");
  });

  test("profile_static_details: profile card shows all expected fields", async ({ page }, info) => {
    caseIds(info, "UP.R03", "UP.R04", "UP.R05", "UP.R06", "UP.R07", "UP.R08", "UP.R09", "UP.R10", "UP.R11", "UP.R12");
    await gotoProfile(page);
    await step(page, info, 1, "profile-page");

    // R04 Full Name, R05 Username handle
    await expect(page.locator(SEL.fullNameText)).toContainText(EXP.fullName);
    await expect(page.locator(SEL.usernameText)).toContainText(EXP.usernameHandle);

    // R03 Last login — asserts the prefix; the timestamp itself varies
    // between runs and would flake.
    await expect(page.locator(SEL.lastLoginText)).toContainText(EXP.lastLoginPrefix);

    // R06 Email is inside the Account form; the profile card doesn't
    // repeat it. Read the account input value.
    await expect(page.locator(SEL.accountEmailInput)).toHaveValue(EXP.email);

    // R07 Department, R08 Organization/Group — both live inside the
    // group-dept card. Assert Department is Corporate and the group
    // area renders (either a group name or "No Groups Available").
    await expect(page.locator(SEL.deptGroup)).toContainText(EXP.department);
    await expect(page.locator(SEL.deptGroup)).toBeVisible();

    // R09 Roles section, R10 Enterprise/manager label, R11 Admin role
    // level. sbhatt's chip reads "Enterprise Admin" — proves the Roles
    // section renders, the "Enterprise" label is present, and the
    // administrator role level (chip text) is what's expected.
    await expect(page.locator(SEL.rolePermission)).toContainText(EXP.roleLabel);
    await expect(page.locator(SEL.roleChip).first()).toContainText(EXP.roleChipText);
    await step(page, info, 2, "profile-fields-visible");

    // R12 Wingman Support Access role is visible only when the user has
    // that permission. sbhatt does not — the chip must be absent.
    const wingmanChip = page.locator(SEL.roleChip).filter({ hasText: EXP.wingmanSupportChipText });
    await expect(
      wingmanChip,
      "Wingman Support chip must be absent for a user without that permission",
    ).toHaveCount(0);
    await step(page, info, 3, "wingman-absent");
  });

  test("edit_and_save_profile: Save button enables on edit, saves, reverts cleanly", async ({ page }, info) => {
    caseIds(info, "UP.R13", "UP.R14");
    await gotoProfile(page);

    const saveBtn = page.locator(SEL.accountSaveButton);
    const fullNameInput = page.locator(SEL.accountFullNameInput);
    const originalName = (await fullNameInput.inputValue()) || EXP.fullName;
    const editedName = originalName + UP.editSuffix;
    await step(page, info, 1, "before-edit");

    // R13 — with no pending change, Save must be visible but disabled.
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled({ timeout: TIMEOUTS.elementVisible });

    try {
      // Trigger an edit; Save must enable.
      await setInputValue(page, SEL.accountFullNameInput, editedName);
      await expect(saveBtn).toBeEnabled({ timeout: TIMEOUTS.buttonEnabled });
      await step(page, info, 2, "edit-typed-save-enabled");

      // R14 — save persists. Click and verify the value survives a
      // page reload (real update, not just local input state).
      await saveBtn.click();
      await page.waitForTimeout(1500);
      await page.reload();
      await expect(page).toHaveTitle(new RegExp(UP.titlePattern), { timeout: TIMEOUTS.navMedium });
      await expect(page.locator(SEL.accountFullNameInput)).toHaveValue(editedName, {
        timeout: TIMEOUTS.elementVisible,
      });
      await step(page, info, 3, "saved-and-reloaded");
    } finally {
      // Revert regardless — do not leave the tenant with the edited
      // name. This runs even if the assertions above fail so that a
      // partial failure still restores state.
      await setInputValue(page, SEL.accountFullNameInput, originalName);
      if (await saveBtn.isEnabled().catch(() => false)) {
        await saveBtn.click().catch(() => {});
        await page.waitForTimeout(1500);
      }
      await page.reload().catch(() => {});
      await expect(page.locator(SEL.accountFullNameInput))
        .toHaveValue(originalName, { timeout: TIMEOUTS.elementVisible })
        .catch(() => {});
      await step(page, info, 4, "reverted");
    }
  });

  test("integrations_section_visible: Integrations block renders with API key + key button", async ({ page }, info) => {
    caseIds(info, "UP.R15");
    await gotoProfile(page);
    await expect(page.locator(SEL.integrationsTitle)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(page.locator(SEL.apiKeyInput)).toBeVisible();
    await expect(page.locator(SEL.generateKeyButton)).toBeVisible();
    await step(page, info, 1, "integrations-visible");
  });

  test("generate_api_key_dialog: banner opens, has required fields, closes via Cancel and X", async ({ page }, info) => {
    caseIds(info, "UP.R16", "UP.R17", "UP.R19", "UP.R20");
    await gotoProfile(page);
    const genBtn = page.locator(SEL.generateKeyButton);
    await expect(genBtn).toBeVisible();
    await expect(genBtn).toBeEnabled();
    await step(page, info, 1, "generate-key-visible");

    // R17 — dialog has all required fields: close (X), Expiration
    // dropdown default Never, Cancel, Generate.
    await genBtn.click();
    const dialog = page.locator(SEL.apiKeyDialog);
    await expect(dialog).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(page.locator(SEL.apiKeyExpiryDropdown)).toContainText(EXP.apiKeyExpiryDefault);
    await expect(page.locator(SEL.apiKeyCancelButton)).toBeVisible();
    await expect(page.locator(SEL.apiKeyGenerateButton)).toBeVisible();
    await expect(page.locator(SEL.apiKeyCloseButton).first()).toBeVisible();
    await step(page, info, 2, "dialog-fields-verified");

    // R19 — Cancel closes without generating a key.
    await page.locator(SEL.apiKeyCancelButton).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
    await step(page, info, 3, "cancel-closes");

    // R20 — Close (X) also closes.
    await genBtn.click();
    await expect(dialog).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await page.locator(SEL.apiKeyCloseButton).first().click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
    await step(page, info, 4, "close-x-closes");
  });

  test("reset_all_warnings_dialog: opens confirm with Cancel + Reset, both act", async ({ page }, info) => {
    caseIds(info, "UP.R21", "UP.R23", "UP.R24", "UP.R25");
    await gotoProfile(page);
    const resetBtn = page.locator(SEL.resetAllWarningsButton);
    await expect(resetBtn).toBeVisible();
    await expect(resetBtn).toBeEnabled();
    await step(page, info, 1, "reset-warnings-visible");

    // R23 — confirm has message + Cancel + Reset.
    await resetBtn.click();
    const cancel = page.locator(SEL.resetWarningsConfirmCancel);
    const reset = page.locator(SEL.resetWarningsConfirmReset);
    await expect(cancel).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(reset).toBeVisible();
    await expect(page.locator("body")).toContainText(new RegExp(EXP.resetWarningsConfirmText, "i"));
    await step(page, info, 2, "confirm-opened");

    // R24 — Cancel closes without action.
    await cancel.click();
    await expect(reset).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
    await step(page, info, 3, "cancel-closes");

    // R25 — Reset applies. The action is idempotent (re-enables tour /
    // release-note popups the user may have dismissed), so it's safe to
    // fire repeatedly on this account.
    await resetBtn.click();
    await expect(reset).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await reset.click();
    await expect(reset).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
    await step(page, info, 4, "reset-applied");
  });

  test("header_icons_functional: Help + Notifications icons open and close", async ({ page }, info) => {
    caseIds(info, "UP.R28");
    await gotoProfile(page);
    await clearBlockingOverlays(page);

    const help = page.locator(SEL.headerHelpButton);
    const notif = page.locator(SEL.headerNotificationsButton);
    await expect(help).toBeVisible();
    await expect(notif).toBeVisible();
    await step(page, info, 1, "header-icons-visible");

    // Assert each button toggles its aria-expanded (both are dropdown
    // triggers). Content inside the dropdown varies by tenant state
    // (notification count / feature flags) so the aria attribute is the
    // stable signal.
    for (const [name, sel] of [
      ["help", SEL.headerHelpButton],
      ["notif", SEL.headerNotificationsButton],
    ] as const) {
      const btn = page.locator(sel);
      await btn.click();
      await expect(btn, `${name} aria-expanded must flip on click`).toHaveAttribute(
        "aria-expanded",
        "true",
        { timeout: TIMEOUTS.elementVisible },
      );
      await btn.click();
      await expect(btn, `${name} aria-expanded must flip back`).toHaveAttribute("aria-expanded", "false", {
        timeout: TIMEOUTS.elementVisible,
      });
    }
    await step(page, info, 2, "header-icons-toggled");
  });

  test("set_password_validation: rule errors + mismatch error appear inline (no submit)", async ({ page }, info) => {
    caseIds(info, "UP.R32", "UP.R33", "UP.R34");
    await gotoProfile(page);

    // Expand the Set Password form.
    await page.locator(SEL.resetPasswordButton).click();
    await expect(page.locator(SEL.securityCurrentPasswordKendo)).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 1, "set-password-open");

    // R32 — invalid new password surfaces all three rule errors and the
    // Set Password submit stays disabled.
    await setInputValue(page, SEL.securityCurrentPasswordInput, "Sneha@123");
    await setInputValue(page, SEL.securityNewPasswordInput, "abc");
    for (const ruleText of EXP.passwordRuleTexts) {
      await expect(page.locator(SEL.passwordValidationSection)).toContainText(ruleText);
    }
    await expect(page.locator(SEL.securitySetPasswordButton)).toBeDisabled({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 2, "invalid-rules-visible");

    // R33 — with a valid new password, the rule errors disappear.
    await setInputValue(page, SEL.securityNewPasswordInput, "ValidPass@1");
    for (const ruleText of EXP.passwordRuleTexts) {
      await expect(page.locator(SEL.passwordValidationSection)).not.toContainText(ruleText);
    }
    await step(page, info, 3, "rules-cleared");

    // R34 — mismatched confirm password surfaces the mismatch error.
    await setInputValue(page, SEL.securityConfirmPasswordInput, "DifferentPass@1");
    await expect(page.locator(SEL.passwordValidationSection)).toContainText(EXP.passwordMismatchText, {
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 4, "mismatch-visible");

    // Clear so the form leaves no half-filled state for the next test.
    await setInputValue(page, SEL.securityCurrentPasswordInput, "");
    await setInputValue(page, SEL.securityNewPasswordInput, "");
    await setInputValue(page, SEL.securityConfirmPasswordInput, "");
  });

  test("logout_from_profile: logout redirects to the login page", async ({ page }, info) => {
    caseIds(info, "UP.R27");
    await gotoProfile(page);

    // Open the header profile dropdown (the profile page itself doesn't
    // carry a logout button — logout lives in the same avatar menu that
    // navigated us here).
    await clearBlockingOverlays(page);
    await page.locator(SEL.headerProfileButton).click();
    const logout = page.locator(SEL.headerLogOutButton);
    await expect(logout).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "logout-menu-open");

    await logout.click();
    // Post-logout, the app redirects to the SSO login endpoint. Match
    // either the /idsvr/... or /sign-in/... variant so a transitional
    // hop doesn't fail the assertion.
    await expect(page).toHaveURL(new RegExp(URL_PATTERNS.loginOrApp), { timeout: TIMEOUTS.navMedium });
    await expect(page.getByRole("textbox", { name: "Username*" })).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 2, "on-login-page");
  });
});
