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

/**
 * Parse `--flag value` and bare `--flag` pairs.
 *
 * `--query` may be repeated; each one is a separate sweep.
 */
export function parseArgs(argv) {
  const args = { queries: [], pages: 1, minStars: 0, json: false, sleep: true, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") args.json = true;
    else if (token === "--no-sleep") args.sleep = false;
    else if (token === "--all") args.queries.push("__default__");
    else if (token.startsWith("--") && index + 1 < argv.length) {
      const key = token.slice(2);
      const value = argv[index + 1];
      index += 1;
      if (key === "query") args.queries.push(value);
      else if (key === "queries") {
        for (const part of value.split(",")) {
          if (part.trim() !== "") args.queries.push(part.trim());
        }
      } else if (key === "pages") args.pages = Math.max(1, Math.min(10, Number.parseInt(value, 10) || 1));
      else if (key === "min-stars") args.minStars = Number.parseInt(value, 10) || 0;
      else if (key === "out") args.out = value;
      else throw new Error(`unknown flag: ${token}`);
    }
  }
  if (args.queries.length === 0) args.queries.push("claude skills");
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

/**
 * Queries worth running.
 *
 * These are shapes of query, not a crawl list. Every one of them is a normal
 * search a person could type, so this is a wider net rather than a way around
 * the rate limit.
 */
export const DEFAULT_QUERIES = [
  "claude skills",
  "claude code skills",
  "agent skills",
  "claude code plugin",
  "mcp server skills",
  "ai coding agent rules",
  "claude subagents",
  "cursor rules",
  "codex skills",
  "llm prompt skills",
  "skill marketplace",
  "awesome claude",
];

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

/**
 * Sweep one query.
 *
 * @returns the verdicts plus whether a rate limit stopped the sweep early.
 */
async function sweep(query, args, token) {
  const stem = `${query} in:name,description`;
  const qualifiers = args.minStars > 0 ? ` stars:>=${args.minStars}` : "";
  const encoded = encodeURIComponent(stem + qualifiers);
  const kept = [];
  const dropped = [];
  let total = 0;
  let limited = false;

  const first = await api(`/search/repositories?q=${encoded}&per_page=1&sort=stars&order=desc`, token);
  if (!first.ok) {
    process.stdout.write(`  ${query}: HTTP ${first.status}, skipped\n`);
    return { kept, dropped, total, limited: first.status === 403 || first.status === 429 };
  }
  total = first.body.total_count ?? 0;

  // The search endpoint never returns past the first 1000 hits, so pages beyond
  // that would be an empty result, not a deeper one.
  const pages = Math.min(args.pages, Math.ceil(Math.min(total, 1000) / 100));
  process.stdout.write(`  ${query} — ${total} candidates, ${pages} page(s)\n`);

  for (let page = 1; page <= pages; page += 1) {
    const response = await api(`/search/repositories?q=${encoded}&per_page=100&sort=stars&order=desc&page=${page}`, token);
    if (!response.ok) {
      // A rate limit is a stop signal, not a retry signal. Retrying into it is
      // how an account gets flagged.
      limited = response.status === 403 || response.status === 429;
      process.stdout.write(`    page ${page}: HTTP ${response.status}${limited ? " — search budget exhausted" : ""}\n`);
      break;
    }
    const items = response.body.items ?? [];
    for (const repo of items) {
      const verdict = judge(repo);
      if (verdict.allowed) kept.push(verdict);
      else dropped.push(verdict);
    }
    process.stdout.write(`    page ${page}: ${items.length} repositories, ${response.remaining ?? "?"} search requests left\n`);
    // The search endpoint allows 30 requests/minute authenticated and 10
    // unauthenticated. Wait rather than discover the limit by hitting it.
    if (page < pages && args.sleep) await sleep(token === null ? 6500 : 2200);
  }

  return { kept, dropped, total, limited };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { token, source } = readToken();

  const budget = await reportBudget(token);
  if (budget === null) {
    process.stderr.write("could not reach api.github.com\n");
    return 1;
  }

  const queries = args.queries.length === 1 && args.queries[0] === "__default__" ? DEFAULT_QUERIES : args.queries;
  process.stdout.write(`token      : ${token === null ? "none (anonymous)" : `from $${source}`}\n`);
  process.stdout.write(`budget     : core ${budget.core?.remaining ?? "?"}/${budget.core?.limit ?? "?"}, search ${budget.search?.remaining ?? "?"}/${budget.search?.limit ?? "?"}\n`);
  process.stdout.write(`queries    : ${queries.length}\n\n`);

  const seen = new Map();
  const kept = [];
  const dropped = [];

  for (const query of queries) {
    const result = await sweep(query, args, token);
    for (const repo of result.kept) {
      if (seen.has(repo.fullName)) continue;
      seen.set(repo.fullName, true);
      kept.push(repo);
    }
    for (const repo of result.dropped) {
      const key = `#${repo.fullName}`;
      if (seen.has(key)) continue;
      seen.set(key, true);
      dropped.push(repo);
    }
    // Spread the sweeps out rather than spending the whole minute's budget at once.
    if (args.sleep) await sleep(token === null ? 6500 : 2200);
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

  if (args.out !== null) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(args.out, `${JSON.stringify({ generatedAt: new Date().toISOString(), queries, kept, dropped }, null, 2)}\n`, "utf8");
    process.stdout.write(`\nwrote ${args.out}\n`);
  } else if (args.json) {
    process.stdout.write(`\n${JSON.stringify({ queries, kept, dropped }, null, 2)}\n`);
  }

  process.stdout.write(
    `\nCandidates only. A repository-level license does not cover the skill file\n` +
      `itself, so each one still needs its path and license checked before it becomes\n` +
      `an entry in registry/data/skills/.\n`,
  );
  return 0;
}

process.exitCode = await main();
