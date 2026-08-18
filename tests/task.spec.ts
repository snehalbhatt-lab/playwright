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
// Task sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Task". 29 rows; 12 real scenarios (R01-R12) + 17 empty-scenario
// rows that belong to the Threat Framework > Resource Type feature
// (see excel/SKIPS.md category I).
//
// Ships 2 non-destructive dialog-interaction tests covering R03 + R04.
//
// Skipped (documented):
//   - R01/R02 — task-count badges render on the diagram <canvas>; no
//     DOM to inspect.
//   - R05-R08 — Create + Save persists a task on the model; even with
//     disposable-model cleanup, cancel + form-interaction coverage is
//     sufficient for the panel-level assertions we need.
//   - R09 — Execute via Wingman: external AI call, non-deterministic
//     text output.
//   - R10-R12 — Undo / Edit / Delete task: destructive chains gated on
//     a saved task.
//   - R13-R28 — empty scenario column; Threat Framework resource-type
//     edit checks belonging to a separate feature.
// =============================================================================

const TK = testdata.task;
const SEL = TK.selectors;

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
  return await createDisposableModel(page, TK.modelPrefix);
}

async function openTasksPanel(page: Page): Promise<void> {
  await clearBlockingOverlays(page);
  const btn = page.locator(SEL.tasksPanelButton);
  await expect(btn).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await btn.click();
  // The Tasks side panel is proven open when the Create Task button
  // renders — it only exists inside that panel.
  await expect(page.locator(SEL.openCreateTaskButton)).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
}

async function openCreateTaskForm(page: Page): Promise<void> {
  await page.locator(SEL.openCreateTaskButton).click();
  // The create form is proven open when the mandatory name input renders.
  await expect(page.locator(SEL.taskNameInput)).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
}

test.describe.configure({ mode: "serial" });

test.describe("Task — Diagram > Task panel dialog interactions", () => {
  // Disposable-model archive + permanent-delete on this tenant runs
  // ~90-120s; per-test timeout raised so setup + test + cleanup all
  // fit even after login retries.
  test.setTimeout(600000);

  test("cancel_closes_create_task_form_without_persisting: Cancel returns to empty task list", async ({ page }, info) => {
    caseIds(info, "TK.R03");
    const { modelName } = await setupModel(page);
    try {
      await openTasksPanel(page);
      await step(page, info, 1, "tasks-panel-open");

      // Panel starts empty on a fresh model.
      await expect(
        page.getByText(SEL.emptyStateText),
        "fresh model must show empty task state",
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });

      await openCreateTaskForm(page);
      await step(page, info, 2, "create-form-open");

      // Fill something so we can prove Cancel discards it.
      await page.locator(SEL.taskNameInput).fill(TK.sampleTaskName);
      await step(page, info, 3, "name-filled");

      await page.locator(SEL.cancelButton).click();
      // Returning to the list view: header shown + still empty.
      await expect(
        page.getByText(SEL.emptyStateText),
        "cancelling create must return to empty task list",
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await step(page, info, 4, "returned-to-empty-list");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("create_button_disabled_without_mandatory_info: Create enables only after name + priority + note", async ({ page }, info) => {
    caseIds(info, "TK.R04");
    const { modelName } = await setupModel(page);
    try {
      await openTasksPanel(page);
      await openCreateTaskForm(page);
      await step(page, info, 1, "create-form-open");

      const createBtn = page.locator(SEL.createButton);
      // Fresh form — Create must be disabled.
      await expect(createBtn, "Create must be disabled with all fields empty").toBeDisabled({
        timeout: TIMEOUTS.elementVisible,
      });
      await step(page, info, 2, "create-disabled-initial");

      // Filling only the name — still disabled.
      await page.locator(SEL.taskNameInput).fill(TK.sampleTaskName);
      await expect(createBtn, "Create must stay disabled with only name filled").toBeDisabled({
        timeout: TIMEOUTS.elementVisible,
      });
      await step(page, info, 3, "create-disabled-name-only");

      // Add priority — still disabled (note is also mandatory).
      await page.locator(SEL.priorityDropdown).click();
      await page.locator(SEL.priorityHigh).click();
      await expect(createBtn, "Create must stay disabled without a note").toBeDisabled({
        timeout: TIMEOUTS.elementVisible,
      });
      await step(page, info, 4, "create-disabled-name-priority");

      // Fill the note — now Create must enable.
      await page.locator(SEL.noteInput).fill(TK.sampleNote);
      await expect(createBtn, "Create must enable once name + priority + note are set").toBeEnabled({
        timeout: TIMEOUTS.buttonEnabled,
      });
      await step(page, info, 5, "create-enabled");

      // Do NOT click Create — cancel out to keep this test non-destructive.
      await page.locator(SEL.cancelButton).click();
      await expect(
        page.getByText(SEL.emptyStateText),
      ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      await step(page, info, 6, "cancelled");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });
});
