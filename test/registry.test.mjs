import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseEntry, validateEntry } from "../registry/scripts/build-registry.mjs";

const VALID = [
  "repo: acme/widget-skills",
  "name: widget-helper",
  "path: skills/widget-helper/SKILL.md",
  "category: docs",
  'tags: [writing, "design-tokens"]',
  "description:",
  '  en: "Helps with widgets: sizes and counts."',
  "  zh: 帮助处理组件。",
  "",
].join("\n");

test("parseEntry reads every supported field", () => {
  const parsed = parseEntry(VALID, "acme__widget-skills--widget-helper.yml");
  assert.equal(parsed.errors, undefined);
  assert.equal(parsed.fields.repo, "acme/widget-skills");
  assert.equal(parsed.fields.name, "widget-helper");
  assert.equal(parsed.fields.path, "skills/widget-helper/SKILL.md");
  assert.equal(parsed.fields.category, "docs");
  assert.deepEqual(parsed.fields.tags, ["writing", "design-tokens"]);
  assert.equal(parsed.fields.description.en, "Helps with widgets: sizes and counts.");
  assert.equal(parsed.fields.description.zh, "帮助处理组件。");
});

test("parseEntry accepts comments and blank lines", () => {
  const text = `# an entry\n\nrepo: acme/tools\nname: demo\npath: SKILL.md\ndescription:\n  en: Demo.\n\n# trailing comment\n`;
  const parsed = parseEntry(text, "demo.yml");
  assert.equal(parsed.errors, undefined);
  assert.equal(parsed.fields.name, "demo");
});

test("parseEntry rejects unknown keys with a line number", () => {
  const parsed = parseEntry("repo: a/b\nname: x\npath: SKILL.md\nowner: someone\ndescription:\n  en: D.\n", "f.yml");
  assert.ok(parsed.errors.some((error) => error.includes("f.yml:4") && error.includes("unknown key")));
});

test("parseEntry rejects stray nesting", () => {
  const parsed = parseEntry("repo: a/b\n  name: x\n", "f.yml");
  assert.ok(parsed.errors.some((error) => error.includes("unexpected indentation")));
});

test("parseEntry rejects a description that is not a map", () => {
  const parsed = parseEntry("repo: a/b\nname: x\npath: s.md\ndescription: one line\n", "f.yml");
  assert.ok(parsed.errors.some((error) => error.includes("description must be a map")));
});

test("parseEntry rejects a non-inline tag list", () => {
  const parsed = parseEntry("repo: a/b\nname: x\npath: s.md\ntags:\n  - one\ndescription:\n  en: D.\n", "f.yml");
  assert.ok(parsed.errors.length > 0);
});

test("parseEntry rejects a bad stars value", () => {
  const parsed = parseEntry("repo: a/b\nname: x\npath: s.md\nstars: many\ndescription:\n  en: D.\n", "f.yml");
  assert.ok(parsed.errors.some((error) => error.includes("stars must be")));
});

test("validateEntry accepts a well-formed entry", () => {
  const parsed = parseEntry(VALID, "acme__widget-skills--widget-helper.yml");
  assert.deepEqual(validateEntry(parsed.fields, "acme__widget-skills--widget-helper.yml"), []);
});

test("validateEntry enforces the kebab-case name grammar", () => {
  const problems = validateEntry({ repo: "a/b", name: "Widget Helper", path: "SKILL.md", description: { en: "D." } }, "f.yml");
  assert.ok(problems.some((problem) => problem.includes("kebab-case")));
});

test("validateEntry rejects absolute and traversing paths", () => {
  for (const path of ["/etc/passwd", "C:/x/SKILL.md", "../../SKILL.md"]) {
    const problems = validateEntry({ repo: "a/b", name: "demo", path, description: { en: "D." } }, "f.yml");
    assert.ok(problems.length > 0, `${path} must be rejected`);
  }
});

test("validateEntry requires a description", () => {
  assert.ok(validateEntry({ repo: "a/b", name: "demo", path: "SKILL.md" }, "f.yml").some((problem) => problem.includes("description is required")));
  assert.ok(validateEntry({ repo: "a/b", name: "demo", path: "SKILL.md", description: { en: "  " } }, "f.yml").some((problem) => problem.includes("description.en is required")));
});

test("validateEntry enforces the file-name convention", () => {
  const problems = validateEntry({ repo: "acme/tools", name: "demo", path: "SKILL.md", description: { en: "D." } }, "wrong-name.yml");
  assert.ok(problems.some((problem) => problem.includes("file name must be")));
});

test("validateEntry admits the repo-only file name", () => {
  const problems = validateEntry({ repo: "acme/tools", name: "demo", path: "SKILL.md", category: "dev", description: { en: "D." } }, "acme__tools.yml");
  assert.deepEqual(problems, []);
});

/** The name the validator expects for the `a/b` + `demo` fixture below. */
const FIXTURE_FILE = "a__b--demo.yml";

test("validateEntry requires a category, and one from the closed list", () => {
  const base = { repo: "a/b", name: "demo", path: "SKILL.md", description: { en: "D." } };
  assert.ok(validateEntry(base, FIXTURE_FILE).some((problem) => problem.includes("category is required")));
  assert.ok(validateEntry({ ...base, category: "not-a-category" }, FIXTURE_FILE).some((problem) => problem.includes("is not one of")));
  assert.deepEqual(validateEntry({ ...base, category: "ui" }, FIXTURE_FILE), []);
});

test("validateEntry checks version and commit shapes", () => {
  const base = { repo: "a/b", name: "demo", path: "SKILL.md", category: "ui", description: { en: "D." } };
  assert.deepEqual(validateEntry({ ...base, version: "2.15.0" }, FIXTURE_FILE), []);
  assert.ok(validateEntry({ ...base, version: "v2.15" }, FIXTURE_FILE).some((problem) => problem.includes("semver")));
  assert.deepEqual(validateEntry({ ...base, commit: "063bee9" }, FIXTURE_FILE), []);
  assert.ok(validateEntry({ ...base, commit: "not-a-sha" }, FIXTURE_FILE).some((problem) => problem.includes("hexadecimal")));
});

test("validateEntry rejects too many tags and bad tag shapes", () => {
  const many = Array.from({ length: 9 }, (_, index) => `t${index}`);
  assert.ok(validateEntry({ repo: "a/b", name: "demo", path: "SKILL.md", category: "ui", tags: many, description: { en: "D." } }, "f.yml").some((problem) => problem.includes("at most")));
  assert.ok(validateEntry({ repo: "a/b", name: "demo", path: "SKILL.md", category: "ui", tags: ["Bad Tag"], description: { en: "D." } }, "f.yml").some((problem) => problem.includes("must be lowercase")));
});

test("validateEntry rejects a non-github tarball", () => {
  const problems = validateEntry({ repo: "a/b", name: "demo", path: "SKILL.md", category: "ui", tarball: "https://example.com/x.tgz", description: { en: "D." } }, "f.yml");
  assert.ok(problems.some((problem) => problem.includes("tarball must be")));
});

test("the committed catalog matches the entry files", async () => {
  const catalog = JSON.parse(await readFile(new URL("../registry/skills.json", import.meta.url), "utf8"));
  assert.equal(catalog.version, 2);
  assert.ok(catalog.skills.length > 0, "the shipped catalog must not be empty");
  for (const skill of catalog.skills) {
    assert.match(skill.id, /^[\w.-]+\/[\w.-]+#.+$/u);
    assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    assert.equal(typeof skill.repo, "string");
    assert.equal(typeof skill.ref, "string");
    assert.equal(typeof skill.description.en, "string");
  }
  const names = new Set(catalog.skills.map((skill) => skill.name));
  assert.equal(names.size, catalog.skills.length, "skill names must be unique, they are install directory names");
  const sorted = [...catalog.skills].sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(catalog.skills, sorted, "the catalog must stay sorted so diffs are stable");
});

test("every shipped entry parses and validates", async () => {
  const { readdir } = await import("node:fs/promises");
  const directory = new URL("../registry/data/skills/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".yml"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = await readFile(new URL(file, directory), "utf8");
    const parsed = parseEntry(text, file);
    assert.equal(parsed.errors, undefined, `${file}: ${(parsed.errors ?? []).join("; ")}`);
    assert.deepEqual(validateEntry(parsed.fields, file), [], file);
  }
});
