import { expect, type Page, type Locator, type TestInfo } from "@playwright/test";
import testdata from "../data/testdata.json";

// Shared plumbing for the Threat Models Screen suite:
//   - login (with recovery from partially-broken auth)
//   - dismissPostLoginOverlays (guided tour, kendo popups, release-note)
//   - waitForLoaderIdle (tm-loader overlay quiet)
//   - capture (screenshot attach per named step)
//
// Values come from tests/data/testdata.json; no hardcoded strings live
// in the spec file itself.

export const BASE_URL: string = process.env.TM_BASE_URL ?? testdata.baseUrl;
export const USERNAME: string = process.env.TM_USER ?? testdata.credentials.username;
export const PASSWORD: string = process.env.TM_PASS ?? testdata.credentials.password;

export const PATHS = testdata.paths;
export const URL_PATTERNS = testdata.urlPatterns;
export const TITLES = testdata.titles;
export const TIMEOUTS = testdata.timeouts;
export const ROLES = testdata.roles;
export const SEL = testdata.selectors;
export const TM = testdata.threatModelsScreen;
export const TM_DATA = testdata.threatModel;

// ---- Login ---------------------------------------------------------------

async function attemptLogin(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}${PATHS.root}`);
  const loginOrApp = new RegExp(URL_PATTERNS.loginOrApp, "i");
  try {
    await page.waitForURL(loginOrApp, { timeout: TIMEOUTS.navShort });
  } catch {
    await page.goto(`${BASE_URL}${PATHS.threatModels}`);
    await page.waitForURL(loginOrApp, { timeout: TIMEOUTS.navMedium });
  }
  if (new RegExp(PATHS.login.replace(/\//g, "\\/"), "i").test(page.url())) {
    // The login page can be covered by a `tm-takeover-root` modal whose
    // backdrop swallows clicks on the username field. Remove it first.
    await page.evaluate(() =>
      document.querySelectorAll("#tm-takeover-root").forEach((el) => el.remove()),
    );
    const usernameField = page.getByRole("textbox", { name: ROLES.textboxes.username });
    const passwordField = page.getByRole("textbox", { name: ROLES.textboxes.password });
    await expect(usernameField).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await usernameField.pressSequentially(USERNAME, { delay: TIMEOUTS.typingDelaySlow });
    await passwordField.pressSequentially(PASSWORD, { delay: TIMEOUTS.typingDelaySlow });
    // Post-login landing drifted on tmdev: sign-in now redirects to /ai-home
    // on some tenant configurations and /threatmodels on others. Accept either
    // so the wait doesn't time out; the title-check fallback below navigates
    // to /threatmodels when the test needs that specific landing.
    await Promise.all([
      page.waitForURL(new RegExp(URL_PATTERNS.postLoginLanding), {
        timeout: TIMEOUTS.navMedium,
      }),
      page.getByRole("button", { name: ROLES.buttons.signIn }).click(),
    ]);
  }
  try {
    await expect(page).toHaveTitle(new RegExp(TITLES.threatModels), {
      timeout: TIMEOUTS.navShort,
    });
  } catch {
    await page.goto(`${BASE_URL}${PATHS.threatModels}`);
    await expect(page).toHaveTitle(new RegExp(TITLES.threatModels), {
      timeout: TIMEOUTS.navMedium,
    });
  }
}

// tmdev intermittently drops the session right after sign-in. Retry with
// a clean session on the second attempt so a broken auth cookie doesn't
// fail the whole test at the login step.
export async function login(page: Page): Promise<void> {
  const MAX_ATTEMPTS = 2;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await attemptLogin(page);
      return;
    } catch (err) {
      lastError = err;
      if (attempt === MAX_ATTEMPTS) break;
      await page.context().clearCookies().catch(() => {});
      await page
        .evaluate(() => {
          try {
            localStorage.clear();
            sessionStorage.clear();
          } catch {}
        })
        .catch(() => {});
    }
  }
  throw lastError;
}

// ---- Overlays ------------------------------------------------------------

export async function dismissPostLoginOverlays(page: Page): Promise<void> {
  const DISMISS = testdata.dismissButtonNames;
  for (let i = 0; i < 5; i++) {
    let acted = false;
    for (const name of DISMISS) {
      const btn = page.getByRole("button", { name, exact: true }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true }).catch(() => {});
        acted = true;
      }
    }
    if (!acted) break;
    await page.waitForTimeout(TIMEOUTS.dismissOverlayPause);
  }
  await page.evaluate(
    ({ overlays, loaderAll }) => {
      document.querySelectorAll(overlays).forEach((el) => el.remove());
      document.querySelectorAll(loaderAll).forEach((el) => {
        const h = el as HTMLElement;
        h.style.display = "none";
        h.style.pointerEvents = "none";
      });
    },
    { overlays: SEL.overlaysToRemove, loaderAll: SEL.loaderOverlayAll },
  );
}

// Removes overlays that re-appear after navigation and intercept
// pointer events. Called before every interactive click on the list.
export async function clearBlockingOverlays(page: Page): Promise<void> {
  await page.evaluate(
    ({ overlays, loaderAll }) => {
      document.querySelectorAll(loaderAll).forEach((el) => {
        const h = el as HTMLElement;
        h.style.display = "none";
        h.style.pointerEvents = "none";
      });
      document.querySelectorAll(overlays).forEach((el) => el.remove());
    },
    { overlays: SEL.overlaysToRemove, loaderAll: SEL.loaderOverlayAll },
  );
}

export async function waitForLoaderIdle(page: Page, timeout: number = TIMEOUTS.loaderIdle): Promise<void> {
  await expect
    .poll(async () => await page.locator(SEL.loaderOverlayVisible).count(), { timeout })
    .toBe(0);
}

// ---- Screenshot capture --------------------------------------------------

// Attaches a full-page screenshot to the current test result with an
// ordered, descriptive name so the HTML report surfaces evidence per
// step. Every meaningful step in each test calls this.
export async function capture(page: Page, info: TestInfo, name: string): Promise<void> {
  const body = await page.screenshot({ fullPage: true });
  await info.attach(name, { body, contentType: "image/png" });
}
