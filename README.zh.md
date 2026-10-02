# dsh-skill-manager

DeepSeek Harness 的技能管理：批量与单项启用/禁用、文件夹与压缩包导入、自己写技能，
外加一个可以用 PR 投稿的技能市场——全部在一个 Web GUI 面板里。

[English](README.md) · [贡献指南](contributing.zh.md) · [目录格式](registry/README.zh.md)

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

- 默认来源：本仓库的 [`registry/skills.json`](registry/skills.json)。收录要过四道闸门：
  **有明确许可证且允许再分发**（没声明、`NOASSERTION`、非商业、copyleft 一律不收）；**仓库
  归档不超过安装器的 32 MiB 下载上限**；**条目属实**（路径存在、frontmatter 里的 `name`
  对得上）；**分类取自封闭列表**。详见
  [`registry/README.zh.md`](registry/README.zh.md) 的「收录闸门」。
- **筛选与排序**照插件市场的做法：按 Star 数／收录时间／名称排，可选升序降序，并可把
  列表限制在最近 7／30／90 天或一年内收录的条目。
- **每张卡片都能点出去**：跳到来源仓库，以及它实际安装的那个 `SKILL.md`。
- **来源是显示出来的，不是编的。** 上游发布了 release 的显示 `版本 v2.15.0`，没有的显示
  `提交 063bee9`。目录里没有 Star 数时，星数排序会明说这一点，而不是把列表按另一种顺序
  悄悄返回。
- **分类是封闭列表**（`ui`、`dev`、`docs`、`infra`、`writing`……，共 15 项），所以筛选出来是
  几个真实的桶，而不是「一个条目一个分类」。分类未定的条目归 `other`。
- 如果 `raw.githubusercontent.com` 不通（有些网络会重置与它的连接，而 `api.github.com`
  照常工作），拉取会自动回退到 GitHub contents 接口并解码同一个文件。给该路径设置
  `GITHUB_TOKEN` 可以解除未认证的限流。
- 安装一条会下载 `https://codeload.github.com/<仓库>/tar.gz/<ref>`，只解出持有该技能的
  目录，写进你选的根。**下载的是整个仓库**，所以归档超过 32 MiB 的仓库无法安装——这类
  仓库在收录时就被拒收，不会出现在列表里。
- `registryUrl` 可以指向任何同构的目录。

投稿方式是对 `registry/data/skills/` 提 PR。格式与要求见
[`registry/README.zh.md`](registry/README.zh.md)；市场页脚也有**申请收录**链接和可复制的
条目模板。

## 关于

**关于**页签说明装的是什么、项目在哪。

- **当前版本**：运行时读本包自己的 `package.json`，不是构建期写死的常量，所以它和磁盘上
  的东西永远一致。读不到清单时界面会直说，而不是印一个占位版本号。
- **检查更新**：拿它和默认分支上的版本比，给出四种结果之一——已是最新、有新版本可用、
  本地版本高于发布版本（说明是未发布的提交）、无法检查。**只有你按按钮时才会请求**：一个
  每打开一次就去打限流接口的面板是不合格的。
- **项目仓库**、**查看发布**，以及收录条目所在目录的可浏览链接。最后这个只在当前目录源就是
  本仓库时才给出——指向别处的 `registryUrl` 在本仓库里没有页面可链。
- **目录来源**：插件实际抓取的那个地址，以**文字**而非链接呈现。它是机器读的 JSON，做成链接
  在浏览器里是一屏乱码；写成文字，顺带也让自定义的 `registryUrl` 一眼可见。
- 可直接复制的 `dsh plugin --profile desktop add github:…` 命令。

更新检查是尽力而为的。断网、被限流、仓库搬家，都会让版本照常显示、并说明检查失败的原因；
它从不编造号码。给该路径设置 `GITHUB_TOKEN` 可以解除未认证的限流。

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
| `about` | GET | 版本号、仓库坐标，带 `?check=1` 时附更新比对结果 |
| `health` | GET | 存活状态与解析出的访问档 |

写操作携带 `{ name, path }`；宿主会重新扫描各根，只有同名技能仍在同一路径时才动手。
客户端编造出来的路径永远不会被执行。

## 测试

```sh
node --test "test/**/*.test.mjs"
```

131 个测试，不联网、不需要 `npm install`。

- **集成**把插件本体跑起来：用假的 cordis 上下文调 `apply()`，把它注册的路由挂在真实的
  `node:http` 服务器上，用真实 HTTP 请求打真实文件——列表、单项与批量启停、读写、创建、
  回收站与恢复、ZIP／上传／主机路径三种导入、市场（目录、tarball 安装、坏 registry）、
  各类状态码，以及访问围栏（含伪造的局域网 `Host`）。
- **单元**覆盖 frontmatter 改写器（CRLF 保持、YAML 引号往返）、ZIP 与 TAR 读取器、压缩包
  路径安全、安装规划、根发现与同名遮蔽、回收站与恢复、访问围栏、registry 解析与校验。
- **浏览器半区**用一套最小渲染器（实现了面板用到的那几个 hook）跑真实组件，断言 loader
  契约、slot 注册、真实载荷的渲染输出、请求体，以及字典、`API` 表与宿主 `ROUTES` 三者
  保持一致。

## 许可

MIT，见 [LICENSE](LICENSE)。
