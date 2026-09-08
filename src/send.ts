/**
 * Daily messaging run.
 *
 * Sends exactly one message per configured friend per day. Runs twice a day;
 * the second run skips anyone already messaged, using state/sent.json (which
 * the workflow commits back to the repo) as the record.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { client, openSession, replayUrl } from "./browserbase.js";
import {
  ConfigError,
  dayKey,
  envFlag,
  loadConfig,
  loadState,
  paths,
  pick,
  requireEnv,
  saveState,
  sleep,
  type Friend,
} from "./config.js";
import { assertLoggedIn, BlockedError, openThread, sendMessage } from "./tiktok.js";

/**
 * Saves a screenshot and the raw HTML so a broken selector can be diagnosed
 * from the Actions artifact instead of by guessing.
 */
async function captureFailure(page: Page, label: string): Promise<void> {
  try {
    mkdirSync(paths.artifacts, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = join(paths.artifacts, `${label}-${stamp}`);
    await page.screenshot({ path: `${base}.png`, fullPage: false });
    writeFileSync(`${base}.html`, await page.content(), "utf8");
    console.error(`  saved artifacts/${label}-${stamp}.{png,html}`);
  } catch (error: unknown) {
    console.error(`  (could not capture failure state: ${String(error)})`);
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const dryRun = envFlag("DRY_RUN");
  const today = dayKey(cfg.timezone);
  const state = loadState();
  const sentToday = state[today] ?? {};

  const pending = cfg.friends.filter((f: Friend) => !sentToday[f.username]);
  console.log(`${today} (${cfg.timezone}) — ${pending.length} of ${cfg.friends.length} friend(s) still to message`);
  if (dryRun) console.log("DRY_RUN is on: nothing will actually be sent.");

  if (pending.length === 0) {
    console.log("Everyone has already been messaged today. Nothing to do.");
    return;
  }

  const contextId = requireEnv("BROWSERBASE_CONTEXT_ID");
  // Generous enough for the whole friend list plus the random pauses between.
  const session = await openSession(client(), contextId, { timeoutSeconds: 900 });
  console.log(`Session ${session.id} — replay: ${replayUrl(session.id)}`);

  const failures: string[] = [];

  try {
    await assertLoggedIn(session.page);

    for (const [index, friend] of pending.entries()) {
      if (index > 0) {
        const range = cfg.maxDelaySeconds - cfg.minDelaySeconds;
        const wait = cfg.minDelaySeconds + Math.random() * range;
        console.log(`  waiting ${wait.toFixed(0)}s before the next friend…`);
        await sleep(wait * 1000);
      }

      const message = pick(friend.messages);
      console.log(`@${friend.username}: sending "${message}"`);

      try {
        if (dryRun) {
          await openThread(session.page, friend.username);
          console.log(`  DRY_RUN — thread opened, not sending`);
        } else {
          await openThread(session.page, friend.username);
          await sendMessage(session.page, message);
          console.log(`  sent`);
        }

        // Persist after every success so a later crash cannot cause a re-send.
        if (!dryRun) {
          state[today] = { ...(state[today] ?? {}), [friend.username]: new Date().toISOString() };
          saveState(state, cfg.timezone);
        }
      } catch (error: unknown) {
        await captureFailure(session.page, friend.username);

        if (error instanceof BlockedError) {
          // A login/CAPTCHA/verification wall applies to the whole account, not
          // just this friend. Stop immediately rather than tripping it further.
          throw error;
        }

        const reason = error instanceof Error ? error.message : String(error);
        console.error(`  FAILED: ${reason}`);
        failures.push(`@${friend.username}: ${reason}`);
      }
    }
  } catch (error: unknown) {
    if (error instanceof BlockedError) {
      console.error(
        `\nSTOPPED: TikTok is asking for ${error.kind}.\n` +
          `  Nothing further was attempted.\n` +
          (error.kind === "login"
            ? `  The saved session has expired. Re-authenticate with:\n` +
              `    1. Open tiktok.com in your normal browser, logged in\n` +
              `    2. Cookie-Editor extension -> Export -> JSON\n` +
              `    3. pbpaste > .secrets/tiktok-cookies.json\n` +
              `    4. npm run import-cookies\n` +
              `  (The 'TikTok auth (one-time)' workflow is the other route, but its live\n` +
              `   view has been unreliable — prefer the cookie import.)\n`
            : `  Open the account in a normal browser, clear the ${error.kind} by hand, then re-run this workflow.\n`) +
          `  Session replay: ${replayUrl(session.id)}`,
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await session.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} friend(s) failed:`);
    for (const f of failures) console.error(`  ${f}`);
    console.error(`Session replay: ${replayUrl(session.id)}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    dryRun
      ? `\nDry run complete — ${pending.length} thread(s) opened, nothing sent.`
      : `\nDone — ${pending.length} message(s) sent.`,
  );
}

main().catch((error: unknown) => {
  // Config problems get a one-liner; anything else is a real bug worth a stack.
  if (error instanceof ConfigError) {
    console.error(`\n${error.message}`);
  } else {
    console.error(`\nRun failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
  process.exitCode = 1;
});
