# Skill registry / 技能目录

`skills.json` is the catalog the **市场** tab in the plugin downloads. It is built
from one YAML file per skill, so two people submitting at the same time never
touch the same file.

`skills.json` 是插件**市场**页下载的目录。它由「一个技能一个 YAML 文件」构建而成，
所以同时提交的两个人永远不会改到同一个文件。

```
registry/
├── skills.json                 generated — do not edit by hand / 生成物，勿手改
├── data/skills/*.yml           one entry per skill / 一个技能一个条目
└── scripts/build-registry.mjs  validate + build + verify
```

## Submit a skill / 提交一个技能

Open a pull request that adds **one file**:
`registry/data/skills/<owner>__<repo>--<skill>.yml`

提一个 PR，只加**一个文件**：`registry/data/skills/<owner>__<repo>--<skill>.yml`

```yaml
repo: acme/widget-skills            # required — owner/name of the repository
name: widget-helper                 # required — must equal the SKILL.md frontmatter `name`
path: skills/widget-helper/SKILL.md # required — where the SKILL.md sits in that repo
ref: main                           # optional — branch, tag or commit; defaults to main
category: docs                      # optional — one lowercase word such as ui, docs, dev, security
tags: [writing, markdown]           # optional — at most 8, lowercase with hyphens
license: MIT                        # optional — only if the upstream repository declares one
description:
  en: Reviews prose for the style guide. Use when asked to audit docs or tighten wording.
  zh: 按风格指南审阅文案。适用于「审一下文档」「把措辞收紧」这类请求。  # optional
```

`description.en` is required and everything else is optional. A missing Chinese
line is our problem, not a reason to reject the entry.

`description.en` 必填，其余可选。缺中文是我们的活，不该成为打回的理由。

The file name must match the entry: `owner__repo--skill.yml` (repository owners
and names keep their original case; the skill part is the kebab-case skill name).

文件名必须与条目一致：`owner__repo--skill.yml`（owner 与 repo 保留原大小写，
技能部分就是 kebab-case 的技能名）。

### What the entry has to be true about / 条目必须属实

- `path` must point at a file that exists **at `ref`**, and that file's
  frontmatter `name` must equal `name`. CI checks both by reading the file.
- `path` 指向的文件必须在 `ref` 上真实存在，且 frontmatter 的 `name` 必须等于 `name`。
  CI 会实际读这个文件来核对。
- Installing copies the **whole directory** that holds the `SKILL.md`, so sibling
  scripts and assets come along. Keep that directory self-contained.
- 安装会复制 `SKILL.md` **所在目录的全部内容**，同级脚本与素材会一起装走。请让该目录自洽。
- The description is read as a claim about the skill. "Audits prose against the
  style guide" should be what it does.
- 描述会被当作对该技能的声明。「按风格指南审阅文案」就应该真的是它在做的事。
- One skill name may only be claimed once in the whole catalog, because the name
  is the directory the skill is installed into.
- 整个目录里同一个技能名只能被声明一次——名字就是安装目录名。

### Do not edit `skills.json` by hand / 不要手改 `skills.json`

Regenerate and commit it:

```sh
npm run registry:build
```

CI runs `--check`, which fails the pull request when the committed catalog and
the entry files disagree.

### 一个 PR 只加一条

One entry per pull request. Reviewing an entry means reading the skill it points
at; that work does not get cheaper in bulk. Fixes to existing entries, category
changes and removals are equally welcome.

一个 PR 只加一条。评审一个条目意味着去读它指向的那个技能，这份工作量不会因为打包
而减少。修正既有条目、调整分类、移除失效条目的 PR 同样欢迎。

## Local commands / 本地命令

```sh
npm run registry:build     # validate every entry and rewrite skills.json
npm run registry:check     # fail when skills.json is stale (what CI runs)
node registry/scripts/build-registry.mjs --verify        # also read each skill upstream
node registry/scripts/build-registry.mjs --verify --strict  # rate limits become errors
node registry/scripts/build-registry.mjs --stars         # refresh star counts
```

`--verify` needs network. Upstream rate limiting is reported as a **warning** so a
pull request is never failed by something unrelated to it; `--strict` promotes
those warnings to errors. Set `GITHUB_TOKEN` to raise the unauthenticated limit
of 60 requests per hour.

`--verify` 需要联网。上游限流会作为**警告**报告，避免一个 PR 因为与它无关的原因失败；
`--strict` 会把警告升级为错误。设置 `GITHUB_TOKEN` 可以提高未认证时每小时 60 次的限制。

## Catalog shape / 目录结构

```jsonc
{
  "version": 1,
  "generatedAt": "2026-10-05T09:00:00.000Z",
  "skills": [
    {
      "id": "acme/widget-skills#skills/widget-helper/SKILL.md",
      "name": "widget-helper",
      "repo": "acme/widget-skills",
      "path": "skills/widget-helper/SKILL.md",
      "ref": "main",
      "category": "docs",
      "tags": ["writing"],
      "license": "MIT",
      "author": "acme",
      "stars": 128,
      "description": { "en": "…", "zh": "…" }
    }
  ]
}
```

`id` is what the plugin sends back when installing. Entries are sorted by `name`
so the generated file only diffs where it actually changed.

`id` 就是插件在安装时回传的标识。条目按 `name` 排序，生成的文件的 diff 只会出现在真正
变化的地方。

## Pointing the plugin elsewhere / 让插件读别的目录

The plugin fetches this repository's `registry/skills.json` by default. A profile
can override it:

插件默认读取本仓库的 `registry/skills.json`。profile 里可以改：

```yaml
- id: skill-manager
  name: dsh-skill-manager
  config:
    registryUrl: https://example.com/skills.json
```

## Not a security review / 这不是安全审查

Listing a skill records where it lives — nothing more. Installing one downloads
that repository's tarball and writes it into your skill root, and the skill's
text then enters your model's context. Read what you install. Entries that stop
working are removed, but nobody audits the code behind them.

收录一个技能只记录它在哪里——仅此而已。安装会下载那个仓库的 tarball 并写进你的技能
目录，技能正文随后会进入模型上下文。装之前自己看一眼。失效条目会被移除，但没有人替
你审计它背后的代码。
