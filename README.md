# TikTok Streak Bot

Sends one TikTok DM per friend per day, automatically, so your streaks don't
die. Runs in the cloud — your laptop can be closed, offline, or switched off.

```
GitHub (every morning)  →  a browser in the cloud  →  tiktok.com
```

**You can set this up entirely in your web browser.** No terminal, no
programming, nothing installed except one Chrome extension.

---

## Read this first

**This breaks TikTok's rules.** Automating your account is against TikTok's
Terms of Service, and accounts do get restricted or banned for it. This sends a
small number of messages once a day, which helps, but it is not a guarantee.
It's your account and your risk. Try it on a spare account first if you can.

**It costs money after the free trial.** The cloud browser (Browserbase) gives
about 1 hour free per month. Five friends costs roughly 2.7 minutes a day, so
free lasts around three weeks. After that it's $20/month.

**Never paste your TikTok cookies into a chatbot.** In Step 4 you'll copy
something that is effectively your TikTok password. It goes into GitHub's
encrypted secret box and **nowhere else**. Not into ChatGPT, not into Qwen, not
into a Google Doc, not into a message to a friend. Anyone who gets it is logged
into your TikTok.

Time needed: **about 25 minutes.**

---

# Setup (browser only)

## Step 1 — Make your own copy

1. Click the green **Use this template** button at the top of this page
2. Choose **Create a new repository**
3. Name it anything, e.g. `my-streaks`
4. **Select Private.** Not optional — this repo will record who you message and
   when, which is your friends' business, not the internet's
5. Click **Create repository**

Everything from here happens inside *your* new repo.

## Step 2 — Get a Browserbase key

1. Go to [browserbase.com](https://www.browserbase.com) and sign up (signing in
   with GitHub is quickest)
2. Open **Settings**
3. Copy the **API Key** — it starts with `bb_live_`

## Step 3 — Add your first settings

In your repo: **Settings** (top bar) → **Secrets and variables** → **Actions**.

Click **New repository secret** and add these, one at a time:

| Name | Value |
|---|---|
| `BROWSERBASE_API_KEY` | the `bb_live_...` key you just copied |

Then switch to the **Variables** tab, click **New repository variable**:

| Name | Value |
|---|---|
| `BROWSERBASE_REGION` | the region nearest you (see below) |

Pick one: `us-west-2`, `us-east-1`, `eu-central-1` (Europe), `ap-southeast-1`
(Asia/Australia). **Choose once and don't change it** — to TikTok, switching
region looks like logging in from a different country, which triggers security
checks.

## Step 4 — Log into TikTok

Your password is never used. You're copying the "already logged in" proof from
your own browser.

1. Install [Cookie-Editor](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)
2. Open **tiktok.com** in Chrome, logged in
3. Click the Cookie-Editor icon in your toolbar
4. At the bottom of the panel, click the **rightmost icon** (Export) → **JSON**
   - ⚠️ The bin icon next to it deletes your cookies and logs you out. Not that one.
   - This copies a big block of text to your clipboard
5. Back in your repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `TIKTOK_COOKIES`
   - Value: paste it (starts with `[` and ends with `]` — paste all of it)

That secret box is encrypted and nobody, including GitHub staff, can read it
back out. That's why it goes there and nowhere else.

## Step 5 — Run the login

1. Go to the **Actions** tab
2. If you see a button asking you to enable workflows, click it
3. In the left sidebar click **1. Log in to TikTok**
4. Click **Run workflow** → **Run workflow**
5. Wait about a minute, then click into the run and open the **Import cookies** step

You should see a big box like this:

```
================================================================
  SAVE THIS AS A SECRET NAMED  BROWSERBASE_CONTEXT_ID

      1a2b3c4d-5e6f-7890-abcd-ef1234567890

================================================================
```

6. Copy that ID and add it as a new secret named `BROWSERBASE_CONTEXT_ID`
   (same place as before: Settings → Secrets and variables → Actions)

If the step ends with `TikTok accepts the session` — you're logged in.

7. **Now delete the `TIKTOK_COOKIES` secret.** It has done its job, and leaving
   a live login lying around is pointless risk. Click the bin next to it.

## Step 6 — Add your friends

Same secrets page. **New repository secret**:

- Name: `FRIENDS_JSON`
- Value: this, edited for your friends:

```json
{
  "timezone": "Europe/London",
  "friends": [
    { "username": "some_friend", "messages": ["hey", "yo", "👋"] },
    { "username": "another_friend", "messages": ["🔥"] }
  ]
}
```

- **username** — their TikTok handle, with or without the `@`
- **messages** — one is picked at random each day, so it isn't identical forever
- **timezone** — [find yours here](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones), the "TZ identifier" column

Your friends' usernames live only in this encrypted secret. They never appear in
your repo's files or history.

## Step 7 — Test it

**Actions** tab → **2. Send messages** → **Run workflow**.

Leave "Walk the flow without actually sending" **unticked** — a real send is the
only real test, and it costs the same as a pretend one.

Wait a minute or two, then check TikTok. A green tick means it worked.

## Done

It now runs every day at **05:00 UTC**. To change the time, edit
`.github/workflows/daily.yml` in your repo (GitHub lets you edit files right in
the browser — click the file, then the pencil icon) and change the `cron` line.
The format is `minute hour * * *` in UTC. [crontab.guru](https://crontab.guru)
translates it if that looks like noise.

---

## Checking on it

**Actions** tab → **2. Send messages** shows every run. Green tick = sent, red
X = something went wrong. GitHub emails you when a run fails, so silence is good
news.

To send today's messages early, run the workflow manually any time. It records
who's already been messaged today, so you can't accidentally double-send.

---

## Troubleshooting

**"the saved session has expired"**

TikTok logged you out. Redo **Step 4** and **Step 5**: re-export cookies, set
`TIKTOK_COOKIES` again, run the login workflow, delete the secret afterwards.
You already have a `BROWSERBASE_CONTEXT_ID`, so keep that one. Two minutes.
This happens occasionally and is normal.

**"Could not find messageButton"**

TikTok changed their website. The failed run saves a screenshot — open the run
page and look under **Artifacts**. Fixing it means editing `src/tiktok.ts`, and
this is the one problem that genuinely needs someone technical.

**"TikTok is asking for captcha / verification"**

TikTok wants to check you're human. The bot deliberately **stops** instead of
trying to get around it. Open TikTok in your normal browser, clear whatever it
asks, then run the workflow again. If it keeps happening, your region is
probably far from where you normally log in.

**Nothing runs at all**

Actions tab → check workflows are enabled. GitHub switches them off by default
on some new repos.

**Out of browser minutes**

Wait for the monthly reset, or upgrade at Browserbase.

**It stopped after a couple of months**

GitHub disables scheduled jobs in repos with no activity for 60 days. This one
commits a file daily so it shouldn't happen, but if you get an email about it,
click the button in that email.

---

## How it works

| File | What it does |
|---|---|
| `src/send.ts` | The daily run: work out who still needs a message, send it, record it |
| `src/import-cookies.ts` | How you log in |
| `src/status.ts` | Health check (terminal only) |
| `src/tiktok.ts` | Everything TikTok-specific — selectors, and the safety stops |
| `src/browserbase.ts` | Cloud browser setup |
| `src/config.ts` | Reads and checks your settings |
| `src/auth.ts` | An alternative login — see warning below |
| `state/sent.json` | Who's been messaged today, so re-runs don't double-send |

**Safety stops.** If TikTok asks for a login, CAPTCHA, 2FA, or verification, the
bot stops and tells you. It never tries to defeat those checks. It also confirms
each message actually appeared in the conversation before recording it as sent,
so a silent failure can't quietly break your streak.

**About `src/auth.ts`.** An alternative login that opens a remote browser for
you to click through. Kept because it may work on paid plans, but in testing it
failed every single attempt — the remote view was too laggy to use, and TikTok
challenged the datacenter IP every time. **Use Steps 4–5 instead.**

**Cost control.** The pause between friends is billed as browser time, so it
defaults to a short 5–15 seconds. Raising it to 20–60s nearly doubles your bill
for no real benefit.

---

## Privacy

- Your TikTok password is never entered, stored, or transmitted
- Your cookies go into GitHub's encrypted secrets, then into Browserbase's
  storage — never into this repo, and never into a chatbot
- Your friends' usernames live in an encrypted secret, not in any file
- Keep your repo **private** and none of this is public

Delete the `TIKTOK_COOKIES` secret once the login has worked. It's a live
session and it has no further use.

---

# Appendix: terminal setup

Only if you'd rather work locally. Needs Node.js 20+ and the
[GitHub CLI](https://cli.github.com).

```bash
gh repo clone YOUR-USERNAME/YOUR-REPO && cd YOUR-REPO && npm install
cp .env.example .env          # add your Browserbase key
cp config/friends.example.json config/friends.json
```

Export cookies with Cookie-Editor, then:

```bash
mkdir -p .secrets && pbpaste > .secrets/tiktok-cookies.json
npm run import-cookies
rm .secrets/tiktok-cookies.json
```

Useful commands:

```bash
npm run status            # health check, costs no browser minutes
npm run status -- --live  # also verifies the TikTok login (~0.4 min)
npm run push-config       # upload config/friends.json to the FRIENDS_JSON secret
DRY_RUN=true npm run send # walk the flow without sending
```

## License

MIT. No warranty. If your account gets banned, that's on you.
