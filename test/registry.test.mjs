import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseEntry, validateEntry } from "../registry/scripts/build-registry.mjs";

const VALID = [
  "repo: acme/widget-skills",
  "name: widget-helper",
  "path: skills/widget-helper/SKILL.md",
  "ref: main",
  "category: docs",
  "license: MIT",
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
  assert.equal(parsed.fields.ref, "main");
  assert.equal(parsed.fields.category, "docs");
  assert.deepEqual(parsed.fields.tags, ["writing", "design-tokens"]);
  assert.equal(parsed.fields.description.en, "Helps with widgets: sizes and counts.");
  assert.equal(parsed.fields.description.zh, "帮助处理组件。");
});

test("parseEntry reads the license field", () => {
  const parsed = parseEntry(VALID, "acme__widget-skills--widget-helper.yml");
  assert.equal(parsed.fields.license, "MIT");
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
  const problems = validateEntry({ repo: "acme/tools", name: "demo", path: "SKILL.md", ref: "main", description: { en: "D." } }, "wrong-name.yml");
  assert.ok(problems.some((problem) => problem.includes("file name must be")));
});

test("validateEntry admits the repo-only file name", () => {
  const problems = validateEntry({ repo: "acme/tools", name: "demo", path: "SKILL.md", ref: "main", category: "dev", license: "MIT", description: { en: "D." } }, "acme__tools.yml");
  assert.deepEqual(problems, []);
});

/** The name the validator expects for the `a/b` + `demo` fixture below. */
const FIXTURE_FILE = "a__b--demo.yml";

/** A fixture that satisfies every rule, so each test can vary exactly one field. */
const OK = { repo: "a/b", name: "demo", path: "SKILL.md", ref: "main", category: "ui", license: "MIT", description: { en: "D." } };

test("validateEntry requires a category, and one from the closed list", () => {
  const base = { repo: "a/b", name: "demo", path: "SKILL.md", ref: "main", description: { en: "D." } };
  assert.ok(validateEntry(base, FIXTURE_FILE).some((problem) => problem.includes("category is required")));
  assert.ok(validateEntry({ ...base, category: "not-a-category" }, FIXTURE_FILE).some((problem) => problem.includes("is not one of")));
  assert.deepEqual(validateEntry({ ...base, category: "ui", license: "MIT" }, FIXTURE_FILE), []);
});

test("validateEntry requires a ref instead of defaulting to main", () => {
  // `main` is not a safe default: two repositories in this catalog use `master`
  // and one uses `development`. An entry with no `ref` used to inherit `main`
  // silently, so it pointed at a path that does not exist, and only the
  // `--verify` pass — which probes upstream — ever noticed.
  const { ref, ...noRef } = OK;
  assert.equal(ref, "main", "the fixture pins main; the test below proves the default is gone");
  assert.ok(
    validateEntry(noRef, FIXTURE_FILE).some((problem) => problem.includes("ref is required")),
    "an entry that never recorded a branch is rejected",
  );
  assert.ok(
    validateEntry({ ...OK, ref: "" }, FIXTURE_FILE).some((problem) => problem.includes("ref must be")),
    "a blank ref is rejected",
  );
  assert.ok(
    validateEntry({ ...OK, ref: "feature/../main" }, FIXTURE_FILE).some((problem) => problem.includes("ref must be")),
    "a ref that walks the tree is rejected",
  );
  assert.deepEqual(validateEntry({ ...OK, ref: "development" }, FIXTURE_FILE), [], "a non-main branch is a legal ref");
});

test("validateEntry requires a license that permits redistribution", () => {
  const { license, ...noLicense } = OK;
  assert.ok(
    validateEntry(noLicense, FIXTURE_FILE).some((problem) => problem.includes("license is required")),
    "an entry with no license is rejected",
  );
  assert.ok(
    validateEntry({ ...OK, license: "" }, FIXTURE_FILE).some((problem) => problem.includes("license is required")),
    "a blank license is rejected",
  );

  // The two values that look like a pass but are not.
  assert.ok(
    validateEntry({ ...OK, license: "NOASSERTION" }, FIXTURE_FILE).some((problem) => problem.includes("does not permit redistribution")),
    "NOASSERTION means the license could not be identified, which is not permission",
  );
  assert.ok(
    validateEntry({ ...OK, license: "CC-BY-NC-4.0" }, FIXTURE_FILE).some((problem) => problem.includes("does not permit redistribution")),
    "non-commercial is not a redistribution right",
  );
  assert.ok(
    validateEntry({ ...OK, license: "GPL-3.0" }, FIXTURE_FILE).some((problem) => problem.includes("does not permit redistribution")),
    "copyleft is not on the allow list",
  );
});

test("validateEntry accepts every allowed license and normalises it", () => {
  for (const license of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "MPL-2.0", "CC0-1.0", "Unlicense", "MIT-0", "0BSD", "BSD-2-Clause", "CC-BY-4.0"]) {
    assert.deepEqual(validateEntry({ ...OK, license }, FIXTURE_FILE), [], `${license} should be accepted`);
  }
  // GitHub reports SPDX, a human writes prose. Both should land on one value.
  for (const [written, canonical] of [["mit", "MIT"], ["Apache 2.0", "Apache-2.0"], ["bsd-3", "BSD-3-Clause"], ["unlicense", "Unlicense"]]) {
    const fields = { ...OK, license: written };
    assert.deepEqual(validateEntry(fields, FIXTURE_FILE), [], `${written} should be accepted`);
    assert.equal(fields.license, canonical, `${written} should normalise to ${canonical}`);
  }
});

test("validateEntry checks version and commit shapes", () => {
  const base = OK;
  assert.deepEqual(validateEntry({ ...base, version: "2.15.0" }, FIXTURE_FILE), []);
  assert.ok(validateEntry({ ...base, version: "v2.15" }, FIXTURE_FILE).some((problem) => problem.includes("semver")));
  assert.deepEqual(validateEntry({ ...base, commit: "063bee9" }, FIXTURE_FILE), []);
  assert.ok(validateEntry({ ...base, commit: "not-a-sha" }, FIXTURE_FILE).some((problem) => problem.includes("hexadecimal")));
});

test("validateEntry rejects too many tags and bad tag shapes", () => {
  const many = Array.from({ length: 9 }, (_, index) => `t${index}`);
  assert.ok(validateEntry({ ...OK, tags: many }, "f.yml").some((problem) => problem.includes("at most")));
  assert.ok(validateEntry({ ...OK, tags: ["Bad Tag"] }, "f.yml").some((problem) => problem.includes("must be lowercase")));
});

test("validateEntry rejects a non-github tarball", () => {
  const problems = validateEntry({ ...OK, tarball: "https://example.com/x.tgz" }, "f.yml");
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

/**
 * Judge which language a description is written in.
 *
 * `description.en` is what an English reader sees, so Chinese text landing there
 * is a real defect — it happened once, when four upstream repositories wrote
 * their summary in Chinese and one concatenated both languages onto one line.
 *
 * Counting CJK against Latin letters outright would be too strict in the other
 * direction: a Chinese sentence about `result-to-claim`, `AdServices` or `jadx`
 * is still Chinese, and those identifiers dominate the character count. What
 * separates the two is the share of CJK among all letters.
 */
function languageShare(text) {
  const cjk = (text.match(/[\u4e00-\u9fff]/gu) ?? []).length;
  const latin = (text.match(/[A-Za-z]/gu) ?? []).length;
  return cjk / Math.max(1, cjk + latin);
}

test("the English description is English and the Chinese one is Chinese", async () => {
  const catalog = JSON.parse(await readFile(new URL("../registry/skills.json", import.meta.url), "utf8"));
  for (const skill of catalog.skills) {
    // A translated description is at least a quarter CJK; an English one is
    // nowhere near it. The widest gap seen in the shipped catalog is 0.28 for a
    // Chinese entry heavy in product names and 0.00 for an English one.
    assert.ok(
      languageShare(skill.description.en) < 0.15,
      `${skill.name}: description.en is not written in English (${Math.round(languageShare(skill.description.en) * 100)}% CJK)`,
    );
    if (skill.description.zh === undefined) continue;
    assert.ok(
      languageShare(skill.description.zh) > 0.25,
      `${skill.name}: description.zh is not written in Chinese (${Math.round(languageShare(skill.description.zh) * 100)}% CJK)`,
    );
  }
});

/**
 * Guard the class of bug that shipped once: every entry must name a real branch,
 * and every entry must record a ref at all.
 *
 * `build-registry.mjs` defaults a missing `ref` to `main`, and `inspect.mjs` used
 * to hardcode `main` outright. Two repositories in the catalog use `master` and
 * one uses `development`, so those entries pointed at paths that do not exist —
 * `--check` passed and only `--check --verify`, which probes upstream, caught it.
 * The `ref` field is required here so the silent fallback can never apply.
 */
test("every entry pins the branch it was verified against", async () => {
  const catalog = JSON.parse(await readFile(new URL("../registry/skills.json", import.meta.url), "utf8"));
  for (const skill of catalog.skills) {
    assert.equal(typeof skill.ref, "string", `${skill.name}: ref must be recorded, not left to default to main`);
    assert.notEqual(skill.ref, "", `${skill.name}: ref must not be empty`);
    assert.ok(!skill.ref.includes(".."), `${skill.name}: ref must be a plain branch, tag or commit`);
    assert.equal(typeof skill.path, "string", `${skill.name}: path must be recorded`);
    assert.ok(skill.path.endsWith("SKILL.md"), `${skill.name}: path must name the SKILL.md the entry claims`);
  }
});

/**
 * The archive cap is written down twice and the two copies must agree.
 *
 * `lib/market.js` enforces the cap when it downloads a repository tarball, and
 * `registry/scripts/inspect.mjs` refuses candidates above it because the
 * installer fetches the whole repository before narrowing to one skill
 * directory. Twelve of the first fifty-nine published entries were
 * uninstallable for exactly this reason — the largest `K-Dense-AI` archive is
 * 233 MB against a 32 MiB cap — and nothing in the catalog build noticed,
 * because reachability was never checked at admission time.
 *
 * Raising the installer cap without raising the admission cap would silently
 * keep refusing repositories that had become installable, so this test reads
 * both files and compares the numbers rather than trusting them to stay in
 * step by hand.
 */
test("the admission cap matches the installer's download cap", async () => {
  const market = await readFile(new URL("../lib/market.js", import.meta.url), "utf8");
  const inspect = await readFile(new URL("../registry/scripts/inspect.mjs", import.meta.url), "utf8");

  // `options.maxBytes ?? 32 * 1024 * 1024` in fetchRepoTarball.
  const marketCap = /options\.maxBytes\s*\?\?\s*(\d+)\s*\*\s*1024\s*\*\s*1024/u.exec(market);
  assert.ok(marketCap, "lib/market.js must still declare its archive cap as a literal MiB expression");

  const inspectCap = /ARCHIVE_LIMIT_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/u.exec(inspect);
  assert.ok(inspectCap, "inspect.mjs must declare ARCHIVE_LIMIT_BYTES");

  assert.equal(
    inspectCap[1],
    marketCap[1],
    `inspect.mjs refuses archives above ${inspectCap[1]} MiB but the installer allows ${marketCap[1]} MiB`,
  );
});

