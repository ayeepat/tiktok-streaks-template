# External scheduler (Cloudflare Worker)

## Why this exists

GitHub Actions never delivered a single `schedule` event to this account.
Measured on 2026-09-09:

| | Slots tested | Scheduled runs |
|---|---|---|
| Private repo, over 3h | 6 | **0** |
| Public repo (control), over 2h | 3 | **0** |
| Manual dispatch, both repos | 10 | **10** |

Not congestion, not billing (ruled out by the public control — public repos have
free unlimited Actions minutes), not permissions, not an outage. Manual
dispatch works perfectly; the scheduler simply never fires.

So the cron moves to Cloudflare, which does fire, and it starts the workflow
through GitHub's API. The `schedule:` block in `daily.yml` is left in place — if
GitHub's scheduler ever recovers, a duplicate run costs nothing, because a run
with nobody left to message exits before it opens a browser.

## Setup (browser only, ~15 min)

### 1. Create the GitHub token

[github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)

- **Token name**: `tiktok-streaks-cron`
- **Expiration**: 1 year (set a reminder — it stops working when it expires)
- **Repository access**: *Only select repositories* → `YOUR-REPO`
- **Permissions** → *Repository permissions* → **Actions: Read and write**
  - Nothing else. Leave every other permission on "No access".

Generate it and copy the token. **This is the only thing this Worker can do:**
start workflows in this one repo. It cannot read your code, push commits, or
reach any other repository.

### 2. Create the Worker

[dash.cloudflare.com](https://dash.cloudflare.com) → sign up (free) →
**Workers & Pages** → **Create** → **Start with Hello World!** → **Deploy**

Name it `tiktok-streaks-cron`.

Then **Edit code**, delete what's there, paste the contents of
[`worker.js`](worker.js), and **Deploy**.

### 3. Add the token as a secret

Worker → **Settings** → **Variables and Secrets** → **Add**

- Type: **Secret** (not plaintext — secrets are encrypted and not readable back)
- Name: `GH_TOKEN`
- Value: the token from step 1

**Deploy** again so the secret takes effect.

### 4. Add the cron triggers

Worker → **Settings** → **Trigger Events** → **Add** → **Cron Trigger**

Add these three (times are UTC):

| Cron | Local (UTC+3) | Purpose |
|---|---|---|
| `17 5 * * *` | 08:17 | the real one |
| `23 9 * * *` | 12:23 | backup |
| `41 13 * * *` | 16:41 | last chance |

The backups are free: if the morning run already messaged everyone, the workflow
exits in about two seconds without opening a browser.

### 5. Test it now

Open your Worker's URL (`https://tiktok-streaks-cron.<your-subdomain>.workers.dev`).

- `Dispatched daily.yml on YOUR-USERNAME/YOUR-REPO` → working. Check the repo's
  Actions tab; a run should appear within seconds.
- A `401`/`403` → the token is wrong, expired, or missing the Actions permission
- A `404` → the token can't see the repo, or the workflow filename is wrong

Note that visiting the URL **really does send the messages**, so only test once
per day, or expect the "everyone already messaged" no-op.

## Checking it later

Runs triggered this way appear in the Actions tab as `workflow_dispatch`, not
`schedule`. If you see one appearing daily around 08:17 that you didn't start,
the Worker is doing its job.

Cloudflare dashboard → your Worker → **Logs** shows every invocation and any
failure.

## If the token expires

Dispatches start failing with 401 and the daily job simply stops — silently,
since a run that never starts can't fail. Repeat step 1 and update the `GH_TOKEN`
secret. Worth a calendar reminder for 11 months out.
