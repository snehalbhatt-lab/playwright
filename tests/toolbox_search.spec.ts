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
// Toolbox search sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Toolbox search". 13 real cases in a single "Component toolbox"
// module. Merged into 4 tests covering 8 rows; 5 rows skipped with
// reason.
//
// Live-vs-Excel drift:
//   - The AI-style placeholder does NOT set the input's `placeholder`
//     attribute — the effect is a sibling `.vertical-placeholder-
//     container` with 6 rotating `.placeholder-item` entries. The
//     container's `style.display` toggles between "block" (empty
//     input) and "none" (typed).
//   - The component grid is canvas-rendered, so verifying that a
//     specific result (e.g. "Lambda") appears in the search result
//     grid cannot be done via DOM inspection. Search-behaviour cases
//     (R10-R13) are asserted indirectly via the "No Result Found"
//     text — its absence means the search matched something.
//
// Skipped (documented — canvas-rendered results, missing feature, or
// dependent on backend state):
//   - R03 — "placeholder updated across all instances". Needs multiple
//     toolbox instances open simultaneously; the live app only exposes
//     one toolbox.
//   - R06 — search by tag: assumes results list is DOM-inspectable
//     (it's canvas), and needs a tenant with tag-labeled components.
//   - R07 — filter-by-department: requires per-department fixtures
//     and the filter UI (separate from the search input).
//   - R08 — search by description: semantic/fuzzy match; hard to
//     assert deterministically.
//   - R09 — search by component type: needs component-type taxonomy
//     knowledge; the Excel expected result itself is "Need to check".
// =============================================================================

const TS = testdata.toolboxSearch;
const SEL = TS.selectors;
const EXP = TS.expected;
const TERMS = TS.searchTerms;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function openDisposableModelAndToolbox(page: Page): Promise<string> {
  await login(page);
  await gotoTMList(page);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  const { modelName } = await createDisposableModel(page, TS.modelPrefix);
  await page.waitForTimeout(3000);
  await clearBlockingOverlays(page);
  // Fresh disposable models sometimes come up with the toolbox panel
  // already open; the icon toggles it, so a naïve click closes an
  // already-open panel. Only click if the panel is not visible yet.
  const toolboxBtn = page.locator(SEL.diagramComponentIcon);
  const panel = page.locator(SEL.toolboxPanel);
  await expect(toolboxBtn).toBeEnabled({ timeout: TIMEOUTS.buttonEnabled });
  const alreadyOpen = await panel.isVisible({ timeout: 1000 }).catch(() => false);
  if (!alreadyOpen) {
    await toolboxBtn.click();
  }
  await expect(panel).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await expect(page.locator(SEL.searchInput)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  return modelName;
}

// Set the search input value + fire input + change events, then wait
// for the debounced search to settle. The input is not a kendo textbox
// so a plain JS setter + input/change is enough; page.locator().fill()
// also works but skips the `change` event on some versions of Angular
// reactive-form bindings.
async function setSearchTerm(page: Page, term: string): Promise<void> {
  await page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) throw new Error(`no input for ${sel}`);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { sel: SEL.searchInput, val: term },
  );
  // Search settles after ~2s of debounced processing.
  await page.waitForTimeout(2500);
}

async function noResultsShown(page: Page): Promise<boolean> {
  const text = (await page.locator("body").textContent()) ?? "";
  return new RegExp(EXP.noResultsText, "i").test(text);
}

test.describe.configure({ mode: "serial" });

test.describe("Toolbox search — Diagram > Component toolbox", () => {
  test.setTimeout(TIMEOUTS.test);

  test("placeholder_animation_shows_ai_suggestions: rotating placeholder items with expected component terms", async ({ page }, info) => {
    caseIds(info, "TS.R01", "TS.R02");
    const modelName = await openDisposableModelAndToolbox(page);
    try {
      // R01 — the AI-placeholder animation is a
      // `.vertical-placeholder-container` sibling of the input, with
      // multiple `.placeholder-item` children that CSS-animate in and
      // out. The container's visibility can flip during animation
      // frames; asserting on DOM presence (attached + text) is
      // stabler than `toBeVisible`.
      const container = page.locator(SEL.placeholderContainer);
      await expect(container, "placeholder container must render").toHaveCount(1);
      const items = page.locator(SEL.placeholderItem);
      expect(await items.count(), "placeholder must have multiple rotating items").toBeGreaterThan(1);
      await step(page, info, 1, "placeholder-present");

      // R02 — the rotating suggestions include the expected
      // AI-generated component names. Read the text once (not via
      // toBeVisible-scoped .textContent, which returns "" on hidden
      // elements) — the elements are attached, text is populated.
      const containerText = ((await container.textContent()) ?? "").toLowerCase();
      const matched = EXP.expectedPlaceholderTerms.filter((t) =>
        containerText.includes(t.toLowerCase()),
      );
      expect(
        matched.length,
        `at least 3 of the expected component-name suggestions must render — found ${matched.join(", ")}`,
      ).toBeGreaterThanOrEqual(3);
      await step(page, info, 2, "expected-terms-present");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("placeholder_disappears_on_type_returns_on_clear: display flips block/none/block", async ({ page }, info) => {
    caseIds(info, "TS.R04");
    const modelName = await openDisposableModelAndToolbox(page);
    try {
      const container = page.locator(SEL.placeholderContainer);

      // Empty → placeholder visible.
      const emptyDisplay = await container.evaluate((el) => (el as HTMLElement).style.display);
      expect(emptyDisplay, "placeholder must be display:block when input is empty").toBe("block");
      await step(page, info, 1, "empty-placeholder-visible");

      // Typed → placeholder hidden.
      await setSearchTerm(page, "a");
      const typedDisplay = await container.evaluate((el) => (el as HTMLElement).style.display);
      expect(typedDisplay, "placeholder must be display:none when input has value").toBe("none");
      await step(page, info, 2, "typed-placeholder-hidden");

      // Cleared → placeholder back.
      await setSearchTerm(page, "");
      const clearedDisplay = await container.evaluate((el) => (el as HTMLElement).style.display);
      expect(clearedDisplay, "placeholder must return to display:block after clearing input").toBe("block");
      await step(page, info, 3, "cleared-placeholder-restored");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("no_results_message_for_unknown_term: shows 'No Result Found' + reason string with searched term", async ({ page }, info) => {
    caseIds(info, "TS.R05");
    const modelName = await openDisposableModelAndToolbox(page);
    try {
      await setSearchTerm(page, TERMS.nonexistent);
      // R05 — "No Result Found" + a "we couldn't find any results for
      // your search {term}" message must appear.
      expect(await noResultsShown(page), "'No Result Found' must appear for unknown term").toBeTruthy();
      const bodyText = ((await page.locator("body").textContent()) ?? "").toLowerCase();
      expect(bodyText).toContain(EXP.couldntFindPrefix);
      expect(bodyText).toContain(TERMS.nonexistent.toLowerCase());
      await step(page, info, 1, "no-results-shown");
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });

  test("fuzzy_search_returns_results: partial / short / long / misspelled terms all match", async ({ page }, info) => {
    caseIds(info, "TS.R10", "TS.R11", "TS.R12", "TS.R13");
    const modelName = await openDisposableModelAndToolbox(page);
    try {
      // Each variant must NOT show the "No Result Found" text — its
      // absence is our proxy for "search returned results" (the
      // component grid itself is canvas-rendered and can't be
      // DOM-inspected).
      const variants: [string, string][] = [
        ["partial (lambd)", TERMS.partial],
        ["short-form (vpc)", TERMS.shortForm],
        ["long-form (virtual private)", TERMS.longForm],
        ["misspelled (lamda)", TERMS.misspelled],
      ];
      for (let i = 0; i < variants.length; i++) {
        const [label, term] = variants[i];
        await setSearchTerm(page, term);
        expect(
          await noResultsShown(page),
          `${label} search must return results (no "No Result Found" text)`,
        ).toBeFalsy();
        await step(page, info, i + 1, `${label.replace(/[^a-z0-9]+/gi, "-")}-has-results`);
      }
    } finally {
      await cleanupDisposableModel(page, modelName).catch(() => {});
    }
  });
});
