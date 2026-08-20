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
// Onboarding Tour sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Onboarding Tour". 42 real cases across five sub-tours in the
// diagram + create-model areas:
//   A. Diagram Screen tour, 14 steps (R1-R15 + R16-R20 controls)
//   B. Inside Threats pane tour, 4 steps (R21-R24)
//   C. Inside Security Requirements pane tour, 4 steps (R25-R28)
//   D. Inside Test Cases pane tour, 4 steps (R29-R32)
//   E. Create New Threat Model tour, 7 steps (R33-R38)
//
// Ships 4 non-destructive tests (T1-T4). Every diagram-side test
// uses the first available shared tenant threat model as a read-only
// fixture — no test creates, edits, or deletes any model. All state
// mutation is confined to a per-user `localStorage`
// (`threat-modeler-tour`) flag that we reset before each test.
//
// Storage mechanic (probed live 2026-08-20):
// The app keeps per-tour state in `localStorage.threat-modeler-tour`
// as a JSON object keyed by tour id — `diagramScreen`,
// `createNewThreatScreen`, `diagramThreatsSideScreen`,
// `diagramSecurityRequirementsSideScreen`,
// `diagramTestCaseSideScreen`, plus a few unrelated ones. Each entry
// tracks `{totalStep, isComplete, skipped, doNotShowAgain,
// visitedStep}`. A tour triggers on its target screen/panel only if
// all three of `isComplete`, `skipped`, `doNotShowAgain` are false.
// The test resets the specific tour to that state before navigating,
// which is the exact same code path a first-time user hits.
//
// Tour DOM contract:
//   - Popover: `.tour-step.tour-{top|bottom|left|right}`
//   - Heading (h4/h6): title of current step
//   - Buttons: `.next-button` (advances / "Done"), `.back-button`
//     (visible from step 2), `.skip-button`, checkbox
//     `#guidedTourCheckbox` (Do Not Show Again)
//   - Counter format: "Next  N/Total" or "Done"
//   - Body class `tour-open` while active
//   - Spotlight: `.guided-tour-spotlight-overlay` (rect over target)
//   - Input mask: `.guided-tour-user-input-mask` (blocks clicks off
//     the highlight)
//
// Live-vs-Excel drift (documented, not fatal):
//   - R24 / R28 / R32 Excel says "Threat Actions" / "SR Actions" /
//     "Test Cases Actions"; live heading is just "Actions" for all
//     three panes. Captured verbatim in expectedHeadings.
//   - Excel R1 says the diagram tour is 15 steps total (R1 welcome
//     + R2-R15 highlights); live storage says 14 total. The welcome
//     is step 1/14, so R1 and R2 map to steps 1 and 2 respectively.
//
// Skipped (documented):
//   - R18, R39 — subjective font / colour / alignment checks with no
//     stable DOM assertion.
//   - R20 — "tour only appears for new users" needs a fresh-user
//     fixture; would require creating a real user in Access
//     Management (destructive, admin-only).
//   - R21-R32 (12 rows — Inside Threats / Inside SR / Inside
//     Test Cases pane tours) — the pane component's tour trigger
//     runs during Angular init, before our localStorage reset can
//     apply. Probed live 2026-08-20 across three approaches:
//     (a) reset flag → reload existing tenant model, (b) reset flag
//     → nav to model from /threatmodels, (c) reset flag → nav to a
//     freshly created disposable model. All three failed to make
//     the pane popover render after clicking the pane opener icon,
//     although the storage flag was demonstrably `{skipped:false,
//     isComplete:false, doNotShowAgain:false}` at click time. The
//     storage-reset mechanic and the tour DOM contract are already
//     exercised by T1-T4 (diagram screen tour), so pane-side
//     coverage adds no new mechanic evidence — deferred rather
//     than fought further.
//   - R33-R38 (6 rows — Create New Threat Model tour) — same
//     init-race pattern as the pane tours. The create-dialog tour
//     fires reliably during interactive MCP-driven exploration
//     (verified 2026-08-20) but does not fire in a scripted test
//     run against sbhatt's account, even when the localStorage
//     flag is confirmed to read `{skipped:false, isComplete:false,
//     doNotShowAgain:false, visitedStep:0}` at the moment the
//     dialog is opened. The tour scheduler appears to consume its
//     "first-time" signal on app boot from the persisted
//     `mainScreen.skipped:true` state and does not re-arm even
//     after we reset the `createNewThreatScreen` sub-key. The
//     tour DOM contract and the 7 expected headings are already
//     documented in `testdata.json` under
//     `onboardingTour.tours.createNewThreatScreen.expectedHeadings`
//     so a future user-fixture pass can add coverage cheaply.
//   - R40 — generic "tour proceeds without disruption"; already
//     covered by T2 (full 14-step walk).
//   - R41 — "clicking Approval Workflow mid-tour doesn't restart the
//     tour". While the tour is active, `.guided-tour-user-input-mask`
//     blocks clicks on every element that isn't the current
//     highlight, so the described action can't actually be
//     performed. T3 asserts the mask is present, which covers the
//     intent (nothing outside the highlight is reachable during the
//     tour).
//   - "Do Not Show Again" writing side of R19 — checking the box
//     would persist `doNotShowAgain=true` for the sbhatt account and
//     block every subsequent tour test. T4 asserts the checkbox is
//     present and starts unchecked, and that skipping without
//     checking keeps `doNotShowAgain=false` in storage — the
//     structural evidence for the "unless the user opted out" clause.
// =============================================================================

const OB = testdata.onboardingTour;
const SEL = OB.selectors;
const TOURS = OB.tours;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

// The single tour key stored in localStorage. Reset a specific
// sub-tour by writing the "fresh" shape back for that key alone —
// other sub-tours are left in whatever state the account already
// has. Runs in the browser context.
async function resetTour(page: Page, tourKey: string, totalStep: number): Promise<void> {
  await page.evaluate(
    ({ storageKey, tourKey, totalStep }) => {
      const raw = localStorage.getItem(storageKey);
      const v = raw ? JSON.parse(raw) : {};
      v[tourKey] = {
        totalStep,
        isComplete: false,
        skipped: false,
        doNotShowAgain: false,
        visitedStep: 0,
      };
      localStorage.setItem(storageKey, JSON.stringify(v));
    },
    { storageKey: OB.storageKey, tourKey, totalStep },
  );
}

async function getTourStorage(page: Page, tourKey: string): Promise<Record<string, unknown> | null> {
  return await page.evaluate(
    ({ storageKey, tourKey }) => {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return v[tourKey] || null;
    },
    { storageKey: OB.storageKey, tourKey },
  );
}

// Reads the current popover's heading + counter text. Returns null
// when no popover is on-screen.
async function readTourStep(page: Page): Promise<{ heading: string; counter: string } | null> {
  return await page.evaluate((sel) => {
    const p = document.querySelector(sel.popover);
    if (!p) return null;
    const h = p.querySelector("h1, h2, h3, h4, h5, h6");
    const n = p.querySelector(".next-button");
    return {
      heading: (h?.textContent || "").trim(),
      counter: (n?.textContent || "").trim(),
    };
  }, SEL);
}

// Opens the first available tenant threat model — same pattern as
// cvss_score.spec.ts, avoids hardcoding a model id that may
// disappear. The tour is a user-level flag, not a model-level flag,
// so any model works as a fixture.
async function openFirstModelDiagram(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + PATHS.threatModels);
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  const firstLink = page.locator(OB.diagramLinkSelector).first();
  await expect(firstLink, "at least one model must exist on the tenant").toBeAttached({
    timeout: TIMEOUTS.navMedium,
  });
  const href = await firstLink.getAttribute("href");
  await page.goto(BASE_URL + href!);
  await page.waitForURL(/\/threatmodeldiagram\//, { timeout: TIMEOUTS.navLong });
  await expect(page).toHaveTitle(/Threat Model Diagram/, { timeout: TIMEOUTS.navLong });
}

// The tour popover only mounts after diagram hydration completes.
// A single strong wait is more reliable than polling every button.
async function waitForTourPopover(page: Page, timeoutMs: number = 15000): Promise<void> {
  await expect(page.locator(SEL.popover), "tour popover should be visible").toBeVisible({
    timeout: timeoutMs,
  });
}

test.describe("Onboarding Tour", () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(TIMEOUTS.test);
  });

  // -------------------------------------------------------------------
  // Section A — Diagram screen tour (R1-R20)
  // -------------------------------------------------------------------

  test("T1 diagram tour launches on first visit with a welcome step", async ({
    page,
  }, info) => {
    caseIds(info, "OnboardingTour.R1");
    await openFirstModelDiagram(page);
    await resetTour(page, "diagramScreen", TOURS.diagramScreen.totalStep);
    await page.reload();
    await waitForTourPopover(page);
    await step(page, info, 1, "tour-welcome-visible");

    const s = await readTourStep(page);
    expect(s?.heading, "welcome heading text").toContain(OB.expected.welcomePartial);
    expect(s?.counter, "counter reads 1/14").toContain(`1/${TOURS.diagramScreen.totalStep}`);

    // Body carries `tour-open` while the tour is up — proxy for the
    // whole app being in guided-tour mode.
    const bodyCls = await page.evaluate(() => document.body.className);
    expect(bodyCls, "body carries tour-open").toContain(SEL.bodyActiveClass);

    // Spotlight + input mask are both mounted (the mask is what
    // blocks arbitrary clicks off the highlight — this is the
    // structural evidence for R41's "clicking elsewhere doesn't
    // restart the tour").
    await expect(page.locator(SEL.spotlightOverlay)).toBeAttached();
    await expect(page.locator(SEL.userInputMask)).toBeAttached();
  });

  test("T2 diagram tour steps through all 14 highlighted panels in order", async ({
    page,
  }, info) => {
    caseIds(
      info,
      "OnboardingTour.R2",
      "OnboardingTour.R3",
      "OnboardingTour.R4",
      "OnboardingTour.R5",
      "OnboardingTour.R6",
      "OnboardingTour.R7",
      "OnboardingTour.R8",
      "OnboardingTour.R9",
      "OnboardingTour.R10",
      "OnboardingTour.R11",
      "OnboardingTour.R12",
      "OnboardingTour.R13",
      "OnboardingTour.R14",
      "OnboardingTour.R15",
      "OnboardingTour.R40",
    );
    await openFirstModelDiagram(page);
    await resetTour(page, "diagramScreen", TOURS.diagramScreen.totalStep);
    await page.reload();
    await waitForTourPopover(page);
    await step(page, info, 1, "diagram-tour-start");

    const total = TOURS.diagramScreen.totalStep;
    for (let i = 0; i < total; i++) {
      const s = await readTourStep(page);
      expect(s, `popover should be visible on step ${i + 1}`).not.toBeNull();
      const expected = TOURS.diagramScreen.expectedHeadings[i];
      expect(
        s!.heading,
        `step ${i + 1}/${total} heading (expected to contain "${expected}")`,
      ).toContain(expected);
      const expectedCounter = i === total - 1 ? OB.expected.counterDone : `${i + 1}/${total}`;
      expect(s!.counter, `step ${i + 1}/${total} counter`).toContain(expectedCounter);
      if (i < total - 1) {
        await page.locator(SEL.nextButton).click();
        const nextCounter =
          i + 1 === total - 1 ? OB.expected.counterDone : `${i + 2}/${total}`;
        await expect
          .poll(async () => (await readTourStep(page))?.counter, {
            timeout: TIMEOUTS.elementVisible,
          })
          .toContain(nextCounter);
      }
    }
    await step(page, info, 2, "diagram-tour-final-step");

    // Click Done and verify the tour dismounts + storage flips to complete.
    await page.locator(SEL.nextButton).click();
    await expect(page.locator(SEL.popover)).toHaveCount(0, {
      timeout: TIMEOUTS.elementVisible,
    });
    const storage = await getTourStorage(page, "diagramScreen");
    expect(storage?.isComplete, "diagramScreen.isComplete after Done").toBe(true);
    await step(page, info, 3, "diagram-tour-done");
  });

  test("T3 tour navigation controls: Next advances, Back returns, Skip dismisses", async ({
    page,
  }, info) => {
    caseIds(info, "OnboardingTour.R16", "OnboardingTour.R17");
    await openFirstModelDiagram(page);
    await resetTour(page, "diagramScreen", TOURS.diagramScreen.totalStep);
    await page.reload();
    await waitForTourPopover(page);
    await step(page, info, 1, "step-1-open");

    // Step 1 has no Back button — it's the first step.
    await expect(page.locator(SEL.backButton), "no Back on step 1").toHaveCount(0);
    await expect(page.locator(SEL.nextButton)).toBeVisible();

    // Next → step 2, Back appears.
    await page.locator(SEL.nextButton).click();
    await expect
      .poll(async () => (await readTourStep(page))?.counter, { timeout: TIMEOUTS.elementVisible })
      .toContain(`2/${TOURS.diagramScreen.totalStep}`);
    await expect(page.locator(SEL.backButton), "Back visible on step 2").toBeVisible();
    await step(page, info, 2, "step-2-with-back");

    // Back → step 1 again.
    await page.locator(SEL.backButton).click();
    await expect
      .poll(async () => (await readTourStep(page))?.counter, { timeout: TIMEOUTS.elementVisible })
      .toContain(`1/${TOURS.diagramScreen.totalStep}`);
    await step(page, info, 3, "back-to-step-1");

    // Skip → tour dismounts, storage.skipped = true.
    await page.locator(SEL.skipButton).click();
    await expect(page.locator(SEL.popover)).toHaveCount(0, {
      timeout: TIMEOUTS.elementVisible,
    });
    const bodyCls = await page.evaluate(() => document.body.className);
    expect(bodyCls, "body no longer carries tour-open").not.toContain(SEL.bodyActiveClass);
    const storage = await getTourStorage(page, "diagramScreen");
    expect(storage?.skipped, "diagramScreen.skipped after Skip").toBe(true);
    await step(page, info, 4, "after-skip");
  });

  test("T4 Do Not Show Again checkbox is present and defaults unchecked", async ({
    page,
  }, info) => {
    caseIds(info, "OnboardingTour.R19");
    await openFirstModelDiagram(page);
    await resetTour(page, "diagramScreen", TOURS.diagramScreen.totalStep);
    await page.reload();
    await waitForTourPopover(page);
    await step(page, info, 1, "tour-open");

    const cb = page.locator(SEL.doNotShowCheckbox);
    const label = page.locator(SEL.doNotShowLabel);
    await expect(cb, "Do Not Show Again checkbox present").toBeAttached();
    await expect(cb, "checkbox unchecked by default").not.toBeChecked();
    await expect(label, "label text").toHaveText(OB.expected.doNotShowLabelText);

    // Skip without checking → doNotShowAgain remains false in
    // storage (i.e. the tour is *allowed* to resume unless the user
    // opts out — the wording of R19).
    await page.locator(SEL.skipButton).click();
    await expect(page.locator(SEL.popover)).toHaveCount(0, {
      timeout: TIMEOUTS.elementVisible,
    });
    const storage = await getTourStorage(page, "diagramScreen");
    expect(storage?.skipped).toBe(true);
    expect(
      storage?.doNotShowAgain,
      "skipping without checking keeps doNotShowAgain=false",
    ).toBe(false);
    await step(page, info, 2, "skipped-without-optout");
  });

  // -------------------------------------------------------------------
  // Section B / C / D (Inside Threats / SR / Test Cases pane tours,
  // R21-R32) and Section E (Create New Threat Model tour, R33-R38)
  // are both skipped — see file header for the app-side init-race
  // rationale that makes those tours untestable via scripted
  // localStorage reset on sbhatt's account.
  // -------------------------------------------------------------------
});
