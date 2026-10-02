/**
 * Documentation language check.
 *
 * The rule this enforces: one language per file. `README.md` and every README
 * under a subdirectory are English; the `.zh.md` sibling carries the Chinese.
 * Paragraph-by-paragraph bilingual documents are the hardest format to read and
 * the easiest to let drift, and they are exactly what slipped in before.
 *
 * Two things are exempt, because they are not prose:
 *   - fenced code blocks and inline code, which legitimately carry Chinese
 *     sample data (`description.zh: 按风格指南审阅文案。`)
 *   - Chinese interface labels, because the shipped UI is Chinese and quoting a
 *     tab as `已安装` is a citation, not a translation failure
 *
 * Usage: node scripts/check-docs.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

/** Interface labels the plugin actually renders in Chinese. */
const UI_LABELS = [
  "已安装",
  "市场",
  "导入",
  "新建",
  "技能管理",
  "删除",
  "回收站",
  "全选",
  "批量启用",
  "批量禁用",
  "编辑",
  "保存",
  "取消",
  "刷新",
  "恢复",
  "只读",
  "链接",
  "被覆盖",
  "模型",
  "手动",
  "同时禁止 /name 手动调用",
  "加载中",
  "出错了",
  "返回会话",
];

/** Files that must be English, with the reason recorded for the failure message. */
const ENGLISH_ONLY = ["README.md", "contributing.md", "registry/README.md", ".github/pull_request_template.md"];
/** Files that must be Chinese. */
const CHINESE_ONLY = ["README.zh.md", "contributing.zh.md", "registry/README.zh.md"];

/**
 * Strip everything that is allowed to contain Chinese: fenced code blocks,
 * inline code spans, the language-switch links, and the known interface labels.
 * @param text - whole Markdown document.
 * @returns the text with those regions blanked out.
 */
function stripAllowed(text) {
  let out = text.replace(/```[\s\S]*?```/gu, (block) => block.replace(/[^\n]/gu, " "));
  out = out.replace(/`[^`\n]*`/gu, (span) => span.replace(/[^\n]/gu, " "));
  // The language switcher is a fixed convention, not prose.
  out = out.replace(/\[(?:中文|English)\](?:\([^)]*\))?/gu, (link) => "X".repeat(link.length));
  // Longer labels first, so a short label cannot split a longer one and leave a
  // Chinese remainder behind.
  for (const label of [...UI_LABELS].sort((a, b) => b.length - a.length)) {
    out = out.split(label).join("X".repeat(label.length));
  }
  return out;
}

/** Collect every line that still carries Chinese after stripping. */
function offenders(text) {
  return stripAllowed(text)
    .split(/\r?\n/u)
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((entry) => CJK.test(entry.text));
}

/** Walk every Markdown file in the repository, skipping generated and vendored trees. */
async function markdownFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith(".md")) found.push(path);
  }
  return found;
}

const problems = [];
const files = await markdownFiles(ROOT);

for (const file of files) {
  const name = relative(ROOT, file).split("\\").join("/");
  const text = await readFile(file, "utf8");
  const bad = offenders(text);
  if (ENGLISH_ONLY.includes(name) && bad.length > 0) {
    for (const entry of bad) problems.push(`${name}:${entry.line}: Chinese in an English document (quote it as inline code, or move it to the .zh.md sibling)\n    ${entry.text.slice(0, 120)}`);
  }
  if (CHINESE_ONLY.includes(name)) {
    const counts = { cjk: 0, ascii: 0 };
    for (const line of text.split(/\r?\n/u)) {
      if (line.trim() === "" || line.trimStart().startsWith("|") || line.trimStart().startsWith("```")) continue;
      if (CJK.test(line)) counts.cjk += 1;
      else if (/^[A-Za-z]/.test(line.trim()) && line.trim().length > 60) counts.ascii += 1;
    }
    if (counts.cjk === 0) problems.push(`${name}: no Chinese prose found`);
    if (counts.ascii > counts.cjk) problems.push(`${name}: looks like English (${counts.ascii} English lines vs ${counts.cjk} Chinese)`);
  }
}

// Every bilingual pair must exist and point at each other.
for (const name of ENGLISH_ONLY) {
  if (!name.endsWith(".md")) continue;
  const zh = name.replace(/\.md$/u, ".zh.md");
  const present = files.some((file) => relative(ROOT, file).split("\\").join("/") === zh);
  if (name === ".github/pull_request_template.md") continue;
  if (!present && CHINESE_ONLY.includes(zh)) problems.push(`${zh}: missing Chinese sibling for ${name}`);
}

if (problems.length > 0) {
  process.stderr.write(`${problems.length} documentation problem(s):\n${problems.map((problem) => `  ${problem}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`documentation language check passed (${files.length} Markdown files, one language each)\n`);
}
