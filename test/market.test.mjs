import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readTarGz } from "../lib/archive.js";
import { planSkills } from "../lib/install.js";
import { MarketError, apiFallbackUrl, assertRegistryUrl, assertRepo, fetchCatalog } from "../lib/market.js";
import { writeSkillFile } from "../lib/roots.js";
import { makeTarGz, skill } from "./helpers.mjs";

async function sandbox() {
  return await mkdtemp(join(tmpdir(), "skill-manager-market-"));
}

test("assertRepo accepts plain coordinates", () => {
  assert.doesNotThrow(() => assertRepo("vercel-labs/agent-skills"));
  assert.doesNotThrow(() => assertRepo("a_b.c/d-e_f"));
});

test("assertRepo refuses anything that could reshape the download URL", () => {
  for (const repo of ["owner", "owner/repo/extra", "a/..", "a/.", "../x", "https://evil.example/x", "", "a b/c"]) {
    assert.throws(() => assertRepo(repo), MarketError, `${repo} must be refused`);
  }
});

test("assertRegistryUrl only admits http and https", () => {
  assert.equal(assertRegistryUrl("https://example.com/skills.json"), "https://example.com/skills.json");
  assert.equal(assertRegistryUrl("http://127.0.0.1:8080/s.json"), "http://127.0.0.1:8080/s.json");
  for (const url of ["file:///etc/passwd", "ftp://x/y", "data:text/plain,x", "", undefined, "not a url"]) {
    assert.throws(() => assertRegistryUrl(url), MarketError, `${String(url)} must be refused`);
  }
});

test("a root-level SKILL.md does not swallow a nested skill's files", () => {
  const plans = planSkills([
    { path: "SKILL.md", data: Buffer.from(skill("root-skill")) },
    { path: "notes.md", data: Buffer.from("root notes") },
    { path: "packed/SKILL.md", data: Buffer.from(skill("packed-skill")) },
    { path: "packed/helper.sh", data: Buffer.from("#!/bin/sh\n") },
  ]);
  assert.deepEqual(plans.map((plan) => plan.name).sort(), ["packed-skill", "root-skill"]);
  const root = plans.find((plan) => plan.name === "root-skill");
  assert.deepEqual(root.files.map((file) => file.rel).sort(), ["SKILL.md", "notes.md"]);
  const packed = plans.find((plan) => plan.name === "packed-skill");
  assert.deepEqual(packed.files.map((file) => file.rel).sort(), ["SKILL.md", "helper.sh"]);
});

test("a pending GNU long name does not leak onto a later entry", () => {
  const archive = makeTarGz([
    { path: "././@LongLink", type: "L", data: "prefix/this-name-is-simply-too-long-for-a-ustar-header/SKILL.md" },
    { path: "././@LongLink", type: "5", data: "" },
    { path: "plain.md", type: "0", data: "plain file" },
  ]);
  const entries = readTarGz(archive);
  assert.deepEqual(entries.map((entry) => entry.path), ["plain.md"]);
});

test("a GNU long name is applied to the file that follows it", () => {
  const long = "deeply/nested/directory/structure/that/exceeds/one/hundred/characters/in/total/for/a/ustar/header/SKILL.md";
  const archive = makeTarGz([
    { path: "././@LongLink", type: "L", data: long },
    { path: "truncated-name", type: "0", data: skill("long-name-skill") },
  ]);
  const entries = readTarGz(archive);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, long);
});

test("apiFallbackUrl rewrites a raw file URL to the contents API", () => {
  assert.equal(
    apiFallbackUrl("https://raw.githubusercontent.com/MyRemme/dsh-skill-manager/main/registry/skills.json"),
    "https://api.github.com/repos/MyRemme/dsh-skill-manager/contents/registry/skills.json?ref=main",
  );
  assert.equal(apiFallbackUrl("https://example.com/skills.json"), undefined);
  assert.equal(apiFallbackUrl("https://raw.githubusercontent.com/owner/repo"), undefined);
});

test("the catalog falls back to the API when the raw host is unreachable", async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    if (String(url).startsWith("https://raw.githubusercontent.com/")) throw new Error("read ECONNRESET");
    const body = JSON.stringify({ version: 1, skills: [{ id: "a/b#s", name: "demo", repo: "a/b", path: "s", description: { en: "D." } }] });
    return new Response(JSON.stringify({ content: Buffer.from(body, "utf8").toString("base64") }), { status: 200 });
  };
  try {
    const result = await fetchCatalog({ url: "https://raw.githubusercontent.com/a/b/main/skills.json" });
    assert.equal(result.catalog.skills.length, 1);
    assert.equal(result.catalog.skills[0].name, "demo");
    assert.equal(seen.length, 2, "the raw host is tried first, then the API");
    assert.ok(seen[1].startsWith("https://api.github.com/repos/a/b/contents/skills.json"));
  } finally {
    globalThis.fetch = original;
  }
});

test("a genuine 404 from the catalog is not masked by the fallback", async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return new Response("nope", { status: 404 });
  };
  try {
    await assert.rejects(() => fetchCatalog({ url: "https://raw.githubusercontent.com/a/b/main/skills.json" }), /HTTP 404/u);
    assert.equal(seen.length, 1, "no second request for a missing file");
  } finally {
    globalThis.fetch = original;
  }
});

test("an unreachable catalog with no API equivalent reports the failure", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("read ECONNRESET");
  };
  try {
    await assert.rejects(() => fetchCatalog({ url: "https://example.com/skills.json" }), MarketError);
  } finally {
    globalThis.fetch = original;
  }
});

test("writeSkillFile leaves no temporary file behind", async () => {
  const root = await sandbox();
  try {
    const file = join(root, "demo", "SKILL.md");
    await writeSkillFile(file, skill("demo"));
    assert.match(await readFile(file, "utf8"), /name: demo/u);
    const leftovers = (await readdir(join(root, "demo"))).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeSkillFile replaces content in place without orphaning the path", async () => {
  const root = await sandbox();
  try {
    const file = join(root, "SKILL.md");
    await writeSkillFile(file, "first");
    await writeSkillFile(file, "second");
    assert.equal(await readFile(file, "utf8"), "second");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeSkillFile writes through a symlink instead of replacing it", async (context) => {
  const root = await sandbox();
  try {
    const target = join(root, "real.md");
    await writeFile(target, "original", "utf8");
    const link = join(root, "linked.md");
    try {
      await symlink(target, link, "file");
    } catch {
      context.skip("symlinks are unavailable in this environment");
      return;
    }
    await writeSkillFile(link, "updated");
    const { lstat } = await import("node:fs/promises");
    assert.equal((await lstat(link)).isSymbolicLink(), true, "the link must survive the write");
    assert.equal(await readFile(target, "utf8"), "updated");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeSkillFile creates missing parent directories", async () => {
  const root = await sandbox();
  try {
    const file = join(root, "a", "b", "c", "SKILL.md");
    await writeSkillFile(file, skill("deep"));
    assert.equal(existsSync(file), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("planSkills refuses an archive with nothing installable", () => {
  assert.throws(() => planSkills([]), /no skill found/u);
});
