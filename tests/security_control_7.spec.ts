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
// Security Control 7.0 sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Security Control 7.0". 70 real cases (R4-R74) covering the
// *Threats-side* view of the same Security Control mitigation
// dialog that `security_requirements_mitigation.spec.ts` covers
// from the *SR side*.
//
// Ships 1 non-destructive shell test that adds the only new
// coverage angle vs. the SRM suite: the tab-switching mechanic on
// the Impact Summary panel. SRM T1 already asserts both tab
// labels are present; this suite verifies that clicking those
// tabs actually toggles the `nav-tab-active` / `nav-tab-inactive`
// class pair on the correct tab. All other structural surface
// (panel opens, accordion mounts, × dismisses) is covered by
// `security_requirements_mitigation.spec.ts` and is not
// duplicated here.
//
// Live probe evidence (2026-08-21):
//   - Same button `#topMenuTour_3` opens the
//     `dialog[aria-label="Security Controls"]`.
//   - Tab bar inside dialog: `<nav class="nav nav-tabs ...">`
//     hosting two `<a class="nav-link nav-tab-title ...">` tabs:
//       - `#ngb-nav-0` — "Threats" (default active — class
//         includes `nav-tab-active` + `active`).
//       - `#ngb-nav-1` — "Security Requirements" (default
//         inactive — class includes `nav-tab-inactive`).
//   - Clicking a tab transitions the class pair — verified by
//     round-trip Threats → SR → Threats.
//
// Skipped (~68 rows):
//   - R4-R14 (structural panel-open) — already covered by
//     `security_requirements_mitigation.spec.ts` T1-T2.
//   - R15-R49 — canvas drag-drop of controls, protocol drawing,
//     right-click Apply Mitigation, Undo/Redo, save-as-template.
//     All canvas-blocked (category E) + destructive. Same class
//     as SRM's skipped rows.
//   - R50-R74 — CVE mitigation, nested/attribute/group threat
//     mitigation, search-by-CVE, count validation. Same canvas +
//     destructive blockers.
// =============================================================================

const SC = testdata.securityControl7;
const SEL = SC.selectors;
const EXP = SC.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

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
  console.log(`[sc7-fixture] opened model: ${found!.name || "(unknown)"}`);
}

test.describe("Security Control 7.0", () => {
  test.beforeEach(async () => {
    test.setTimeout(TIMEOUTS.test);
  });

  test("T1 Impact Summary Threats/SR tabs toggle active state on click (Threats is default)", async ({
    page,
  }, info) => {
    caseIds(info, "SecurityControl7.R4", "SecurityControl7.R5", "SecurityControl7.R7");
    await openFirstModelDiagram(page);

    await page.locator(SEL.securityControlsButton).click();
    const dialog = page.locator(SEL.impactSummaryDialog);
    await expect(dialog, "Impact Summary dialog opens").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 1, "impact-summary-open");

    const threatsTab = page.locator(SEL.threatsTab);
    const srTab = page.locator(SEL.srTab);
    await expect(threatsTab, "Threats tab present").toHaveText(EXP.threatsTabText);
    await expect(srTab, "Security Requirements tab present").toHaveText(EXP.srTabText);

    // Default state: Threats tab active, SR tab inactive.
    await expect(threatsTab, "Threats tab active by default").toHaveClass(
      new RegExp(`(^|\\s)${SEL.activeClass}(\\s|$)`),
    );
    await expect(srTab, "SR tab inactive by default").toHaveClass(
      new RegExp(`(^|\\s)${SEL.inactiveClass}(\\s|$)`),
    );
    await step(page, info, 2, "threats-active-default");

    // Click SR tab → active state moves to SR.
    await srTab.click();
    await expect(srTab, "SR tab active after click").toHaveClass(
      new RegExp(`(^|\\s)${SEL.activeClass}(\\s|$)`),
    );
    await expect(threatsTab, "Threats tab inactive after SR click").toHaveClass(
      new RegExp(`(^|\\s)${SEL.inactiveClass}(\\s|$)`),
    );
    await step(page, info, 3, "sr-active-after-click");

    // Click Threats tab → active state returns to Threats — completes
    // the round-trip proof that both tabs are interactive.
    await threatsTab.click();
    await expect(threatsTab, "Threats tab active again after click").toHaveClass(
      new RegExp(`(^|\\s)${SEL.activeClass}(\\s|$)`),
    );
    await expect(srTab, "SR tab inactive after Threats re-click").toHaveClass(
      new RegExp(`(^|\\s)${SEL.inactiveClass}(\\s|$)`),
    );
    await step(page, info, 4, "threats-active-after-roundtrip");
  });
});
