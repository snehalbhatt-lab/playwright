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
// CloudModeler (Changes) sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "CloudModeler (Changes)". 66 real cases across 5 story-linked
// modules covering GCP account creation / editing, Cloudmodeler
// component metadata, Azure/AWS/GCP Resource Tag flow, and cloud-
// model auto-mitigation cascade.
//
// Ships 2 non-destructive shell tests (T1-T2) covering the DOM
// structural surface of the CloudModeler tab in the Create dialog:
//   T1 — the Cloud Provider dropdown exposes AWS / Azure / GCP.
//   T2 — clicking + with GCP selected reveals the inline Create
//        New GCP Account form (keyless + key-based auth radios,
//        public + private access radios, Cancel/Submit buttons,
//        Submit disabled by default).
//
// The whole Create-model dialog + Cancel path is a code path we've
// exercised many times (create_model.spec.ts, onboarding_tour tour).
// No cloud account is ever saved: T2 always closes via Cancel so
// no submission or side-effect on the tenant integrations list.
//
// Live probe evidence (2026-08-21):
//   - Create dialog has 6 tabs: Blank / Template / Import File /
//     CloudModeler / Solutions Hub / Wizard. Clicking the
//     "CloudModeler" tab reveals `#step4-panel` with a
//     `kendo-dropdownlist#cloudModeler-list` for Cloud Provider.
//   - Provider dropdown items: "AWS Accelerator" (default),
//     "Azure Accelerator", "Google Cloud Platform".
//   - After selecting Google Cloud Platform + clicking
//     `button#AddNewCloud-button`, the CloudModeler panel shows
//     an inline account-creation form (NOT a separate dialog):
//       - `#wfi-gcpRadioButton` — Keyless Authentication radio
//         (label "Keyless Authentication"), default checked.
//       - `#keys-gcpRadioButton` — Key-Based radio (label
//         "Key-Based").
//       - Text inputs: instance name, project id, project
//         search.
//       - JSON file uploader (`input[type="file"][aria-label=
//         "upload-jsonFile"]`) + `#gcp-Credentials-browse-button`
//         (Browse) — for key-based auth.
//       - `#public-gcpRadioButton` (Public) /
//         `#private-gcpRadioButton` (Private, default checked).
//       - `#gcp-cancel-button` (Cancel) / `#gcpCreate-button`
//         (Submit — `k-disabled` until form filled).
//
// Skipped (~60 rows):
//   - R7-R12, R32-R38 — submit account create / edit / delete;
//     destructive to shared tenant integrations list and needs
//     real GCP credentials.
//   - R19-R24 — Cloudmodeler component metadata (Resource
//     Details tab in Component Info panel); needs an existing
//     cloud model with cloud-provider components as fixture.
//   - R39 — private-account cross-user access; needs multiple
//     user fixtures + admin permissions (category G).
//   - R43-R44 — cloud-model auto-mitigation cascade; needs a
//     created cloud model + destructive threat status
//     verification.
//   - R47-R58 (Azure), R62-R73 (AWS), R77-R88 (GCP) — Resource
//     Tag flow. Each provider's Resource-Tag path is gated by
//     a saved cloud account being selected first, and every
//     terminal case clicks "Validate and Create" which is
//     destructive (creates a real cloud model on the tenant).
// =============================================================================

const CM = testdata.cloudmodelerChanges;
const SEL = CM.selectors;
const EXP = CM.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function openCreateDialogCloudModeler(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + PATHS.threatModels);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  await page.evaluate(() => {
    const raw = localStorage.getItem("threat-modeler-tour");
    if (raw) {
      const v = JSON.parse(raw);
      for (const k of Object.keys(v)) {
        v[k].isComplete = true;
        v[k].skipped = true;
        v[k].doNotShowAgain = false;
        v[k].visitedStep = v[k].totalStep || 1;
      }
      localStorage.setItem("threat-modeler-tour", JSON.stringify(v));
    }
    document
      .querySelectorAll(".guided-tour-user-input-mask, .guided-tour-spotlight-overlay, ngx-guided-tour, .tour-step")
      .forEach((e) => e.remove());
  });
  await page.locator(SEL.createNewMenu).click();
  await page.locator(SEL.createNewMenuItem).click();
  const dialog = page.locator(SEL.dialog);
  await expect(dialog, "Create New Threat Model dialog opens").toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
  // Click the CloudModeler tab. Tab ids are UUID-based per session
  // so we locate by visible text.
  await page.locator(SEL.tabItem).filter({ hasText: EXP.cloudModelerTabText }).first().click();
  await expect(page.locator(SEL.cloudPanel), "#step4-panel activates").toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
}

// Always close the dialog before the test finishes so subsequent
// tests / suites land on a clean /threatmodels list.
async function closeDialog(page: Page): Promise<void> {
  const close = page.locator(SEL.dialogCloseIcon);
  if (await close.isVisible({ timeout: 1000 }).catch(() => false)) {
    await close.click().catch(() => {});
  }
}

test.describe("CloudModeler (Changes)", () => {
  test.beforeEach(async () => {
    test.setTimeout(TIMEOUTS.test);
  });

  test("T1 CloudModeler tab exposes AWS, Azure, and Google Cloud Platform as cloud-provider options", async ({
    page,
  }, info) => {
    caseIds(info, "CloudModelerChanges.R5", "CloudModelerChanges.R29", "CloudModelerChanges.R30");
    await openCreateDialogCloudModeler(page);
    await step(page, info, 1, "cloudmodeler-tab-open");

    // Cloud Provider dropdown is present with default AWS
    // Accelerator selected (verified live 2026-08-21).
    const dropdown = page.locator(SEL.cloudProviderDropdown);
    await expect(dropdown, "Cloud Provider dropdown mounts").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await dropdown.click();
    await expect(page.locator(SEL.cloudProviderOption).first()).toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });

    // The dropdown list must expose exactly the three documented
    // provider options — this is the trigger surface for the R5
    // (create new GCP), R47/R62/R77 (Azure/AWS/GCP Resource Tag)
    // and every other cloud-flow case in the tab.
    for (const providerLabel of EXP.providerOptions) {
      await expect(
        page.locator(SEL.cloudProviderOption).filter({ hasText: providerLabel }),
        `provider option "${providerLabel}" visible`,
      ).toBeVisible();
    }
    await step(page, info, 2, "providers-visible");

    // Close the dropdown before finishing.
    await page.keyboard.press("Escape");
    await closeDialog(page);
  });

  test("T2 + button on GCP reveals inline Create New GCP Account form with keyless/key-based + public/private + disabled Submit", async ({
    page,
  }, info) => {
    caseIds(
      info,
      "CloudModelerChanges.R6",
      "CloudModelerChanges.R31",
      "CloudModelerChanges.R32",
      "CloudModelerChanges.R34",
    );
    await openCreateDialogCloudModeler(page);

    // Select Google Cloud Platform.
    await page.locator(SEL.cloudProviderDropdown).click();
    await page.locator(SEL.cloudProviderOption).filter({ hasText: EXP.gcpOption }).first().click();
    await step(page, info, 1, "gcp-selected");

    // Click + Add New Cloud → account form renders inline in
    // the CloudModeler panel (not a separate dialog — verified
    // live 2026-08-21).
    await page.locator(SEL.addNewCloudButton).click();
    await expect(page.locator(SEL.keylessRadio), "keyless auth radio appears").toBeAttached({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 2, "gcp-account-form-open");

    // Both auth-mode radios are present. Keyless is checked by
    // default (verified live).
    await expect(page.locator(SEL.keylessRadio)).toBeChecked();
    await expect(page.locator(SEL.keybasedRadio)).not.toBeChecked();

    // Both access-mode radios are present. Private is checked
    // by default (verified live).
    await expect(page.locator(SEL.publicRadio)).not.toBeChecked();
    await expect(page.locator(SEL.privateRadio)).toBeChecked();

    // Cancel + Submit + Browse buttons all render. Submit is
    // disabled until the form is filled — the guardrail against
    // R7-R12 destructive account submission.
    await expect(page.locator(SEL.cancelButton), "Cancel button present").toBeVisible();
    await expect(page.locator(SEL.browseButton), "Browse (JSON) button present").toBeVisible();
    const submit = page.locator(SEL.submitButton);
    await expect(submit, "Submit button present").toBeVisible();
    await expect(submit, "Submit disabled on empty form").toBeDisabled();
    await step(page, info, 3, "form-structure-verified");

    // Cancel to leave the tenant integrations list unchanged.
    await page.locator(SEL.cancelButton).click();
    await closeDialog(page);
  });
});
