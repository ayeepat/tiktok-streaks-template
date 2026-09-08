/**
 * How you log in: import cookies from a browser you are already signed into.
 *
 * Your export gets injected into a Browserbase session, and `persist: true`
 * writes it into the stored context exactly as if you had logged in there by
 * hand. Run once; the daily job reuses it.
 *
 * Two ways in, both fine:
 *   - GitHub Actions, via the TIKTOK_COOKIES secret (no terminal needed)
 *   - Locally, via .secrets/tiktok-cookies.json
 *
 * Either way those cookies are a live credential — they ARE your logged-in
 * session, and anyone holding them is you. Never paste them into a chatbot, a
 * pastebin, or anywhere other than GitHub's encrypted secret store. Nothing in
 * this file ever prints a cookie value.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Cookie } from "playwright-core";
import { client, createContext, openSession, replayUrl } from "./browserbase.js";
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

/**
 * Cookies come from the TIKTOK_COOKIES secret when running in GitHub Actions,
 * or from a local file when running on your own machine.
 *
 * The secret path exists so the whole setup can be done in a browser: you paste
 * the export into GitHub's encrypted secret store and a workflow does the rest.
 * Nothing has to be typed into a terminal, and — importantly — the cookies never
 * have to be shown to a chatbot or any other third party.
 */
function readCookieSource(): { raw: unknown; from: string } {
  const fromEnv = optionalEnv("TIKTOK_COOKIES");
  if (fromEnv) {
    try {
      return { raw: JSON.parse(fromEnv), from: "the TIKTOK_COOKIES secret" };
    } catch (error: unknown) {
      throw new ConfigError(
        `TIKTOK_COOKIES is not valid JSON: ${error instanceof Error ? error.message : String(error)}\n` +
          `Re-copy it with Cookie-Editor's Export -> JSON and paste the whole thing, [ brackets included ].`,
      );
    }
  }

  const file = optionalEnv("COOKIE_FILE") ?? join(paths.root, ".secrets", "tiktok-cookies.json");
  try {
    return { raw: JSON.parse(readFileSync(file, "utf8")), from: file };
  } catch (error: unknown) {
    throw new ConfigError(
      `No cookies found.\n` +
        `  In GitHub Actions: set the TIKTOK_COOKIES secret.\n` +
        `  Locally: save your export to ${file}\n` +
        `  (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

async function main(): Promise<void> {
  const { raw, from } = readCookieSource();
  console.log(`Reading cookies from ${from}`);

  const cookies = toPlaywrightCookies(raw);
  // Count only — never the values.
  console.log(`Loaded ${cookies.length} tiktok.com cookie(s), including: ${REQUIRED.join(", ")}`);

  const bb = client();

  // First time through there is no context yet, so make one and print it very
  // loudly — saving it is the step people forget, and without it the login is
  // orphaned and has to be done again.
  let contextId = optionalEnv("BROWSERBASE_CONTEXT_ID");
  let created = false;
  if (!contextId) {
    contextId = await createContext(bb);
    created = true;
    const line = "=".repeat(64);
    console.log(`\n${line}`);
    console.log("  SAVE THIS AS A SECRET NAMED  BROWSERBASE_CONTEXT_ID");
    console.log("");
    console.log(`      ${contextId}`);
    console.log("");
    console.log("  GitHub: Settings -> Secrets and variables -> Actions");
    console.log("  Without it, this login is lost and you start over.");
    console.log(`${line}\n`);
  }
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
        ? "\nDone. Cookies are saved in the Browserbase context — the daily job can run now."
        : "\nWarning: the inbox bounced the session. The context was still saved; run a dry run to see how far it gets.",
    );
    if (created) {
      console.log(`\nDo not skip this: save BROWSERBASE_CONTEXT_ID = ${contextId}`);
    }
    if (from.startsWith("/")) {
      console.log("Now delete your local cookie file — it is a live credential.");
    }
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
