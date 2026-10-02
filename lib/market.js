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
import { ArchiveError, readTarGz, stripSingleRoot } from "./archive.js";
import { installSkills, planSkills } from "./install.js";
import tls from "node:tls";

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
      ...(typeof entry.version === "string" ? { version: entry.version } : {}),
      ...(typeof entry.commit === "string" ? { commit: entry.commit } : {}),
      ...(typeof entry.added === "string" ? { added: entry.added } : {}),
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
 * Rewrite a `raw.githubusercontent.com` file URL into the equivalent GitHub
 * contents API URL.
 *
 * Some networks reset connections to the raw host while `api.github.com` keeps
 * working, so the catalog fetch falls back to this form instead of failing.
 *
 * @param url - a raw.githubusercontent.com URL.
 * @returns the API URL, or undefined when the input is not that shape.
 */
export function apiFallbackUrl(url) {
  const match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/u.exec(String(url));
  if (match === null) return undefined;
  const [, owner, repo, ref, path] = match;
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`;
}

const CATALOG_HEADERS = { accept: "application/json", "user-agent": "dsh-skill-manager" };

function apiHeaders() {
  const headers = { ...CATALOG_HEADERS, accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (typeof token === "string" && token !== "") headers.authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Trust the operating system's certificate authorities as well as Node's own.
 *
 * Some networks terminate TLS with a middlebox whose certificate chains to a CA
 * installed in the system store rather than in the bundle Node ships. Node does
 * not read the system store by default, so every request to GitHub fails with
 * "unable to verify the first certificate" and the market reports that it cannot
 * reach its registry — while the same request succeeds from a browser. Both
 * documented routes fail the same way, so there is no fallback left to try.
 *
 * This adds the system roots rather than disabling verification. Setting
 * NODE_TLS_REJECT_UNAUTHORIZED=0 would also make the request succeed, but it
 * turns off certificate checking for every request the process makes, which is
 * not a trade a catalog fetch is entitled to make on the user's behalf.
 *
 * Idempotent, and a no-op where the API or the system store is unavailable, so
 * a normal machine pays nothing for it.
 */
let systemRootsTried = false;
function trustSystemAuthorities() {
  if (systemRootsTried === true) return;
  systemRootsTried = true;
  try {
    const roots = tls.getCACertificates("system");
    if (Array.isArray(roots) && roots.length > 0) tls.setDefaultCACertificates(roots);
  } catch {
    // Older Node, a locked-down system store, or a non-OpenSSL build. The fetch
    // below then fails with its own diagnostic, which is the honest outcome.
  }
}

/** Whether an error is the TLS trust failure this module can recover from. */
function isCertificateError(error) {
  const text = String(error?.cause?.message ?? error?.message ?? error);
  return /unable to verify the first certificate|self[- ]signed certificate|SELF_SIGNED_CERT/i.test(text);
}

/**
 * Fetch the catalog text, falling back to the GitHub contents API when the raw
 * host is unreachable.
 * @param url - catalog URL.
 * @returns the document text.
 * @throws MarketError when neither route yields a document.
 */
async function fetchCatalogText(url) {
  let firstFailure;
  try {
    const response = await fetch(url, { headers: CATALOG_HEADERS });
    if (response.ok) return await response.text();
    // A 404 is the registry's own answer about a missing file; do not mask it.
    if (response.status === 404) throw new MarketError(`skill registry returned HTTP 404`);
    firstFailure = `HTTP ${response.status}`;
  } catch (error) {
    if (error instanceof MarketError) throw error;
    firstFailure = String(error);
    // The trust store is extended and the request retried once, rather than
    // reporting an unreachable registry when the only fault is a missing system
    // root. Bounded: one retry, then the normal fallback runs as before.
    if (isCertificateError(error)) {
      trustSystemAuthorities();
      try {
        const retry = await fetch(url, { headers: CATALOG_HEADERS });
        if (retry.ok) return await retry.text();
        if (retry.status !== 404) firstFailure = `HTTP ${retry.status}`;
      } catch (retryError) {
        firstFailure = String(retryError);
      }
    }
  }

  const fallback = apiFallbackUrl(url);
  if (fallback === undefined) throw new MarketError(`cannot reach the skill registry: ${firstFailure}`);
  let response;
  try {
    response = await fetch(fallback, { headers: apiHeaders() });
  } catch (error) {
    // The API route is reached over the same trust store as the raw host, so it
    // fails the same way when a system root is missing.
    if (!isCertificateError(error)) {
      throw new MarketError(`cannot reach the skill registry (direct and API routes both failed): ${String(error)}`);
    }
    trustSystemAuthorities();
    try {
      response = await fetch(fallback, { headers: apiHeaders() });
    } catch (retryError) {
      throw new MarketError(`cannot reach the skill registry (direct and API routes both failed): ${String(retryError)}`);
    }
  }
  if (!response.ok) {
    throw new MarketError(`cannot reach the skill registry: ${firstFailure}, then HTTP ${response.status} from the API route`);
  }
  const payload = await response.json();
  return Buffer.from(payload.content ?? "", "base64").toString("utf8");
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
  const text = await fetchCatalogText(url);
  let payload;
  try {
    payload = JSON.parse(text);
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
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  let response;
  try {
    response = await fetch(url, { headers: { "user-agent": "dsh-skill-manager" }, redirect: "follow" });
  } catch (error) {
    // A catalog that rendered would still fail to install from, because the
    // tarball comes off the same host chain. Extending the trust store once is
    // cheaper than a separate diagnostic for each route.
    if (!isCertificateError(error)) throw new MarketError(`cannot download ${repo}: ${String(error)}`);
    trustSystemAuthorities();
    try {
      response = await fetch(url, { headers: { "user-agent": "dsh-skill-manager" }, redirect: "follow" });
    } catch (retryError) {
      throw new MarketError(`cannot download ${repo}: ${String(retryError)}`);
    }
  }
  if (!response.ok) throw new MarketError(`cannot download ${repo}: HTTP ${response.status}`);
  // `codeload` sends no `Content-Length` on HEAD and switches to chunked transfer
  // for anything sizeable, so the total cannot be read from the headers. Report
  // running bytes instead, plus the cap as the denominator, which is what a
  // progress bar can actually fill honestly.
  const declared = Number(response.headers.get("content-length"));
  const total = Number.isFinite(declared) && declared > 0 ? declared : null;
  const indeterminate = total === null;
  const chunks = [];
  let received = 0;
  onProgress?.({ phase: "download", received, total: total ?? maxBytes, indeterminate });
  try {
    for await (const chunk of response.body) {
      chunks.push(Buffer.from(chunk));
      received += chunk.length;
      // Stop accumulating at the cap rather than reading a 233 MB archive before
      // rejecting it. This mirrors what `inspect.mjs` does at admission time.
      if (received > maxBytes) {
        // The `for await` already holds the stream, so `cancel()` reports
        // ERR_INVALID_STATE here. Breaking out closes the reader through the
        // iterator's own return, which is what actually stops the transfer.
        throw new MarketError(`${repo} archive exceeds the ${maxBytes} byte limit`);
      }
      onProgress?.({ phase: "download", received, total: total ?? maxBytes, indeterminate });
    }
  } catch (error) {
    // The cap is reported as a download failure, so it has to survive the
    // rewrite below rather than being relabelled as a network error.
    if (error instanceof MarketError) throw error;
    throw new MarketError(`cannot download ${repo}: ${String(error)}`);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length > maxBytes) throw new MarketError(`${repo} archive exceeds the ${maxBytes} byte limit`);
  onProgress?.({ phase: "download", received: buffer.length, total: total ?? maxBytes, indeterminate });
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
  // GitHub wraps every tarball in `<repo>-<ref>/`, and the catalog's `path` is
  // relative to the repository root, so the wrapper has to come off before the
  // entry's directory can be located.
  const entries = stripSingleRoot(readTarGz(buffer, options));
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
  options.onProgress?.({ phase: "extract", received: tarball.buffer.length, total: null, indeterminate: true });
  const plans = plansFromRepoArchive(tarball.buffer, entry, options);
  options.onProgress?.({ phase: "write", received: null, total: null, indeterminate: true });
  const results = await installSkills(plans, options);
  return { source: tarball.url, results };
}
