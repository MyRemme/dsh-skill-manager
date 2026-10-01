# dsh-skill-manager

DeepSeek Harness 的技能管理：批量与单项启用/禁用、文件夹与压缩包导入、自己写技能，
外加一个可以用 PR 投稿的技能市场——全部在一个 Web GUI 面板里。

[English](README.md) · [贡献指南](contributing.md) · [目录格式](registry/README.md)

## 有什么

| 页面 | 能做什么 |
| --- | --- |
| **已安装** | 按来源分级列出 harness 能看到的全部技能：搜索框、来源过滤、逐行开关、勾选多选、**全选 / 批量启用 / 批量禁用**、整组启用/禁用、就地编辑、可恢复的删除 |
| **市场** | 从本仓库的 `registry/skills.json` 拉目录：搜索、按分类过滤、看哪些已装、一键安装 |
| **导入** | 从 `.zip` 上传、从文件夹选择器、或从主机上的绝对路径安装 |
| **新建** | 把新技能（名字、描述、适用场景、正文）写进用户根或项目根 |

启停会改写 `SKILL.md` 里的 `disable-model-invocation`。文件系统 provider 在监视各
根目录，所以模型目录会热刷新，不用重启——技能立刻从模型的视野里出现或消失。可选的
**同时禁止 /name 手动调用** 勾选框会一并写入 `user-invocable: false`，把技能从
`/name` 补全里也撤掉。

## 安装

```sh
dsh plugin --profile web add github:MyRemme/dsh-skill-manager
```

desktop profile 由 Electron 应用独占管理；请装进 `web` 或其他 profile，或者自己把这
一行加进 `cordis.patch.yml`：

```yaml
- id: skill-manager
  name: dsh-skill-manager
```

重启该 profile，侧边栏会出现 **技能管理**。

本插件**没有运行时依赖，也没有构建步骤**。`dsh plugin add` 只是 clone。

## 配置

全部可选，默认值就是原版 harness 的样子。

```yaml
- id: skill-manager
  name: dsh-skill-manager
  config:
    enabled: true                 # false 则完全不挂载路由
    access: paired                # loopback | paired | lan
    registryUrl: "https://raw.githubusercontent.com/MyRemme/dsh-skill-manager/main/registry/skills.json"
    registryTtlMs: 600000         # 拉到的目录缓存多久
    dshHome: "C:\\Users\\you\\.dsh"
    agentsHome: "C:\\Users\\you\\.agents"
    customSkillDirs: []           # 额外根目录，排在项目根与用户根之间
    maxUploadBytes: 16777216      # 16 MiB，单个 ZIP 或主机路径导入
    maxExtractBytes: 67108864     # 64 MiB，展开后的总量
    maxEntries: 4096              # 单次导入的文件数
    maxFileBytes: 8388608         # 单文件 8 MiB
    maxSkills: 64                 # 单次导入最多装几个技能
```

### `access`

每条路由都能在技能根下创建、改写、删除文件，所以这道围栏不是装饰。

- `paired`（默认）——loopback 调用方，加上完成过局域网配对握手的设备。没有配对 cookie
  的局域网客户端会拿到 `403`。
- `loopback` ——只有本机。
- `lan` ——任何同源调用方。如果你用 `dsh-lan-pair` 的免密模式、并且想从手机上面板操作，
  这就是你要的那档；它信任你整个局域网，这是一个决定，不是一个细节。

## 技能根

发现逻辑与 `@deepseek-ai/dsh-skill-filesystem` 完全一致：只扫一层，目录贡献
`<目录>/SKILL.md`，以 `.md` 结尾的文件贡献它自己。同名时更近的根胜出。

| 优先级 | 来源 | 路径 | 可写 |
| --- | --- | --- | --- |
| 100 | 项目 | `<projectRoot>/.dsh/skills` | 是 |
| 200 | 项目 | `<projectRoot>/.agents/skills` | 否 |
| 300+ | 自定义 | `customSkillDirs[n]` | 是 |
| 400 | 用户 | `<dshHome>/skills` | 是 |
| 500 | 用户 | `<agentsHome>/skills` | 否 |

`<projectRoot>` 是最近的带 `.git` 的祖先目录，没有则用当前会话的 cwd。只读根会照常
列出，文件本身可写时也能就地启停，但管理器拒绝在其中创建、编辑、删除。

## 导入

**ZIP** ——上传一个至少含一个 `SKILL.md` 的 `.zip`。每个持有 `SKILL.md` 的目录成为一个
技能，同级内容（`scripts/`、素材）一起装走。没有任何 `SKILL.md` 时，退化为接受一个带
`name` 与 `description` frontmatter 的扁平 `.md`。

**文件夹** ——在浏览器里选一个目录，文件被上传后走同一套规划。

**主机路径** ——填一个运行 harness 那台机器上的绝对路径。不上传任何东西，宿主直接读。

三者共同的行为：会剥掉唯一的一层顶层目录（GitHub tarball 的 `repo-main/` 包装），拒绝
绝对路径、盘符、`..` 与符号链接成员，覆盖既有技能时先移进回收站而不是删除。

## 删除与回收站

**删除**把目录型技能移到 `<dshHome>/skills/.trash/<时间戳>__<名字>`，文件型技能移到
`.trash/<时间戳>__<名字>.md`。回收站一节会列出内容，并支持恢复到你选定的目标根。
链接技能在删除路径上被拒绝——删一个链接会越出技能根。

## 市场

目录是一份 JSON，由「一个技能一个 YAML 文件」构建，所以两个投稿人永远不会撞到同一个
文件。

- 默认来源：本仓库的 [`registry/skills.json`](registry/skills.json)——写这份文档时有 12 条。
- 如果 `raw.githubusercontent.com` 不通（有些网络会重置与它的连接，而 `api.github.com`
  照常工作），拉取会自动回退到 GitHub contents 接口并解码同一个文件。给该路径设置
  `GITHUB_TOKEN` 可以解除未认证的限流。
- 安装一条会下载 `https://codeload.github.com/<仓库>/tar.gz/<ref>`，只解出持有该技能的
  目录，写进你选的根。
- `registryUrl` 可以指向任何同构的目录。
- 投稿方式是对 `registry/data/skills/` 提 PR。格式与要求见
  [`registry/README.md`](registry/README.md)。

**被收录不是安全审查。** 安装一个技能就是下载别人的文件，并把它们的正文放进你的模型
上下文。装之前自己看一眼。

## HTTP 路由

全部位于 `/api/dsh-skill-manager/` 下，且仅限同源。

| 路由 | 方法 | 用途 |
| --- | --- | --- |
| `list` | GET | 各根、可写目标、技能、回收站路径 |
| `read` | GET | 单个技能的描述、适用场景与正文 |
| `set-enabled` | POST | 启用或禁用单个技能 |
| `set-enabled-batch` | POST | 批量启用或禁用 |
| `write` | POST | 就地更新描述、适用场景与正文 |
| `create` | POST | 在指定根下创建新技能 |
| `remove` | POST | 把技能移进回收站 |
| `trash` | GET | 列出回收站条目 |
| `restore` | POST | 恢复一个回收站条目 |
| `import-zip` | POST | 从 ZIP 请求体安装 |
| `import-files` | POST | 从 base64 上传记录安装 |
| `import-path` | POST | 从主机目录安装 |
| `market` | GET | 目录，附带已装标记 |
| `market-install` | POST | 安装目录里的一条 |
| `health` | GET | 存活状态与解析出的访问档 |

写操作携带 `{ name, path }`；宿主会重新扫描各根，只有同名技能仍在同一路径时才动手。
客户端编造出来的路径永远不会被执行。

## 测试

```sh
node --test "test/**/*.test.mjs"
```

109 个测试，不联网、不需要 `npm install`。覆盖 frontmatter 改写器（含 CRLF 保持与 YAML
引号往返）、ZIP 与 TAR 读取器、压缩包路径安全、安装规划、根发现与同名遮蔽、回收站与
恢复、访问围栏、registry 解析与校验，以及浏览器半区——用一套最小渲染器驱动真实组件跑
真实载荷。

## 许可

MIT，见 [LICENSE](LICENSE)。
