/**
 * Skill market client.
 *
 * The catalog is a plain JSON document produced by `registry/scripts/build-registry.mjs`
 * from one YAML file per skill. Installing an entry downloads the source
 * repository's tarball and extracts only the directory that holds the skill, so
 * sibling scripts and assets come along.
 *
 * @module dsh-skill-manager/market
 */
import { ArchiveError, readTarGz } from "./archive.js";
import { decodeUploads, installSkills, planSkills } from "./install.js";

/** Where the built catalog lives by default. */
export const DEFAULT_REGISTRY_URL = "https://raw.githubusercontent.com/MyRemme/dsh-skill-manager/main/registry/skills.json";

/** Accepted catalog locations: plain HTTP(S), nothing else. */
const REGISTRY_URL = /^https?:\/\/[^\s]+$/u;

/**
 * Reject catalog URLs that are not plain HTTP(S).
 * @param url - candidate URL.
 * @returns the URL.
 * @throws MarketError when the scheme is not http or https.
 */
export function assertRegistryUrl(url) {
  if (typeof url !== "string" || !REGISTRY_URL.test(url)) {
    throw new MarketError(`invalid registry URL: ${JSON.stringify(url)}`);
  }
  return url;
}

/** Raised for network and catalog-shape problems. */
export class MarketError extends Error {
  constructor(message) {
    super(message);
    this.name = "MarketError";
  }
}

/** Validate and normalise a catalog document. */
function normalizeCatalog(payload) {
  if (payload === null || typeof payload !== "object") throw new MarketError("registry document is not an object");
  const raw = Array.isArray(payload.skills) ? payload.skills : undefined;
  if (raw === undefined) throw new MarketError("registry document has no `skills` array");
  const skills = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    if (typeof entry.name !== "string" || typeof entry.repo !== "string") continue;
    skills.push({
      id: typeof entry.id === "string" ? entry.id : `${entry.repo}#${entry.path ?? ""}`,
      name: entry.name,
      repo: entry.repo,
      ...(typeof entry.path === "string" ? { path: entry.path } : {}),
      ...(typeof entry.ref === "string" ? { ref: entry.ref } : {}),
      ...(typeof entry.category === "string" ? { category: entry.category } : {}),
      ...(Array.isArray(entry.tags) ? { tags: entry.tags.filter((tag) => typeof tag === "string") } : {}),
      ...(entry.description !== null && typeof entry.description === "object" ? { description: entry.description } : {}),
      ...(typeof entry.license === "string" ? { license: entry.license } : {}),
      ...(typeof entry.author === "string" ? { author: entry.author } : {}),
      ...(Number.isInteger(entry.stars) ? { stars: entry.stars } : {}),
    });
  }
  return {
    version: Number.isInteger(payload.version) ? payload.version : 1,
    ...(typeof payload.generatedAt === "string" ? { generatedAt: payload.generatedAt } : {}),
    skills,
  };
}

/**
 * Fetch and normalise the catalog, with a small in-process cache.
 * @param options - `url`, `ttlMs`, `force`, `cache`.
 * @returns the catalog plus its fetch metadata.
 */
export async function fetchCatalog(options) {
  const url = assertRegistryUrl(options.url ?? DEFAULT_REGISTRY_URL);
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const cache = options.cache;
  const cached = cache?.get(url);
  if (options.force !== true && cached !== undefined && Date.now() - cached.fetchedAt < ttlMs) {
    return { catalog: cached.catalog, fetchedAt: cached.fetchedAt, url, cached: true };
  }
  let response;
  try {
    response = await fetch(url, { headers: { accept: "application/json", "user-agent": "dsh-skill-manager" } });
  } catch (error) {
    throw new MarketError(`cannot reach the skill registry: ${String(error)}`);
  }
  if (!response.ok) throw new MarketError(`skill registry returned HTTP ${response.status}`);
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new MarketError(`skill registry is not valid JSON: ${String(error)}`);
  }
  const catalog = normalizeCatalog(payload);
  const fetchedAt = Date.now();
  cache?.set(url, { catalog, fetchedAt });
  return { catalog, fetchedAt, url, cached: false };
}

/**
 * Reject repository coordinates that could produce an unexpected request URL.
 * @param repo - `owner/name`.
 * @throws MarketError when the shape is not a plain GitHub repository.
 */
export function assertRepo(repo) {
  const shapeOk = typeof repo === "string" && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(repo);
  const segments = shapeOk ? repo.split("/") : [];
  if (!shapeOk || segments.some((segment) => segment === "." || segment === "..")) {
    throw new MarketError(`invalid repository coordinate: ${JSON.stringify(repo)}`);
  }
}

/** Reject refs that could escape the expected path segment. */
function assertRef(ref) {
  if (typeof ref !== "string" || ref === "" || ref.includes("..") || !/^[A-Za-z0-9._/-]+$/u.test(ref)) {
    throw new MarketError(`invalid git ref: ${JSON.stringify(ref)}`);
  }
}

/**
 * Download a repository tarball.
 * @param repo - `owner/name`.
 * @param ref - branch, tag or commit.
 * @param options - `maxBytes`.
 * @returns the raw `.tar.gz` bytes.
 */
export async function fetchRepoTarball(repo, ref, options = {}) {
  assertRepo(repo);
  const resolvedRef = ref ?? "main";
  assertRef(resolvedRef);
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const url = `https://codeload.github.com/${repo}/tar.gz/${resolvedRef}`;
  let response;
  try {
    response = await fetch(url, { headers: { "user-agent": "dsh-skill-manager" }, redirect: "follow" });
  } catch (error) {
    throw new MarketError(`cannot download ${repo}: ${String(error)}`);
  }
  if (!response.ok) throw new MarketError(`cannot download ${repo}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new MarketError(`${repo} archive exceeds the ${maxBytes} byte limit`);
  return { buffer, url };
}

/**
 * Reduce a downloaded repository archive to the plans for one catalog entry.
 * @param buffer - `.tar.gz` bytes.
 * @param entry - catalog entry.
 * @param options - archive caps.
 * @returns skill plans ready for {@link installSkills}.
 */
export function plansFromRepoArchive(buffer, entry, options = {}) {
  const entries = readTarGz(buffer, options);
  const wanted = typeof entry.path === "string" ? entry.path.replace(/^\/+/u, "") : undefined;
  const scoped =
    wanted === undefined || wanted === ""
      ? entries
      : (() => {
          const directory = wanted.endsWith("/SKILL.md") ? wanted.slice(0, -"/SKILL.md".length) : wanted;
          if (directory === "") return entries;
          const inside = entries.filter((file) => file.path === directory || file.path.startsWith(`${directory}/`));
          if (inside.length === 0) throw new ArchiveError(`${entry.repo} does not contain ${directory}`);
          return inside.map((file) => ({ path: file.path.slice(directory.length + 1), data: file.data }));
        })();
  const plans = planSkills(scoped, options);
  for (const plan of plans) plan.requested = entry.name;
  return plans;
}

/**
 * Install a catalog entry into a skill root.
 * @param entry - catalog entry.
 * @param options - destination and overwrite policy.
 * @returns install results plus the source URL.
 */
export async function installFromMarket(entry, options) {
  const tarball = await fetchRepoTarball(entry.repo, entry.ref, options);
  const plans = plansFromRepoArchive(tarball.buffer, entry, options);
  const results = await installSkills(plans, options);
  return { source: tarball.url, results };
}

/**
 * Turn an uploaded ZIP into installed skills.
 * @param buffer - ZIP bytes.
 * @param options - destination and overwrite policy.
 * @returns install results.
 */
export async function installFromZip(buffer, options) {
  const { readZip } = await import("./archive.js");
  const entries = readZip(buffer, options);
  const plans = planSkills(entries, options);
  return installSkills(plans, options);
}

/**
 * Turn client-supplied base64 uploads into installed skills.
 * @param files - `{ path, data }` upload records.
 * @param options - destination and overwrite policy.
 * @returns install results.
 */
export async function installFromUploads(files, options) {
  const entries = decodeUploads(files, options);
  const plans = planSkills(entries, options);
  return installSkills(plans, options);
}
