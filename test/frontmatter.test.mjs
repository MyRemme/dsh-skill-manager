import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_KEY,
  USER_KEY,
  applyEnabled,
  findLegacyKey,
  locateFrontmatter,
  readField,
  readInvocation,
  renderSkillFile,
  setField,
  splitBody,
  yamlScalar,
} from "../lib/frontmatter.js";

const SAMPLE = [
  "---",
  "name: demo-skill",
  "description: Demonstrates parsing.",
  "whenToUse: When a demo is needed.",
  "metadata:",
  "  owner: someone",
  "---",
  "",
  "# Body",
  "",
  "Keep me.",
  "",
].join("\n");

test("reads the leading frontmatter block and leaves the body alone", () => {
  const block = locateFrontmatter(SAMPLE);
  assert.equal(block?.inner.split("\n").length, 5);
  assert.equal(splitBody(SAMPLE).trim(), "# Body\n\nKeep me.");
});

test("readField returns undefined for absent and empty keys", () => {
  assert.equal(readField(SAMPLE, "name"), "demo-skill");
  assert.equal(readField(SAMPLE, "nope"), undefined);
  assert.equal(readField("---\nname:\n---\n", "name"), undefined);
});

test("readField joins block scalars", () => {
  const raw = "---\nname: x\ndescription: |\n  line one\n  line two\n---\n";
  assert.equal(readField(raw, "description"), "line one\nline two");
});

test("readField strips quotes so colon-bearing descriptions survive", () => {
  const raw = `---\nname: x\ndescription: ${yamlScalar("Vision toolkit: OCR, grounding.")}\n---\n`;
  assert.equal(readField(raw, "description"), "Vision toolkit: OCR, grounding.");
});

test("setField preserves every other byte, including unknown keys", () => {
  const next = setField(SAMPLE, MODEL_KEY, "true");
  assert.ok(next.includes("metadata:\n  owner: someone"));
  assert.equal(readField(next, "name"), "demo-skill");
  assert.equal(readField(next, MODEL_KEY), "true");
  assert.ok(next.endsWith("# Body\n\nKeep me.\n"), "body must be untouched");
});

test("setField removes the key when value is undefined", () => {
  const disabled = setField(SAMPLE, MODEL_KEY, "true");
  const enabled = setField(disabled, MODEL_KEY, undefined);
  assert.equal(readField(enabled, MODEL_KEY), undefined);
  assert.equal(enabled, SAMPLE, "removing an added key restores the original file");
});

test("setField creates a frontmatter block when the file has none", () => {
  const next = setField("# bare\n", MODEL_KEY, "true");
  assert.equal(readField(next, MODEL_KEY), "true");
  assert.ok(next.startsWith("---\n"));
  assert.ok(next.endsWith("# bare\n"));
});

test("applyEnabled toggles model invocation only by default", () => {
  const off = applyEnabled(SAMPLE, false);
  assert.equal(readInvocation(off).modelInvocable, false);
  assert.equal(readInvocation(off).userInvocable, true);
  const back = applyEnabled(off, true);
  assert.equal(back, SAMPLE);
});

test("applyEnabled with both also withdraws the user command", () => {
  const off = applyEnabled(SAMPLE, false, { both: true });
  assert.deepEqual(readInvocation(off), { modelInvocable: false, userInvocable: false });
  const on = applyEnabled(off, true, { both: true });
  assert.deepEqual(readInvocation(on), { modelInvocable: true, userInvocable: true });
});

test("CRLF files keep CRLF after an edit", () => {
  const crlf = SAMPLE.replace(/\n/gu, "\r\n");
  const next = applyEnabled(crlf, false);
  assert.ok(next.includes("\r\n"));
  assert.equal(next.includes("\n\n"), false, "no bare LF introduced");
  assert.equal(applyEnabled(next, true), crlf);
});

test("legacy invocation keys are reported", () => {
  assert.equal(findLegacyKey("---\nname: x\ndisableModelInvocation: true\n---\n"), "disableModelInvocation");
  assert.equal(findLegacyKey(SAMPLE), undefined);
});

test("renderSkillFile produces a file the reader agrees with", () => {
  const text = renderSkillFile({ name: "new-skill", description: "A skill: with a colon.", content: "# Hi" });
  assert.equal(readField(text, "name"), "new-skill");
  assert.equal(readField(text, "description"), "A skill: with a colon.");
  assert.equal(splitBody(text).trim(), "# Hi");
  assert.ok(text.endsWith("\n"));
});

test("renderSkillFile collapses newlines in the description", () => {
  const text = renderSkillFile({ name: "x", description: "one\ntwo" });
  assert.equal(readField(text, "description"), "one two");
});

test("yamlScalar quotes only what a strict parser would misread", () => {
  assert.equal(yamlScalar("plain text"), "plain text");
  assert.equal(yamlScalar("has: colon"), '"has: colon"');
  assert.equal(yamlScalar("trailing "), '"trailing "');
  assert.equal(yamlScalar("# not a comment"), '"# not a comment"');
  assert.equal(yamlScalar('quote " inside'), 'quote " inside', "a plain scalar may hold an inner quote");
  assert.equal(yamlScalar('a: "b"'), '"a: \\"b\\""');
});

test("a quoted scalar round-trips through the reader", () => {
  for (const value of ['Vision toolkit: OCR, "grounding" and diff.', "back\\slash: and colon", "trailing ", "# hash start"]) {
    const raw = `---\nname: x\ndescription: ${yamlScalar(value)}\n---\n`;
    assert.equal(readField(raw, "description"), value);
  }
});

test("a single-quoted scalar is unescaped the YAML way", () => {
  assert.equal(readField("---\nname: x\ndescription: 'it''s fine'\n---\n", "description"), "it's fine");
});
