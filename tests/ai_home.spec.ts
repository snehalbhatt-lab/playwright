import { test, expect, type Page, type TestInfo } from "@playwright/test";
import testdata from "./data/testdata.json";
import {
  BASE_URL,
  PATHS,
  ROLES,
  TIMEOUTS,
  USERNAME,
  PASSWORD,
  capture,
  clearBlockingOverlays,
  dismissPostLoginOverlays,
} from "./lib/helpers";

// =============================================================================
// AI Home (/ai-home) suite
//
// Target screen: ThreatModeler Nexus "AI Home" — the post-login AI composer
// landing with a Chats side panel and a conversation composer. Structural,
// non-destructive coverage: no AI query is sent, no chat is created, no
// snooze/account preference is persisted.
//
// Live probe evidence (2026-10-08):
//   - URL: /ai-home ; title "AI Home | ThreatModeler Nexus"
//   - Page heading h1 "Home" ; conversation heading h1 "How can I help you,
//     {firstName}?" (personalised with the signed-in user's first name)
//   - Composer: `textarea#textarea-landing` with placeholder
//     "Create a threat model, widget — or search threat models";
//     `button[aria-label="Open the composer menu"]` (aria-haspopup=menu,
//     opens a 2-item menu: "Add files/image" and "Connectors");
//     `button#wingman-mic-button` (aria "Start voice input");
//     `button[aria-label="Send"]` disabled when textarea is empty, enabled
//     after typing. Footer note[role=note] "AI can make mistakes, please
//     double check responses."
//   - Chats aside[aria-label="Chats"]: brand text "Chats",
//     `button[aria-label="Search chats"]` opens a modal
//     dialog[aria-label="Search chats"] with an input (placeholder
//     "Search...") and a Close button; `button[aria-label="Collapse panel"]`
//     unmounts the aside and reveals `button[aria-label="Expand panel"]`
//     which restores it; `.nexus-new-chat` "New chat" CTA; "Recent chats"
//     heading with "No recent chats yet." empty state for the sbhatt
//     account.
// =============================================================================

const AI = testdata.aiHome;
const SEL = AI.selectors;
const EXP = AI.expected;

async function step(page: Page, info: TestInfo, idx: number, name: string): Promise<void> {
  const padded = String(idx).padStart(2, "0");
  await capture(page, info, `${padded}-${name}`);
}

// The shared `login` helper in lib/helpers.ts hardcodes `/threatmodels` as
// the post-sign-in landing URL. On this tenant /ai-home has become the
// default landing surface, and sign-in redirected from `/` lands on
// /ai-home — so waiting for /threatmodels times out. Instead, drive the
// login flow directly against /ai-home: the ReturnUrl on the login challenge
// carries us back to /ai-home after submit.
async function loginAndGotoAiHome(page: Page): Promise<void> {
  await page.context().clearCookies().catch(() => {});
  await page
    .evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
    })
    .catch(() => {});

  const aiHomeUrlPattern = new RegExp(PATHS.aiHome.replace(/\//g, "\\/") + "(\\?|$|\\/)");
  const loginUrlPattern = new RegExp(PATHS.login.replace(/\//g, "\\/"), "i");

  await page.goto(BASE_URL + PATHS.aiHome);
  // Could land on login OR directly on /ai-home if a cookie survived.
  await page.waitForURL(new RegExp(`(${loginUrlPattern.source}|${aiHomeUrlPattern.source})`), {
    timeout: TIMEOUTS.navMedium,
  });

  if (loginUrlPattern.test(page.url())) {
    // Remove the takeover overlay that intermittently swallows clicks on
    // the username field (same mitigation as the shared login helper).
    await page.evaluate(() =>
      document.querySelectorAll("#tm-takeover-root").forEach((el) => el.remove()),
    );
    const username = page.getByRole("textbox", { name: ROLES.textboxes.username });
    const password = page.getByRole("textbox", { name: ROLES.textboxes.password });
    await expect(username).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await username.pressSequentially(USERNAME, { delay: TIMEOUTS.typingDelaySlow });
    await password.pressSequentially(PASSWORD, { delay: TIMEOUTS.typingDelaySlow });
    await Promise.all([
      page.waitForURL(aiHomeUrlPattern, { timeout: TIMEOUTS.navLong }),
      page.getByRole("button", { name: ROLES.buttons.signIn }).click(),
    ]);
  }

  await expect(page).toHaveTitle(new RegExp(testdata.titles.aiHome), {
    timeout: TIMEOUTS.navLong,
  });
  await dismissPostLoginOverlays(page);
  await clearBlockingOverlays(page);
  // Wipe any guided-tour masks that would intercept clicks on composer / chat
  // controls (the tour mechanic is covered by onboarding_tour.spec.ts).
  await page.evaluate(() => {
    document
      .querySelectorAll(".guided-tour-user-input-mask, .guided-tour-spotlight-overlay, ngx-guided-tour, .tour-step")
      .forEach((e) => e.remove());
  });
}

test.describe("AI Home (/ai-home)", () => {
  test.beforeEach(async () => {
    test.setTimeout(TIMEOUTS.test);
  });

  // --------------------------------------------------------------------------
  test("T1 /ai-home loads with page heading, personalised greeting, and disclaimer note", async ({
    page,
  }, info) => {
    await loginAndGotoAiHome(page);
    await step(page, info, 1, "ai-home-loaded");

    await expect(page.locator(SEL.pageHeading).first(), "page h1 'Home'").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });

    const conversation = page.locator(SEL.aiConversation);
    await expect(conversation, "AI conversation main region").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });

    const greeting = page.locator(SEL.greetingHeading).first();
    await expect(greeting, "greeting heading mounted").toBeVisible();
    const greetingText = (await greeting.textContent())?.trim() || "";
    // Personalised: "How can I help you, {firstName}?" — assert the prefix,
    // not the specific name, so this stays stable across sign-in identities.
    expect(greetingText, "greeting starts with the expected prefix").toContain(EXP.greetingPrefix);
    expect(greetingText.length, "greeting includes a name after the prefix").toBeGreaterThan(
      EXP.greetingPrefix.length + 1,
    );

    const note = page.locator(SEL.disclaimerNote).first();
    await expect(note, "disclaimer note mounted").toBeVisible();
    await expect(note).toHaveText(EXP.disclaimerText);
    await step(page, info, 2, "heading-greeting-note-verified");
  });

  // --------------------------------------------------------------------------
  test("T2 composer renders textarea + mic + composer-menu + disabled Send; Send enables after typing", async ({
    page,
  }, info) => {
    await loginAndGotoAiHome(page);

    const textarea = page.locator(SEL.textarea);
    await expect(textarea, "composer textarea mounted").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(textarea).toHaveAttribute("placeholder", EXP.textareaPlaceholder);

    const composerBtn = page.locator(SEL.composerBtn);
    await expect(composerBtn, "composer menu trigger present").toBeVisible();
    await expect(composerBtn).toHaveAttribute("aria-haspopup", "menu");

    const voice = page.locator(SEL.voiceBtn);
    await expect(voice, "mic button present").toBeVisible();

    const send = page.locator(SEL.sendBtn);
    await expect(send, "Send button present").toBeVisible();
    await expect(send, "Send disabled when textarea is empty").toBeDisabled();
    await step(page, info, 1, "composer-structure-verified");

    // Typing should enable Send (R-style enablement contract).
    await textarea.fill("Hello");
    await expect(send, "Send enables after text is entered").toBeEnabled({
      timeout: TIMEOUTS.buttonEnabled,
    });
    await step(page, info, 2, "send-enabled-after-type");

    // Clear so the tenant is left in a clean state (no accidental submit).
    await textarea.fill("");
    await expect(send, "Send disabled again after clearing").toBeDisabled({
      timeout: TIMEOUTS.buttonEnabled,
    });
    await step(page, info, 3, "send-redisabled-after-clear");
  });

  // --------------------------------------------------------------------------
  test("T3 composer menu opens with Add files/image + Connectors options and closes on Escape", async ({
    page,
  }, info) => {
    await loginAndGotoAiHome(page);

    const composerBtn = page.locator(SEL.composerBtn);
    await expect(composerBtn).toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await composerBtn.click();
    await step(page, info, 1, "composer-menu-opened");

    await expect(composerBtn, "composer button marked expanded").toHaveAttribute(
      "aria-expanded",
      "true",
      { timeout: TIMEOUTS.elementVisible },
    );
    const items = page.locator(SEL.composerMenuItem);
    await expect(items, "composer menu exposes 2 items").toHaveCount(2, {
      timeout: TIMEOUTS.elementVisible,
    });
    for (const label of EXP.composerMenuItemLabels) {
      await expect(
        items.filter({ hasText: label }).first(),
        `menu item "${label}" present`,
      ).toBeVisible();
    }
    await step(page, info, 2, "composer-items-verified");

    await page.keyboard.press("Escape");
    await expect(composerBtn, "composer button collapses after Escape").toHaveAttribute(
      "aria-expanded",
      "false",
      { timeout: TIMEOUTS.elementVisible },
    );
    await step(page, info, 3, "composer-menu-closed");
  });

  // --------------------------------------------------------------------------
  test("T4 Chats sidebar renders with New chat + Recent chats empty state; Search chats dialog opens and closes", async ({
    page,
  }, info) => {
    await loginAndGotoAiHome(page);

    const chats = page.locator(SEL.chatsPanel);
    await expect(chats, "Chats aside mounted").toBeVisible({ timeout: TIMEOUTS.elementVisible });
    await expect(page.locator(SEL.chatsBrandText)).toHaveText(EXP.chatsTitleText);
    await expect(page.locator(SEL.newChatBtn), "New chat CTA visible").toBeVisible();
    await expect(page.locator(SEL.newChatBtn)).toContainText(EXP.newChatText);
    await expect(page.locator(SEL.recentChatsHeading)).toHaveText(EXP.recentChatsText);
    // The sbhatt tenant account has no chats seeded, so the empty-state copy
    // should surface. The element renders a "Loading…" placeholder first, so
    // wait past that transient state before asserting the final empty copy.
    await expect(page.locator(SEL.chatsEmpty)).toHaveText(EXP.chatsEmptyText, {
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 1, "chats-sidebar-structure");

    // Search chats → dialog opens with input + close button.
    await page.locator(SEL.searchChatsBtn).click();
    const dialog = page.locator(SEL.searchDialog);
    await expect(dialog, "Search chats dialog opens").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    const searchInput = page.locator(SEL.searchDialogInput);
    await expect(searchInput, "search input in dialog").toBeVisible();
    await expect(searchInput).toHaveAttribute("placeholder", EXP.searchInputPlaceholder);
    await expect(page.locator(SEL.searchDialogEmpty)).toHaveText(EXP.chatsEmptyText, {
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 2, "search-chats-dialog-open");

    await page.locator(SEL.searchDialogClose).click();
    await expect(dialog, "search chats dialog closes").toBeHidden({
      timeout: TIMEOUTS.dialogHidden,
    });
    await step(page, info, 3, "search-chats-dialog-closed");
  });

  // --------------------------------------------------------------------------
  test("T5 Collapse / Expand toggle hides and restores the Chats panel", async ({
    page,
  }, info) => {
    await loginAndGotoAiHome(page);

    const chats = page.locator(SEL.chatsPanel);
    await expect(chats, "Chats aside initially visible").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await page.locator(SEL.collapseBtn).click();
    // After collapse the aside is unmounted (not just hidden) and an
    // "Expand panel" button appears in its place.
    await expect(chats, "Chats aside unmounts after collapse").toHaveCount(0, {
      timeout: TIMEOUTS.elementVisible,
    });
    const expandBtn = page.locator(SEL.expandBtn);
    await expect(expandBtn, "Expand panel button appears").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 1, "chats-collapsed");

    await expandBtn.click();
    await expect(chats, "Chats aside re-mounts after expand").toBeVisible({
      timeout: TIMEOUTS.elementVisible,
    });
    await step(page, info, 2, "chats-restored");
  });
});
