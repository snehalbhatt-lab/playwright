import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import {
  BASE_URL,
  TIMEOUTS,
  login,
  capture,
  clearBlockingOverlays,
  dismissPostLoginOverlays,
} from "./lib/helpers";

// =============================================================================
// Custom Compliance sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Custom Compliance". 40+ rows covering the Threat Framework >
// Compliance and Compliance Section entities in Secure Design Graph.
//
// Ships 2 read-only assertions over the library-lock behaviour that
// gates both entities. Every other row in the sheet mutates the
// shared Compliance/Compliance-Section library (create / edit /
// delete / hide / add-SR-to-section) or checks propagation to the
// diagram — destructive or diagram-dependent.
//
// Skipped (documented):
//   - R04, R09-R11, R13-R21 — actually create/edit/delete/hide
//     Compliance items on the shared library (destructive).
//   - R25, R29-R41 — same for Compliance Sections.
//   - R05-R08, R12 — right-info-panel + Diagram reflection checks
//     that depend on tenant state.
//   - R14-R22 — Compliance-Section-relation canvas SR editing
//     (destructive).
// =============================================================================

const CC = testdata.customCompliance;
const SEL = CC.selectors;
const EXP = CC.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function gotoSDG(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + CC.path);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  await expect(page.locator(SEL.entityTitleButton)).toBeVisible({
    timeout: TIMEOUTS.elementVisible,
  });
}

async function switchEntity(page: Page, entityName: string): Promise<void> {
  await page.locator(SEL.entityTitleButton).click();
  // The entity-option selector uses a space-containing id, so build
  // it via CSS attribute-selector to avoid space-parsing issues.
  const optionSelector = SEL.entityOptionTemplate.replace("{name}", entityName);
  await page.locator(optionSelector).click();
  // Header updates to the new entity name.
  await expect(page.locator(SEL.entityTitleButton)).toHaveText(entityName, {
    timeout: TIMEOUTS.elementVisible,
  });
}

test.describe.configure({ mode: "serial" });

test.describe("Custom Compliance — Secure Design Graph library-lock behaviour", () => {
  test.setTimeout(TIMEOUTS.test);

  test("compliance_entity_locks_library_to_all: switching to Compliance disables the Library dropdown at All", async ({ page }, info) => {
    caseIds(info, "CC.R03");
    await gotoSDG(page);
    await switchEntity(page, "Compliance");
    await step(page, info, 1, "compliance-entity-active");

    const library = page.locator(SEL.libraryDropdown);
    await expect(library, "Library dropdown must show the locked value").toContainText(
      EXP.libraryLockedLabel,
      { timeout: TIMEOUTS.elementVisible },
    );
    await expect(
      page.locator(SEL.libraryDropdown).locator('[aria-disabled="true"]').first(),
      "Library dropdown must be disabled while on the Compliance entity",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "compliance-library-locked");

    // Entity count renders — proves the list actually loaded.
    const count = await page.locator(SEL.entityCount).innerText();
    expect(
      Number(count.trim()),
      "Compliance entity must expose at least one item",
    ).toBeGreaterThan(0);
    await step(page, info, 3, "count-verified");
  });

  test("compliance_section_entity_locks_library_to_all: same library-lock behaviour on Compliance Sections", async ({ page }, info) => {
    caseIds(info, "CC.R24");
    await gotoSDG(page);
    await switchEntity(page, "Compliance Sections");
    await step(page, info, 1, "compliance-sections-entity-active");

    const library = page.locator(SEL.libraryDropdown);
    await expect(library).toContainText(EXP.libraryLockedLabel, {
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(
      page.locator(SEL.libraryDropdown).locator('[aria-disabled="true"]').first(),
      "Library dropdown must be disabled while on the Compliance Sections entity",
    ).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "sections-library-locked");
  });
});
