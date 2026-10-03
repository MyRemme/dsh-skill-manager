/**
 * Skill root resolution and on-disk discovery.
 *
 * Mirrors `@deepseek-ai/dsh-skill-filesystem`: roots are scanned at exactly one
 * level, a directory entry contributes `<dir>/SKILL.md`, a file entry ending in
 * `.md` contributes itself. Nearer roots win name collisions.
 *
 * @module dsh-skill-manager/roots
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath, sep } from "node:path";
import { findLegacyKey, readField, readInvocation } from "./frontmatter.js";

/** The harness' skill-name grammar. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validate a skill name against the harness grammar.
 * @param name - candidate name.
 * @returns true when the harness would accept it.
 */
export function isSkillName(name) {
  return typeof name === "string" && SKILL_NAME.test(name);
}

/** Reserved trash directory name inside the user skill root. */
export const TRASH_DIR = ".trash";

/**
 * Find the project root the way the harness does: nearest ancestor with `.git`.
 * @param start - workspace directory.
 * @returns the project root, or the start directory when no marker exists.
 */
export function findProjectRoot(start) {
  let cursor = resolvePath(start);
  for (;;) {
    if (existsSync(join(cursor, ".git"))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) return resolvePath(start);
    cursor = parent;
  }
}

/**
 * Build the ordered root list for one project context.
 * @param config - dshHome, agentsHome, customSkillDirs, cwd.
 * @returns roots ordered by rank.
 */
export function resolveRoots(config) {
  const projectRoot = findProjectRoot(config.cwd ?? process.cwd());
  const roots = [
    { rank: 100, source: "project-dsh", path: join(projectRoot, ".dsh", "skills"), kind: "project", writable: true },
    { rank: 200, source: "project-agents", path: join(projectRoot, ".agents", "skills"), kind: "project", writable: false },
  ];
  (config.customSkillDirs ?? []).forEach((entry, index) => {
    roots.push({ rank: 300 + index, source: `custom:${index}`, path: resolvePath(entry), kind: "custom", writable: true, customIndex: index });
  });
  roots.push({ rank: 400, source: "user-dsh", path: join(config.dshHome, "skills"), kind: "user", writable: true, skipSystem: true });
  roots.push({ rank: 500, source: "user-agents", path: join(config.agentsHome, "skills"), kind: "user", writable: false });
  return roots.sort((a, b) => a.rank - b.rank);
}

/**
 * The destinations the manager is allowed to create into.
 * @param config - root configuration.
 * @param cwd - project context directory.
 * @returns selectable target descriptors.
 */
export function resolveTargets(config, cwd) {
  const projectRoot = findProjectRoot(cwd ?? process.cwd());
  const targets = [
    { id: "user", label: "User (~/.dsh/skills)", path: join(config.dshHome, "skills") },
    { id: "project", label: "Project (.dsh/skills)", path: join(projectRoot, ".dsh", "skills") },
  ];
  (config.customSkillDirs ?? []).forEach((entry, index) => {
    targets.push({ id: `custom:${index}`, label: `Custom ${index + 1}`, path: resolvePath(entry) });
  });
  return targets;
}

/**
 * Resolve a target id to its absolute path.
 * @param config - root configuration.
 * @param cwd - project context directory.
 * @param id - target id from {@link resolveTargets}.
 * @returns the absolute destination root.
 * @throws Error when the id is unknown.
 */
export function resolveTargetPath(config, cwd, id) {
  const target = resolveTargets(config, cwd).find((candidate) => candidate.id === id);
  if (target === undefined) throw new Error(`unknown import target "${id}"`);
  return target.path;
}

async function entryKind(path) {
  try {
    const info = await stat(path);
    if (info.isDirectory()) return { type: "directory", size: 0, mtimeMs: info.mtimeMs };
    if (info.isFile()) return { type: "file", size: info.size, mtimeMs: info.mtimeMs };
    return undefined;
  } catch {
    return undefined;
  }
}

async function isSymlink(path) {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Discover every skill a root exposes at depth one.
 * @param root - one entry from {@link resolveRoots}.
 * @returns skill records sorted by directory-entry name.
 */
export async function discoverRoot(root) {
  let entries;
  try {
    entries = await readdir(root.path, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return [];
  }
  const names = entries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  const found = [];
  for (const name of names) {
    if (root.skipSystem === true && name === ".system") continue;
    if (root.skipSystem === true && name === TRASH_DIR) continue;
    const entryPath = join(root.path, name);
    const linked = await isSymlink(entryPath);
    const kind = await entryKind(entryPath);
    if (kind === undefined) continue;
    let file;
    let directory;
    let form;
    if (kind.type === "directory") {
      file = join(entryPath, "SKILL.md");
      directory = entryPath;
      form = "directory";
      if ((await entryKind(file)) === undefined) continue;
    } else if (kind.type === "file" && name.endsWith(".md")) {
      file = entryPath;
      directory = root.path;
      form = "file";
    } else {
      continue;
    }
    let raw;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const skillName = readField(raw, "name");
    const description = readField(raw, "description");
    if (typeof skillName !== "string" || !isSkillName(skillName) || typeof description !== "string") continue;
    const whenToUse = readField(raw, "whenToUse");
    const invocation = readInvocation(raw);
    found.push({
      name: skillName,
      description,
      ...(typeof whenToUse === "string" ? { whenToUse } : {}),
      ...invocation,
      path: file,
      directory,
      form,
      root: root.source,
      rank: root.rank,
      kind: root.kind,
      writable: root.writable === true,
      symlink: linked,
      legacyKey: findLegacyKey(raw),
      bytes: (await entryKind(file))?.size ?? 0,
    });
  }
  return found;
}

/**
 * Discover skills across every root, marking shadowed names.
 * @param roots - ordered roots.
 * @returns `{ skills, complete }`, nearest rank first within each name.
 */
export async function discoverSkills(roots) {
  const collected = [];
  const failures = [];
  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    try {
      for (const skill of await discoverRoot(root)) collected.push(skill);
    } catch (error) {
      failures.push({ root: root.source, message: String(error) });
    }
  }
  const winners = new Map();
  for (const skill of collected) {
    const current = winners.get(skill.name);
    if (current === undefined || skill.rank < current.rank) winners.set(skill.name, skill);
  }
  const skills = collected.map((skill) => ({ ...skill, shadowed: winners.get(skill.name)?.path !== skill.path }));
  return { skills, complete: failures.length === 0, failures };
}

/**
 * Assert that a path is a direct child of `root`.
 * @param root - destination root.
 * @param candidate - absolute path to check.
 * @returns the resolved candidate.
 * @throws Error when the candidate escapes the root.
 */
export function assertInside(root, candidate) {
  const base = resolvePath(root);
  const target = resolvePath(candidate);
  if (target !== base && !target.startsWith(base + sep)) throw new Error(`path escapes the skill root: ${candidate}`);
  return target;
}

async function moveInto(trashRoot, source, name) {
  await mkdir(trashRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  let destination = join(trashRoot, `${stamp}__${name}`);
  let suffix = 1;
  while (existsSync(destination)) {
    destination = join(trashRoot, `${stamp}__${name}-${suffix}`);
    suffix += 1;
  }
  await rename(source, destination);
  return destination;
}

/**
 * Move a directory-form skill into the user root's trash folder.
 * @param record - a discovered skill.
 * @param trashRoot - trash directory for the owning root.
 * @returns the trash path.
 */
export async function trashSkill(record, trashRoot) {
  if (record.form !== "directory") throw new Error("only directory-form skills can be removed");
  if (record.symlink === true) throw new Error("linked skills cannot be removed");
  return moveInto(trashRoot, record.directory, record.name);
}

/**
 * Delete a file-form skill.
 * @param record - a discovered skill.
 * @param trashRoot - trash directory for the owning root.
 * @returns the trash path.
 */
export async function trashFileSkill(record, trashRoot) {
  if (record.form !== "file") throw new Error("not a file-form skill");
  await mkdir(trashRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const destination = join(trashRoot, `${stamp}__${record.name}.md`);
  await rename(record.path, destination);
  return destination;
}

/**
 * List trash entries newest first.
 * @param trashRoot - the trash directory.
 * @returns trash records.
 */
export async function listTrash(trashRoot) {
  if (!existsSync(trashRoot)) return [];
  const entries = await readdir(trashRoot, { withFileTypes: true, encoding: "utf8" });
  const items = [];
  for (const entry of entries) {
    const path = join(trashRoot, entry.name);
    let info;
    try {
      info = await lstat(path);
    } catch {
      continue;
    }
    const marker = entry.name.indexOf("__");
    items.push({
      entry: entry.name,
      path,
      name: marker === -1 ? entry.name : entry.name.slice(marker + 2),
      directory: entry.isDirectory(),
      removedAt: marker === -1 ? undefined : entry.name.slice(0, marker),
      bytes: info.size,
    });
  }
  return items.sort((a, b) => String(b.removedAt).localeCompare(String(a.removedAt)));
}

/**
 * Move one trash entry back into a skill root.
 * @param item - a record from {@link listTrash}.
 * @param destinationRoot - skill root to restore into.
 * @returns the restored path.
 */
export async function restoreTrash(item, destinationRoot) {
  await mkdir(destinationRoot, { recursive: true });
  const target = join(destinationRoot, item.directory ? item.name : `${item.name}.md`);
  if (existsSync(target)) throw new Error(`${item.name} already exists in the destination root`);
  await rename(item.path, target);
  return target;
}

/**
 * Permanently remove one trash entry. This is the only place the plugin deletes
 * anything for good, so it refuses to touch a path outside the trash root.
 *
 * @param item - a record from {@link listTrash}.
 * @param trashRoot - the trash directory the item must live in.
 * @returns the removed path.
 */
export async function purgeTrashItem(item, trashRoot) {
  const path = assertInside(trashRoot, item.path);
  await rm(path, { recursive: true, force: true });
  return path;
}

/**
 * Permanently remove every trash entry.
 *
 * Each entry is resolved against the trash root and removed on its own, so one
 * stubborn entry (a file held open, a permission problem) cannot take the rest
 * of the sweep down with it. The caller gets the failures, not an exception.
 *
 * @param trashRoot - the trash directory.
 * @returns `{ removed, failed }`, each a list of entry names.
 */
export async function purgeTrash(trashRoot) {
  const removed = [];
  const failed = [];
  for (const item of await listTrash(trashRoot)) {
    try {
      await purgeTrashItem(item, trashRoot);
      removed.push(item.entry);
    } catch (error) {
      failed.push({ entry: item.entry, reason: String(error?.message ?? error) });
    }
  }
  return { removed, failed };
}

/**
 * Write a skill file without ever exposing a half-written file to the watcher.
 *
 * The byte-identical replacement goes through a sibling temporary file and a
 * rename, so a watching provider either sees the old content or the new one. A
 * symlinked skill file is written in place instead, because renaming over the
 * link would quietly turn it into a regular file.
 *
 * @param file - destination path.
 * @param content - UTF-8 text.
 */
export async function writeSkillFile(file, content) {
  await mkdir(dirname(file), { recursive: true });
  let linked = false;
  try {
    linked = (await lstat(file)).isSymbolicLink();
  } catch {
    linked = false;
  }
  if (linked) {
    await writeFile(file, content, { encoding: "utf8" });
    return;
  }
  const temporary = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8" });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
