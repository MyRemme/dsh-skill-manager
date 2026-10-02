# 技能目录

[English](README.md)

`skills.json` 是插件**市场**页下载的目录。它由「一个技能一个 YAML 文件」构建而成，
所以同时提交的两个人永远不会改到同一个文件。

```
registry/
├── skills.json                     生成物，勿手改
├── data/skills/*.yml               一个技能一个条目
└── scripts/
    ├── build-registry.mjs          校验 + 构建 + 核验
    └── discover.mjs                在 GitHub 上找候选，并套用许可证闸门
```

## 提交一个技能

提一个 PR，只加**一个文件**：
`registry/data/skills/<owner>__<repo>--<skill>.yml`

```yaml
repo: acme/widget-skills            # 必填——仓库的 owner/name
name: widget-helper                 # 必填——必须等于 SKILL.md frontmatter 里的 `name`
path: skills/widget-helper/SKILL.md # 必填——SKILL.md 在该仓库中的位置
category: writing                   # 必填——从下方列表里选一个
ref: main                           # 必填——分支、标签或提交；没有默认值
version: 2.15.0                     # 可选——仅当上游确实发布 release 时
commit: 063bee9                     # 可选——条目核验时所处的提交
added: 2026-10-02                   # 可选——条目进入目录的日期 YYYY-MM-DD
tags: [writing, markdown]           # 可选——最多 8 个，小写加连字符
license: MIT                        # 必填——必须是允许再分发的许可证
description:
  en: Reviews prose for the style guide. Use when asked to audit docs or tighten wording.
  zh: 按风格指南审阅文案。适用于「审一下文档」「把措辞收紧」这类请求。  # 可选
```

`repo`、`name`、`path`、`category`、`ref`、`license`、`description.en` 必填。缺中文是我们的活，
不该成为打回的理由。

## 收录闸门

收录一个条目，市场就得兑现一个承诺：点「安装」，技能落到本地。四道闸门在条目进入目录前
检查这个承诺。

### 一、许可证闸门

收录一个条目，等于复述了它的仓库坐标、并让市场去装它的文件。所以：**没有许可证就不进目录。**

没有许可证**不等于**获得许可——仓库里没有 `LICENSE` 文件，默认状态是「保留所有权利」；
`NOASSERTION` **也不等于**宽松许可证，那是 GitHub 在说「有许可证文件，但认不出是什么」。
「认不出」和「允许用」是两回事。

白名单，此外一律不放行：

`0BSD` `Apache-2.0` `BSD-2-Clause` `BSD-3-Clause` `CC-BY-4.0` `CC0-1.0` `ISC`
`MIT` `MIT-0` `MPL-2.0` `Unlicense`

写法会归一化，所以 `mit`、`Apache 2.0` 能被接受，并回写成 `MIT`、`Apache-2.0`。故意排除：
`CC-BY-NC-*`、`CC-BY-ND-*`（非商业、禁止演绎都不是再分发授权），以及 `GPL-*` / `AGPL-*`
（copyleft 义务不是一个目录能追踪的）。要改这个名单，就在 `schema.mjs` 里改一行——**公开
改，把理由写出来，不要开暗门例外**。

**闸门查的是仓库，不是 skill 文件本身。** 仓库根目录的宽松许可证通常覆盖它下面的一切，但
skill 目录若自带 `LICENSE`，则以那个为准。提交前请自己确认——构建脚本看不到这一层。

### 二、下载体积闸门

安装器下载的是**整个仓库的 tarball**，下完了才裁出其中一个技能目录（`lib/market.js` 的
`fetchRepoTarball`）。所以超过 32 MiB 上限的归档会在最后一步失败——流量已经付完了。

这不是假设。最初发布的五十九条里有十二条**任何人都装不上**：`K-Dense-AI/scientific-agent-skills`
233 MB、`NanmiCoder/cc-haha` 125 MB、`wasp-lang/open-saas` 91 MB。点「安装」会先下几十到
几百兆，然后报错；而目录构建从没发现，因为收录时只查了质量，没查可达性。

因此 `inspect.mjs` 会量归档，超限就**整仓库拒收**。超限仓库不是「收录但标注一下」，是根本不收。
一个装不上的条目比一个缺席的条目更糟——它看起来是能用的。

上限写在两个文件里，由一条测试拴住（`the admission cap matches the installer's download cap`）。
要抬安装器的 `maxBytes`，就得在同一次改动里抬 `inspect.mjs` 的 `ARCHIVE_LIMIT_BYTES`，否则测试失败。

### 三、软链闸门

**`SKILL.md` 本身是符号链接的技能一律拒收。** 这条来自一次真实翻车：核验通过，安装却报
「仓库不含该路径」。

因为两边对软链的处理不一致。GitHub contents 接口**会解引用**软链并返回真实文件，所以
frontmatter、`name`、描述全读得出来，核验一路绿灯；但安装器下的是 tarball，tar 读取器只收
普通文件（type 0/7），把软链（type 2）全丢掉。目录于是空了，安装失败。`alirezarezvani/claude-skills`
发布了 1574 个软链，目录里曾有两条条目建在软链上，两条都装不上。

选择在收录端拒收，而不是让读取器跟随链接：软链技能装出来也是断链，目录本就不该发布它。
要用那个仓库里的技能，取它指向的真实路径。

### 四、属实闸门

每个条目都必须是真的：

- `path` 必须在 `ref` 上存在，且该文件 frontmatter 里的 `name` 必须等于条目的 `name`。
  CI 会实际读这个文件来核对。
- `ref` 必填且要记录下来，没有默认值。目录里有两个仓库用 `master`、一个用 `development`；
  静默回退到 `main` 让那些条目指向了不存在的路径，而且只有会探上游的 `--check --verify` 才发现。
- frontmatter 里没有 `name` 的 `SKILL.md` 不是技能，一律拒收。名为 `*SKILL.md` 的文档文件和
  生成的占位文件曾被以「上游从未声明过的名字」收录。
- 整个目录里同一个技能名只能被声明一次——名字就是安装目录名。

### 五、分类闸门

`category` 必须取自「找候选」一节给出的封闭列表。分类还没定的条目归 `other`，不要硬塞进
不属于它的桶——一个错位的条目会污染那个桶里所有真实成员的筛选结果。

改完条目跑构建：

```
node registry/scripts/build-registry.mjs          # 重写 skills.json
node registry/scripts/build-registry.mjs --check  # 过期则失败
```

## 找候选

`discover.mjs` 向 GitHub 搜索接口要匹配的仓库，读 GitHub 已经算好的 `license.spdx_id`，
只报告过了闸门的那些。一次请求返回 100 个仓库，所以跑一轮只花几次请求，而不是每个仓库
一次。

```
node registry/scripts/discover.mjs --query "claude skills" --pages 2 --min-stars 100
node registry/scripts/discover.mjs --query "agent skills" --json
```

它从环境变量读 `GITHUB_TOKEN`（或 `GH_TOKEN`）来提高额度，**没有也能跑**，走匿名额度。
这个 token 不会被打印，也不会被写进任何地方。请求按搜索接口 10 次/分钟的限速**主动等待**，
而不是撞上限流再重试。

**它什么都不写。** 候选仍要人工变成条目，因为仓库级的许可证不能证明那个 skill 文件也被覆盖。

下一步是 `inspect.mjs`，它套用其余闸门：读仓库的 git tree、量归档体积、核验每个将被发布的
技能文件。

```
node registry/scripts/inspect.mjs --in _candidates.json                  # 只报告
node registry/scripts/inspect.mjs --in _candidates.json --write          # 生成条目
node registry/scripts/inspect.mjs --in _candidates.json --top 30 --per-repo 3 --write
```

`--per-repo`（默认 3）是硬上限，不是建议：一个仓库不该靠一己之力填满目录。`--top`（默认 30）
限制总共考虑多少个候选。

`category` 是封闭列表——放开成自由文本会让筛选器变成「一个条目一个分类」，比没有筛选
更糟：

`ui` `dev` `docs` `data` `office` `design` `media` `testing` `security`
`infra` `research` `writing` `agent` `fun` `other`

`other` 是刻意留的兜底项，收容分类尚未定的条目。

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
