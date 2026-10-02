/**
 * Discover candidate skills on GitHub and keep only the ones that pass the
 * license gate.
 *
 * This crawls nothing. It asks the search API for repositories, reads the
 * `license.spdx_id` GitHub already computed for each one, and drops everything
 * that is not on the allow list. One request returns 100 candidates, so a run
 * costs single-digit requests instead of one per repository.
 *
 * The token is read from the environment and never written to disk, never
 * printed, and never sent anywhere except api.github.com. Without a token the
 * script still works on the anonymous 60/hour budget; it just makes less
 * progress per run.
 *
 * Usage:
 *   node registry/scripts/discover.mjs --query "claude skills" --pages 1
 *   node registry/scripts/discover.mjs --query "agent skills" --pages 2 --min-stars 50
 *
 * Output is a report on stdout. Nothing is written into registry/data — a
 * candidate still has to be turned into an entry by hand, because a repository
 * having a license says nothing about the skill file itself.
 */

import { LICENSE_ALLOW, normalizeLicense } from "../schema.mjs";

const API = "https://api.github.com";
const USER_AGENT = "dsh-skill-manager/discover";

/** Parse `--flag value` and bare `--flag` pairs. */
function parseArgs(argv) {
  const args = { query: "claude skills", pages: 1, minStars: 0, json: false, sleep: true };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") args.json = true;
    else if (token === "--no-sleep") args.sleep = false;
    else if (token.startsWith("--") && index + 1 < argv.length) {
      const key = token.slice(2);
      const value = argv[index + 1];
      index += 1;
      if (key === "query") args.query = value;
      else if (key === "pages") args.pages = Math.max(1, Math.min(10, Number.parseInt(value, 10) || 1));
      else if (key === "min-stars") args.minStars = Number.parseInt(value, 10) || 0;
      else throw new Error(`unknown flag: ${token}`);
    }
  }
  return args;
}

/** Read the token without ever echoing it. */
function readToken() {
  for (const name of ["GITHUB_TOKEN", "GH_TOKEN"]) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim() !== "") return { token: value.trim(), source: name };
  }
  return { token: null, source: null };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call the GitHub API once.
 *
 * @param path - request path, including the query string.
 * @param token - bearer token, or null for an anonymous request.
 * @returns `{ ok, status, body }`; never throws on an HTTP error.
 */
async function api(path, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, { headers });
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  let body = null;
  const text = await response.text();
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
  }
  return { ok: response.ok, status: response.status, body, remaining, reset };
}

/** Report the budget the token (or the lack of one) has left. */
async function reportBudget(token) {
  const { ok, body } = await api("/rate_limit", token);
  if (!ok || body === null) return null;
  const core = body.resources?.core;
  const search = body.resources?.search;
  return { core, search };
}

/** Turn one search hit into a decision. */
function judge(repo) {
  const spdx = repo.license?.spdx_id ?? null;
  const normalized = normalizeLicense(spdx ?? "");
  const allowed = spdx !== null && LICENSE_ALLOW.includes(normalized);
  return {
    fullName: repo.full_name,
    stars: repo.stargazers_count,
    spdx,
    normalized: allowed ? normalized : null,
    allowed,
    reason: allowed
      ? null
      : spdx === null
        ? "no license declared"
        : spdx === "NOASSERTION"
          ? "license present but unidentified"
          : `license ${spdx} is not on the allow list`,
    pushedAt: repo.pushed_at,
    description: typeof repo.description === "string" ? repo.description : "",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { token, source } = readToken();

  const budget = await reportBudget(token);
  if (budget === null) {
    process.stderr.write("could not reach api.github.com\n");
    return 1;
  }

  const stem = `${args.query} in:name,description`;
  const qualifiers = args.minStars > 0 ? ` stars:>=${args.minStars}` : "";
  const searchPath = `/search/repositories?q=${encodeURIComponent(stem + qualifiers)}&per_page=100&sort=stars&order=desc`;

  // One search request tells us how many pages exist and consumes one unit.
  const first = await api(`/search/repositories?q=${encodeURIComponent(stem + qualifiers)}&per_page=1&sort=stars&order=desc`, token);
  if (!first.ok) {
    process.stderr.write(`search failed: HTTP ${first.status}\n`);
    if (first.status === 403) {
      process.stderr.write(
        token === null
          ? "  the anonymous budget is exhausted or the search rate limit was hit; set GITHUB_TOKEN to raise it\n"
          : "  the token's budget is exhausted or it lacks access; check the token's scopes\n",
      );
    }
    return 1;
  }

  const total = first.body.total_count ?? 0;
  process.stdout.write(`query      : ${args.query}\n`);
  process.stdout.write(`token      : ${token === null ? "none (anonymous)" : `from $${source}`}\n`);
  process.stdout.write(`budget     : core ${budget.core?.remaining ?? "?"}/${budget.core?.limit ?? "?"}, search ${budget.search?.remaining ?? "?"}/${budget.search?.limit ?? "?"}\n`);
  process.stdout.write(`candidates : ${total}\n`);

  const pages = Math.min(args.pages, Math.ceil(Math.min(total, 1000) / 100));
  const kept = [];
  const dropped = [];
  for (let page = 1; page <= pages; page += 1) {
    const path = `${searchPath}&page=${page}`;
    const response = await api(path, token);
    if (!response.ok) {
      process.stderr.write(`page ${page} failed: HTTP ${response.status}\n`);
      break;
    }
    const items = response.body.items ?? [];
    for (const repo of items) {
      const verdict = judge(repo);
      if (verdict.allowed) kept.push(verdict);
      else dropped.push(verdict);
    }
    process.stdout.write(`  page ${page}: ${items.length} repositories, ${response.remaining ?? "?"} search requests left\n`);
    // The search endpoint allows 10 requests/minute authenticated, 10 unauthenticated.
    if (page < pages && args.sleep) await sleep(6500);
  }

  process.stdout.write(`\n--- pass the license gate: ${kept.length} ---\n`);
  for (const repo of kept) {
    process.stdout.write(`  ${repo.fullName.padEnd(52)} ${String(repo.stars).padStart(8)}  ${repo.normalized}\n`);
  }

  process.stdout.write(`\n--- rejected: ${dropped.length} ---\n`);
  const byReason = new Map();
  for (const repo of dropped) byReason.set(repo.reason, (byReason.get(repo.reason) ?? 0) + 1);
  for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${String(count).padStart(4)}  ${reason}\n`);
  }

  if (args.json) {
    process.stdout.write(`\n${JSON.stringify({ query: args.query, kept, dropped }, null, 2)}\n`);
  }

  process.stdout.write(
    `\nNothing was written. A repository-level license does not cover the skill file\n` +
      `itself, so each candidate still needs its path and license checked before it\n` +
      `becomes an entry in registry/data/skills/.\n`,
  );
  return 0;
}

process.exitCode = await main();
