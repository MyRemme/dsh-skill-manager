import assert from "node:assert/strict";
import test from "node:test";
import { ArchiveError, readTarGz, readZip, safeRelativePath, stripSingleRoot } from "../lib/archive.js";
import { makeTarGz, makeZip, skill } from "./helpers.mjs";

test("readZip handles deflated entries", () => {
  const archive = makeZip([
    { path: "demo/SKILL.md", data: skill("demo") },
    { path: "demo/notes.txt", data: "hello" },
  ]);
  const entries = readZip(archive);
  assert.deepEqual(entries.map((entry) => entry.path), ["demo/SKILL.md", "demo/notes.txt"]);
  assert.match(entries[0].data.toString("utf8"), /name: demo/u);
  assert.equal(entries[1].data.toString("utf8"), "hello");
});

test("readZip handles stored entries", () => {
  const archive = makeZip([{ path: "a.txt", data: "stored" }], { store: true });
  assert.equal(readZip(archive)[0].data.toString("utf8"), "stored");
});

test("readZip rejects absolute paths and traversal", () => {
  assert.throws(() => readZip(makeZip([{ path: "/etc/passwd", data: "x" }])), ArchiveError);
  assert.throws(() => readZip(makeZip([{ path: "../escape", data: "x" }])), ArchiveError);
  assert.throws(() => readZip(makeZip([{ path: "a/../../escape", data: "x" }])), ArchiveError);
  assert.throws(() => readZip(makeZip([{ path: "C:/win", data: "x" }])), ArchiveError);
});

test("readZip enforces the entry cap", () => {
  const files = Array.from({ length: 5 }, (_, index) => ({ path: `f${index}.txt`, data: "x" }));
  assert.throws(() => readZip(makeZip(files), { maxEntries: 3 }), /limit is 3/u);
});

test("readZip enforces the expansion cap", () => {
  const archive = makeZip([{ path: "big.txt", data: "z".repeat(4096) }]);
  assert.throws(() => readZip(archive, { maxTotalBytes: 1024 }), /expands past/u);
});

test("readZip rejects non-ZIP input", () => {
  assert.throws(() => readZip(Buffer.from("not a zip at all")), /not a ZIP archive/u);
});

test("readTarGz reads github-style trees", () => {
  const archive = makeTarGz([
    { path: "repo-main/skills/demo/SKILL.md", data: skill("demo") },
    { path: "repo-main/skills/demo/run.sh", data: "#!/bin/sh\n" },
  ]);
  const entries = readTarGz(archive);
  assert.deepEqual(entries.map((entry) => entry.path), ["repo-main/skills/demo/SKILL.md", "repo-main/skills/demo/run.sh"]);
  assert.equal(entries[1].data.toString("utf8"), "#!/bin/sh\n");
});

test("readTarGz rejects traversal in a header name", () => {
  assert.throws(() => readTarGz(makeTarGz([{ path: "../escape.md", data: "x" }])), ArchiveError);
});

test("stripSingleRoot unwraps exactly one shared directory", () => {
  const entries = [
    { path: "repo-main/a.md", data: Buffer.from("a") },
    { path: "repo-main/sub/b.md", data: Buffer.from("b") },
  ];
  assert.deepEqual(stripSingleRoot(entries).map((entry) => entry.path), ["a.md", "sub/b.md"]);

  const split = [
    { path: "one/a.md", data: Buffer.from("a") },
    { path: "two/b.md", data: Buffer.from("b") },
  ];
  assert.deepEqual(stripSingleRoot(split).map((entry) => entry.path), ["one/a.md", "two/b.md"]);
});

test("safeRelativePath normalises separators and dot segments", () => {
  assert.equal(safeRelativePath("a\\b\\c.md"), "a/b/c.md");
  assert.equal(safeRelativePath("./a//b.md"), "a/b.md");
  assert.throws(() => safeRelativePath(".."), ArchiveError);
});
