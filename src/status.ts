/**
 * Health check.
 *
 * By default this costs ZERO Browserbase browser minutes: it only reads
 * session *metadata* from the API and recent run results from GitHub. Neither
 * starts a browser.
 *
 *   npm run status          free — recent runs, minutes used, runway
 *   npm run status -- --live  ~0.4 min — actually opens TikTok and proves the
 *                             saved login still works
 */
import { execFileSync } from "node:child_process";
import { client, openSession, replayUrl } from "./browserbase.js";
import { ConfigError, loadConfig, loadState, dayKey, optionalEnv } from "./config.js";
import { isLoggedIn, assertNotBlocked, BlockedError } from "./tiktok.js";

const FREE_TIER_MINUTES = 60;

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

/** Recent workflow results, via the gh CLI. Costs nothing. */
function githubRuns(): void {
  heading("Recent runs");
  try {
    const out = execFileSync(
      "gh",
      ["run", "list", "--workflow=Daily streak messages", "--limit", "7", "--json", "conclusion,createdAt,status"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const runs = JSON.parse(out) as { conclusion: string | null; createdAt: string; status: string }[];
    if (runs.length === 0) {
      console.log("  no runs yet");
      return;
    }
    for (const r of runs) {
      const state = r.status !== "completed" ? "running" : (r.conclusion ?? "?");
      const mark = state === "success" ? "OK  " : state === "running" ? "... " : "FAIL";
      console.log(`  ${mark} ${r.createdAt.slice(0, 16).replace("T", " ")}  ${state}`);
    }
    const lastDone = runs.find((r) => r.status === "completed");
    if (lastDone && lastDone.conclusion !== "success") {
      console.log("\n  Last completed run FAILED. See the log:");
      console.log("    gh run view --log-failed");
    }
  } catch {
    console.log("  (could not read GitHub runs — is the `gh` CLI installed and authenticated?)");
  }
}

/** Browser-minute accounting. Metadata only, so this is free. */
async function usage(): Promise<void> {
  heading("Browserbase usage");
  const sessions = await client().sessions.list();
  let used = 0;
  let lastRunCost = 0;
  for (const s of sessions) {
    if (!s.endedAt) continue;
    const mins = (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60_000;
    used += mins;
    if (lastRunCost === 0) lastRunCost = mins;
  }
  const remaining = FREE_TIER_MINUTES - used;
  console.log(`  used:      ${used.toFixed(1)} min of ${FREE_TIER_MINUTES}`);
  console.log(`  remaining: ${remaining.toFixed(1)} min`);
  if (lastRunCost > 0 && remaining > 0) {
    console.log(`  runway:    ~${Math.floor(remaining / lastRunCost)} days at ${lastRunCost.toFixed(2)} min/run`);
  }
  if (remaining < 10) console.log("  WARNING: nearly out of free minutes — runs will start failing.");
}

/** Did today's friends get their message? Reads the committed state file. */
function todaysState(): void {
  heading("Today");
  const cfg = loadConfig();
  const today = dayKey(cfg.timezone);
  const sent = loadState()[today] ?? {};
  console.log(`  ${today} (${cfg.timezone})`);
  for (const f of cfg.friends) {
    const at = sent[f.username];
    console.log(`  ${at ? "sent" : "  - "}  @${f.username}${at ? `  ${at.slice(11, 19)}` : ""}`);
  }
  console.log("\n  (local file — run `git pull` first if you want the latest)");
}

/** The only part that spends browser minutes. Opt in with --live. */
async function liveCheck(): Promise<void> {
  heading("Live login check (~0.4 min of browser time)");
  const contextId = optionalEnv("BROWSERBASE_CONTEXT_ID");
  if (!contextId) throw new ConfigError("BROWSERBASE_CONTEXT_ID is not set — check your .env");

  const session = await openSession(client(), contextId, { timeoutSeconds: 120 });
  try {
    await session.page.goto("https://www.tiktok.com/messages", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await assertNotBlocked(session.page);
    if (await isLoggedIn(session.page)) {
      console.log("  LOGGED IN — the saved session still works.");
    } else {
      console.log("  NOT LOGGED IN — re-run `npm run import-cookies`.");
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    if (error instanceof BlockedError) {
      console.log(`  BLOCKED (${error.kind}) — TikTok wants manual action.`);
      if (error.kind === "login") console.log("  Re-run `npm run import-cookies`.");
      process.exitCode = 1;
    } else {
      throw error;
    }
  } finally {
    console.log(`  replay: ${replayUrl(session.id)}`);
    await session.close();
  }
}

async function main(): Promise<void> {
  githubRuns();
  todaysState();
  await usage();

  if (process.argv.includes("--live")) {
    await liveCheck();
  } else {
    console.log("\nTip: `npm run status -- --live` also proves the TikTok login still works.");
    console.log("     That one costs ~0.4 min of browser time; everything above is free.");
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`\n${error.message}`);
  } else {
    console.error(`\nStatus check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
});
