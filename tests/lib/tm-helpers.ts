import { expect, type Page, type Locator } from "@playwright/test";
import {
  BASE_URL,
  PATHS,
  URL_PATTERNS,
  TITLES,
  TIMEOUTS,
  ROLES,
  SEL,
  TM,
  TM_DATA,
  dismissPostLoginOverlays,
  waitForLoaderIdle,
  clearBlockingOverlays,
} from "./helpers";

// Threat Models Screen operation helpers. Every destructive flow uses
// the create-mutate-delete pattern with an AutoTM-{timestamp} name so
// the tenant doesn't accumulate test rows. Selectors were live-verified
// via Playwright MCP at the start of this session.

const DIAGRAM_URL = new RegExp(URL_PATTERNS.threatModelDiagram, "i");
const TM_URL = new RegExp(URL_PATTERNS.loggedIn, "i");

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---- Navigation ---------------------------------------------------------

export async function gotoTMList(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}${PATHS.threatModels}`);
  await dismissPostLoginOverlays(page);
  await expect(page).toHaveURL(TM_URL, { timeout: TIMEOUTS.navMedium });
  await waitForLoaderIdle(page).catch(() => {});
}

export async function gotoArchivedList(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}${PATHS.threatModelsArchived}`);
  await dismissPostLoginOverlays(page);
  await waitForLoaderIdle(page).catch(() => {});
  await expect(page).toHaveTitle(new RegExp(TITLES.threatModelsArchived), {
    timeout: TIMEOUTS.navMedium,
  });
}

// ---- Row lookup ---------------------------------------------------------

export function findRowByName(page: Page, modelName: string): Locator {
  return page
    .getByRole("row", { name: new RegExp(`\\b${escapeRegExp(modelName)}\\b`) })
    .first();
}

export async function waitForRow(page: Page, modelName: string): Promise<Locator> {
  const row = findRowByName(page, modelName);
  await expect(row).toBeVisible({ timeout: TIMEOUTS.rowVisible });
  return row;
}

// ---- JS-dispatch clicks (bypass overlay interception) -------------------

// Kendo's expand-details icon and row checkbox are intermittently
// intercepted by tm-release-note / k-overlay / loader overlays that
// re-appear between the wipe and Playwright's actionability check. JS
// dispatch on the element bypasses pointer-events entirely. Row lookup
// is name-based (row.textContent includes modelName) with fallback to
// the checkbox-0 row when the search filter has already narrowed to a
// single result.
async function jsClickInRow(
  page: Page,
  modelName: string,
  selector: string,
): Promise<void> {
  await clearBlockingOverlays(page);
  const clicked = await page.evaluate(
    ({ sel, name }) => {
      const els = document.querySelectorAll(sel);
      for (const el of Array.from(els)) {
        const row = el.closest('[role="row"]') || el.closest("tr");
        if (row && (row.textContent || "").includes(name)) {
          (el as HTMLElement).click();
          return true;
        }
      }
      // Fallback: page-wide text contains the name AND the first row's
      // element exists -- typical when the search input has already
      // filtered to one match.
      const first = document.querySelector(sel) as HTMLElement | null;
      if (first && (document.body.innerText || "").includes(name)) {
        first.click();
        return true;
      }
      return false;
    },
    { sel: selector, name: modelName },
  );
  if (!clicked) {
    throw new Error(`Could not find "${selector}" for model "${modelName}"`);
  }
}

// ---- Create -------------------------------------------------------------

export async function createDisposableModel(
  page: Page,
  prefix: string,
): Promise<{ modelName: string }> {
  const modelName = `${prefix}-${Date.now()}`;
  await waitForLoaderIdle(page).catch(() => {});
  await clearBlockingOverlays(page);
  // Role-based selectors match the working project convention. Id-based
  // menu-trigger lookup would pick the collapsed icon variant, leaving
  // the menuitem CSS-hidden when we click it.
  await page.getByRole("button", { name: ROLES.buttons.createNewMenu }).click();
  await page.getByRole("menuitem", { name: new RegExp(ROLES.menuItems.threatModel) }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Create New Threat Model" });
  await expect(dialog).toBeVisible({ timeout: TIMEOUTS.elementVisible });

  await dialog.locator('input[placeholder="Enter Model Name"]').fill(modelName);
  await dialog.locator('input[placeholder="Enter Version"]').fill(TM_DATA.version.initial);

  const createBtn = page.locator("button#createSave_button");
  await expect(createBtn).toBeEnabled({ timeout: TIMEOUTS.buttonEnabled });
  // Overlays (tm-release-note / k-overlay) can re-appear between the
  // dialog mount and the submit click. Wipe again before clicking so
  // pointer events reach the button.
  await clearBlockingOverlays(page);
  await createBtn.click();

  await page.waitForURL(DIAGRAM_URL, { timeout: TIMEOUTS.navLong });
  await expect(page).toHaveTitle(new RegExp(TITLES.threatModelDiagram), {
    timeout: TIMEOUTS.navMedium,
  });
  return { modelName };
}

// ---- Archive ------------------------------------------------------------

export async function archiveModelByName(page: Page, modelName: string): Promise<void> {
  await clearBlockingOverlays(page);
  await waitForRow(page, modelName);
  // Dialog exposes its title as body text (no aria-label), so match
  // by text content rather than accessible name.
  const confirm = page
    .getByRole("dialog")
    .filter({ hasText: ROLES.dialogs.archiveThreatModel })
    .first();
  // Live-app path (verified 2026-08 against tmdev):
  //   1. Select a row via its per-row `input[aria-label="Select Row"]`
  //      (Kendo strips the id from row checkboxes; the header
  //      "Select All Name" is the only checkbox with an id and must
  //      not be the click target).
  //   2. Selection reveals a top-of-grid toolbar containing an
  //      `i[aria-label="Archive"]` icon (no navigation menu is
  //      involved — the old "Threat Model menu" click was wrong; it
  //      only opens the left sidebar submenu).
  //   3. Clicking the archive icon opens the confirm dialog.
  // The selection sometimes doesn't register in time for the archive
  // icon to mount, so retry the checkbox + icon-click cycle up to 3
  // times, wiping overlays between attempts.
  let dialogVisible = false;
  for (let attempt = 1; attempt <= 3 && !dialogVisible; attempt++) {
    await clearBlockingOverlays(page);
    await jsClickInRow(page, modelName, 'input[aria-label="Select Row"]');
    await page.waitForTimeout(500);
    await clearBlockingOverlays(page);
    // Wait for the archive icon to mount before dispatching the
    // click; if it never appears the selection didn't register, so
    // loop back and try again.
    const iconMounted = await page
      .waitForFunction(
        (sel) => !!document.querySelector(sel),
        SEL.archiveIcon,
        { timeout: TIMEOUTS.elementVisible },
      )
      .then(() => true)
      .catch(() => false);
    if (!iconMounted) continue;
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      el?.click();
    }, SEL.archiveIcon);
    dialogVisible = await confirm
      .isVisible({ timeout: TIMEOUTS.elementVisible })
      .catch(() => false);
  }
  await expect(confirm).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  // Remove the "Welcome to ThreatModeler Nexus" release-note dialog
  // if it stacked over the confirm — otherwise Playwright's actionability
  // check on the Archive button times out silently and clicks a stale
  // hidden node.
  await page.evaluate(() => {
    document.querySelectorAll("kendo-dialog, .k-dialog, .k-window").forEach((el) => {
      if (/Welcome to/i.test((el as HTMLElement).innerText || "")) el.remove();
    });
  });
  // Also JS-dispatch as a belt-and-braces fallback in case Angular's
  // click handler doesn't fire from Playwright's event.
  await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll("kendo-dialog, .k-dialog, .k-window"));
    const archiveDialog = dialogs.find((el) =>
      /Archive threat model/i.test((el as HTMLElement).innerText || ""),
    );
    if (archiveDialog) {
      const btn = Array.from(archiveDialog.querySelectorAll("button")).find(
        (b) => (b.textContent || "").trim().toLowerCase() === "archive",
      );
      (btn as HTMLElement | undefined)?.click();
    }
  });
  // Explicit short timeout so if the JS-dispatch already closed the
  // dialog, we don't sit waiting for the (now-gone) button up to the
  // test-level timeout.
  await confirm
    .getByRole("button", { name: ROLES.buttons.archive, exact: true })
    .click({ force: true, timeout: 3000 })
    .catch(() => {});
  await expect(confirm).toBeHidden({ timeout: TIMEOUTS.dialogHidden });
  await waitForLoaderIdle(page).catch(() => {});
  // The active grid doesn't always refetch after archive; force a
  // reload so the row-gone assertion sees the freshly filtered set.
  await gotoTMList(page);
  const search = page.locator(TM.selectors.searchInput).first();
  if (await search.isVisible({ timeout: TIMEOUTS.elementVisible }).catch(() => false)) {
    await search.fill(modelName);
    await page.waitForTimeout(1500);
  }
  await expect(page.getByRole("button", { name: modelName, exact: true })).toHaveCount(0, {
    timeout: TIMEOUTS.rowVisible,
  });
}

// ---- Restore ------------------------------------------------------------

export async function restoreModelByName(page: Page, modelName: string): Promise<void> {
  await gotoArchivedList(page);
  await clearBlockingOverlays(page);
  await waitForRow(page, modelName);
  await jsClickInRow(page, modelName, 'input[aria-label="Select Row"]');
  await clearBlockingOverlays(page);
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    el?.click();
  }, SEL.restoreIcon);
  // Kill any "Welcome to ThreatModeler Nexus" release-note dialog
  // that stacks over the confirm — same interceptor issue as archive.
  await page.evaluate(() => {
    document.querySelectorAll("kendo-dialog, .k-dialog, .k-window").forEach((el) => {
      if (/Welcome to/i.test((el as HTMLElement).innerText || "")) el.remove();
    });
  });
  const confirm = page.getByRole("dialog").first();
  if (await confirm.isVisible({ timeout: TIMEOUTS.elementVisible }).catch(() => false)) {
    const btn = confirm.getByRole("button", { name: /^(Yes|Restore)$/ }).first();
    if (await btn.isVisible().catch(() => false)) await btn.click();
  }
  await waitForLoaderIdle(page).catch(() => {});
  // Force a fresh archived-list fetch — the grid can hold stale state.
  await gotoArchivedList(page);
  const search = page.locator(TM.selectors.searchInput).first();
  if (await search.isVisible({ timeout: TIMEOUTS.elementVisible }).catch(() => false)) {
    await search.fill(modelName);
    await page.waitForTimeout(1500);
  }
  await expect(page.getByRole("button", { name: modelName, exact: true })).toHaveCount(0, {
    timeout: TIMEOUTS.rowVisible,
  });
}

// ---- Permanent delete ---------------------------------------------------

export async function permanentDeleteFromArchive(page: Page, modelName: string): Promise<void> {
  await gotoArchivedList(page);
  await clearBlockingOverlays(page);
  const search = page.locator(TM.selectors.searchInput).first();
  if (await search.isVisible({ timeout: TIMEOUTS.elementVisible }).catch(() => false)) {
    await search.fill(modelName);
    await page.waitForTimeout(1500);
  }
  const present = await page
    .getByRole("button", { name: modelName, exact: true })
    .first()
    .isVisible({ timeout: TIMEOUTS.elementVisible })
    .catch(() => false);
  if (!present) return;
  // The delete flow is flaky on this tenant: the JS-dispatched icon
  // click sometimes fires before the row checkbox has fully registered,
  // so the confirm dialog never appears. Retry the whole
  // checkbox-select + icon-dispatch cycle up to 3 times, wiping
  // overlays between attempts, before giving up.
  let dialogVisible = false;
  for (let attempt = 1; attempt <= 3 && !dialogVisible; attempt++) {
    await clearBlockingOverlays(page);
    await jsClickInRow(page, modelName, 'input[aria-label="Select Row"]');
    await page.waitForTimeout(500);
    await clearBlockingOverlays(page);
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      el?.click();
    }, SEL.deleteIcon);
    dialogVisible = await page
      .getByRole("dialog")
      .first()
      .isVisible({ timeout: TIMEOUTS.elementVisible })
      .catch(() => false);
  }
  const confirm = page.getByRole("dialog").first();
  await expect(confirm).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  // Kill the "Welcome to ThreatModeler Nexus" release-note dialog if
  // it stacked on top of the confirm and would swallow the click.
  await page.evaluate(() => {
    document.querySelectorAll("kendo-dialog, .k-dialog, .k-window").forEach((el) => {
      if (/Welcome to/i.test((el as HTMLElement).innerText || "")) el.remove();
    });
  });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await waitForLoaderIdle(page).catch(() => {});
}

export async function cleanupDisposableModel(page: Page, modelName: string): Promise<void> {
  await gotoTMList(page);
  const search = page.locator(TM.selectors.searchInput).first();
  if (await search.isVisible({ timeout: TIMEOUTS.elementVisible }).catch(() => false)) {
    await search.fill(modelName);
    await page.waitForTimeout(1500);
  }
  const stillActive = await page
    .getByRole("button", { name: modelName, exact: true })
    .first()
    .isVisible({ timeout: TIMEOUTS.elementVisible })
    .catch(() => false);
  if (stillActive) await archiveModelByName(page, modelName);
  await permanentDeleteFromArchive(page, modelName);
}

// ---- Edit inline -------------------------------------------------------

export async function editModelVersionInline(
  page: Page,
  modelName: string,
  newVersion: string,
): Promise<void> {
  await waitForRow(page, modelName);
  await jsClickInRow(page, modelName, 'i[id^="tour-expand-detail-"]');
  const versionField = page.getByRole("textbox", { name: ROLES.textboxes.versionField });
  await expect(versionField).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  await versionField.fill(newVersion);
  await clearBlockingOverlays(page);
  const saveBtn = page.getByRole("button", { name: ROLES.buttons.save, exact: true });
  await expect(saveBtn).toBeEnabled({ timeout: TIMEOUTS.buttonEnabled });
  await saveBtn.click();
  await expect(
    page
      .getByRole("row", {
        name: new RegExp(`${escapeRegExp(modelName)}\\s+${newVersion.replace(".", "\\.")}`),
      })
      .first(),
  ).toBeVisible({ timeout: TIMEOUTS.rowVisible });
}

// ---- Export download ---------------------------------------------------

export async function triggerExportDownload(
  page: Page,
  format: "excel" | "csv",
): Promise<{ filename: string }> {
  await clearBlockingOverlays(page);
  const optionId = format === "excel" ? TM.selectors.exportOptionExcel : TM.selectors.exportOptionCsv;
  const optionEl = page.locator(optionId).first();
  const alreadyOpen = await optionEl.isVisible({ timeout: 1000 }).catch(() => false);
  if (!alreadyOpen) {
    await page.locator(TM.selectors.exportDropdownTrigger).first().click();
    await expect(optionEl).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  }
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: TIMEOUTS.navLong }),
    optionEl.click(),
  ]);
  return { filename: download.suggestedFilename() };
}

// Expose jsClickInRow for spec-level use if needed for expand-details.
export async function jsClickRowExpandDetailsForModel(page: Page, modelName: string): Promise<void> {
  await jsClickInRow(page, modelName, 'i[id^="tour-expand-detail-"]');
}
