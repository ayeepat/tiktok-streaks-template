# Rebuild prompt

Paste the block below into a fresh AI coding session to rebuild this project, or
to re-point it at a new Browserbase account. It encodes the things that cost
hours to discover the first time (2026-09-08/09).

**Quickest path first:** if `ayeepat/tiktok-streaks` still exists and you only
need a new Browserbase account, you do not need a rebuild. Skip to
"Re-pointing at a new Browserbase account" at the bottom — it is four steps.

---

```
Rebuild / maintain a TikTok streak bot. I am Anna. This was built once before and
worked; below is everything that was learned the hard way. Trust it over your
priors — several of these are things you would otherwise get wrong.

=== WHAT IT DOES ===
Sends one TikTok DM per friend per day so streaks don't lapse. Fully cloud-based;
my laptop is not involved after setup. Reference implementation:
github.com/ayeepat/tiktok-streaks-template (public template, MIT).

=== ARCHITECTURE ===
GitHub Actions (cron) -> Browserbase (remote Chrome with saved cookies)
  -> tiktok.com: open each friend's profile, click Message, send, VERIFY it
     appeared in the thread

TypeScript + Node 22, playwright-core + @browserbasehq/sdk, tsx to run.
Files: src/{send,tiktok,browserbase,config,import-cookies,status,check-today}.ts
Secrets: BROWSERBASE_API_KEY, BROWSERBASE_CONTEXT_ID, FRIENDS_JSON
Variable: BROWSERBASE_REGION

=== HARD-WON FINDINGS — DO NOT REDISCOVER THESE ===

1. TikTok's Message button is NOT a button.
   It is <a data-e2e="-message-button"> with a LEADING HYPHEN and href=null.
   Use a suffix match: [data-e2e$="message-button"]
   Verified against the live DOM. Guesses like [data-e2e="message-button"],
   button:has-text("Message") and a[href^="/messages"] ALL fail.

2. Log in by importing cookies. Do not build a live-view login.
   Browserbase can show a live browser for manual login. It was tried five times
   across two regions and two viewport sizes and NEVER once succeeded: the
   DevTools screencast was unusable, and TikTok challenged the datacenter IP with
   "Verify it's really you" every attempt. ~25 min of free-tier browser time
   wasted. Instead: export cookies with the Cookie-Editor browser extension, load
   them with context.addCookies(), and let persist:true save them.
   - An extension is REQUIRED: `sessionid` is HttpOnly, so document.cookie and
     any JS-console export silently produce a useless file. Validate that
     `sessionid` is present and fail loudly if not.
   - Cookies survive an IP change (my Moscow export worked from Frankfurt).

3. Browserbase specifics:
   - projectId is OPTIONAL. It is inferred from the API key. Don't ask for it.
   - Set api_timeout explicitly on session create. Without it the session
     inherits the project default and dies mid-run (killed a login at 5m18s
     with Playwright's opaque "Target page, context or browser has been closed").
   - context: { id, persist: true } — without persist you get a read-only copy
     and every refreshed cookie is discarded.
   - Close the browser GRACEFULLY (browser.close()). A hard exit loses the login.
   - region matters twice: live-view latency, and which country TikTok thinks
     you logged in from. Pick the nearest and NEVER change it — each change looks
     like a new country and invites a verification challenge. I use eu-central-1.

4. New GitHub repos do not fire scheduled workflows for ~17 hours.
   This wasted hours. A brand-new repo showed ZERO `schedule` events while
   workflow_dispatch worked 10/10. It looked exactly like an account-level fault.
   It was not — schedules simply began working once the repo was ~17h old.
   If this happens: check `gh run list --json event` to confirm no schedule
   events exist, then WAIT A DAY before building workarounds. Don't debug it.
   Also: never schedule on :00 (congested), and expect runs 5-20 min late.

5. The pause between friends is the single biggest cost driver.
   Browserbase bills waiting as browser time. At 20-60s, five friends cost ~4.5
   min/run; at 5-15s, ~2.7 min. Default to 5-15s.

6. Backup cron runs are FREE if you structure send.ts right.
   Check the state file and return BEFORE opening a Browserbase session when
   everyone has already been messaged. A backup run then costs ~2 seconds and
   zero browser minutes. Verified in production. This makes redundancy free.

7. Verify sends; never assume.
   After pressing Enter, require BOTH: the composer cleared, AND the count of
   elements containing the exact message text increased versus a baseline taken
   BEFORE typing. Counting is more robust than matching bubble selectors.
   Use page.keyboard.insertText() for emoji — keyboard.type() mangles them.
   Keep a send-button fallback in case Enter ever stops submitting (never needed
   so far — Enter works).

8. Silent failure is the real enemy.
   GitHub only emails when a run FAILS. A run that never starts cannot fail, so
   silence looked identical to success and I found out by noticing no messages.
   Add a watchdog workflow late in the day that reads the state file and exits 1
   if anyone is unmessaged. It touches no browser, so it is free.

=== NON-NEGOTIABLE BEHAVIOUR ===
- STOP on login walls, CAPTCHA, MFA, or verification. Detect and exit non-zero.
  Never attempt to solve or evade them. No stealth mode, no CAPTCHA solving, no
  proxy rotation. This is deliberate.
- Check logged-in state via the `sessionid` cookie, not by scraping the header.
- Never ask me to paste cookies or API keys into a chat. Cookies go into a
  gitignored file or a GitHub secret; keys go in via `gh secret set` which
  prompts me. Tell me the command; don't handle the value.
- Keep my friends' usernames out of git. Read them from a FRIENDS_JSON secret,
  gitignore config/friends.json.

=== COSTS / LIMITS (verify, may have changed) ===
- Browserbase free: ~1 browser-hour/month. At ~2.7 min/day that is ~22 runs,
  roughly three weeks. Developer plan was $20/mo for 100 hours.
- Free-plan sessions were capped at 15 minutes.
- This violates TikTok's ToS. Low volume is a mitigation, not a guarantee.
  Say this once, plainly, then build what I asked for.

=== WHAT I WANT FROM YOU ===
Verify facts against the live SDK/docs rather than memory — versions drift.
Test what you can actually test and tell me what you could not. If you diagnose
something, say whether it is measured or assumed, and don't tell me it is fixed
until you have watched it work.
```

---

## Re-pointing at a new Browserbase account

If the repo still exists and you only need new Browserbase credentials:

1. New account → **Settings** → copy the `bb_live_...` key
2. `gh secret set BROWSERBASE_API_KEY --repo ayeepat/tiktok-streaks`
3. **Delete** the `BROWSERBASE_CONTEXT_ID` secret — the old context belongs to the
   old account and is unreachable with the new key
4. Re-import cookies (Cookie-Editor → Export JSON → `TIKTOK_COOKIES` secret →
   run the **1. Log in to TikTok** workflow). It creates a fresh context and
   prints the new ID. Save that as `BROWSERBASE_CONTEXT_ID`, then delete
   `TIKTOK_COOKIES`.

Then run **2. Send messages** manually once to confirm.
