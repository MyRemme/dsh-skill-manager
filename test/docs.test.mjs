import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

/** The pairs that must exist, English first. */
const PAIRS = [
  ["README.md", "README.zh.md"],
  ["contributing.md", "contributing.zh.md"],
  ["registry/README.md", "registry/README.zh.md"],
];

const read = (name) => readFile(join(ROOT, name), "utf8");

test("the documentation language check passes on the committed tree", () => {
  const result = spawnSync(process.execPath, [join(ROOT, "scripts", "check-docs.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 0, `check-docs reported problems:\n${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /one language each/u);
});

test("every English document has a Chinese sibling", async () => {
  for (const [en, zh] of PAIRS) {
    assert.ok((await read(en)).length > 0, `${en} is empty`);
    assert.ok((await read(zh)).length > 0, `${zh} is empty`);
  }
});

test("each pair cross-links to the other", async () => {
  for (const [en, zh] of PAIRS) {
    const enText = await read(en);
    const zhText = await read(zh);
    const enName = en.split("/").pop();
    const zhName = zh.split("/").pop();
    assert.ok(zhText.includes("English") && zhText.includes(enName), `${zh} must link back to ${enName}`);
    assert.ok(enText.includes("中文") && enText.includes(zhName), `${en} must link to ${zhName}`);
  }
});

test("the English documents carry no Chinese prose outside the allowed spots", async () => {
  // Re-implements the rule rather than importing it: a bug in the checker must
  // not also silence the test that is supposed to catch it.
  const UI_LABELS = [
    "同时禁止 /name 手动调用",
    "复制条目模板",
    "申请收录",
    "发布时间范围",
    "排序字段",
    "排序方向",
    "全部时间",
    "最近 7 天",
    "最近 30 天",
    "最近 90 天",
    "最近 1 年",
    "全部分类",
    "收录时间",
    "技能管理",
    "批量启用",
    "批量禁用",
    "返回会话",
    "已安装",
    "回收站",
    "新建",
    "导入",
    "市场",
    "删除",
    "全选",
    "只读",
    "被覆盖",
    "筛选",
    "链接",
  ];
  for (const [en] of PAIRS) {
    let text = await read(en);
    text = text.replace(/```[\s\S]*?```/gu, "");
    text = text.replace(/`[^`\n]*`/gu, "");
    text = text.replace(/\[(?:中文|English)\](?:\([^)]*\))?/gu, "");
    for (const label of [...UI_LABELS].sort((a, b) => b.length - a.length)) text = text.split(label).join("");
    const bad = text
      .split(/\r?\n/u)
      .map((line, index) => ({ line: index + 1, text: line.trim() }))
      .filter((entry) => CJK.test(entry.text));
    assert.deepEqual(bad, [], `${en} carries Chinese prose at ${bad.map((entry) => entry.line).join(", ")}`);
  }
});

test("the Chinese documents are actually written in Chinese", async () => {
  for (const [, zh] of PAIRS) {
    const text = await read(zh);
    const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== "" && !line.trimStart().startsWith("|") && !line.trimStart().startsWith("```"));
    const chinese = lines.filter((line) => CJK.test(line)).length;
    assert.ok(chinese / lines.length > 0.5, `${zh} looks like it drifted into English (${chinese}/${lines.length})`);
  }
});

test("the checker is not vacuously green — it rejects injected Chinese prose", async () => {
  const probe = join(ROOT, "README.md");
  const original = await readFile(probe, "utf8");
  const { writeFile } = await import("node:fs/promises");
  try {
    await writeFile(probe, `${original}\n这是一个中文段落，不应该出现在英文文件里。\n`, "utf8");
    const result = spawnSync(process.execPath, [join(ROOT, "scripts", "check-docs.mjs")], { encoding: "utf8" });
    assert.equal(result.status, 1, "the checker must fail on injected Chinese prose");
    assert.match(result.stderr, /Chinese in an English document/u);
  } finally {
    await writeFile(probe, original, "utf8");
  }
  const restored = await readFile(probe, "utf8");
  assert.equal(restored, original, "the probe must leave the file byte-identical");
});
