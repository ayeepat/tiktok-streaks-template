/**
 * Watchdog. Fails if anyone on the friend list has not been messaged today.
 *
 * This exists because GitHub's scheduler is best-effort: a scheduled run can be
 * delayed or silently dropped, and a run that never starts produces no failure
 * and therefore no notification. Silence looked exactly like success.
 *
 * Running this late in the day turns that silence into a failed run, which
 * GitHub does email about. It touches no browser, so it costs nothing.
 */
import { dayKey, loadConfig, loadState } from "./config.js";
import { ConfigError } from "./config.js";

function main(): void {
  const cfg = loadConfig();
  const today = dayKey(cfg.timezone);
  const sent = loadState()[today] ?? {};

  const missing = cfg.friends.filter((f) => !sent[f.username]).map((f) => f.username);

  console.log(`${today} (${cfg.timezone})`);
  for (const f of cfg.friends) {
    console.log(`  ${sent[f.username] ? "sent" : "MISSING"}  @${f.username}`);
  }

  if (missing.length === 0) {
    console.log(`\nAll ${cfg.friends.length} friend(s) messaged today.`);
    return;
  }

  console.error(
    `\n${missing.length} friend(s) were NOT messaged today: ${missing.join(", ")}\n` +
      `\nThe scheduled run was probably dropped by GitHub rather than failing —\n` +
      `that happens, and it is why this check exists.\n` +
      `\nTo fix it right now: Actions -> "Daily streak messages" -> Run workflow.\n` +
      `It will only message whoever is still missing.`,
  );
  process.exitCode = 1;
}

try {
  main();
} catch (error: unknown) {
  if (error instanceof ConfigError) {
    console.error(`\n${error.message}`);
  } else {
    console.error(`\nCheck failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
}
