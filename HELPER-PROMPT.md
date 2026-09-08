# AI helper prompt

Stuck? Paste everything in the box below into a fresh chat with an AI assistant
(Qwen Coder, ChatGPT, Claude — any of them). It gives the AI the full picture so
it can help without you having to explain the project first.

**It also tells the AI never to ask you for your passwords, cookies or API key.**
If any AI ever asks for those, something is wrong — stop and don't send them.

---

```
I'm setting up a project called "TikTok Streak Bot" and I need help. I am not
technical — explain things simply and one step at a time.

=== HARD RULE: NEVER ASK ME FOR SECRETS ===
Never ask me to paste, show, or send you:
  - my TikTok cookies, or the TIKTOK_COOKIES value
  - my Browserbase API key
  - any password
These belong in GitHub's encrypted secret box and nowhere else. My TikTok
cookies are effectively my password — anyone holding them is logged into my
account. If I offer one anyway, tell me to stop, tell me to treat it as leaked
and replace it, and keep helping without it. You never need any secret to help
me. Error text from GitHub Actions logs IS safe to share (GitHub hides secrets
as *** automatically).

=== WHAT THE PROJECT IS ===
A bot that sends one TikTok direct message per day to each friend on a list, so
TikTok streaks don't lapse. It runs in the cloud — my computer is not involved
after setup.

How it works:
  GitHub Actions (a scheduled job, 05:00 UTC daily)
    -> Browserbase (a Chrome browser running on their servers, already logged
       into my TikTok via saved cookies)
    -> tiktok.com: open each friend's profile, click Message, send, and verify
       the message actually appeared in the conversation

Repo: github.com/ayeepat/tiktok-streaks-template (I made my own private copy
from this template).

=== HOW LOGIN WORKS, AND WHY ===
I never type my TikTok password anywhere. Instead I export my browser cookies
with the Cookie-Editor extension, paste them into a GitHub secret called
TIKTOK_COOKIES, and run a workflow that loads them into Browserbase's storage
(a "context"). After that the daily job is permanently logged in and I delete
the TIKTOK_COOKIES secret.

There is also a file src/auth.ts that does login a different way, by opening a
remote browser for me to click through. DO NOT suggest it. It was tested
repeatedly and failed every time — the remote view was too laggy to use, and
TikTok challenged the datacenter IP with "Verify it's really you" on every
attempt. The cookie method takes under a minute and works.

=== MY SETUP, IN ORDER ===
1. "Use this template" on GitHub -> Create a new repository -> set to PRIVATE
2. browserbase.com -> sign up -> Settings -> copy the API key (starts bb_live_)
3. Repo Settings -> Secrets and variables -> Actions:
     secret   BROWSERBASE_API_KEY    = the bb_live_ key
     variable BROWSERBASE_REGION     = region nearest me, e.g. eu-central-1
4. Cookie-Editor extension on tiktok.com -> Export -> JSON
     secret   TIKTOK_COOKIES         = that whole export
5. Actions tab -> "1. Log in to TikTok" -> Run workflow
     It prints a context ID in a banner. I save it as:
     secret   BROWSERBASE_CONTEXT_ID = that ID
     Then I DELETE the TIKTOK_COOKIES secret.
6. secret   FRIENDS_JSON = my friend list, e.g.
     {"timezone":"Europe/London","friends":[
       {"username":"someone","messages":["hey","yo"]}]}
7. Actions tab -> "2. Send messages" -> Run workflow (leave the "without
   actually sending" box UNTICKED). Then check TikTok.

=== THINGS YOU SHOULD KNOW ===
- Setup is BROWSER ONLY. Don't tell me to install Node, npm, or the gh CLI, or
  to run terminal commands, unless I say I want the developer route.
- Browserbase free tier is about 1 hour of browser time per month. Five friends
  costs roughly 2.7 minutes a day, so free lasts about three weeks. Then it's
  $20/month.
- The pause between friends is billed as browser time, so it's deliberately
  short (5-15s). Don't suggest raising it.
- The bot deliberately STOPS if TikTok asks for a login, CAPTCHA, 2FA or
  verification. Never help me get around those — tell me to clear it manually
  in my normal browser. This is intended behaviour, not a bug.
- Running the send workflow twice in one day is safe: it records who's been
  messaged and skips them.
- Config errors fail before any browser starts, so a typo costs nothing.

=== COMMON PROBLEMS ===
- "Missing required environment variable BROWSERBASE_API_KEY" -> secret missing
  or misspelled. Names are case-sensitive.
- "No cookies found" -> TIKTOK_COOKIES secret missing or misspelled.
- "TIKTOK_COOKIES is not valid JSON" -> I pasted only part of it. Needs
  everything from the first [ to the last ].
- "Cookie file is missing: sessionid" -> exported the wrong way. Must use the
  Cookie-Editor extension while logged into tiktok.com.
- "the saved session has expired" -> TikTok logged me out. Redo steps 4 and 5,
  keeping the existing BROWSERBASE_CONTEXT_ID.
- "Could not find messageButton" -> either TikTok changed their website, or
  that person doesn't accept DMs from me. The failed run saves a screenshot
  under Artifacts on the run page.
- "FRIENDS_JSON is not valid JSON" -> usually a comma after the LAST friend, or
  curly quotes from a word processor instead of straight quotes.
- Nothing runs at all -> Actions tab, check workflows are enabled.

=== WHAT I'D LIKE FROM YOU ===
Ask me where I'm stuck. Then walk me through it one step at a time, waiting for
me to confirm before moving on. Use plain language — "the tab at the top that
says Settings", not "repo settings". If I paste an error, explain what it means
before telling me what to do.
```
