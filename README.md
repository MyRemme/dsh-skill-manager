# dsh-skill-manager

Skill management for DeepSeek Harness: batch and per-skill enable/disable,
folder and archive import, authoring, and a PR-fed skill market you can browse
and install from — all in one Web GUI panel.

[中文说明](README.zh.md) · [Contributing](contributing.md) · [Registry format](registry/README.md)

## What it does

| Surface | What you get |
| --- | --- |
| **已安装** | Every skill the harness can see, grouped by source root, with a search box, a source filter, per-row switches, checkbox multi-select, **全选 / 批量启用 / 批量禁用**, per-group enable/disable, inline editing, and reversible removal |
| **市场** | A catalog fetched from this repository's `registry/skills.json`: search, filter by category, see what is already installed, and install with one click |
| **导入** | Install from a `.zip` upload, from a folder picker, or from an absolute path on the host |
| **新建** | Write a new skill (name, description, whenToUse, body) into the user or project skill root |

Toggling a skill rewrites `disable-model-invocation` in its `SKILL.md`. The
filesystem provider watches its roots, so the model catalog refreshes without a
restart — the skill appears or disappears from the model's view immediately.
An optional **同时禁止 /name 手动调用** checkbox also writes
`user-invocable: false`, which withdraws the skill from `/name` completion too.

## Install

```sh
dsh plugin --profile web add github:MyRemme/dsh-skill-manager
```

The desktop profile is owned by the Electron app; install into `web` or another
profile, or add the row to `cordis.patch.yml` yourself:

```yaml
- id: skill-manager
  name: dsh-skill-manager
```

Restart the profile, then open **技能管理** in the sidebar.

The plugin has **no runtime dependencies and no build step**. `dsh plugin add`
only clones it.

## Configuration

Everything is optional. The defaults match a stock harness.

```yaml
- id: skill-manager
  name: dsh-skill-manager
  config:
    enabled: true                 # false mounts no routes at all
    access: paired                # loopback | paired | lan
    registryUrl: "https://raw.githubusercontent.com/MyRemme/dsh-skill-manager/main/registry/skills.json"
    registryTtlMs: 600000         # how long a fetched catalog is reused
    dshHome: "C:\\Users\\you\\.dsh"
    agentsHome: "C:\\Users\\you\\.agents"
    customSkillDirs: []           # extra roots, scanned between project and user
    maxUploadBytes: 16777216      # 16 MiB — one ZIP or host-path import
    maxExtractBytes: 67108864     # 64 MiB — total expanded size
    maxEntries: 4096              # files per import
    maxFileBytes: 8388608         # 8 MiB per file
    maxSkills: 64                 # skills one import may define
```

### `access`

Every route can create, rewrite and delete files under a skill root, so the fence
matters.

- `paired` (default) — loopback callers, plus devices that completed the LAN
  pairing handshake. A LAN client without a pairing cookie gets `403`.
- `loopback` — only the machine itself.
- `lan` — any same-origin caller. This is what you want if you run
  `dsh-lan-pair` in key-free mode and use the panel from a phone; it trusts your
  whole LAN, which is a decision, not a detail.

## Skill roots

Discovery mirrors `@deepseek-ai/dsh-skill-filesystem` exactly: one level deep, a
directory contributes `<dir>/SKILL.md`, a file ending in `.md` contributes
itself. Nearer roots win name collisions.

| Rank | Source | Path | Writable |
| --- | --- | --- | --- |
| 100 | project | `<projectRoot>/.dsh/skills` | yes |
| 200 | project | `<projectRoot>/.agents/skills` | no |
| 300+ | custom | `customSkillDirs[n]` | yes |
| 400 | user | `<dshHome>/skills` | yes |
| 500 | user | `<agentsHome>/skills` | no |

`<projectRoot>` is the nearest ancestor with `.git`, or the active session's cwd.
Read-only roots are listed and togglable in place where the file itself is
writable, but the manager refuses to create, edit or delete there.

## Import

**ZIP** — upload a `.zip` containing at least one `SKILL.md`. Every directory
holding a `SKILL.md` becomes one skill, and its siblings (`scripts/`, assets)
come along. An archive with no `SKILL.md` falls back to a flat `.md` carrying
`name` and `description` frontmatter.

**Folder** — pick a directory in the browser; the files are uploaded and planned
the same way.

**Host path** — type an absolute path to a directory on the machine running the
harness. Nothing is uploaded; the host reads it directly.

Either way: a single shared top-level directory (the `repo-main/` wrapper
GitHub tarballs use) is stripped, `absolute` paths, drive letters, `..` and
symlink members are rejected, and overwriting an existing skill moves it to the
trash first rather than deleting it.

## Removal and the trash

**删除** moves a directory-form skill into `<dshHome>/skills/.trash/<timestamp>__<name>`
and a file-form skill to `.trash/<timestamp>__<name>.md`. The 回收站 section lists
what is there and restores any entry into the target root you pick. Linked skills
are refused on the delete path — removing a link would reach outside the skill
root.

## Market

The catalog is a JSON document built from one YAML file per skill, so two
contributors never touch the same file.

- Default source: this repository's
  [`registry/skills.json`](registry/skills.json) — 12 entries at the time of writing.
- If `raw.githubusercontent.com` is unreachable (some networks reset connections
  to it while `api.github.com` keeps working), the fetch falls back to the GitHub
  contents API and decodes the same file. Set `GITHUB_TOKEN` to lift the
  unauthenticated rate limit on that route.
- Installing an entry downloads `https://codeload.github.com/<repo>/tar.gz/<ref>`,
  extracts only the directory holding the skill, and writes it into your chosen
  root.
- `registryUrl` points it at any other catalog with the same shape.
- Submissions go through a pull request against `registry/data/skills/`. The
  format and the requirements are in [`registry/README.md`](registry/README.md).

**Being listed is not a security review.** Installing a skill downloads someone
else's files and puts their text into your model's context. Read what you install.

## HTTP routes

All routes live under `/api/dsh-skill-manager/` and are same-origin only.

| Route | Method | Purpose |
| --- | --- | --- |
| `list` | GET | Roots, targets, skills, trash root |
| `read` | GET | One skill's description, whenToUse and body |
| `set-enabled` | POST | Enable or disable one skill |
| `set-enabled-batch` | POST | Enable or disable a list of skills |
| `write` | POST | Update description, whenToUse and body in place |
| `create` | POST | Create a new skill under a target root |
| `remove` | POST | Move a skill to the trash |
| `trash` | GET | List trash entries |
| `restore` | POST | Restore one trash entry |
| `import-zip` | POST | Install from a ZIP body |
| `import-files` | POST | Install from base64 upload records |
| `import-path` | POST | Install from a host directory |
| `market` | GET | The catalog, annotated with what is installed |
| `market-install` | POST | Install one catalog entry |
| `health` | GET | Liveness and the resolved access mode |

Writes carry `{ name, path }`; the host re-scans the roots and refuses the write
unless a skill with that exact name is still at that exact path. A path the client
invented is never acted on.

## Tests

```sh
node --test "test/**/*.test.mjs"
```

109 tests, no network and no `npm install`. They cover the frontmatter rewriter
(including CRLF preservation and YAML quoting round-trips), the ZIP and TAR
readers, archive path safety, install planning, root discovery and shadowing,
trash and restore, the access fence, the registry parser and validator, and the
browser half — driven through a minimal renderer that exercises the real
components against real payloads.

## License

MIT. See [LICENSE](LICENSE).
