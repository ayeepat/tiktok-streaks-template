import Browserbase from "@browserbasehq/sdk";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { ConfigError, optionalEnv, requireEnv } from "./config.js";

export function client(): Browserbase {
  return new Browserbase({ apiKey: requireEnv("BROWSERBASE_API_KEY") });
}

/**
 * Browserbase infers the project from the API key, so BROWSERBASE_PROJECT_ID is
 * optional. Only set it if your key spans multiple projects and you need to
 * pin a specific one.
 */
function projectId(): { projectId: string } | Record<string, never> {
  const id = optionalEnv("BROWSERBASE_PROJECT_ID");
  return id ? { projectId: id } : {};
}

/**
 * Creates a Browserbase context. Only needed once, ever — the returned ID is
 * what makes logins survive between runs.
 */
export async function createContext(bb: Browserbase): Promise<string> {
  const context = await bb.contexts.create({ ...projectId() });
  return context.id;
}

export type Session = {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
};

const REGIONS = ["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"] as const;
type Region = (typeof REGIONS)[number];

/**
 * Region matters twice over. It sets how far every live-view frame has to
 * travel during the manual login, and it decides which country TikTok sees the
 * session coming from — a login from the wrong continent is exactly the kind of
 * thing that triggers a verification challenge.
 */
function region(): Region {
  const value = optionalEnv("BROWSERBASE_REGION") ?? "eu-central-1";
  if (!(REGIONS as readonly string[]).includes(value)) {
    throw new ConfigError(`BROWSERBASE_REGION must be one of: ${REGIONS.join(", ")} (got "${value}")`);
  }
  return value as Region;
}

/**
 * Opens a remote browser bound to our persistent context and attaches Playwright.
 *
 * `persist: true` is the whole point: without it Browserbase gives us a
 * read-only copy of the context and any cookie TikTok refreshes during the run
 * is thrown away on close.
 */
export async function openSession(
  bb: Browserbase,
  contextId: string,
  opts: { timeoutSeconds?: number; viewport?: { width: number; height: number } } = {},
): Promise<Session> {
  const session = await bb.sessions.create({
    ...projectId(),
    region: region(),
    // Without this the session inherits the project's defaultTimeout, which is
    // short enough to kill a manual login halfway through.
    api_timeout: Math.min(Math.max(opts.timeoutSeconds ?? 600, 60), 21_600),
    browserSettings: {
      context: { id: contextId, persist: true },
      // The live view screencasts JPEG frames of the whole viewport, so during
      // the manual login a smaller viewport is a noticeably smoother viewport.
      viewport: opts.viewport ?? { width: 1280, height: 800 },
    },
  });

  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Browserbase session started without a browser context");
  const page = context.pages()[0] ?? (await context.newPage());

  return {
    id: session.id,
    browser,
    context,
    page,
    // Closing gracefully is what flushes cookies back into the stored context.
    // A hard process exit here loses the login.
    close: async () => {
      await browser.close().catch(() => undefined);
    },
  };
}

/** Interactive URL a human can open to drive the remote browser themselves. */
export async function liveViewUrl(bb: Browserbase, sessionId: string): Promise<string> {
  const links = await bb.sessions.debug(sessionId);
  return links.debuggerFullscreenUrl;
}

export function replayUrl(sessionId: string): string {
  return `https://www.browserbase.com/sessions/${sessionId}`;
}
