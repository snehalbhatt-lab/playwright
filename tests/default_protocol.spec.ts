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
// Default Protocol sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Default Protocol". 34 rows covering two feature areas in the
// diagram screen:
//   A. Default Protocol (R1-R14) — right-click a canvas link →
//      Mark-as-default icon → Save.
//   B. Show Link Color (R20-R30) — Display Options menu → Show link
//      color toggle.
//
// Ships 3 non-destructive tests over the Show Link Color toggle. All
// of module A and most of module B are skipped — see below.
//
// Skipped module A (R1-R14, all 14 real cases): the diagram is
// rendered by GoJS on a pure <canvas> (verified live 2026-08-19: main
// diagram = 4 canvases + 0 SVG, `window.diagram` is a go.Diagram).
// Right-clicking a link at the correct canvas coordinate does not
// yield a DOM context menu — the Mark-as-default entry is rendered by
// GoJS on-canvas (link.contextMenu is null and no HTML popup appears
// after either a synthetic contextmenu MouseEvent or an MCP-driven
// right-click). Same class of blocker as Component color change,
// Verizon, Border color change, Threat Risk Colour (memory category
// E). Verifying R3 / R5 / R6 also requires reading canvas pixels for
// the default-icon overlay. No stable DOM surface → skipped.
//
// Skipped module B (8 of 11 real rows):
//   - R23 — same setting shown for all models (cross-model fixture).
//   - R25 — "Need to check" (non-actionable expected result).
//   - R26 — works with all model types (5+ disposable-model
//     create+cleanup for a smoke assertion; poor ROI).
//   - R28 — read-only user (cross-user fixture).
//   - R29 — RW/admin changes reflect on owner canvas (cross-user).
//   - R30 — works in Template Builder (covered by
//     template_builder.spec.ts).
//
// Kept module B (3 tests):
//   - B1: R20 + R21 + R22 — default state is enabled, toggle flips
//         both the UI check icon and localStorage.
//         HighlightAllDiagramLinks.
//   - B2: R27 — setting persists across reload.
//   - B3: R24 — setting is stored client-side (localStorage) — proxy
//         for "per-user per-browser".
//
// Note on the persistence key: the app stores this toggle in
// localStorage under `HighlightAllDiagramLinks` (a "true"/"false"
// string). Clicking the menu item flips both the `.fa-check` icon
// inside the button and the stored value in the same event handler.
// =============================================================================

const DP = testdata.defaultProtocol;
const SEL = DP.selectors;
const STORAGE = DP.storageKeys;

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
  return await createDisposableModel(page, DP.modelPrefix);
}

// The Display Options dropdown is an ngb-dropdown that toggles on
// every button click: clicking when already open closes it. The
// button carries aria-expanded so we can test the current state
// instead of blindly clicking. The button itself is intercepted by
// the post-navigation guided-tour mask on fresh disposable models —
// clear overlays first.
async function openDisplayOptions(page: Page): Promise<void> {
  await clearBlockingOverlays(page);
  const button = page.locator(SEL.displayOptionsButton);
  const expanded = await button.getAttribute("aria-expanded");
  if (expanded !== "true") await button.click();
  await expect(showLinkColorItem(page)).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
}

function showLinkColorItem(page: Page) {
  return page
    .locator(".dropdown-item")
    .filter({ hasText: SEL.showLinkColorItemText })
    .first();
}

async function isShowLinkColorChecked(page: Page): Promise<boolean> {
  await openDisplayOptions(page);
  const count = await showLinkColorItem(page)
    .locator(`i.${SEL.checkedIconClass}`)
    .count();
  return count > 0;
}

async function readStorageValue(page: Page): Promise<string | null> {
  return await page.evaluate((k) => localStorage.getItem(k), STORAGE.showLinkColor);
}

// Clicking the item dismisses the dropdown, so every toggle must
// re-open the menu first. Callers should not assume the menu is
// already open.
async function clickShowLinkColor(page: Page): Promise<void> {
  await openDisplayOptions(page);
  await showLinkColorItem(page).click();
}

test.describe.configure({ mode: "serial" });

test.describe("Default Protocol sheet — Display Options > Show link color", () => {
  // Disposable-model archive + permanent-delete on this tenant runs
  // ~90-120s; per-test timeout raised so setup + test + cleanup all
  // fit even after login retries.
  test.setTimeout(600000);

  test("show_link_color_default_and_toggle: default enabled, toggle flips icon and storage", async ({ page }, info) => {
    caseIds(info, "DP.R20", "DP.R21", "DP.R22");
    const { modelName } = await setupModel(page);
    try {
      // R20 — default state is enabled on a fresh model.
      const initialChecked = await isShowLinkColorChecked(page);
      const initialStored = await readStorageValue(page);
      expect(
        initialChecked,
        "Show link color must be enabled by default on a new model",
      ).toBe(true);
      // Storage is either unset (never toggled in this browser) or
      // explicitly "true" — both count as enabled.
      expect(
        initialStored === null || initialStored === "true",
        `Storage key ${STORAGE.showLinkColor} must reflect enabled default (got ${initialStored})`,
      ).toBe(true);
      await step(page, info, 1, "default-state-enabled");

      // R21 — deselect flips the icon off and storage to "false".
      await clickShowLinkColor(page);
      const afterOffChecked = await isShowLinkColorChecked(page);
      const afterOffStored = await readStorageValue(page);
      expect(
        afterOffChecked,
        "Clicking Show link color must remove the check icon",
      ).toBe(false);
      expect(
        afterOffStored,
        `Storage key ${STORAGE.showLinkColor} must be "false" after deselect`,
      ).toBe("false");
      await step(page, info, 2, "toggled-off");

      // R22 — re-select flips icon on and storage back to "true".
      await clickShowLinkColor(page);
      const afterOnChecked = await isShowLinkColorChecked(page);
      const afterOnStored = await readStorageValue(page);
      expect(
        afterOnChecked,
        "Re-selecting Show link color must restore the check icon",
      ).toBe(true);
      expect(
        afterOnStored,
        `Storage key ${STORAGE.showLinkColor} must be "true" after re-select`,
      ).toBe("true");
      await step(page, info, 3, "toggled-back-on");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("show_link_color_persists_across_reload: toggled state survives a page reload", async ({ page }, info) => {
    caseIds(info, "DP.R27");
    const { modelName } = await setupModel(page);
    try {
      // Toggle off first so we have a mutation to verify.
      await clickShowLinkColor(page);
      const stateBeforeReload = await readStorageValue(page);
      expect(
        stateBeforeReload,
        `Storage key ${STORAGE.showLinkColor} must be "false" before reload`,
      ).toBe("false");
      await step(page, info, 1, "toggled-off-pre-reload");

      // Full page reload — the diagram remounts, the menu re-renders.
      await page.reload();
      await dismissPostLoginOverlays(page);
      await clearBlockingOverlays(page);
      await expect(page.locator(SEL.displayOptionsButton)).toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });
      await step(page, info, 2, "reloaded");

      const stateAfterReload = await readStorageValue(page);
      const checkedAfterReload = await isShowLinkColorChecked(page);
      expect(
        stateAfterReload,
        `Storage key ${STORAGE.showLinkColor} must remain "false" after reload`,
      ).toBe("false");
      expect(
        checkedAfterReload,
        "Menu must render the setting as disabled after reload",
      ).toBe(false);
      await step(page, info, 3, "persisted-after-reload");

      // Restore before cleanup so we don't leave storage in a
      // non-default state for the next disposable-model page load in
      // the same worker.
      await clickShowLinkColor(page);
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("show_link_color_is_stored_client_side: setting written to localStorage (per-browser, not server)", async ({ page }, info) => {
    caseIds(info, "DP.R24");
    const { modelName } = await setupModel(page);
    try {
      // Toggle so the key definitely exists (fresh browsers start
      // without the key set at all).
      await clickShowLinkColor(page);
      await clickShowLinkColor(page);
      await step(page, info, 1, "toggled-to-materialise-key");

      const stored = await readStorageValue(page);
      expect(
        stored,
        `Setting must be stored client-side under ${STORAGE.showLinkColor}`,
      ).not.toBeNull();
      // "true" or "false" are the only valid materialised values.
      expect(["true", "false"]).toContain(stored);
      await step(page, info, 2, "key-present-in-localstorage");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });
});
