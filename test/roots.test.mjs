import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertInside,
  discoverSkills,
  findProjectRoot,
  isSkillName,
  listTrash,
  resolveRoots,
  resolveTargetPath,
  resolveTargets,
  restoreTrash,
  trashSkill,
} from "../lib/roots.js";
import { skill } from "./helpers.mjs";

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "skill-manager-roots-"));
  return root;
}

test("isSkillName matches the harness grammar", () => {
  assert.equal(isSkillName("demo"), true);
  assert.equal(isSkillName("demo-skill-2"), true);
  assert.equal(isSkillName("Demo"), false);
  assert.equal(isSkillName("demo--skill"), false);
  assert.equal(isSkillName("-demo"), false);
  assert.equal(isSkillName("demo_skill"), false);
  assert.equal(isSkillName(""), false);
});

test("findProjectRoot walks up to the .git marker", async () => {
  const root = await sandbox();
  try {
    await mkdir(join(root, "repo", ".git"), { recursive: true });
    await mkdir(join(root, "repo", "a", "b"), { recursive: true });
    assert.equal(findProjectRoot(join(root, "repo", "a", "b")), join(root, "repo"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("findProjectRoot falls back to the start directory", async () => {
  const root = await sandbox();
  try {
    assert.equal(findProjectRoot(join(root)), join(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discoverSkills reads directory-form and flat skills, and marks shadowing", async () => {
  const root = await sandbox();
  try {
    const dshHome = join(root, "home");
    const agentsHome = join(root, "agents");
    const project = join(root, "proj");
    await mkdir(join(project, ".git"), { recursive: true });
    await mkdir(join(project, ".dsh", "skills", "project-only"), { recursive: true });
    await mkdir(join(dshHome, "skills", "user-only"), { recursive: true });
    await mkdir(join(dshHome, "skills", "shared"), { recursive: true });
    await mkdir(join(project, ".dsh", "skills", "shared"), { recursive: true });
    await mkdir(join(dshHome, "skills", ".trash"), { recursive: true });
    await writeFile(join(project, ".dsh", "skills", "project-only", "SKILL.md"), skill("project-only"), "utf8");
    await writeFile(join(dshHome, "skills", "user-only", "SKILL.md"), skill("user-only"), "utf8");
    await writeFile(join(dshHome, "skills", "shared", "SKILL.md"), skill("shared", "user copy"), "utf8");
    await writeFile(join(project, ".dsh", "skills", "shared", "SKILL.md"), skill("shared", "project copy"), "utf8");
    await writeFile(join(dshHome, "skills", "flat-skill.md"), skill("flat-skill"), "utf8");

    const config = { dshHome, agentsHome, customSkillDirs: [] };
    const roots = resolveRoots({ ...config, cwd: project });
    const { skills } = await discoverSkills(roots);
    const names = skills.map((entry) => entry.name).sort();
    assert.deepEqual(names, ["flat-skill", "project-only", "shared", "shared", "user-only"]);

    const shared = skills.filter((entry) => entry.name === "shared");
    const winner = shared.find((entry) => entry.shadowed === false);
    assert.equal(winner.root, "project-dsh", "the nearer root wins");
    assert.equal(winner.description, "project copy");
    assert.equal(shared.filter((entry) => entry.shadowed === true).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discoverSkills ignores files without a usable frontmatter", async () => {
  const root = await sandbox();
  try {
    const dshHome = join(root, "home");
    await mkdir(join(dshHome, "skills", "no-frontmatter"), { recursive: true });
    await mkdir(join(dshHome, "skills", "bad-name"), { recursive: true });
    await writeFile(join(dshHome, "skills", "no-frontmatter", "SKILL.md"), "# just a body\n", "utf8");
    await writeFile(join(dshHome, "skills", "bad-name", "SKILL.md"), "---\nname: Bad Name\ndescription: x\n---\n", "utf8");
    const roots = resolveRoots({ dshHome, agentsHome: join(root, "agents"), customSkillDirs: [], cwd: join(root) });
    const { skills } = await discoverSkills(roots);
    assert.deepEqual(skills, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the user root skips .system and .trash", async () => {
  const root = await sandbox();
  try {
    const dshHome = join(root, "home");
    await mkdir(join(dshHome, "skills", ".system"), { recursive: true });
    await mkdir(join(dshHome, "skills", ".trash"), { recursive: true });
    await writeFile(join(dshHome, "skills", ".system", "SKILL.md"), skill("system-skill"), "utf8");
    const roots = resolveRoots({ dshHome, agentsHome: join(root, "agents"), customSkillDirs: [], cwd: join(root) });
    const { skills } = await discoverSkills(roots);
    assert.deepEqual(skills, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("targets resolve to the user and project roots", async () => {
  const root = await sandbox();
  try {
    const project = join(root, "proj");
    await mkdir(join(project, ".git"), { recursive: true });
    const config = { dshHome: join(root, "home"), agentsHome: join(root, "agents"), customSkillDirs: [join(root, "extra")] };
    const targets = resolveTargets(config, project);
    assert.deepEqual(targets.map((target) => target.id), ["user", "project", "custom:0"]);
    assert.equal(resolveTargetPath(config, project, "project"), join(project, ".dsh", "skills"));
    assert.throws(() => resolveTargetPath(config, project, "nope"), /unknown import target/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assertInside rejects escapes and accepts children", () => {
  assert.equal(assertInside("C:\\root", "C:\\root\\a\\b"), "C:\\root\\a\\b");
  assert.throws(() => assertInside("C:\\root", "C:\\rootless\\a"), /escapes/u);
  assert.throws(() => assertInside("C:\\root", "C:\\other"), /escapes/u);
});

test("trash moves a skill aside and restore brings it back", async () => {
  const root = await sandbox();
  try {
    const dshHome = join(root, "home");
    const skillsRoot = join(dshHome, "skills");
    const trashRoot = join(skillsRoot, ".trash");
    await mkdir(join(skillsRoot, "demo"), { recursive: true });
    await writeFile(join(skillsRoot, "demo", "SKILL.md"), skill("demo"), "utf8");

    const config = { dshHome, agentsHome: join(root, "agents"), customSkillDirs: [] };
    const roots = resolveRoots({ ...config, cwd: root });
    const { skills } = await discoverSkills(roots);
    const record = skills.find((entry) => entry.name === "demo");
    const moved = await trashSkill(record, trashRoot);
    assert.ok(moved.startsWith(trashRoot));

    const afterTrash = await discoverSkills(resolveRoots({ ...config, cwd: root }));
    assert.equal(afterTrash.skills.some((entry) => entry.name === "demo"), false, "trashed skills leave the catalog");

    const items = await listTrash(trashRoot);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "demo");
    const restored = await restoreTrash(items[0], skillsRoot);
    assert.match(await readFile(join(restored, "SKILL.md"), "utf8"), /name: demo/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("trash refuses to remove a linked skill", async (context) => {
  const root = await sandbox();
  try {
    const dshHome = join(root, "home");
    const skillsRoot = join(dshHome, "skills");
    const elsewhere = join(root, "elsewhere", "demo");
    await mkdir(elsewhere, { recursive: true });
    await writeFile(join(elsewhere, "SKILL.md"), skill("demo"), "utf8");
    await mkdir(skillsRoot, { recursive: true });
    try {
      await symlink(elsewhere, join(skillsRoot, "demo"), "junction");
    } catch {
      context.skip("symlinks are unavailable in this environment");
      return;
    }
    const config = { dshHome, agentsHome: join(root, "agents"), customSkillDirs: [] };
    const { skills } = await discoverSkills(resolveRoots({ ...config, cwd: root }));
    const record = skills.find((entry) => entry.name === "demo");
    assert.equal(record.symlink, true);
    await assert.rejects(trashSkill(record, join(skillsRoot, ".trash")), /linked skills/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
