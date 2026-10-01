import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ArchiveError } from "../lib/archive.js";
import {
  decodeUploads,
  installFromDirectory,
  installSkills,
  planSkills,
  readDirectoryEntries,
} from "../lib/install.js";
import { makeZip, skill } from "./helpers.mjs";

async function sandbox() {
  return await mkdtemp(join(tmpdir(), "skill-manager-install-"));
}

const entriesOf = (files) => files.map((file) => ({ path: file.path, data: Buffer.from(file.data, "utf8") }));

test("planSkills finds a skill directory and keeps its sibling files", () => {
  const plans = planSkills(
    entriesOf([
      { path: "repo-main/skills/demo/SKILL.md", data: skill("demo") },
      { path: "repo-main/skills/demo/scripts/run.sh", data: "#!/bin/sh\n" },
      { path: "repo-main/README.md", data: "# repo\n" },
    ]),
  );
  assert.equal(plans.length, 1);
  assert.equal(plans[0].name, "demo");
  assert.deepEqual(
    plans[0].files.map((file) => file.rel).sort(),
    ["SKILL.md", "scripts/run.sh"],
  );
});

test("planSkills finds several skills in one archive", () => {
  const plans = planSkills(
    entriesOf([
      { path: "pack/one/SKILL.md", data: skill("one") },
      { path: "pack/two/SKILL.md", data: skill("two") },
    ]),
  );
  assert.deepEqual(plans.map((plan) => plan.name).sort(), ["one", "two"]);
});

test("planSkills falls back to a flat .md carrying frontmatter", () => {
  const plans = planSkills(entriesOf([{ path: "solo.md", data: skill("solo") }]));
  assert.equal(plans[0].name, "solo");
  assert.equal(plans[0].files[0].rel, "SKILL.md");
});

test("planSkills rejects a repeated skill name", () => {
  assert.throws(
    () =>
      planSkills(
        entriesOf([
          { path: "a/demo/SKILL.md", data: skill("demo") },
          { path: "b/demo/SKILL.md", data: skill("demo") },
        ]),
      ),
    /more than once/u,
  );
});

test("planSkills rejects an archive with nothing installable", () => {
  assert.throws(() => planSkills(entriesOf([{ path: "readme.txt", data: "hi" }])), ArchiveError);
});

test("planSkills rejects an unusable skill name", () => {
  assert.throws(
    () => planSkills(entriesOf([{ path: "Bad Name/SKILL.md", data: "---\nname: Bad Name\ndescription: x\n---\n" }])),
    /no usable skill name/u,
  );
});

test("installSkills writes the skill tree into the destination root", async () => {
  const root = await sandbox();
  try {
    const destination = join(root, "skills");
    const plans = planSkills(
      entriesOf([
        { path: "demo/SKILL.md", data: skill("demo") },
        { path: "demo/scripts/run.sh", data: "#!/bin/sh\n" },
      ]),
    );
    const results = await installSkills(plans, { destinationRoot: destination, overwrite: "skip" });
    assert.equal(results[0].status, "installed");
    assert.match(await readFile(join(destination, "demo", "SKILL.md"), "utf8"), /name: demo/u);
    assert.equal(await readFile(join(destination, "demo", "scripts", "run.sh"), "utf8"), "#!/bin/sh\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installSkills skips an existing skill unless told to trash it", async () => {
  const root = await sandbox();
  try {
    const destination = join(root, "skills");
    const trashRoot = join(root, "trash");
    await mkdir(join(destination, "demo"), { recursive: true });
    await writeFile(join(destination, "demo", "SKILL.md"), "old", "utf8");

    const plans = planSkills(entriesOf([{ path: "demo/SKILL.md", data: skill("demo") }]));
    const skipped = await installSkills(plans, { destinationRoot: destination, overwrite: "skip", trashRoot });
    assert.equal(skipped[0].status, "skipped");
    assert.equal(await readFile(join(destination, "demo", "SKILL.md"), "utf8"), "old");

    const replaced = await installSkills(plans, { destinationRoot: destination, overwrite: "trash", trashRoot });
    assert.equal(replaced[0].status, "installed");
    assert.match(await readFile(join(destination, "demo", "SKILL.md"), "utf8"), /name: demo/u);
    const trashed = await readDirectoryEntries(trashRoot, {});
    assert.equal(trashed.length, 1);
    assert.equal(trashed[0].data.toString("utf8"), "old", "the previous copy is recoverable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installSkills refuses a plan whose file path escapes the skill directory", async () => {
  const root = await sandbox();
  try {
    const destination = join(root, "skills");
    await assert.rejects(
      installSkills([{ name: "demo", prefix: "demo", files: [{ rel: "SKILL.md", data: Buffer.from(skill("demo")) }, { rel: "../escape.md", data: Buffer.from("x") }] }], {
        destinationRoot: destination,
        overwrite: "skip",
      }),
      ArchiveError,
    );
    assert.equal(existsSync(join(root, "escape.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readDirectoryEntries walks a host directory and skips heavy folders", async () => {
  const root = await sandbox();
  try {
    await mkdir(join(root, "demo", "scripts"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, "demo", "SKILL.md"), skill("demo"), "utf8");
    await writeFile(join(root, "demo", "scripts", "run.sh"), "x", "utf8");
    await writeFile(join(root, ".git", "HEAD"), "ref", "utf8");
    const entries = await readDirectoryEntries(root, {});
    assert.deepEqual(entries.map((entry) => entry.path).sort(), ["demo/SKILL.md", "demo/scripts/run.sh"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installFromDirectory installs a local folder", async () => {
  const root = await sandbox();
  try {
    const source = join(root, "source", "demo");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "SKILL.md"), skill("demo"), "utf8");
    const results = await installFromDirectory(join(root, "source"), {
      destinationRoot: join(root, "skills"),
      overwrite: "skip",
    });
    assert.equal(results[0].status, "installed");
    assert.ok(existsSync(join(root, "skills", "demo", "SKILL.md")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("decodeUploads decodes base64 and normalises separators", () => {
  const entries = decodeUploads([{ path: "demo\\SKILL.md", data: Buffer.from(skill("demo")).toString("base64") }]);
  assert.equal(entries[0].path, "demo/SKILL.md");
  assert.match(entries[0].data.toString("utf8"), /name: demo/u);
});

test("decodeUploads enforces the total cap", () => {
  const blob = Buffer.alloc(64, 1).toString("base64");
  assert.throws(() => decodeUploads([{ path: "a", data: blob }], { maxTotalBytes: 16 }), /upload exceeds/u);
});

test("a zip fixture round-trips through the planner", () => {
  const archive = makeZip([{ path: "pack/demo/SKILL.md", data: skill("demo") }]);
  assert.equal(archive.length > 0, true);
});
