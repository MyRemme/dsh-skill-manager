/**
 * Verify discovery candidates and turn the sound ones into entry files.
 *
 * `discover.mjs` answers "does this repository carry a license that permits
 * redistribution". That is a repository-level answer, and it is not enough to
 * write an entry, because an entry names a specific `SKILL.md` and a specific
 * `name`. This script closes the gap: for each candidate it reads the git tree,
 * finds the skill files, reads each one's frontmatter for the real `name`, and
 * refuses anything it cannot verify.
 *
 * A candidate is dropped when:
 *   - the repository has no `SKILL.md` at all;
 *   - a `SKILL.md` has no `name` in its frontmatter, or the name is not a legal
 *     skill name;
 *   - a skill directory carries its own `LICENSE`, because then the repository
 *     license does not speak for that skill;
 *   - the same skill name appears at two paths, which means we cannot tell which
 *     one the author intends;
 *   - the repository archive is larger than the installer's download cap, which
 *     makes every skill in it uninstallable no matter how good they are.
 *
 * That last rule exists because the installer fetches the whole repository
 * tarball and only then narrows it to one skill directory (`lib/market.js`).
 * A catalog that does not check the archive size ships entries whose install
 * button downloads 233 MB and then fails. Twelve of the first fifty-nine
 * entries were in that state; see `ARCHIVE_LIMIT_BYTES`.
 *
 * Nothing is written unless `--write` is passed. Verification reads a lot of
 * small files, so a run costs roughly two requests per candidate.
 *
 * Usage:
 *   node registry/scripts/inspect.mjs --in  _candidates.json                 # report only
 *   node registry/scripts/inspect.mjs --in  _candidates.json --top 30 --write
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.github.com";
const USER_AGENT = "dsh-skill-manager/inspect";
const CODELOAD = "https://codeload.github.com";

/**
 * The installer's archive cap, mirrored from `lib/market.js` (`maxBytes`,
 * default 32 MiB). A repository above it can never be installed, so it is not
 * admitted. Keep the two in step: if `market.js` raises its cap, raise this.
 */
const ARCHIVE_LIMIT_BYTES = 32 * 1024 * 1024;

/** The name grammar the skill loader enforces. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Where skill files are looked for, in priority order. */
const SKILL_ROOTS = [".claude/skills/", "skills/", ".claude/", "skill/", ""];

/**
 * Category written for every generated entry.
 *
 * Categorisation is a judgement this script cannot make from a repository
 * description, so it does not attempt one: generated entries land in the
 * catch-all category and a human moves the ones that deserve a real bucket.
 */
const PLACEHOLDER_CATEGORY = "other";

/** Matches MAX_DESCRIPTION in build-registry.mjs; the build rejects anything longer. */
const MAX_DESCRIPTION = 800;

function parseArgs(argv) {
  const args = { input: null, top: 30, perRepo: 3, write: false, sleep: true };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--write") args.write = true;
    else if (token === "--no-sleep") args.sleep = false;
    else if (token.startsWith("--") && index + 1 < argv.length) {
      const key = token.slice(2);
      const value = argv[index + 1];
      index += 1;
      if (key === "in") args.input = value;
      else if (key === "top") args.top = Number.parseInt(value, 10) || 30;
      else if (key === "per-repo") args.perRepo = Number.parseInt(value, 10) || 3;
      else throw new Error(`unknown flag: ${token}`);
    }
  }
  if (args.input === null) throw new Error("--in <file> is required (the --out file from discover.mjs)");
  return args;
}

function readToken() {
  for (const name of ["GITHUB_TOKEN", "GH_TOKEN"]) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, token) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT, "X-GitHub-Api-Version": "2022-11-28" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, { headers });
  let body = null;
  const text = await response.text();
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { ok: response.ok, status: response.status, body, remaining: response.headers.get("x-ratelimit-remaining") };
}

/**
 * Measure a repository archive without downloading all of it.
 *
 * `codeload` sends no `Content-Length` on a HEAD request and uses chunked
 * transfer for large archives, so the size cannot be read from headers. Reading
 * the stream and abandoning it once the cap is passed costs one cap-sized
 * download instead of the full archive — 2.4 s for a 233 MB repository against
 * 32 MB of transfer.
 *
 * @returns `{ bytes, over }` — `over` is true once the archive is known to
 *   exceed {@link ARCHIVE_LIMIT_BYTES}; `bytes` is then a lower bound.
 */
async function archiveSize(repo, ref, token) {
  const headers = { "User-Agent": USER_AGENT };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${CODELOAD}/${repo}/tar.gz/${ref}`, { headers, redirect: "follow" });
  } catch (error) {
    return { bytes: null, over: false, reason: `archive unreadable (${String(error)})` };
  }
  if (!response.ok) return { bytes: null, over: false, reason: `archive unreadable (HTTP ${response.status})` };
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      // Returning here rather than cancelling the stream is deliberate: the
      // `for await` holds the reader, so `cancel()` raises ERR_INVALID_STATE.
      // Returning closes it through the iterator, which is what halts the
      // transfer.
      if (bytes > ARCHIVE_LIMIT_BYTES) return { bytes, over: true };
    }
  } catch {
    // A truncated read still tells us the archive passed the cap.
    return { bytes, over: bytes > ARCHIVE_LIMIT_BYTES };
  }
  return { bytes, over: false };
}

/** Decode the base64 blob body GitHub returns for file contents. */
function decodeContent(payload) {
  if (payload === null || typeof payload.content !== "string") return null;
  const cleaned = payload.content.replace(/\n/gu, "");
  return Buffer.from(cleaned, "base64").toString("utf8");
}

/**
 * Pull `name` out of a SKILL.md frontmatter block.
 *
 * Only the leading `---` block counts, and only a plain scalar `name:` line.
 * Anything else means we could not verify the skill, which is a rejection.
 */
function readFrontmatterName(text) {
  if (typeof text !== "string") return null;
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text);
  if (match === null) return null;
  for (const line of match[1].split(/\r?\n/u)) {
    const field = /^name:[ \t]*(.*)$/u.exec(line);
    if (field !== null) {
      const value = field[1].trim().replace(/^["']|["']$/gu, "");
      return value === "" ? null : value;
    }
  }
  return null;
}

/**
 * Pull `description` out of a SKILL.md frontmatter block.
 *
 * Only a single-line scalar is read. A folded or block scalar (`description: >`
 * or `|`) would need a real YAML parser, so it is reported as absent rather than
 * guessed at.
 */
function readFrontmatterDescription(text) {
  if (typeof text !== "string") return null;
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text);
  if (match === null) return null;
  for (const line of match[1].split(/\r?\n/u)) {
    const field = /^description:[ \t]*(.*)$/u.exec(line);
    if (field !== null) {
      const value = field[1].trim().replace(/^["']|["']$/gu, "");
      if (value === "" || value === ">" || value === "|" || value === ">-" || value === "|-") return null;
      // Not truncated here: the build enforces its own length cap on the entry,
      // and a half sentence is worse than none when the summary is what a
      // translator works from.
      return value;
    }
  }
  return null;
}

/** Distinct directory containing a path, or "" for the repository root. */
function directoryOf(path) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/** How well a SKILL.md path matches the conventional locations. */
function rootRank(path) {
  const index = SKILL_ROOTS.findIndex((prefix) => path.startsWith(prefix));
  return index === -1 ? SKILL_ROOTS.length : index;
}

/**
 * Determine what a repository offers.
 *
 * The branch is whatever the repository declares as its default, not `main`:
 * `virgiliojr94/book-to-skill` and `alchaincyf/huashu-design` both use `master`,
 * and `yusufkaraaslan/Skill_Seekers` uses `development`. Guessing between `main`
 * and `master` silently produced entries pointing at paths that do not exist.
 *
 * @returns `{ skills, reason }` — `skills` is populated only when all of them
 *   are verifiable.
 */
async function inspectRepo(candidate, token, perRepo) {
  const repo = candidate.fullName;
  const meta = await api(`/repos/${repo}`, token);
  if (!meta.ok) return { skills: [], ref: null, reason: `metadata unreadable (HTTP ${meta.status})` };
  const ref = typeof meta.body?.default_branch === "string" ? meta.body.default_branch : null;
  if (ref === null) return { skills: [], ref: null, reason: "no default branch reported" };

  // Reachability comes before quality. The installer downloads the whole
  // repository and only then picks out one skill directory, so an archive over
  // the cap produces an entry that cannot be installed by anyone. Admitting one
  // is worse than dropping the repository: it looks installable and is not.
  const size = await archiveSize(repo, ref, token);
  if (size.over) {
    return {
      skills: [],
      ref,
      reason: `archive exceeds the ${ARCHIVE_LIMIT_BYTES / (1024 * 1024)} MiB download cap (>${(size.bytes / (1024 * 1024)).toFixed(1)} MiB)`,
    };
  }
  // Fail closed. An unmeasurable archive is not a small one, and admitting it
  // unmeasured would reintroduce exactly the defect this gate removes.
  if (size.bytes === null) return { skills: [], ref, reason: size.reason };

  const tree = await api(`/repos/${repo}/git/trees/${ref}?recursive=1`, token);
  if (!tree.ok) return { skills: [], ref, reason: `tree unreadable (HTTP ${tree.status})` };
  return collect(repo, ref, tree.body, token, perRepo);
}

/** Turn a tree listing into verified skill records. */
async function collect(repo, ref, treePayload, token, perRepo) {
  const entries = Array.isArray(treePayload?.tree) ? treePayload.tree : [];
  if (treePayload?.truncated === true) return { skills: [], reason: "tree too large to verify" };

  const skillFiles = entries.filter((entry) => entry.type === "blob" && entry.path.endsWith("SKILL.md"));
  if (skillFiles.length === 0) return { skills: [], reason: "no SKILL.md" };

  // A symlinked SKILL.md verifies here but cannot be installed. The contents API
  // dereferences a symlink and returns the real file, so frontmatter, name and
  // description all read correctly — but the installer downloads the tarball,
  // and the tar reader keeps only regular files (type 0 and 7) and drops every
  // symlink (type 2). The directory then arrives empty and the install reports
  // that the repository does not contain the entry's path. `alirezarezvani/claude-skills`
  // publishes 1574 symlinks; two entries were built on one and neither installed.
  //
  // Refusing them at admission is the honest outcome: a symlinked skill would
  // also install as a dangling link, so making the reader follow links would be
  // support for something the catalog should not publish.
  const symlinked = skillFiles.filter((entry) => entry.mode === "120000");
  const realSkillFiles = skillFiles.filter((entry) => entry.mode !== "120000");
  if (realSkillFiles.length === 0) return { skills: [], reason: "every SKILL.md is a symlink" };

  // Prefer conventional locations when the same skill is mirrored elsewhere.
  const chosen = new Map();
  for (const file of realSkillFiles.sort((a, b) => rootRank(a.path) - rootRank(b.path) || a.path.localeCompare(b.path))) {
    const dir = directoryOf(file.path);
    const name = dir === "" ? repo.split("/")[1].toLowerCase() : dir.split("/").pop().toLowerCase();
    if (!chosen.has(name)) chosen.set(name, file.path);
  }

  // One repository can hold hundreds of skills (affaan-m/ECC has 296). Taking all
  // of them would let a single repository dominate the catalog, so only the first
  // few by the order above are considered.
  const capped = new Map([...chosen].slice(0, perRepo));
  const skipped = chosen.size - capped.size;

  // A skill that ships its own LICENSE is not covered by the repository license.
  const ownLicenses = new Set(
    entries
      .filter((entry) => entry.type === "blob" && /(^|\/)LICEN[SC]E(\.(md|txt))?$/iu.test(entry.path))
      .map((entry) => directoryOf(entry.path)),
  );
  const repoRootHasLicense = ownLicenses.has("");

  const skills = [];
  const rejected = [];
  // Two directories can declare the same frontmatter name. An entry is keyed by
  // that name, so the second one would collide — keep the first and drop the rest.
  const taken = new Set();
  for (const [guessedName, path] of capped) {
    if (ownLicenses.has(directoryOf(path)) && directoryOf(path) !== "") {
      continue; // Nested license of unknown terms — out of scope, dropped below.
    }
    const blob = await api(`/repos/${repo}/contents/${path}?ref=${ref}`, token);
    const text = blob.ok ? decodeContent(blob.body) : null;
    const declared = readFrontmatterName(text);
    // A SKILL.md without a declared name is not a skill: `NanmiCoder/cc-haha`
    // keeps generated stubs in its skills directory, and `Skill_Seekers` has
    // plain documentation files named `*SKILL.md`. Falling back to the directory
    // name published those under a name the upstream file never claimed — and
    // the build later rejects the entry because the name does not match.
    if (declared === null) {
      rejected.push(`${path} (no \`name\` in frontmatter)`);
      continue;
    }
    const name = declared;
    if (!SKILL_NAME.test(name) || taken.has(name)) continue;
    taken.add(name);
    skills.push({ name, path, declared, summary: readFrontmatterDescription(text) });
    if (token === null) await sleep(120);
  }

  const droppedForNestedLicense = skillFiles.filter(
    (file) => ownLicenses.has(directoryOf(file.path)) && directoryOf(file.path) !== "",
  ).length;

  if (skills.length === 0) {
    return {
      skills: [],
      ref,
      reason:
        droppedForNestedLicense > 0
          ? "every skill directory carries its own LICENSE"
          : rejected.length > 0
            ? `no verifiable skill (${rejected[0]})`
            : "no verifiable skill",
    };
  }
  return {
    skills,
    ref,
    reason: null,
    note: repoRootHasLicense ? null : "no LICENSE at the repository root",
    replicated: realSkillFiles.length - chosen.size,
    skipped,
    rejected,
    // Reported rather than silently dropped, so a repository whose skills are
    // all symlinks produces a stated reason instead of a quiet zero.
    symlinked: symlinked.map((entry) => entry.path),
  };
}

/** Quote a YAML scalar only when it needs it. */
function yaml(text) {
  const value = String(text).replace(/\r?\n/gu, " ").trim();
  if (value === "") return '""';
  // A leading indicator character or a colon would change how YAML reads it.
  if (/^[\s>|@`"'#%&*!?,[\]{}:-]/u.test(value) || /:\s|\s#/u.test(value)) return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
  return value;
}

function entryFileName(repo, name) {
  return `${repo.replace("/", "__")}--${name}.yml`;
}

async function entryText(record, category) {
  const lines = [
    `repo: ${yaml(record.repo)}`,
    `name: ${yaml(record.name)}`,
    `path: ${yaml(record.path)}`,
    `ref: ${record.ref}`,
    `category: ${category}`,
    `license: ${record.license}`,
  ];
  if (typeof record.commit === "string" && record.commit !== "") lines.push(`commit: ${record.commit}`);
  lines.push(`added: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("description:");
  // Prefer what the skill says about itself; fall back to the repository blurb.
  // Clipped to the build's cap, but only here: `_verified.json` keeps the full
  // text so a translator is not working from a half sentence.
  const summary = record.summary ?? record.repoDescription ?? record.name;
  const clipped = summary.length > MAX_DESCRIPTION ? `${summary.slice(0, MAX_DESCRIPTION - 3)}...` : summary;
  lines.push(`  en: ${yaml(clipped)}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = readToken();
  const payload = JSON.parse(await readFile(args.input, "utf8"));
  const kept = Array.isArray(payload.kept) ? payload.kept : [];

  const shortlist = kept.slice(0, args.top);
  process.stdout.write(`token     : ${token === null ? "none (anonymous)" : "from environment"}\n`);
  process.stdout.write(`input     : ${args.input} (${kept.length} candidates, taking top ${shortlist.length})\n`);
  process.stdout.write(`per repo  : at most ${args.perRepo}\n`);
  process.stdout.write(`mode      : ${args.write ? "write entries" : "report only"}\n\n`);

  const verified = [];
  const refused = [];

  for (const candidate of shortlist) {
    const result = await inspectRepo(candidate, token, args.perRepo);
    if (result.skills.length === 0) {
      refused.push({ repo: candidate.fullName, reason: result.reason });
      process.stdout.write(`  - ${candidate.fullName.padEnd(48)} ${result.reason}\n`);
    } else {
      for (const skill of result.skills) {
        verified.push({
          repo: candidate.fullName,
          name: skill.name,
          path: skill.path,
          ref: result.ref,
          license: candidate.normalized,
          stars: candidate.stars,
          summary: skill.summary,
          repoDescription: candidate.description,
          pushedAt: candidate.pushedAt,
        });
      }
      const names = result.skills.map((skill) => skill.name).join(", ");
      const notes = [];
      if (result.skipped > 0) notes.push(`${result.skipped} more not taken`);
      if (result.rejected.length > 0) notes.push(`${result.rejected.length} unverifiable`);
      if (result.symlinked.length > 0) notes.push(`${result.symlinked.length} symlinked (not installable)`);
      if (result.ref !== "main") notes.push(`ref ${result.ref}`);
      const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
      process.stdout.write(`  + ${candidate.fullName.padEnd(48)} ${result.skills.length}: ${names}${suffix}\n`);
    }
    if (args.sleep) await sleep(token === null ? 700 : 150);
  }

  // An entry is addressed by its skill name, so two repositories declaring the
  // same name would collide in the catalog. Keep the one from the repository with
  // more stars and record what was set aside.
  const byName = new Map();
  const duplicates = [];
  for (const record of verified) {
    const held = byName.get(record.name);
    if (held === undefined) {
      byName.set(record.name, record);
      continue;
    }
    const [winner, loser] = held.stars >= record.stars ? [held, record] : [record, held];
    byName.set(record.name, winner);
    duplicates.push({ name: record.name, kept: winner.repo, dropped: loser.repo, reason: "duplicate name" });
  }

  process.stdout.write(`\nverified ${byName.size} skill(s) across ${shortlist.length - refused.length} repository(ies)\n`);
  process.stdout.write(`refused  ${refused.length} repository(ies)\n`);
  if (duplicates.length > 0) {
    process.stdout.write(`set aside ${duplicates.length} duplicate name(s)\n`);
    for (const item of duplicates) {
      process.stdout.write(`  ${item.name} — kept ${item.kept}, dropped ${item.dropped}\n`);
    }
  }

  if (!args.write) {
    process.stdout.write(`\nRe-run with --write to create entries under registry/data/skills/.\n`);
    return 0;
  }

  // Written under a placeholder category on purpose — a category is a judgement
  // about what a skill is for, and guessing it dozens of times would produce a
  // filter nobody trusts. The build accepts the entry; a human still has to
  // assign the real category before it ships.
  // Anchored to this file, not to the working directory: a relative path would
  // scatter entries wherever the script happened to be invoked from.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const skillsDir = resolve(repoRoot, "registry", "data", "skills");
  const created = [];
  for (const record of byName.values()) {
    const file = entryFileName(record.repo, record.name);
    const target = resolve(skillsDir, file);
    const text = await entryText(record, PLACEHOLDER_CATEGORY);
    await writeFile(target, text, "utf8");
    created.push({ file, ...record });
  }
  await writeFile(resolve(repoRoot, "_verified.json"), `${JSON.stringify({ created, duplicates, refused }, null, 2)}\n`, "utf8");
  process.stdout.write(`\nwrote ${created.length} entry file(s) and _verified.json\n`);
  process.stdout.write(`every one carries category: ${PLACEHOLDER_CATEGORY} — move the ones that deserve a real bucket\n`);
  return 0;
}

process.exitCode = await main();
