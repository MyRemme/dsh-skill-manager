/**
 * Self-update check.
 *
 * The plugin ships as a git dependency, so "is there a newer version" means
 * "does the repository's package.json on the default branch declare a version
 * above mine". That is one small API call, and it answers the only question
 * worth showing the user: is what I have behind what exists.
 *
 * @module dsh-skill-manager/update
 */
import { MarketError, assertRepo } from "./market.js";

/** The repository this package is published from. */
export const REPO = "MyRemme/dsh-skill-manager";
/** The repository's human-facing page. */
export const REPO_URL = `https://github.com/${REPO}`;
/** Where a skill is submitted. */
export const SUBMIT_URL = `${REPO_URL}/issues/new`;
/** Where releases are listed. */
export const RELEASES_URL = `${REPO_URL}/releases`;

/**
 * Compare two dotted versions, following the semver rule that a prerelease is
 * lower than its own release (`0.2.0-rc.1` < `0.2.0`).
 *
 * This is not a full semver implementation: it exists to answer "is the remote
 * manifest ahead of mine", and it treats an unparseable segment as text rather
 * than refusing to answer.
 *
 * @param a - left version.
 * @param b - right version.
 * @returns negative when a < b, 0 when equal, positive when a > b.
 */
export function compareVersions(a, b) {
  const [coreA, preA] = String(a).split("-", 2);
  const [coreB, preB] = String(b).split("-", 2);
  const left = coreA.split(".");
  const right = coreB.split(".");
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? "0";
    const r = right[index] ?? "0";
    const ln = Number.parseInt(l, 10);
    const rn = Number.parseInt(r, 10);
    if (Number.isInteger(ln) && Number.isInteger(rn)) {
      if (ln !== rn) return ln - rn;
      continue;
    }
    const compared = l.localeCompare(r);
    if (compared !== 0) return compared;
  }
  // Numeric cores are equal from here on.
  if (preA === undefined && preB === undefined) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA.localeCompare(preB);
}

function headers() {
  const base = { accept: "application/vnd.github+json", "user-agent": "dsh-skill-manager" };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (typeof token === "string" && token !== "") base.authorization = `Bearer ${token}`;
  return base;
}

/**
 * Read the version the default branch declares.
 * @param options - `repo`, `url`, `maxBytes`.
 * @returns `{ version, ref, url }`.
 * @throws MarketError when the repository is unreachable or malformed.
 */
export async function fetchLatestVersion(options = {}) {
  const repo = options.repo ?? REPO;
  assertRepo(repo);
  const url = options.url ?? `https://api.github.com/repos/${repo}/contents/package.json?ref=main`;
  const maxBytes = options.maxBytes ?? 1024 * 1024;

  let response;
  try {
    response = await fetch(url, { headers: headers() });
  } catch (error) {
    throw new MarketError(`cannot reach ${repo}: ${String(error)}`);
  }
  if (!response.ok) throw new MarketError(`${repo} returned HTTP ${response.status}`);
  const payload = await response.json();
  const size = typeof payload.size === "number" ? payload.size : 0;
  if (size > maxBytes) throw new MarketError(`${repo}'s package.json is implausibly large`);
  let text;
  if (typeof payload.content === "string" && payload.content !== "") {
    text = Buffer.from(payload.content, "base64").toString("utf8");
  } else if (typeof payload.download_url === "string") {
    const raw = await fetch(payload.download_url, { headers: headers() });
    if (!raw.ok) throw new MarketError(`${repo}'s package.json returned HTTP ${raw.status}`);
    text = await raw.text();
  } else {
    throw new MarketError(`${repo}'s package.json could not be read`);
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw new MarketError(`${repo}'s package.json is not valid JSON: ${String(error)}`);
  }
  if (typeof manifest.version !== "string" || manifest.version === "") {
    throw new MarketError(`${repo}'s package.json declares no version`);
  }
  return {
    version: manifest.version,
    ref: "main",
    url: `${REPO_URL}/blob/main/package.json`,
  };
}

/**
 * Decide what to tell the user about their copy.
 * @param current - the installed version.
 * @param latest - the version declared on the default branch.
 * @returns `{ current, latest, status, comparison }` where status is one of
 *   `current`, `behind`, `ahead`, `unknown`.
 */
export function compare(current, latest) {
  if (typeof current !== "string" || current === "" || typeof latest !== "string" || latest === "") {
    return { current, latest, status: "unknown", comparison: 0 };
  }
  const comparison = compareVersions(latest, current);
  const status = comparison > 0 ? "behind" : comparison < 0 ? "ahead" : "current";
  return { current, latest, status, comparison };
}
