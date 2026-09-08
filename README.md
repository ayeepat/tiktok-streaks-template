# TikTok Streak Bot

Sends one TikTok DM per friend per day, automatically, so your streaks don't
die. Runs in the cloud — your laptop can be closed, offline, or switched off.

```
GitHub (every morning)  →  a browser in the cloud  →  tiktok.com
```

---

## Read this before you start

**This breaks TikTok's rules.** Automating your account is against TikTok's
Terms of Service, and accounts do get restricted or banned for it. This sends a
small number of messages once a day, which helps, but it is not a guarantee.
It's your account and your risk. Try it on a spare account first.

**It costs money after the free trial.** The cloud browser (Browserbase) gives
you about 1 hour free per month. Five friends costs roughly 2.7 minutes a day,
so free lasts around three weeks. After that it's $20/month.

**You need to be comfortable with a terminal.** Not an expert — every command
is written out below and you can copy-paste all of them. But if you have never
opened Terminal and that sounds stressful, grab a friend who has. Honest
estimate: **30–45 minutes** for your first setup.

---

## What you need

| | |
|---|---|
| A computer | Mac or Linux. Windows works via WSL. |
| A GitHub account | Free. [github.com/signup](https://github.com/signup) |
| A Browserbase account | Free to start. [browserbase.com](https://www.browserbase.com) |
| Node.js 20+ | [nodejs.org](https://nodejs.org) — take the "LTS" button |
| The GitHub CLI | [cli.github.com](https://cli.github.com) |
| Chrome + Cookie-Editor | An extension, linked in step 5 |

Check Node is installed — this should print a version number like `v22.x`:

```bash
node --version
```

---

## Step 1 — Make your own copy

Click the green **Use this template** button at the top of this page →
**Create a new repository**.

**Set it to Private.** Not optional. Your repo will hold a record of who you
message and when — that's your friends' business, not the internet's.

Name it whatever you like, e.g. `my-streaks`.

## Step 2 — Download it to your computer

Replace `YOUR-USERNAME` and `YOUR-REPO` with your actual details:

```bash
gh auth login
```

```bash
gh repo clone YOUR-USERNAME/YOUR-REPO && cd YOUR-REPO && npm install
```

## Step 3 — Get a Browserbase key

1. Sign up at [browserbase.com](https://www.browserbase.com) (GitHub login is quickest)
2. Go to **Settings**
3. Copy your **API Key** — it starts with `bb_live_`

Now save it. This command will ask you to paste it:

```bash
gh secret set BROWSERBASE_API_KEY
```

Also put it in a local file for your own machine:

```bash
cp .env.example .env
```

Open `.env` in any text editor and paste your key after `BROWSERBASE_API_KEY=`.

While you're in there, set `BROWSERBASE_REGION` to whichever is nearest you:
`us-west-2`, `us-east-1`, `eu-central-1` (Europe), or `ap-southeast-1` (Asia).
**Pick once and don't change it** — to TikTok, changing region looks like
logging in from a different country, which triggers security checks.

```bash
gh variable set BROWSERBASE_REGION --body eu-central-1
```

## Step 4 — Tell it who to message

```bash
cp config/friends.example.json config/friends.json
```

Open `config/friends.json` and edit it:

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
- **messages** — one is picked at random each day, so it's not identical forever
- **timezone** — [find yours here](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) (the "TZ identifier" column)

This file is **gitignored**, so your friends' usernames never get uploaded to
GitHub. Send it to Actions as a secret instead:

```bash
npm run push-config
```

Re-run that command any time you change the list.

## Step 5 — Log into TikTok

You do this by hand, once. **Your password never goes near this project** — it
copies the "already logged in" cookies from your own browser.

1. Install [Cookie-Editor](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)
2. Open **tiktok.com** in Chrome and make sure you're logged in
3. Click the Cookie-Editor icon in your toolbar
4. At the bottom of the panel, click the **rightmost icon** (Export) → choose **JSON**
   *(careful — the bin icon next to it deletes your cookies and logs you out)*
5. Save what it copied:

```bash
mkdir -p .secrets && pbpaste > .secrets/tiktok-cookies.json
```

*(Linux: use `xclip -o > .secrets/tiktok-cookies.json`)*

```bash
npm run import-cookies
```

It prints a **context ID**. Save it in two places — paste it into `.env` after
`BROWSERBASE_CONTEXT_ID=`, and run:

```bash
gh secret set BROWSERBASE_CONTEXT_ID
```

Then delete the cookie file. It's effectively your password:

```bash
rm .secrets/tiktok-cookies.json
```

## Step 6 — Test it

First, make sure GitHub will actually run it. Open your repo's **Actions** tab.
If you see a button offering to enable workflows, click it — GitHub switches
them off by default on some new repos, and nothing will run until you do.

```bash
npm run status
```

Shows what's set up and how many browser minutes you have. Costs nothing.

Now a real test — this genuinely sends the messages:

```bash
gh workflow run "Daily streak messages"
```

Wait about a minute, then:

```bash
gh run list --limit 1
```

`success` means it worked. Check TikTok to see the messages. Anything else, see
Troubleshooting below.

## Done

It now runs every day at **05:00 UTC**. To change that, edit the `cron` line in
`.github/workflows/daily.yml`. The format is `minute hour * * *` in UTC —
[crontab.guru](https://crontab.guru) helps if that looks like noise.

---

## Everyday commands

Check everything's healthy (free — no browser minutes used):

```bash
npm run status
```

Also verify TikTok still has you logged in (~0.4 min of browser time):

```bash
npm run status -- --live
```

Send today's messages right now instead of waiting:

```bash
gh workflow run "Daily streak messages"
```

---

## Troubleshooting

**"the saved session has expired"**

TikTok logged you out. Redo **Step 5** — export cookies again and run
`npm run import-cookies`. Takes two minutes. This happens occasionally; it's
normal, not a sign anything is broken.

**"Could not find messageButton"**

TikTok changed their website and the bot can't find the Message button. The
failed run saves a screenshot — download it from the run page on GitHub under
**Artifacts**. Fixing it means adding a new selector to `src/tiktok.ts`. This is
the one problem that genuinely needs a developer.

**"TikTok is asking for captcha / verification"**

TikTok wants to check you're human. It deliberately **stops** rather than trying
to get around this. Open TikTok in your normal browser, clear whatever it asks,
then re-run. If it keeps happening, your cloud browser region is probably far
from where you normally log in.

**Out of browser minutes**

`npm run status` warns you before this bites. Either wait for your monthly
reset, or upgrade to Browserbase's Developer plan.

**It just stopped running**

GitHub switches off scheduled jobs in repos with no activity for 60 days. This
one commits a file daily so it shouldn't happen — but if you get an email about
it, click the button in that email to re-enable.

---

## How it works

| File | What it does |
|---|---|
| `src/send.ts` | The daily run: work out who still needs a message, send it, record it |
| `src/import-cookies.ts` | How you log in |
| `src/status.ts` | Health check |
| `src/tiktok.ts` | Everything TikTok-specific — selectors, and the safety stops |
| `src/browserbase.ts` | Cloud browser setup |
| `src/config.ts` | Reads and checks your settings |
| `src/auth.ts` | An alternative login (see warning below) |
| `state/sent.json` | Who's been messaged today, so re-runs don't double-send |

**Safety stops.** If TikTok asks for a login, CAPTCHA, 2FA, or verification, the
bot stops and tells you. It never tries to defeat those checks. It also confirms
each message actually appeared in the conversation before counting it as sent —
so a silent failure can't quietly break your streak.

**About `src/auth.ts`.** It's an alternative login that opens a remote browser
for you to click through. It's kept because it may work on paid plans, but in
testing it failed every attempt — the remote view was too laggy to use, and
TikTok challenged the datacenter IP every time. **Use the cookie import from
Step 5.** It takes under a minute and works.

**Cost control.** The pause between friends is billed as browser time, so it
defaults to a short 5–15 seconds. Raising it to 20–60s nearly doubles your bill
for no real benefit.

---

## Privacy

- Your TikTok password is never entered, stored, or transmitted by this project
- Your friends' usernames stay in a gitignored file and a private secret
- Your login cookies live in Browserbase's storage, not in this repo
- Keep your repo **private** and none of it is public

If you fork or share this, double-check you haven't committed `config/friends.json`
or a populated `state/sent.json` — git history keeps things forever.

## License

MIT. No warranty. If your account gets banned, that's on you.
