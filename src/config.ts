import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const paths = {
  root,
  friends: join(root, "config", "friends.json"),
  state: join(root, "state", "sent.json"),
  artifacts: join(root, "artifacts"),
};

/**
 * A problem with the config or environment rather than a bug. These print as a
 * single clear line instead of a stack trace, because the fix is always
 * "edit a file or set a secret".
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type Friend = {
  username: string;
  messages: string[];
  note?: string;
};

export type Config = {
  timezone: string;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  friends: Friend[];
};

/**
 * Reads your friend list from the FRIENDS_JSON secret if set, otherwise from
 * config/friends.json on disk.
 *
 * The secret comes first on purpose. config/friends.json is gitignored, so your
 * friends' usernames never land in a commit — not in your repo, and not in
 * anything you might later share or make public. The file is for local runs;
 * GitHub Actions reads the secret.
 */
function readConfigSource(): { raw: unknown; from: string } {
  const fromEnv = optionalEnv("FRIENDS_JSON");
  if (fromEnv) {
    try {
      return { raw: JSON.parse(fromEnv), from: "the FRIENDS_JSON secret" };
    } catch (error: unknown) {
      throw new ConfigError(
        `FRIENDS_JSON is not valid JSON: ${error instanceof Error ? error.message : String(error)}\n` +
          `Re-set it with:  gh secret set FRIENDS_JSON < config/friends.json`,
      );
    }
  }

  try {
    return { raw: JSON.parse(readFileSync(paths.friends, "utf8")), from: "config/friends.json" };
  } catch {
    throw new ConfigError(
      `No friend list found.\n` +
        `  Locally: cp config/friends.example.json config/friends.json, then edit it.\n` +
        `  In CI:   gh secret set FRIENDS_JSON < config/friends.json`,
    );
  }
}

/**
 * Loads and validates the config, failing loudly on anything malformed. A bad
 * config should stop the run before we ever spend Browserbase minutes on it.
 */
export function loadConfig(): Config {
  const { raw, from } = readConfigSource();
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError(`${from} must contain a JSON object`);
  }

  const cfg = raw as Partial<Config>;
  const timezone = cfg.timezone ?? "UTC";
  assertValidTimezone(timezone);

  if (!Array.isArray(cfg.friends) || cfg.friends.length === 0) {
    throw new ConfigError(`${from} needs a non-empty \`friends\` array`);
  }

  const seen = new Set<string>();
  const friends = cfg.friends.map((entry, i) => {
    const where = `friends[${i}]`;
    if (typeof entry?.username !== "string" || entry.username.trim() === "") {
      throw new ConfigError(`${where}.username must be a non-empty string`);
    }
    // Tolerate "@name" in the config; TikTok URLs want it without the @.
    const username = entry.username.trim().replace(/^@/, "");
    if (seen.has(username.toLowerCase())) {
      throw new ConfigError(`${where}: duplicate username "${username}"`);
    }
    seen.add(username.toLowerCase());

    if (!Array.isArray(entry.messages) || entry.messages.length === 0) {
      throw new ConfigError(`${where}.messages must be a non-empty array of strings`);
    }
    for (const [j, m] of entry.messages.entries()) {
      if (typeof m !== "string" || m.trim() === "") {
        throw new ConfigError(`${where}.messages[${j}] must be a non-empty string`);
      }
    }

    const friend: Friend = { username, messages: entry.messages };
    if (typeof entry.note === "string") friend.note = entry.note;
    return friend;
  });

  // Defaults are deliberately short: Browserbase bills the pause between
  // friends as browser time, so long delays are the biggest cost in a run.
  const minDelaySeconds = cfg.minDelaySeconds ?? 5;
  const maxDelaySeconds = cfg.maxDelaySeconds ?? 15;
  if (minDelaySeconds < 0 || maxDelaySeconds < minDelaySeconds) {
    throw new ConfigError("minDelaySeconds must be >= 0 and <= maxDelaySeconds");
  }

  return { timezone, minDelaySeconds, maxDelaySeconds, friends };
}

function assertValidTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    throw new ConfigError(`Unknown timezone "${tz}" — see the IANA timezone list`);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new ConfigError(
      `Missing required environment variable ${name}. ` +
        `Locally: copy .env.example to .env. In CI: set it as a GitHub Secret.`,
    );
  }
  return value.trim();
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export function envFlag(name: string): boolean {
  return /^(1|true|yes)$/i.test(process.env[name] ?? "");
}

/** YYYY-MM-DD in the configured timezone — the key we dedupe sends against. */
export function dayKey(timezone: string, when: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
}

export type SentState = Record<string, Record<string, string>>;

export function loadState(): SentState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(paths.state, "utf8"));
    if (typeof parsed === "object" && parsed !== null) return parsed as SentState;
  } catch {
    // Missing or corrupt state is not fatal — worst case we re-send today.
  }
  return {};
}

/** Writes state and drops entries older than 30 days so the file stays small. */
export function saveState(state: SentState, timezone: string): void {
  const cutoff = dayKey(timezone, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const pruned: SentState = {};
  for (const [day, entry] of Object.entries(state)) {
    if (day >= cutoff) pruned[day] = entry;
  }
  mkdirSync(dirname(paths.state), { recursive: true });
  writeFileSync(paths.state, `${JSON.stringify(pruned, null, 2)}\n`, "utf8");
}

export function pick<T>(items: T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error("pick() called with an empty array");
  return item;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
