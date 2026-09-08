/**
 * Alternative to the live-view login: import cookies from a browser where you
 * are already signed in.
 *
 * You export your tiktok.com cookies to a local file, this injects them into a
 * Browserbase session, and `persist: true` writes them into the stored context
 * exactly as if you had logged in there by hand.
 *
 * Run this once, locally. The daily job stays entirely in the cloud.
 *
 * The cookie file is a live credential — it is your logged-in session. Keep it
 * out of git (`.secrets/` is ignored) and delete it once this succeeds. Nothing
 * here ever prints a cookie value.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Cookie } from "playwright-core";
import { client, openSession, replayUrl } from "./browserbase.js";
import { ConfigError, optionalEnv, paths, sleep } from "./config.js";
import { isLoggedIn } from "./tiktok.js";

/** Shape exported by the Cookie-Editor extension and most of its clones. */
type ExportedCookie = {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  expirationDate?: number;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

/** Cookies TikTok needs before it will treat the session as signed in. */
const REQUIRED = ["sessionid"];

function normaliseSameSite(value: string | undefined): "Strict" | "Lax" | "None" {
  switch ((value ?? "").toLowerCase()) {
    case "strict":
      return "Strict";
    case "none":
    case "no_restriction":
      return "None";
    default:
      // "unspecified", "lax", or missing. Lax is Chrome's own default.
      return "Lax";
  }
}

function toPlaywrightCookies(raw: unknown): Cookie[] {
  if (!Array.isArray(raw)) {
    throw new ConfigError(
      "Cookie file must be a JSON array. Export with Cookie-Editor's " +
        '"Export" → "JSON" while on tiktok.com.',
    );
  }

  const cookies: Cookie[] = [];
  for (const entry of raw as ExportedCookie[]) {
    if (typeof entry?.name !== "string" || typeof entry.value !== "string") continue;
    const domain = entry.domain ?? ".tiktok.com";
    if (!domain.includes("tiktok.com")) continue;

    // Session cookies have no expiry; Playwright wants -1 for those.
    const expires = entry.expirationDate ?? entry.expires ?? -1;

    cookies.push({
      name: entry.name,
      value: entry.value,
      domain,
      path: entry.path ?? "/",
      expires: Math.floor(expires),
      httpOnly: entry.httpOnly ?? false,
      secure: entry.secure ?? true,
      sameSite: normaliseSameSite(entry.sameSite),
    });
  }

  const names = new Set(cookies.map((c) => c.name));
  const missing = REQUIRED.filter((n) => !names.has(n));
  if (missing.length > 0) {
    throw new ConfigError(
      `Cookie file is missing: ${missing.join(", ")}.\n` +
        `"sessionid" is HttpOnly, so it will not appear if you exported via the JS console — ` +
        `use the Cookie-Editor extension (or DevTools → Application → Cookies) instead.`,
    );
  }

  return cookies;
}

async function main(): Promise<void> {
  const file = optionalEnv("COOKIE_FILE") ?? join(paths.root, ".secrets", "tiktok-cookies.json");

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error: unknown) {
    throw new ConfigError(
      `Could not read ${file}: ${error instanceof Error ? error.message : String(error)}\n` +
        `Create it, or point COOKIE_FILE somewhere else.`,
    );
  }

  const cookies = toPlaywrightCookies(raw);
  // Count only — never the values.
  console.log(`Loaded ${cookies.length} tiktok.com cookie(s), including: ${REQUIRED.join(", ")}`);

  const contextId = optionalEnv("BROWSERBASE_CONTEXT_ID");
  if (!contextId) throw new ConfigError("BROWSERBASE_CONTEXT_ID is not set — check your .env");

  const bb = client();
  const session = await openSession(bb, contextId, { timeoutSeconds: 180 });
  console.log(`Session ${session.id} — replay: ${replayUrl(session.id)}`);

  try {
    await session.context.addCookies(cookies);
    await session.page.goto("https://www.tiktok.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await sleep(4000);

    if (!(await isLoggedIn(session.page))) {
      throw new Error(
        "Cookies were injected but TikTok still does not consider the session logged in.\n" +
          "Most likely the export is stale or incomplete — re-export while actually signed in, " +
          "making sure you copy ALL tiktok.com cookies rather than just sessionid.",
      );
    }

    console.log("TikTok accepts the session. Loading the inbox to capture message cookies…");
    await session.page
      .goto("https://www.tiktok.com/messages", { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => undefined);
    await sleep(5000);

    const stillGood = await isLoggedIn(session.page);
    console.log(
      stillGood
        ? "\nDone. Cookies are saved in the Browserbase context — the daily job can run now.\nDelete your cookie file."
        : "\nWarning: the inbox bounced the session. The context was still saved; run a dry run to see how far it gets.",
    );
  } finally {
    // Graceful close is what flushes cookies into the stored context.
    await session.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`\n${error.message}`);
  } else {
    console.error(`\nImport failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
});
