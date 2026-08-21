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
// Security Requirements Mitigatio sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Security Requirements Mitigatio". 59 real cases (R1-R59, R45
// empty) covering the *Security Control mitigation* flow on the
// diagram. The tab title truncates "Mitigation" to "Mitigatio".
//
// Flow described by Excel:
//   1. Click "Security Controls" icon in the diagram header.
//   2. Left toolbox opens listing security controls.
//   3. Drag a control to the canvas.
//   4. Add a protocol from the control to a component.
//   5. Right-click the control → "Mitigate Security Requirements".
//   6. Right-side Impact Summary panel opens with an accordion of
//      controls, their mapped SRs and components.
//   7. Apply Mitigation → SR statuses change to "Implemented by
//      Control".
//
// Ships 2 non-destructive shell tests (T1-T2) covering the DOM
// surface at steps 1 and 6 — the "Security Control Impact
// Summary" dialog opens on button click and dismisses via the ×
// icon. Every step involving canvas interaction (drag control,
// draw protocol, right-click canvas, Apply Mitigation) is
// canvas-blocked (same GoJS class as Default Protocol module A /
// Component color change / Verizon — SKIPS.md category E) and
// destructive to shared tenant models.
//
// Live probe evidence (2026-08-21):
//   - Header button: `button#topMenuTour_3` (aria "Security
//     Controls") in the diagram top toolbar.
//   - Clicking it mounts a `dialog[aria-label="Security Controls"]`
//     hosting a `<tm-diagram-model-review-security-control>`
//     component with title "Security Control Impact Summary",
//     tab labels "Threats" / "Security Requirements", and an
//     `ngbaccordion` listing controls (each item has
//     `.flag-title-text` control name + `.box-value.font-medium`
//     count of mapped SRs). Populated model "path base" showed
//     "Control 9 15" as the first accordion row.
//   - Close: `<i class="tm-panel-close fa-regular fa-xmark"
//     aria-label="Close">` inside the dialog dismisses it.
//
// Skipped (55 rows):
//   - R6-R10 — impact-summary content specifics (SR count,
//     component count, list-matches-toolbox). All require a model
//     with a known SR / component / control mapping to make
//     content assertions non-fragile.
//   - R11-R44 (34 rows) — canvas drag-drop of controls, adding
//     protocols, right-clicking canvas, Apply Mitigation, Undo /
//     Redo cycles, save-as-template + re-import, copy/paste. All
//     canvas-blocked (category E) + destructive.
//   - R46-R59 (14 rows) — attribute mitigation, nested-model
//     mitigation, group mitigation, chain-of-links, CVE-SR
//     interactions. Same canvas + destructive blockers.
// =============================================================================

const SRM = testdata.securityRequirementsMitigation;
const SEL = SRM.selectors;
const EXP = SRM.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

// Any tenant model works — the Impact Summary panel is rendered
// on the diagram screen regardless of whether the model has any
// controls yet (an empty-controls model shows the panel with a
// zero-count accordion). Same first-model-with-render pattern
// from auto_threat_mitigation.spec.ts.
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
      if (nameEl) {
        return { rowIndex: Array.from(rows).indexOf(row), name: nameEl.textContent?.trim() || null };
      }
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
  // Suppress the guided tour that would block the header button.
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
  console.log(`[srm-fixture] opened model: ${found!.name || "(unknown)"}`);
}

test.describe("Security Requirements Mitigation", () => {
  test.beforeEach(async () => {
    test.setTimeout(TIMEOUTS.test);
  });

  test("T1 Security Controls header button opens the Impact Summary panel with a controls accordion", async ({
    page,
  }, info) => {
    caseIds(
      info,
      "SecurityRequirementsMitigation.R1",
      "SecurityRequirementsMitigation.R2",
      "SecurityRequirementsMitigation.R3",
    );
    await openFirstModelDiagram(page);

    const btn = page.locator(SEL.securityControlsButton);
    await expect(btn, "Security Controls button in header").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(btn).toHaveAttribute("aria-label", EXP.buttonAriaLabel);
    await btn.click();
    await step(page, info, 1, "security-controls-clicked");

    const dialog = page.locator(SEL.impactSummaryDialog);
    await expect(dialog, "Security Controls dialog mounts").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(page.locator(SEL.impactSummaryComponent)).toBeAttached();

    // Title "Security Control Impact Summary" identifies the
    // panel — R2/R3 wording refers to it as the Mitigation
    // Summary panel; on tmdev the header is the more literal
    // "Impact Summary".
    await expect(dialog, "panel shows the Impact Summary title").toContainText(EXP.titleText);

    // Both view-tab labels are present in the panel header.
    for (const tab of EXP.tabLabels) {
      await expect(dialog, `panel exposes "${tab}" tab label`).toContainText(tab);
    }

    // Accordion has at least one control item — R2 "list of
    // controls related to the model". Each item carries a
    // `.flag-title-text` (control name) and a
    // `.box-value.font-medium` (SR count). We don't assert the
    // exact count because it varies per tenant model.
    const items = page.locator(SEL.accordionItem);
    await expect
      .poll(async () => await items.count(), {
        timeout: TIMEOUTS.elementVisible,
        message: "at least one control item mounts in the accordion",
      })
      .toBeGreaterThan(0);
    // The first accordion item contains a nested accordion for
    // its child controls, so `.flag-title-text` resolves to
    // multiple descendants. Use `.first()` to target the
    // top-level control's title / count row.
    await expect(items.first().locator(SEL.accordionFlagTitle).first()).toBeVisible();
    await expect(items.first().locator(SEL.accordionCount).first()).toBeVisible();
    await step(page, info, 2, "impact-summary-visible");
  });

  test("T2 Close × icon dismisses the Impact Summary panel", async ({ page }, info) => {
    caseIds(info, "SecurityRequirementsMitigation.R5", "SecurityRequirementsMitigation.R24");
    await openFirstModelDiagram(page);

    await page.locator(SEL.securityControlsButton).click();
    const dialog = page.locator(SEL.impactSummaryDialog);
    await expect(dialog).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "panel-open");

    const closeIcon = page.locator(SEL.closeIcon);
    await expect(closeIcon, "close × icon present").toBeVisible();
    await closeIcon.click();
    await expect(dialog, "panel closes after × click").toBeHidden({
      timeout: TIMEOUTS.dialogHidden,
    });
    await step(page, info, 2, "panel-closed");
  });
});
