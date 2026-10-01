# Contributing / 贡献指南

Two things can be contributed: a **skill** for the market, and **code** for the plugin.

可以贡献两样东西：给市场的**技能**，和给插件的**代码**。

## Submitting a skill / 提交一个技能

Add one file under `registry/data/skills/` and open a pull request. The full
format, the requirements and what CI checks are in
[`registry/README.md`](registry/README.md).

在 `registry/data/skills/` 下加一个文件，提 PR。完整格式、要求与 CI 检查项见
[`registry/README.md`](registry/README.md)。

The short version: `repo`, `name`, `path` and `description.en` are required;
`name` must equal the `name` in the upstream `SKILL.md`; run
`npm run registry:build` and commit the regenerated `registry/skills.json`.

一句话版本：`repo`、`name`、`path`、`description.en` 必填；`name` 必须等于上游
`SKILL.md` 里的 `name`；跑 `npm run registry:build` 并把重新生成的
`registry/skills.json` 一起提交。

One entry per pull request. A pull request that rewrites other people's entries
will be sent back.

一个 PR 一条。改写别人条目的 PR 会被打回。

## Contributing code / 贡献代码

Install it into a scratch profile rather than the one you use daily:

装进一个临时 profile，而不是你天天在用的那个：

```sh
dsh plugin --profile web add github:MyRemme/dsh-skill-manager
```

To work from a checkout, point the profile at the directory:

从本地检出开发时，让 profile 指向该目录：

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-skill-manager
```

### Ground rules / 硬性约定

- **No dependencies at runtime.** The host half imports Node builtins only; the
  browser half imports nothing but `react`, which the loader already provides.
  A pull request that adds a runtime dependency needs to argue why.
- **运行时零依赖。** 宿主半区只 import Node 内置模块；浏览器半区除了 loader
  已经提供的 `react` 之外不 import 任何东西。加运行时依赖需要说明理由。
- **No build step.** `lib/index.js` and `lib/client.js` are the shipped files.
  The client is hand-written in the module-loader format; do not introduce a
  bundler.
- **没有构建步骤。** `lib/index.js` 与 `lib/client.js` 就是发布物。客户端是手写的
  module-loader 格式；不要引入打包器。
- **The two halves must agree.** Every path in `lib/client.js`'s `API` map has to
  exist in `lib/index.js`'s `ROUTES`. A test asserts it; keep it green.
- **两个半区必须一致。** `lib/client.js` 的 `API` 表里每个路径都要在
  `lib/index.js` 的 `ROUTES` 里存在。有测试在盯这件事，别让它红。
- **Both languages, same keys.** The `zh` and `en` dictionaries must have
  identical key sets, and every `t("…")` must exist in both. Tests cover it.
- **双语同键。** `zh` 与 `en` 两个字典的键集必须一致，每个 `t("…")` 都要两边都有。
  有测试覆盖。

### Before you push / 推送之前

```sh
node --test "test/**/*.test.mjs"
node registry/scripts/build-registry.mjs --check
```

Both run in CI. The test suite needs no network and no `npm install`.

两条 CI 都会跑。测试套件不需要联网，也不需要 `npm install`。

### Things worth knowing about the code / 代码上的几个要点

- **Skill writes are path-checked twice.** The client sends `{ name, path }`, and
  the host re-scans the roots and refuses the write unless a skill with that
  exact name is still at that exact path. Nothing is written based on a path the
  client made up.
- **技能写入有双重路径校验。** 客户端发 `{ name, path }`，宿主会重新扫描各根目录，
  只有「同名技能仍在同一路径」才动手。不会按客户端编造的路径写任何东西。
- **Installs are planned before anything touches disk.** `planSkills()` reduces an
  archive to a plan; `installSkills()` writes it. A rejected archive leaves the
  roots untouched.
- **安装先规划再落盘。** `planSkills()` 把压缩包归约成计划，`installSkills()` 才执行。
  被拒的压缩包不会动到任何根目录。
- **Archives never extract directly.** ZIP and TAR readers return in-memory file
  lists with POSIX relative paths; absolute paths, drive letters, `..` and
  symlink members are rejected or dropped.
- **压缩包从不直接解包到磁盘。** ZIP 与 TAR 读取器只返回内存中的文件列表；绝对路径、
  盘符、`..` 与符号链接成员会被拒绝或丢弃。
- **Overwrites go through the trash.** `overwrite: "trash"` renames the existing
  directory aside instead of deleting it, so a mistaken install is recoverable.
- **覆盖走回收站。** `overwrite: "trash"` 是把既有目录改名挪走，不是删除，装错了能捞回来。
- **Only two frontmatter keys are ever written:** `disable-model-invocation` and
  `user-invocable`. Every other byte of a `SKILL.md` survives an edit, including
  keys this plugin does not know about.
- **只会写两个 frontmatter 键：** `disable-model-invocation` 与 `user-invocable`。
  `SKILL.md` 的其余字节在编辑后原样保留，包括本插件不认识的键。

## Reporting a bad entry / 举报问题条目

Open an issue naming the entry file and what is wrong with it — the skill moved,
the repository is gone, the description overstates what it does. Entries that
stop being true are removed.

开 issue，写清是哪个条目文件、哪里不对——技能挪走了、仓库没了、描述夸大了。不再属实的
条目会被移除。
