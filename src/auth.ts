/**
 * One-time TikTok login.
 *
 * We never handle the password. This opens a remote browser bound to the
 * persistent Browserbase context, prints an interactive live-view URL, and
 * waits for a human to log in by hand. Once TikTok issues a session cookie we
 * close the browser cleanly, which flushes it into the stored context so every
 * later `npm run send` starts already logged in.
 */
import { client, createContext, openSession, liveViewUrl, replayUrl } from "./browserbase.js";
import { ConfigError, optionalEnv, sleep } from "./config.js";
import { assertNotBlocked, isLoggedIn } from "./tiktok.js";

/**
 * Playwright reports a dead remote browser as "Target page, context or browser
 * has been closed", which tells you nothing about why. Translate it into
 * something that names the actual cause.
 */
function rethrowIfClosed(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/has been closed/i.test(message)) {
    throw new Error(
      "The remote browser closed before login finished. Usually the Browserbase " +
        "session hit its timeout — raise timeout_minutes when running the workflow, " +
        "or check the session replay for what happened.",
    );
  }
  throw error instanceof Error ? error : new Error(message);
}

function banner(lines: string[]): void {
  const width = Math.max(...lines.map((l) => [...l].length));
  console.log(`\n${"=".repeat(width)}`);
  for (const line of lines) console.log(line);
  console.log(`${"=".repeat(width)}\n`);
}

async function main(): Promise<void> {
  const timeoutMinutes = Number(optionalEnv("AUTH_TIMEOUT_MINUTES") ?? 10);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    throw new Error("AUTH_TIMEOUT_MINUTES must be a positive number");
  }

  const bb = client();

  let contextId = optionalEnv("BROWSERBASE_CONTEXT_ID");
  if (!contextId) {
    contextId = await createContext(bb);
    banner([
      "A new Browserbase context was created.",
      "",
      `  BROWSERBASE_CONTEXT_ID = ${contextId}`,
      "",
      "Save it as a GitHub Secret now, or this login will be orphaned:",
      "  gh secret set BROWSERBASE_CONTEXT_ID",
    ]);
  }

  // Give the remote browser a couple of minutes more than we intend to wait, so
  // the session never expires out from under a login in progress.
  const session = await openSession(bb, contextId, {
    timeoutSeconds: timeoutMinutes * 60 + 120,
    viewport: { width: 1024, height: 720 },
  });
  console.log(`Session ${session.id} — replay: ${replayUrl(session.id)}`);

  try {
    await session.page.goto("https://www.tiktok.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    if (await isLoggedIn(session.page)) {
      console.log("Already logged in — this context is still good. Nothing to do.");
      return;
    }

    const url = await liveViewUrl(bb, session.id);
    banner([
      "OPEN THIS LINK AND LOG INTO TIKTOK BY HAND:",
      "",
      url,
      "",
      `The browser stays open for ${timeoutMinutes} minute(s).`,
      "Anyone with this link can drive the browser while it is open — do not share it.",
    ]);

    const deadline = Date.now() + timeoutMinutes * 60_000;
    let lastLog = 0;
    while (Date.now() < deadline) {
      await sleep(5000);
      if (await isLoggedIn(session.page).catch(rethrowIfClosed)) {
        console.log("\nLogin detected.");
        // Load the inbox too, so message-scoped cookies are also persisted.
        await session.page
          .goto("https://www.tiktok.com/messages", { waitUntil: "domcontentloaded", timeout: 45_000 })
          .catch(() => undefined);
        await sleep(5000);
        await assertNotBlocked(session.page);

        banner([
          "Authenticated. The session cookies are saved in Browserbase context:",
          `  ${contextId}`,
          "",
          "Make sure these three secrets are set, then run the 'Daily streak messages'",
          "workflow manually to verify end to end:",
          "  BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID / BROWSERBASE_CONTEXT_ID",
        ]);
        return;
      }

      const remaining = Math.ceil((deadline - Date.now()) / 1000);
      if (Date.now() - lastLog > 30_000) {
        console.log(`waiting for login… ${remaining}s left`);
        lastLog = Date.now();
      }
    }

    throw new Error(
      `No TikTok session cookie after ${timeoutMinutes} minute(s). ` +
        `Re-run this workflow and finish the login before the timer runs out.`,
    );
  } finally {
    // Must close gracefully — a hard exit here would discard the login.
    await session.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`\n${error.message}`);
  } else {
    console.error(`\nAuth failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
});
