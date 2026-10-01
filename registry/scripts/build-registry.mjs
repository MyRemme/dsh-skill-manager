#!/usr/bin/env node
/**
 * Build `registry/skills.json` from one YAML file per skill.
 *
 * Entries live in `registry/data/skills/<owner>__<repo>[--<skill>].yml` so that
 * two contributors never touch the same file. The generated catalog is committed
 * and is what the plugin fetches at runtime.
 *
 * The entry format is a deliberately strict YAML subset — flat scalars, an
 * optional `tags: [a, b]` list, and a two-key `description` map. Anything else is
 * rejected with a line number, which keeps a permissive parser from quietly
 * accepting a typo.
 *
 * Usage:
 *   node registry/scripts/build-registry.mjs                 # write skills.json
 *   node registry/scripts/build-registry.mjs --check         # fail if it is stale
 *   node registry/scripts/build-registry.mjs --check --verify # also probe upstream
 *   node registry/scripts/build-registry.mjs --stars         # refresh star counts
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = join(HERE, "..");
const DATA_DIR = join(REGISTRY_DIR, "data", "skills");
const OUTPUT = join(REGISTRY_DIR, "skills.json");

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;
const REF = /^[A-Za-z0-9._/-]+$/u;
const TAG = /^[a-z0-9][a-z0-9-]*$/u;
const CATEGORY = /^[a-z][a-z0-9-]*$/u;
const MAX_DESCRIPTION = 800;
const MAX_TAGS = 8;

const SCALAR_KEYS = new Set(["repo", "name", "path", "ref", "category", "license", "author", "stars", "tarball"]);
const FLAGS = new Set(process.argv.slice(2));

/** Strip one layer of matching quotes and undo the escapes we emit. */
function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/\\(["\\])/gu, "$1");
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/gu, "'");
  return value;
}

/**
 * Parse one entry file.
 * @param text - file contents.
 * @param file - file name, used in error messages.
 * @returns `{ fields }` or `{ errors }`.
 */
export function parseEntry(text, file) {
  const errors = [];
  const fields = {};
  const lines = text.split(/\r?\n/u);
  let inDescription = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.replace(/\s+$/u, "");
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const indented = /^\s/u.test(line);
    const trimmed = line.trim();

    if (inDescription) {
      if (!indented) inDescription = false;
      else {
        const nested = /^(en|zh):[ \t]*(.*)$/u.exec(trimmed);
        if (nested === null) {
          errors.push(`${file}:${index + 1}: only \`en:\` and \`zh:\` are allowed under description`);
          continue;
        }
        fields.description = fields.description ?? {};
        fields.description[nested[1]] = unquote(nested[2]);
        continue;
      }
    }

    if (indented) {
      errors.push(`${file}:${index + 1}: unexpected indentation (nesting is only allowed under description)`);
      continue;
    }

    const pair = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/u.exec(trimmed);
    if (pair === null) {
      errors.push(`${file}:${index + 1}: expected \`key: value\`, saw ${JSON.stringify(trimmed)}`);
      continue;
    }
    const key = pair[1];
    const rest = pair[2].trim();

    if (key === "description") {
      if (rest !== "") {
        errors.push(`${file}:${index + 1}: description must be a map with \`en:\` and optional \`zh:\``);
        continue;
      }
      inDescription = true;
      continue;
    }
    if (key === "tags") {
      const list = /^\[(.*)\]$/u.exec(rest);
      if (list === null) {
        errors.push(`${file}:${index + 1}: tags must be an inline list, e.g. \`tags: [design, ui]\``);
        continue;
      }
      fields.tags = list[1]
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "")
        .map(unquote);
      continue;
    }
    if (!SCALAR_KEYS.has(key)) {
      errors.push(`${file}:${index + 1}: unknown key ${JSON.stringify(key)}`);
      continue;
    }
    if (rest === "") {
      errors.push(`${file}:${index + 1}: ${key} needs a value`);
      continue;
    }
    if (key === "stars") {
      const value = Number.parseInt(rest, 10);
      if (!Number.isInteger(value) || value < 0) {
        errors.push(`${file}:${index + 1}: stars must be a non-negative integer`);
        continue;
      }
      fields.stars = value;
      continue;
    }
    fields[key] = unquote(rest);
  }
  if (Object.keys(fields).length === 0) errors.push(`${file}: no fields parsed`);
  return errors.length > 0 ? { errors } : { fields };
}

/**
 * Validate one parsed entry.
 * @param fields - parsed fields.
 * @param file - entry file name.
 * @returns a list of problems.
 */
export function validateEntry(fields, file) {
  const errors = [];
  const fail = (message) => errors.push(`${file}: ${message}`);

  if (typeof fields.repo !== "string" || !REPO.test(fields.repo)) fail("repo must be `owner/name`");
  if (typeof fields.name !== "string" || !SKILL_NAME.test(fields.name)) fail("name must be kebab-case (lowercase letters, digits and single hyphens)");
  if (typeof fields.path !== "string" || fields.path === "") fail("path is required");
  else {
    if (fields.path.startsWith("/") || /^[A-Za-z]:/u.test(fields.path)) fail("path must be relative to the repository root");
    if (fields.path.split("/").includes("..")) fail("path must not contain `..`");
    if (!fields.path.endsWith(".md")) fail("path must point at a Markdown file, normally SKILL.md");
  }
  const ref = fields.ref ?? "main";
  if (typeof ref !== "string" || ref === "" || ref.includes("..") || !REF.test(ref)) fail("ref must be a plain branch, tag or commit");

  if (fields.category !== undefined && !CATEGORY.test(String(fields.category))) fail("category must be lowercase, e.g. `ui` or `docs`");
  if (fields.tags !== undefined) {
    if (!Array.isArray(fields.tags)) fail("tags must be a list");
    else {
      if (fields.tags.length > MAX_TAGS) fail(`at most ${MAX_TAGS} tags are allowed`);
      for (const tag of fields.tags) if (!TAG.test(tag)) fail(`tag ${JSON.stringify(tag)} must be lowercase with hyphens`);
    }
  }

  const description = fields.description;
  if (description === undefined || typeof description !== "object") fail("description is required");
  else {
    const en = description.en;
    if (typeof en !== "string" || en.trim() === "") fail("description.en is required");
    else if (en.length > MAX_DESCRIPTION) fail(`description.en is ${en.length} characters; the limit is ${MAX_DESCRIPTION}`);
    if (description.zh !== undefined && typeof description.zh !== "string") fail("description.zh must be a string");
  }

  // The file name encodes the entry so two contributors never collide.
  const expected = typeof fields.repo === "string" && typeof fields.name === "string" ? `${fields.repo.replace("/", "__")}--${fields.name}.yml` : undefined;
  if (expected !== undefined && file !== expected) {
    const repoOnly = `${fields.repo.replace("/", "__")}.yml`;
    if (file !== repoOnly) fail(`file name must be ${expected}`);
  }

  if (fields.tarball !== undefined && !/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\//u.test(String(fields.tarball))) {
    fail("tarball must be an https release asset on github.com");
  }
  return errors;
}

/** Read and validate every entry file. */
async function loadEntries() {
  let names;
  try {
    names = (await readdir(DATA_DIR, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".yml")).map((entry) => entry.name).sort();
  } catch (error) {
    return { errors: [`cannot read ${DATA_DIR}: ${String(error)}`], entries: [] };
  }
  if (names.length === 0) return { errors: [`no entries in ${DATA_DIR}`], entries: [] };

  const errors = [];
  const entries = [];
  const files = new Map();
  for (const file of names) {
    const parsed = parseEntry(await readFile(join(DATA_DIR, file), "utf8"), file);
    if (parsed.errors !== undefined) {
      errors.push(...parsed.errors);
      continue;
    }
    const problems = validateEntry(parsed.fields, file);
    if (problems.length > 0) {
      errors.push(...problems);
      continue;
    }
    entries.push({ file, fields: parsed.fields });
    files.set(file, parsed.fields);
  }

  const byName = new Map();
  const byId = new Map();
  for (const { file, fields } of entries) {
    const id = `${fields.repo}#${fields.path}`;
    const previousName = byName.get(fields.name);
    if (previousName !== undefined) errors.push(`${file}: skill name ${fields.name} is already claimed by ${previousName}`);
    else byName.set(fields.name, file);
    const previousId = byId.get(id);
    if (previousId !== undefined) errors.push(`${file}: duplicate entry, already declared by ${previousId}`);
    else byId.set(id, file);
  }
  return { errors, entries: entries.sort((a, b) => a.fields.name.localeCompare(b.fields.name)) };
}

/** Build the catalog document from validated entries. */
function catalogOf(entries) {
  return {
    version: 1,
    skills: entries.map(({ fields }) => {
      const skill = {
        id: `${fields.repo}#${fields.path}`,
        name: fields.name,
        repo: fields.repo,
        path: fields.path,
        ref: fields.ref ?? "main",
        description: { en: fields.description.en, ...(fields.description.zh === undefined ? {} : { zh: fields.description.zh }) },
      };
      if (fields.category !== undefined) skill.category = fields.category;
      if (fields.tags !== undefined) skill.tags = fields.tags;
      if (fields.license !== undefined) skill.license = fields.license;
      if (fields.author !== undefined) skill.author = fields.author;
      else skill.author = fields.repo.split("/")[0];
      if (fields.stars !== undefined) skill.stars = fields.stars;
      if (fields.tarball !== undefined) skill.tarball = fields.tarball;
      return skill;
    }),
  };
}

class UpstreamError extends Error {
  constructor(message, transient) {
    super(message);
    this.transient = transient;
  }
}

async function fetchText(repo, ref, path) {
  const headers = { "user-agent": "dsh-skill-manager-registry", accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token !== undefined && token !== "") headers.authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${ref}`, { headers });
  if (!response.ok) {
    // A 404 means the entry is wrong; a 403 or 429 means this runner is out of
    // API budget and says nothing about the entry.
    const transient = response.status === 403 || response.status === 429 || response.status >= 500;
    throw new UpstreamError(`HTTP ${response.status}`, transient);
  }
  const payload = await response.json();
  return Buffer.from(payload.content ?? "", "base64").toString("utf8");
}

/**
 * Confirm each entry really exists upstream and declares the name it claims.
 *
 * Transient failures (rate limiting, upstream 5xx) are reported as warnings so a
 * contributor's pull request is never failed by something unrelated to it.
 * `--strict` turns them into errors.
 */
async function verify(entries) {
  const problems = [];
  const warnings = [];
  for (const { file, fields } of entries) {
    const ref = fields.ref ?? "main";
    try {
      const text = await fetchText(fields.repo, ref, fields.path);
      const name = /^name[ \t]*:[ \t]*(.*)$/mu.exec(text);
      const declared = name === null ? undefined : unquote(name[1].trim());
      if (declared !== fields.name) problems.push(`${file}: upstream ${fields.repo}/${fields.path} declares name ${JSON.stringify(declared)}, expected ${JSON.stringify(fields.name)}`);
      if (!/^description[ \t]*:/mu.test(text)) problems.push(`${file}: upstream file has no description`);
    } catch (error) {
      const message = `${file}: cannot read ${fields.repo}/${fields.path} at ${ref}: ${String(error)}`;
      if (error instanceof UpstreamError && error.transient) warnings.push(message);
      else problems.push(message);
    }
  }
  const rateLimited = warnings.length === entries.length && entries.length > 0;
  return { problems, warnings, rateLimited };
}

/** Refresh star counts into the entry files. */
async function refreshStars(entries) {
  const headers = { "user-agent": "dsh-skill-manager-registry", accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token !== undefined && token !== "") headers.authorization = `Bearer ${token}`;
  const seen = new Map();
  for (const { fields } of entries) {
    if (seen.has(fields.repo)) continue;
    try {
      const response = await fetch(`https://api.github.com/repos/${fields.repo}`, { headers });
      seen.set(fields.repo, response.ok ? (await response.json()).stargazers_count ?? 0 : undefined);
    } catch {
      seen.set(fields.repo, undefined);
    }
  }
  let changed = 0;
  for (const { file, fields } of entries) {
    const stars = seen.get(fields.repo);
    if (stars === undefined || stars === fields.stars) continue;
    const path = join(DATA_DIR, file);
    const text = await readFile(path, "utf8");
    const next = /^stars[ \t]*:/mu.test(text) ? text.replace(/^stars[ \t]*:.*$/mu, `stars: ${stars}`) : `${text.replace(/\s+$/u, "")}\nstars: ${stars}\n`;
    await writeFile(path, next, "utf8");
    changed += 1;
  }
  process.stdout.write(`stars updated in ${changed} file(s)\n`);
}

/**
 * Run the selected mode.
 * @param flags - command-line flags.
 * @returns the process exit code.
 */
export async function main(flags = FLAGS) {
  const { errors, entries } = await loadEntries();
  if (flags.has("--stars")) {
    if (errors.length > 0) {
      process.stderr.write(`${errors.join("\n")}\n`);
      return 1;
    }
    await refreshStars(entries);
    return 0;
  }

  if (errors.length > 0) {
    process.stderr.write(`${errors.length} problem(s):\n${errors.map((error) => `  ${error}`).join("\n")}\n`);
    return 1;
  }

  if (flags.has("--verify")) {
    const { problems, warnings, rateLimited } = await verify(entries);
    if (warnings.length > 0) {
      process.stderr.write(`${warnings.length} entr${warnings.length === 1 ? "y" : "ies"} could not be reached (rate limited or upstream unavailable):\n${warnings.map((warning) => `  ${warning}`).join("\n")}\n`);
      if (rateLimited) process.stderr.write("Every entry failed, which points at this runner's API budget rather than at the entries. Set GITHUB_TOKEN to raise the limit.\n");
    }
    if (problems.length > 0 || (flags.has("--strict") && warnings.length > 0)) {
      process.stderr.write(`${problems.length} upstream problem(s):\n${problems.map((problem) => `  ${problem}`).join("\n")}\n`);
      return 1;
    }
    process.stdout.write(`verified ${entries.length - warnings.length} of ${entries.length} entr${entries.length === 1 ? "y" : "ies"} upstream\n`);
  }

  const catalog = catalogOf(entries);
  if (flags.has("--check")) {
    let existing;
    try {
      existing = JSON.parse(await readFile(OUTPUT, "utf8"));
    } catch (error) {
      process.stderr.write(`${OUTPUT} is missing or unreadable: ${String(error)}\nRun \`npm run registry:build\` and commit the result.\n`);
      return 1;
    }
    const same = JSON.stringify(existing.skills) === JSON.stringify(catalog.skills) && existing.version === catalog.version;
    if (!same) {
      process.stderr.write(`${OUTPUT} is out of date.\nRun \`npm run registry:build\` and commit the result.\n`);
      return 1;
    }
    process.stdout.write(`${OUTPUT} is up to date (${entries.length} entries)\n`);
    return 0;
  }

  await writeFile(OUTPUT, `${JSON.stringify({ ...catalog, generatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${OUTPUT} with ${entries.length} entr${entries.length === 1 ? "y" : "ies"}\n`);
  return 0;
}

if (import.meta.main) process.exitCode = await main();
