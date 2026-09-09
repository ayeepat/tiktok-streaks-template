/**
 * External scheduler.
 *
 * GitHub Actions' own scheduler never delivered a single `schedule` event to
 * this account — measured over 9 slots across a private and a public repo,
 * while manual dispatch worked 10/10. So the cron lives here instead, and this
 * Worker starts the workflow through GitHub's API.
 *
 * Cloudflare's cron triggers are reliable and free, and nothing here depends on
 * any machine you own.
 *
 * Needs one secret, GH_TOKEN: a GitHub fine-grained personal access token with
 * access to ONLY this repository and only the "Actions: Read and write"
 * permission. It cannot read your code, push commits, or touch anything else.
 */

const OWNER = "YOUR-GITHUB-USERNAME";
const REPO = "YOUR-REPO-NAME";
const WORKFLOW = "daily.yml";
const REF = "main";

async function dispatch(env) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      // GitHub rejects API requests without a User-Agent.
      "User-Agent": "tiktok-streaks-cron",
      "Content-Type": "application/json",
    },
    // No `inputs` — dry_run defaults to false in the workflow. Passing a
    // boolean-typed input over the REST API is fiddly and buys nothing here.
    body: JSON.stringify({ ref: REF }),
  });

  // A successful dispatch is 204 No Content — there is no body to parse.
  if (res.status === 204) {
    return { ok: true, message: `Dispatched ${WORKFLOW} on ${OWNER}/${REPO}` };
  }

  const body = await res.text();
  return {
    ok: false,
    message:
      `GitHub returned ${res.status}: ${body}\n` +
      (res.status === 401 || res.status === 403
        ? "Check GH_TOKEN: it needs 'Actions: Read and write' on this repo, and must not be expired."
        : res.status === 404
          ? "404 usually means the token cannot see the repo, or the workflow filename is wrong."
          : ""),
  };
}

export default {
  // Fired by the cron triggers configured in the Cloudflare dashboard.
  async scheduled(event, env, ctx) {
    const result = await dispatch(env);
    console.log(`[${new Date().toISOString()}] ${result.ok ? "OK" : "FAILED"} — ${result.message}`);
    if (!result.ok) {
      // Throwing marks the invocation as errored so it shows up in Cloudflare's
      // dashboard rather than disappearing into a log nobody reads.
      throw new Error(result.message);
    }
  },

  // Visiting the Worker's URL runs the same thing, so you can test setup
  // without waiting for the cron.
  async fetch(request, env) {
    const result = await dispatch(env);
    return new Response(result.message, {
      status: result.ok ? 200 : 500,
      headers: { "Content-Type": "text/plain" },
    });
  },
};
