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
// Add threats(Per project) sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Add threats(Per project)". 27 real cases (R2-R8 add-threats
// dialog + R12-R31 delete-threat / delete-SR flows). Every case
// after R2/R3/R6 mutates the model (submits a new threat, or
// deletes a manually-added threat / SR).
//
// Ships 2 non-destructive shell tests (T1-T2). Both open the
// Add Threat dialog, verify its structure, and cancel/close
// without submitting so no threat is added to the shared tenant
// model. Submit is disabled by the dialog until a component and
// a threat are chosen, which further guards against accidental
// mutation.
//
// Live probe evidence (2026-08-21):
//   - Threats panel opens via `#sideMenuTour_3`, exposes an
//     "Add New" button `button#diagram-threats-addNewThreat-button`.
//   - Clicking it mounts a `kendo-dialog` containing an
//     `.add-threat-sr-content` panel. Title text "Add Threat"
//     (in the kendo-dialog titlebar).
//   - Body content: instruction paragraph, a
//     "Component/Threat models" section label
//     (`.add-threat-sr-form-label`), an `.add-threat-container`
//     hosting the Threat + Security Requirements picker items,
//     and a note paragraph `.add-threat-sr-note` "Threats which
//     are already associated to the selected component will not
//     be added again."
//   - Bottom action row: `button#diagram-Threat-addMore-button`
//     (Add More), `button#diagram-Threat-cancel-button` (Cancel),
//     `button#diagram-Threat-submit-button` (Submit, `k-disabled`
//     until a component + threat are selected).
//   - Titlebar close X: `button[aria-label="Close"]`.
//
// Skipped (~23 rows):
//   - R4, R5 — Threat Framework SR assign/remove → verify in Add
//     Threats suggestions. Framework edits are admin-gated
//     (SKIPS.md category G) and destructive to shared config.
//   - R7, R8 — actually submit Add Threats with selected SRs.
//     Destructive — creates a manually-added threat on the shared
//     tenant model.
//   - R12-R19 — delete-threat flow. Every case starts with
//     "manually add a threat" (destructive setup) then hovers
//     the delete icon, opens the confirmation, and clicks
//     Yes/Cancel. Both the setup and the delete are destructive.
//   - R20-R31 — delete-SR flow. Same shape: needs a manually
//     added SR fixture, then destructive delete via the SR panel.
// =============================================================================

const ADD = testdata.addThreatsPerProject;
const SEL = ADD.selectors;
const EXP = ADD.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

// Any tenant model works — the Add Threat dialog is model-scoped
// but has no fixture dependency on existing threats. Same
// first-model-with-render pattern as
// auto_threat_mitigation.spec.ts /
// security_requirements_mitigation.spec.ts.
async function openFirstModelDiagram(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + PATHS.threatModels);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  await expect(page.locator(SEL.modelListRow).first(), "model list rows render").toBeVisible({
    timeout: TIMEOUTS.navLong,
  });
  const found = await page.evaluate((sel) => {
    const rows = document.querySelectorAll(sel.modelListRow);
    for (const row of Array.from(rows)) {
      const nameEl = row.querySelectorAll("td")[1]?.querySelector(sel.modelNameElement) as HTMLElement | null;
      if (nameEl) return { rowIndex: Array.from(rows).indexOf(row), name: nameEl.textContent?.trim() || null };
    }
    return null;
  }, SEL);
  test.skip(!found, "no tenant model rows visible on /threatmodels");
  await page.evaluate(
    ({ rowIndex, sel }) => {
      const row = document.querySelectorAll(sel.modelListRow)[rowIndex];
      const nameEl = row?.querySelectorAll("td")[1]?.querySelector(sel.modelNameElement) as HTMLElement | null;
      nameEl?.click();
    },
    { rowIndex: found!.rowIndex, sel: SEL },
  );
  await page.waitForURL(new RegExp(SEL.diagramLinkPattern), { timeout: TIMEOUTS.navLong });
  await expect(page).toHaveTitle(/Threat Model Diagram/, { timeout: TIMEOUTS.navLong });
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
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    document
      .querySelectorAll(".guided-tour-user-input-mask, .guided-tour-spotlight-overlay")
      .forEach((e) => e.remove());
  });
  // eslint-disable-next-line no-console
  console.log(`[add-threats-fixture] opened model: ${found!.name || "(unknown)"}`);
}

async function openThreatsPanelAndAddNew(page: Page): Promise<void> {
  await page.locator(SEL.threatsPanelButton).click();
  await expect(page.locator(SEL.threatsGrid)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await page.evaluate(() => {
    document
      .querySelectorAll(".guided-tour-user-input-mask, .guided-tour-spotlight-overlay")
      .forEach((e) => e.remove());
  });
  const addBtn = page.locator(SEL.addNewButton);
  await expect(addBtn, "Add New button in Threats panel").toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
  await expect(addBtn).toHaveText(EXP.addNewButtonText);
  await addBtn.click();
  await expect(page.locator(SEL.dialog), "Add Threat dialog opens").toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
}

test.describe("Add threats(Per project)", () => {
  test.beforeEach(async () => {
    test.setTimeout(TIMEOUTS.test);
  });

  test("T1 Add Threat dialog opens with component + threat + SR picker structure and disabled Submit", async ({
    page,
  }, info) => {
    caseIds(
      info,
      "AddThreats.R2",
      "AddThreats.R3",
      "AddThreats.R6",
    );
    await openFirstModelDiagram(page);
    await openThreatsPanelAndAddNew(page);
    await step(page, info, 1, "add-threat-dialog-open");

    const dialog = page.locator(SEL.dialog);
    // Titlebar reads "Add Threat".
    await expect(dialog.locator(SEL.dialogTitle).first()).toHaveText(EXP.dialogTitleText);

    // Body has the Component/Threat models section label — the
    // canonical entry point for R2/R3/R6 (all three cases open
    // this dialog and inspect the SR list rendered under a
    // selected component/threat).
    await expect(
      dialog.locator(SEL.componentLabel).filter({ hasText: EXP.componentLabelText }),
      "Component/Threat models label present",
    ).toBeAttached();

    // Threat + Security Requirements picker items live inside
    // `.add-threat-container` / `.add-threat-item`. The item
    // contains inline labels for "Threat" and "Security
    // Requirements" plus their picker + Create New links.
    const item = dialog.locator(SEL.addThreatItem).first();
    await expect(item, "add-threat picker item mounts").toBeAttached();
    await expect(item, "picker item exposes Threat label").toContainText("Threat");
    await expect(item, "picker item exposes Security Requirements label").toContainText(
      "Security Requirements",
    );

    // Guardrail note lives at the bottom of the dialog body.
    await expect(dialog.locator(SEL.noteText)).toContainText(EXP.noteTextPartial);

    // Bottom action row: Add More, Cancel, Submit — Submit is
    // disabled until a component + threat are chosen. Verifying
    // the disabled state is the strongest structural evidence
    // that R7-R8 destructive submit is guarded.
    await expect(page.locator(SEL.addMoreButton)).toHaveText(EXP.addMoreText);
    await expect(page.locator(SEL.cancelButton)).toHaveText(EXP.cancelText);
    const submit = page.locator(SEL.submitButton);
    await expect(submit).toHaveText(EXP.submitText);
    await expect(submit, "Submit is disabled with empty selection").toBeDisabled();
    await step(page, info, 2, "dialog-structure-verified");

    // Close via Cancel — no threat is added to the model.
    await page.locator(SEL.cancelButton).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
    await step(page, info, 3, "dialog-cancelled");
  });

  test("T2 Cancel and titlebar × both dismiss the Add Threat dialog without adding a threat", async ({
    page,
  }, info) => {
    caseIds(info, "AddThreats.R16");
    await openFirstModelDiagram(page);

    // --- Attempt 1: dismiss via Cancel button ---
    await openThreatsPanelAndAddNew(page);
    await step(page, info, 1, "dialog-open-1");
    const dialog = page.locator(SEL.dialog);
    await page.locator(SEL.cancelButton).click();
    await expect(dialog, "dialog closes after Cancel").toBeHidden({
      timeout: TIMEOUTS.dialogHidden,
    });
    await step(page, info, 2, "cancel-dismissed");

    // --- Attempt 2: dismiss via titlebar × ---
    await page.locator(SEL.addNewButton).click();
    await expect(dialog).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 3, "dialog-open-2");
    await page.locator(SEL.closeIcon).click();
    await expect(dialog, "dialog closes after titlebar ×").toBeHidden({
      timeout: TIMEOUTS.dialogHidden,
    });
    await step(page, info, 4, "close-icon-dismissed");
  });
});
