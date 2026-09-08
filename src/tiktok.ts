import type { Page, Locator } from "playwright-core";
import { sleep } from "./config.js";

/**
 * Every TikTok-specific selector lives here. When TikTok ships a redesign this
 * is the only file that should need editing — add the new selector to the front
 * of the relevant list and leave the old ones as fallbacks.
 *
 * Lists are tried in order and the first *visible* match wins.
 *
 * VERIFIED entries were read off the live DOM on 2026-09-08 via Browserbase.
 * UNVERIFIED entries are inside the logged-in messages UI, which could not be
 * inspected without an authenticated session. Expect to tune those once after
 * the first real run — the artifacts/ dump on failure tells you what to use.
 *
 * Note the leading hyphen in "-message-button": TikTok builds these attributes
 * as `${prefix}-message-button` with an empty prefix on profile pages. The
 * `$=` suffix match is deliberate so a future non-empty prefix still matches.
 */
export const SELECTORS = {
  /** VERIFIED: an <a> (not a button) with data-e2e="-message-button", href=null. */
  messageButton: [
    '[data-e2e$="message-button"]',
    'a[data-e2e*="message"]',
    'button[aria-label="Message" i]',
    'button:has-text("Message")',
  ],
  /** UNVERIFIED: needs a logged-in session to confirm. */
  composer: [
    '[data-e2e="message-input-area"] div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    ".public-DraftEditor-content",
    'div[contenteditable="true"]',
  ],
  /** UNVERIFIED: fallback for when Enter inserts a newline instead of sending. */
  sendButton: [
    '[data-e2e$="message-send"]',
    'svg[data-e2e="message-send"]',
    'button[aria-label="Send" i]',
    'button:has-text("Send")',
  ],
  /**
   * VERIFIED: logged out, /messages 302s to
   * /login?lang=en&redirect_url=... so the URL check in assertNotBlocked
   * catches this before any of these selectors matter.
   */
  loginWall: [
    '[data-e2e="login-modal"]',
    "#login-modal",
    'div[id*="loginContainer"]',
    'button:has-text("Log in to TikTok")',
    'h1:has-text("Log in to TikTok")',
  ],
  /** UNVERIFIED: deliberately broad. Erring toward stopping is the safe failure. */
  captcha: [
    ".captcha_verify_container",
    "#captcha-verify-image",
    '[class*="captcha_verify"]',
    '[id^="captcha"]',
    "#tiktok-verify-ele",
  ],
  /** UNVERIFIED: two-factor / "confirm it's you" interstitials. */
  verification: [
    '[data-e2e="verify-modal"]',
    'div[class*="verification-code"]',
    'input[name="code"]',
    'h1:has-text("Verify your account")',
  ],
} as const;

export type BlockKind = "login" | "captcha" | "verification";

/**
 * Thrown when TikTok puts a human-in-the-loop wall in front of us. This is not
 * a bug to work around — it is the signal to stop the run and tell the owner.
 */
export class BlockedError extends Error {
  constructor(
    readonly kind: BlockKind,
    readonly url: string,
  ) {
    super(`TikTok requires manual action (${kind}) at ${url}`);
    this.name = "BlockedError";
  }
}

/** Thrown when the page loaded fine but we could not find something we need. */
export class SelectorError extends Error {
  constructor(what: string, tried: readonly string[], url: string) {
    super(
      `Could not find ${what} at ${url}.\n` +
        `Tried:\n${tried.map((s) => `  - ${s}`).join("\n")}\n` +
        `TikTok's markup has probably changed — add a working selector to SELECTORS.${what} in src/tiktok.ts.`,
    );
    this.name = "SelectorError";
  }
}

async function firstVisible(page: Page, selectors: readonly string[], timeoutMs = 8000): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    await sleep(250);
  } while (Date.now() < deadline);
  return null;
}

async function anyVisible(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
  }
  return false;
}

/**
 * Bails out if TikTok is asking for a login, a CAPTCHA, or a verification code.
 * Called after every navigation — we would rather stop early than keep poking
 * at a page that is actively asking us to prove we are a person.
 */
export async function assertNotBlocked(page: Page): Promise<void> {
  const url = page.url();

  if (/\/(login|signup)\b/.test(url)) throw new BlockedError("login", url);
  if (await anyVisible(page, SELECTORS.captcha)) throw new BlockedError("captcha", url);
  if (await anyVisible(page, SELECTORS.verification)) throw new BlockedError("verification", url);
  if (await anyVisible(page, SELECTORS.loginWall)) throw new BlockedError("login", url);
}

/**
 * Cookie-based login check. More reliable than looking for an avatar element,
 * and it does not break when TikTok reshuffles its header.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies("https://www.tiktok.com");
  return cookies.some((c) => c.name === "sessionid" && c.value.length > 0);
}

export async function assertLoggedIn(page: Page): Promise<void> {
  await page.goto("https://www.tiktok.com/messages", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await sleep(2000);
  await assertNotBlocked(page);
  if (!(await isLoggedIn(page))) {
    throw new BlockedError("login", page.url());
  }
}

/**
 * Opens the DM thread for a friend by going to their profile and clicking
 * "Message". Username-based rather than relying on TikTok's numeric user IDs,
 * which we would otherwise have to scrape and cache.
 */
export async function openThread(page: Page, username: string): Promise<void> {
  await page.goto(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await sleep(2500);
  await assertNotBlocked(page);

  const button = await firstVisible(page, SELECTORS.messageButton, 15_000);
  if (!button) throw new SelectorError("messageButton", SELECTORS.messageButton, page.url());

  await button.click();
  await page.waitForURL(/\/messages/, { timeout: 30_000 });
  await sleep(2500);
  await assertNotBlocked(page);
}

async function composerText(composer: Locator): Promise<string> {
  return (await composer.innerText().catch(() => "")).trim();
}

/**
 * Types `text` into the open thread and sends it, then verifies it actually
 * landed. Returns only once the message is confirmed in the transcript — a
 * silent no-op would quietly break the streak we are here to protect.
 */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const composer = await firstVisible(page, SELECTORS.composer, 15_000);
  if (!composer) throw new SelectorError("composer", SELECTORS.composer, page.url());

  const before = await page.getByText(text, { exact: true }).count();

  await composer.click();
  await sleep(300);

  // insertText handles emoji and other astral-plane characters that
  // keyboard.type() mangles; fall back to typing if the editor ignores it.
  await page.keyboard.insertText(text);
  await sleep(500);
  if (!(await composerText(composer)).includes(text)) {
    await page.keyboard.type(text, { delay: 60 });
    await sleep(500);
  }
  if (!(await composerText(composer)).includes(text)) {
    throw new Error(`Composer stayed empty after typing — TikTok's message input did not accept "${text}"`);
  }

  await page.keyboard.press("Enter");

  // Confirm by counting occurrences rather than matching a bubble selector, so
  // this keeps working across TikTok's chat-UI reshuffles.
  if (await confirmSent(page, composer, text, before, 10_000)) return;

  // Enter may have inserted a newline rather than sending. Try the send button
  // before giving up — a silently unsent message breaks the streak we exist to
  // protect, so it is worth the second attempt.
  const send = await firstVisible(page, SELECTORS.sendButton, 3000);
  if (send) {
    await send.click();
    if (await confirmSent(page, composer, text, before, 15_000)) return;
  }

  await assertNotBlocked(page);
  throw new Error(
    `Typed "${text}" but could not confirm it was sent. ` +
      `Enter did not submit and no send button matched SELECTORS.sendButton. ` +
      `Check the screenshot in artifacts/ and update src/tiktok.ts.`,
  );
}

/**
 * Resolves true once the composer has cleared AND a new copy of `text` exists.
 *
 * `baseline` must be the count taken *before* typing. Both halves matter: a
 * cleared composer alone can mean the text was discarded, and a higher count
 * alone can mean the text is still sitting in the composer unsent.
 */
async function confirmSent(
  page: Page,
  composer: Locator,
  text: string,
  baseline: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(750);
    const cleared = (await composerText(composer)) === "";
    const after = await page.getByText(text, { exact: true }).count();
    if (cleared && after > baseline) return true;
  }
  return false;
}
