import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import { BASE_URL, TIMEOUTS, login, capture } from "./lib/helpers";

// =============================================================================
// Access Management sheet suite
//
// Source: excel/ThreatModeler Test Cases 7.x (till 7.4.1).xlsx, sheet
// "Access Management". 264 real cases in 12 modules. Merged into 9 tests
// covering ~40 UI-observable cases on the 4-tab layout live on tmdev;
// ~220 rows skipped with reason.
//
// Live-vs-Excel drift (significant on this sheet — follow the live app):
//   - Access Management is now a 4-tab layout (Departments / Users / Groups /
//     Roles & Permissions), not the multi-panel single view the Excel assumes.
//   - The URL is /user-management (Excel refers to it as "Access Management").
//   - The top-nav "Create new menu" no longer exposes Dept/Users/Groups on
//     this screen — it only offers "Threat Model". Create controls appear to
//     be inside individual tabs when the signed-in user has Enterprise Admin
//     permissions; sbhatt does not, so the Create/Add controls the Excel
//     assumes are not present and cannot be exercised.
//   - The Users tab exposes Department + Status (Active/Inactive/All) filters
//     via kendo dropdowns (`#users-departmentfilter-dropdown`,
//     `#users-statusfilter-dropdown`).
//   - Groups grid has `#groups-search-input` and per-row
//     `#groups-groupdetail{n}-button` ids.
//   - Roles & Permissions grid uses `#roles-typefilter-dropdown`.
//
// Skipped (documented):
//   - All destructive CUD flows (~120 cases): create/edit/delete department/
//     user/group; transfer threat model ownership; deactivate users; move
//     users; license upload/transfer.
//   - CSV import/export flows (R267-R290, 23 cases): file upload — excluded
//     per prompt (and gated by permission that sbhatt doesn't have).
//   - Role-specific permission tests (~81 cases across 4 role modules):
//     Manager RO / RO+Approver at Dept and Enterprise levels. Would need
//     dedicated fixture accounts with those exact role combos.
//   - Contributor role permission effects (R094-R111, 18 cases): destructive
//     role changes propagating across many screens.
//   - Library visibility across screens (R023-R027, R032, 6 cases): needs
//     controlled data setup and cross-screen navigation.
//
// All selectors/data live in testdata.accessManagement.*.
// =============================================================================

const AM = testdata.accessManagement;
const SEL = AM.selectors;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

function caseIds(info: TestInfo, ...ids: string[]): void {
  for (const id of ids) info.annotations.push({ type: "case", description: id });
}

async function gotoAccessManagement(page: Page): Promise<void> {
  await login(page);
  await page.goto(BASE_URL + AM.path);
  await expect(page).toHaveTitle(new RegExp(AM.titles.landing + "|" + AM.titles.departments), {
    timeout: TIMEOUTS.navMedium,
  });
  await expect(page.locator(SEL.mainContainer)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
}

async function selectTab(page: Page, name: string): Promise<void> {
  const tab = page.locator(SEL.tabRole).filter({ hasText: name }).first();
  await expect(tab).toBeVisible({ timeout: TIMEOUTS.elementVisible });
  if ((await tab.getAttribute("aria-selected")) !== "true") {
    await tab.click();
    await expect(tab, `tab ${name} must become selected`).toHaveAttribute("aria-selected", "true", {
      timeout: TIMEOUTS.elementVisible,
    });
  }
}

async function gridHeaderTexts(page: Page): Promise<string[]> {
  return (await page.locator(SEL.mainContainer).locator(SEL.gridHeader).allInnerTexts()).map((t) => t.trim());
}

test.describe("Access Management", () => {
  test.setTimeout(TIMEOUTS.test);

  // --------------------------------------------------------------------------
  test("R006 - navigate to Access Management and land on the correct URL + title", async ({ page }, info) => {
    caseIds(info, "C110849", "R006");
    await gotoAccessManagement(page);
    expect(page.url()).toContain(AM.path);
    await step(page, info, 1, "landed-on-access-management");
  });

  // --------------------------------------------------------------------------
  test("R008 (partial) - all 4 tabs mount with entity counts", async ({ page }, info) => {
    caseIds(info, "C110850", "R008");
    await gotoAccessManagement(page);
    for (const name of [AM.tabs.departments, AM.tabs.users, AM.tabs.groups, AM.tabs.roles]) {
      const tab = page.locator(SEL.tabRole).filter({ hasText: name }).first();
      await expect(tab, `tab ${name} must be visible`).toBeVisible({ timeout: TIMEOUTS.elementVisible });
      // Tab text carries an entity count: "Departments\n179".
      const text = (await tab.innerText()).replace(/\s+/g, " ").trim();
      expect(text, `${name} tab should carry a count`).toMatch(/\d+/);
    }
    await step(page, info, 1, "tabs-with-counts-verified");
  });

  // --------------------------------------------------------------------------
  test("R008 R073-R076 (partial) - each tab activates and updates the browser title", async ({ page }, info) => {
    caseIds(info, "C110851", "R008", "R073", "R074", "R075", "R076");
    await gotoAccessManagement(page);
    // Live drift: on first mount the Departments tab is already selected and
    // the title remains "Access Management | ...". The title switches to the
    // per-tab wording only after navigating away and back. Visit Users first,
    // then verify each tab activates and its browser title updates.
    const cases: Array<{ name: string; titleKey: keyof typeof AM.titles }> = [
      { name: AM.tabs.users, titleKey: "users" },
      { name: AM.tabs.groups, titleKey: "groups" },
      { name: AM.tabs.roles, titleKey: "roles" },
      { name: AM.tabs.departments, titleKey: "departments" },
    ];
    let stepIdx = 0;
    for (const c of cases) {
      await selectTab(page, c.name);
      await expect(page, `${c.name} tab title`).toHaveTitle(new RegExp(AM.titles[c.titleKey]), {
        timeout: TIMEOUTS.navMedium,
      });
      stepIdx += 1;
      await step(page, info, stepIdx, `${c.name.toLowerCase().replace(/[^a-z]+/g, "_")}-tab-active`);
    }
  });

  // --------------------------------------------------------------------------
  test("R008 R010 R017 R018 - Departments tab: grid columns + search + pagination", async ({ page }, info) => {
    caseIds(info, "C110852", "R008", "R010", "R011", "R012", "R015", "R016", "R017", "R018", "R019", "R020");
    await gotoAccessManagement(page);
    await selectTab(page, AM.tabs.departments);
    const headers = await gridHeaderTexts(page);
    for (const col of AM.expected.departmentsColumns) {
      expect(headers, `Departments grid missing column: ${col}`).toContain(col);
    }
    // Search wrapper is a <kendo-textbox> — target its inner <input>.
    const searchInput = page.locator(SEL.searchInput + " input").first();
    await expect(searchInput).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await searchInput.fill("Corp");
    await expect(searchInput).toHaveValue("Corp");
    await step(page, info, 1, "departments-search-echoed");
    await searchInput.fill("");
    // Pagination — Departments has 179 rows so multiple pages.
    await expect(page.locator(SEL.pageNumberButton).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 2, "departments-pagination-visible");
  });

  // --------------------------------------------------------------------------
  test("R083 R084 - Users tab: Department + Status filter dropdowns mount with expected columns", async ({ page }, info) => {
    caseIds(info, "C110853", "R083", "R084", "R085", "R086", "R087");
    await gotoAccessManagement(page);
    await selectTab(page, AM.tabs.users);
    const headers = await gridHeaderTexts(page);
    for (const col of AM.expected.usersColumns) {
      expect(headers, `Users grid missing column: ${col}`).toContain(col);
    }
    await expect(page.locator(SEL.users.departmentFilter)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(page.locator(SEL.users.statusFilter)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "users-filters-mounted");
  });

  // --------------------------------------------------------------------------
  test("R085 R086 R087 - Users tab: Status filter defaults to Active and exposes Inactive / All options", async ({ page }, info) => {
    caseIds(info, "C110854", "R085", "R086", "R087");
    await gotoAccessManagement(page);
    await selectTab(page, AM.tabs.users);
    const statusFilter = page.locator(SEL.users.statusFilter);
    await expect(statusFilter).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    // The kendo-dropdown-list surfaces its current selection as innerText.
    const current = (await statusFilter.innerText()).trim();
    expect(current, "Status default").toBe("Active");
    await statusFilter.click();
    // The popup portal renders k-list items. Ensure Active/Inactive/All appear.
    for (const opt of ["Active", "Inactive", "All"]) {
      await expect(page.locator(".k-animation-container .k-list-item, kendo-popup .k-list-item").filter({ hasText: opt }).first(), `option ${opt}`).toBeVisible({
        timeout: TIMEOUTS.elementVisible,
      });
    }
    await step(page, info, 1, "status-filter-options-verified");
    // Close popup without changing (avoid tenant-wide impact if a listener reacts).
    await page.keyboard.press("Escape");
  });

  // --------------------------------------------------------------------------
  test("R065 R066 - Groups tab: grid columns + search + department filter + at least one row", async ({ page }, info) => {
    caseIds(info, "C110855", "R065", "R066", "R067", "R068", "R069", "R071");
    await gotoAccessManagement(page);
    await selectTab(page, AM.tabs.groups);
    const headers = await gridHeaderTexts(page);
    for (const col of AM.expected.groupsColumns) {
      expect(headers, `Groups grid missing column: ${col}`).toContain(col);
    }
    await expect(page.locator(SEL.groups.searchInput).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(page.locator(SEL.groups.departmentFilter)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    // At least one group row.
    await expect(page.locator(SEL.groups.groupRowTemplate).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "groups-grid-verified");
  });

  // --------------------------------------------------------------------------
  test("Roles & Permissions tab: search + type filter mount", async ({ page }, info) => {
    caseIds(info, "C110856"); // no direct Excel case IDs — a sanity check for the 4th tab
    await gotoAccessManagement(page);
    await selectTab(page, AM.tabs.roles);
    await expect(page.locator(SEL.searchInput).first()).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(page.locator(SEL.roles.typeFilter)).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await step(page, info, 1, "roles-controls-verified");
  });

  // --------------------------------------------------------------------------
  test("R248 R250 (partial permission-gate) - Create/Add controls are absent for non-Enterprise-Admin sbhatt", async ({ page }, info) => {
    caseIds(info, "C110857", "R248", "R250");
    await gotoAccessManagement(page);
    // On this tenant sbhatt lacks Enterprise Admin — the top-nav "Create new"
    // menu on this screen offers only "Threat Model", never Dept/User/Group.
    // Assert no visible "New Department" / "New User" / "New Group" button
    // exists inside the Access Management surface.
    for (const label of ["New Department", "Create Department", "Add Department", "New User", "Create User", "New Group", "Create Group"]) {
      const count = await page.locator(SEL.mainContainer).getByRole("button", { name: label }).count();
      expect(count, `expected no "${label}" button for role sbhatt`).toBe(0);
    }
    await step(page, info, 1, "permission-gated-controls-absent");
  });
});

// =============================================================================
// Coverage summary for the Access Management sheet
//
//   Raw rows in sheet         : 264 (blank + Jira-link rows excluded)
//   In-scope UI-observable    : ~40
//   Merged into                : 9 tests
//   Skipped (documented)      : ~220
//     - All destructive CUD flows on the shared tenant (create/edit/delete
//       departments/users/groups, transfer model ownership, deactivate users,
//       license transfers)
//     - CSV import/export (23 cases): file upload
//     - Role-specific permission tests (~81 cases): need fixture accounts
//     - Contributor role behavior across many screens (R094-R111): destructive
//     - Library visibility cross-screen (R023-R027, R032): needs data setup
//
//   Live operations verified in the browser during authoring:
//     * Access Management landing page + URL (R006)
//     * 4 tabs mount with entity counts (R008)
//     * Each tab activates and updates browser title (R008, R073-R076 partial)
//     * Departments tab: 4-column grid + search + pagination (R008-R020)
//     * Users tab: 5-column grid + Department + Status filter dropdowns (R083-R087)
//     * Users Status filter: Active default, Active/Inactive/All options (R085-R087)
//     * Groups tab: 3-column grid + search + department filter + rows (R065-R071)
//     * Roles & Permissions tab: search + type filter mount
//     * Permission-gate: Create/Add controls absent for non-Enterprise-Admin (R248, R250)
// =============================================================================
