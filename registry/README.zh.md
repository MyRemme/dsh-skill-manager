# 技能目录

[English](README.md)

`skills.json` 是插件**市场**页下载的目录。它由「一个技能一个 YAML 文件」构建而成，
所以同时提交的两个人永远不会改到同一个文件。

```
registry/
├── skills.json                 生成物，勿手改
├── data/skills/*.yml           一个技能一个条目
└── scripts/build-registry.mjs  校验 + 构建 + 核验
```

## 提交一个技能

提一个 PR，只加**一个文件**：
`registry/data/skills/<owner>__<repo>--<skill>.yml`

```yaml
repo: acme/widget-skills            # 必填——仓库的 owner/name
name: widget-helper                 # 必填——必须等于 SKILL.md frontmatter 里的 `name`
path: skills/widget-helper/SKILL.md # 必填——SKILL.md 在该仓库中的位置
category: writing                   # 必填——从下方列表里选一个
ref: main                           # 可选——分支、标签或提交；默认 main
version: 2.15.0                     # 可选——仅当上游确实发布 release 时
commit: 063bee9                     # 可选——条目核验时所处的提交
added: 2026-10-02                   # 可选——条目进入目录的日期 YYYY-MM-DD
tags: [writing, markdown]           # 可选——最多 8 个，小写加连字符
license: MIT                        # 可选——仅当上游仓库声明了许可证时
description:
  en: Reviews prose for the style guide. Use when asked to audit docs or tighten wording.
  zh: 按风格指南审阅文案。适用于「审一下文档」「把措辞收紧」这类请求。  # 可选
```

`repo`、`name`、`path`、`category`、`description.en` 必填。缺中文是我们的活，不该成为
打回的理由。

`category` 是封闭列表——放开成自由文本会让筛选器变成「一个条目一个分类」，比没有筛选
更糟：

`ui` `dev` `docs` `data` `office` `design` `media` `testing` `security`
`infra` `research` `writing` `agent` `fun`

市场会把 `category` 渲染成筛选项、把 `version` 或 `commit` 渲染成来源徽标、把 `added`
当作时间筛选的窗口。**只有上游确实发布 release 时才写 `version`**——编一个版本号比不写
更糟，核验时所处的修订请写进 `commit`。

文件名必须与条目一致：`owner__repo--skill.yml`。owner 与 repo 保留原大小写，
技能部分就是 kebab-case 的技能名。

一个 PR 只加一条。评审一个条目意味着去读它指向的那个技能，这份工作量不会因为打包而
减少。修正既有条目、调整分类、移除失效条目的 PR 同样欢迎。

### 条目必须属实

- `path` 指向的文件必须在 `ref` 上真实存在，且该文件 frontmatter 里的 `name` 必须
  等于 `name`。CI 会实际读这个文件来核对。
- 安装会复制 `SKILL.md` **所在目录的全部内容**，同级脚本与素材会一起装走。请让该目录
  自洽。
- 描述会被当作对该技能的声明。「按风格指南审阅文案」就应该真的是它在做的事。
- 整个目录里同一个技能名只能被声明一次——名字就是安装目录名。

### 不要手改 `skills.json`

重新生成并提交：

```sh
npm run registry:build
```

CI 会跑 `--check`，当已提交的目录与条目文件不一致时判该 PR 失败。

## 本地命令

```sh
npm run registry:build      # 校验每个条目并重写 skills.json
npm run registry:check      # skills.json 过期就失败（CI 跑的就是这条）
node registry/scripts/build-registry.mjs --verify           # 另外去上游读一遍每个技能
node registry/scripts/build-registry.mjs --verify --strict  # 限流升级为错误
node registry/scripts/build-registry.mjs --stars            # 刷新 star 数
```

`--verify` 需要联网。上游限流会作为**警告**报告，避免一个 PR 因为与它无关的原因失败；
`--strict` 会把警告升级为错误。设置 `GITHUB_TOKEN` 可以提高未认证时每小时 60 次的限制。

## 目录结构

```jsonc
{
  "version": 2,
  "generatedAt": "2026-10-05T09:00:00.000Z",
  "skills": [
    {
      "id": "acme/widget-skills#skills/widget-helper/SKILL.md",
      "name": "widget-helper",
      "repo": "acme/widget-skills",
      "path": "skills/widget-helper/SKILL.md",
      "ref": "main",
      "category": "writing",
      "version": "2.15.0",          // 或 "commit": "063bee9"
      "added": "2026-10-02",
      "tags": ["writing"],
      "license": "MIT",
      "author": "acme",
      "stars": 128,
      "description": { "en": "…", "zh": "…" }
    }
  ]
}
```

`version` 是目录文档自身的 schema 版本。推进它就是告诉旧版插件「形状变了」。
`id` 就是插件在安装时回传的标识。条目按 `name` 排序，生成文件的 diff 只会出现在真正
变化的地方。

## 让插件读别的目录

插件默认读取本仓库的 `registry/skills.json`。profile 里可以改：

```yaml
- id: skill-manager
  name: dsh-skill-manager
  config:
    registryUrl: https://example.com/skills.json
```

## 这不是安全审查

收录一个技能只记录它在哪里——仅此而已。安装会下载那个仓库的 tarball 并写进你的技能
目录，技能正文随后会进入模型上下文。装之前自己看一眼。失效条目会被移除，但没有人替
你审计它背后的代码。
