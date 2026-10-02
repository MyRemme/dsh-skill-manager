# 贡献指南

[English](contributing.md)

可以贡献两样东西：给市场的**技能**，和给插件的**代码**。

## 提交一个技能

在 `registry/data/skills/` 下加一个文件，提 PR。完整格式、要求与 CI 检查项见
[`registry/README.zh.md`](registry/README.zh.md)。

一句话版本：`repo`、`name`、`path`、`description.en` 必填；`name` 必须等于上游
`SKILL.md` 里的 `name`；跑 `npm run registry:build` 并把重新生成的
`registry/skills.json` 一起提交。

一个 PR 一条。改写别人条目的 PR 会被打回。

## 贡献代码

装进一个临时 profile，而不是你天天在用的那个：

```sh
dsh plugin --profile web add github:MyRemme/dsh-skill-manager
```

从本地检出开发时，让 profile 指向该目录：

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-skill-manager
```

### 硬性约定

- **运行时零依赖。** 宿主半区只 import Node 内置模块；浏览器半区除了 loader 已经提供的
  `react` 之外不 import 任何东西。加运行时依赖需要说明理由。
- **没有构建步骤。** `lib/index.js` 与 `lib/client.js` 就是发布物。客户端是手写的
  module-loader 格式；不要引入打包器。
- **两个半区必须一致。** `lib/client.js` 的 `API` 表里每个路径都要在 `lib/index.js` 的
  `ROUTES` 里存在。有测试在盯这件事，别让它红。
- **双语同键。** `zh` 与 `en` 两个字典的键集必须一致，每个 `t("…")` 都要两边都有。
  有测试覆盖。
- **一个文件只用一种语言。** `README.md` 与各子目录下的 `README.md` 是英文，同名的
  `.zh.md` 是中文版。不要把两种语言逐段夹在一起——那是最难读、也最容易走样的排版。

### 推送之前

```sh
node --test "test/**/*.test.mjs"
node registry/scripts/build-registry.mjs --check
```

两条 CI 都会跑。测试套件不需要联网，也不需要 `npm install`。

测试必须与平台无关。把 CI 当成 Linux：硬编码的 `C:\…` 字面量在那里是一个文件名而不是
路径，所以请用 `node:path` 拼路径，不要手写。

### 代码上的几个要点

- **技能写入有双重路径校验。** 客户端发 `{ name, path }`，宿主会重新扫描各根目录，
  只有「同名技能仍在同一路径」才动手。不会按客户端编造的路径写任何东西。
- **安装先规划再落盘。** `planSkills()` 把压缩包归约成计划，`installSkills()` 才执行。
  被拒的压缩包不会动到任何根目录。
- **压缩包从不直接解包到磁盘。** ZIP 与 TAR 读取器只返回内存中的文件列表；绝对路径、
  盘符、`..` 与符号链接成员会被拒绝或丢弃。
- **覆盖走回收站。** `overwrite: "trash"` 是把既有目录改名挪走，不是删除，装错了能捞回来。
- **只会写两个 frontmatter 键：** `disable-model-invocation` 与 `user-invocable`。
  `SKILL.md` 的其余字节在编辑后原样保留，包括本插件不认识的键。

## 举报问题条目

开 issue，写清是哪个条目文件、哪里不对——技能挪走了、仓库没了、描述夸大了。不再属实的
条目会被移除。
