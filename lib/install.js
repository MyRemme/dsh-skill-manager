/**
 * Skill install planning and execution.
 *
 * An archive or upload is first reduced to a plan — which directories are
 * skills, which files belong to each — and only then written. Nothing is
 * created on disk until the whole plan validates, so a rejected archive leaves
 * the skill roots untouched.
 *
 * @module dsh-skill-manager/install
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ArchiveError, readZip, safeRelativePath, stripSingleRoot } from "./archive.js";
import { readField } from "./frontmatter.js";
import { assertInside, isSkillName } from "./roots.js";

const SKILL_FILE = "SKILL.md";

/**
 * Group archive entries into skill plans.
 * @param entries - `{ path, data }` records with POSIX relative paths.
 * @param options - `maxSkills` and `maxFileBytes` caps.
 * @returns skill plans `{ name, prefix, files }`.
 * @throws ArchiveError when no skill can be recognised.
 */
export function planSkills(entries, options = {}) {
  const maxSkills = options.maxSkills ?? 64;
  const maxFileBytes = options.maxFileBytes ?? 8 * 1024 * 1024;
  const flattened = stripSingleRoot(entries);

  for (const entry of flattened) {
    if (entry.data.length > maxFileBytes) throw new ArchiveError(`${entry.path} exceeds the ${maxFileBytes} byte per-file limit`);
  }

  const plans = [];
  const manifests = flattened.filter((entry) => basename(entry.path) === SKILL_FILE);
  // A manifest sitting at the archive root owns the whole archive, minus any file
  // that already belongs to a nested skill.
  const nestedPrefixes = manifests.map((entry) => (dirname(entry.path) === "." ? "" : dirname(entry.path))).filter((prefix) => prefix !== "");
  for (const manifest of manifests) {
    const prefix = dirname(manifest.path) === "." ? "" : dirname(manifest.path);
    const raw = manifest.data.toString("utf8");
    const declared = readField(raw, "name");
    const name = isSkillName(declared) ? declared : isSkillName(basename(prefix)) ? basename(prefix) : undefined;
    if (name === undefined) {
      throw new ArchiveError(`${manifest.path} declares no usable skill name (frontmatter \`name\` or directory name must be kebab-case)`);
    }
    const owned =
      prefix === ""
        ? flattened.filter((entry) => !nestedPrefixes.some((nested) => entry.path.startsWith(`${nested}/`)))
        : flattened.filter((entry) => entry.path.startsWith(`${prefix}/`));
    const files = owned
      .map((entry) => ({ rel: prefix === "" ? entry.path : entry.path.slice(prefix.length + 1), data: entry.data }))
      .filter((file) => file.rel !== "" && !file.rel.startsWith(".git/"));
    if (files.length === 0) throw new ArchiveError(`${manifest.path} has no files`);
    plans.push({ name, prefix, files, manifest: files.find((file) => file.rel === SKILL_FILE) ?? files[0] });
  }

  if (plans.length === 0) {
    for (const entry of flattened) {
      if (!entry.path.endsWith(".md")) continue;
      const raw = entry.data.toString("utf8");
      const name = readField(raw, "name");
      if (!isSkillName(name) || typeof readField(raw, "description") !== "string") continue;
      plans.push({ name, prefix: entry.path, files: [{ rel: SKILL_FILE, data: entry.data }], manifest: { rel: SKILL_FILE, data: entry.data }, flat: true });
    }
  }

  if (plans.length === 0) throw new ArchiveError("no skill found: expected a SKILL.md or a frontmatter-bearing .md file");
  if (plans.length > maxSkills) throw new ArchiveError(`archive contains ${plans.length} skills, limit is ${maxSkills}`);

  const seen = new Set();
  for (const plan of plans) {
    if (seen.has(plan.name)) throw new ArchiveError(`archive defines "${plan.name}" more than once`);
    seen.add(plan.name);
  }
  return plans;
}

/** Validate that every planned relative path is safe and inside the skill directory. */
function assertPlanSafe(plan) {
  for (const file of plan.files) {
    const clean = safeRelativePath(file.rel);
    if (clean !== file.rel) throw new ArchiveError(`unsafe path inside skill "${plan.name}": ${file.rel}`);
  }
}

/**
 * Write skill plans into a destination root.
 * @param plans - output of {@link planSkills}.
 * @param options - `destinationRoot`, `overwrite` (`skip` | `trash`), `trashRoot`.
 * @returns per-skill outcomes.
 */
export async function installSkills(plans, options) {
  const { destinationRoot, overwrite = "skip", trashRoot } = options;
  await mkdir(destinationRoot, { recursive: true });
  const results = [];
  for (const plan of plans) {
    assertPlanSafe(plan);
    const skillDir = assertInside(destinationRoot, join(destinationRoot, plan.name));
    if (existsSync(skillDir)) {
      if (overwrite !== "trash") {
        results.push({ name: plan.name, status: "skipped", reason: "already installed", path: skillDir });
        continue;
      }
      if (typeof trashRoot !== "string") throw new ArchiveError("overwrite=trash requires a trash directory");
      await mkdir(trashRoot, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
      let destination = join(trashRoot, `${stamp}__${plan.name}`);
      let suffix = 1;
      while (existsSync(destination)) {
        destination = join(trashRoot, `${stamp}__${plan.name}-${suffix}`);
        suffix += 1;
      }
      await rename(skillDir, destination);
    }
    try {
      for (const file of plan.files) {
        const target = assertInside(skillDir, join(skillDir, file.rel));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.data);
      }
      results.push({ name: plan.name, status: "installed", path: skillDir, files: plan.files.length });
    } catch (error) {
      await rm(skillDir, { recursive: true, force: true });
      results.push({ name: plan.name, status: "failed", reason: String(error) });
    }
  }
  return results;
}

/**
 * Read a server-side directory into archive-shaped entries.
 * @param directory - absolute source directory.
 * @param options - traversal caps.
 * @returns `{ path, data }` entries relative to the directory.
 */
export async function readDirectoryEntries(directory, options = {}) {
  const maxEntries = options.maxEntries ?? 4096;
  const maxFileBytes = options.maxFileBytes ?? 8 * 1024 * 1024;
  const out = [];
  const walk = async (current, prefix) => {
    const entries = await readdir(current, { withFileTypes: true, encoding: "utf8" });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".trash") continue;
      const absolute = join(current, entry.name);
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(absolute, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (out.length >= maxEntries) throw new ArchiveError(`directory has more than ${maxEntries} files`);
      const data = await readFile(absolute);
      if (data.length > maxFileBytes) throw new ArchiveError(`${rel} exceeds the ${maxFileBytes} byte per-file limit`);
      out.push({ path: rel, data });
    }
  };
  await walk(directory, "");
  return out;
}

/**
 * Install from a directory already present on the host.
 * @param directory - absolute source directory.
 * @param options - destination and overwrite policy.
 * @returns install results.
 */
export async function installFromDirectory(directory, options) {
  const entries = await readDirectoryEntries(directory, options);
  const plans = planSkills(entries, options);
  return installSkills(plans, options);
}

/**
 * Turn client-supplied upload records into archive-shaped entries.
 * @param files - `{ path, data }` where data is base64.
 * @param options - decode caps.
 * @returns `{ path, data }` entries with sanitised relative paths.
 */
export function decodeUploads(files, options = {}) {
  const maxFileBytes = options.maxFileBytes ?? 8 * 1024 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 32 * 1024 * 1024;
  const out = [];
  let total = 0;
  for (const file of files) {
    const path = safeRelativePath(file.path);
    const data = Buffer.from(String(file.data ?? ""), "base64");
    if (data.length > maxFileBytes) throw new ArchiveError(`${path} exceeds the ${maxFileBytes} byte per-file limit`);
    total += data.length;
    if (total > maxTotalBytes) throw new ArchiveError(`upload exceeds the ${maxTotalBytes} byte limit`);
    out.push({ path, data });
  }
  return out;
}

/**
 * Turn an uploaded ZIP into installed skills.
 * @param buffer - ZIP bytes.
 * @param options - destination and overwrite policy.
 * @returns install results.
 */
export async function installFromZip(buffer, options) {
  const plans = planSkills(readZip(buffer, options), options);
  return installSkills(plans, options);
}

/**
 * Turn client-supplied base64 uploads into installed skills.
 * @param files - `{ path, data }` upload records.
 * @param options - destination and overwrite policy.
 * @returns install results.
 */
export async function installFromUploads(files, options) {
  const plans = planSkills(decodeUploads(files, options), options);
  return installSkills(plans, options);
}
