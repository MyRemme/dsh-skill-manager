# dsh-skill-manager

Skill management for DeepSeek Harness: batch and per-skill enable/disable,
folder and archive import, authoring, and a PR-fed skill market you can browse
and install from — all in one Web GUI panel.

[中文](README.zh.md) · [Contributing](contributing.md) · [Registry format](registry/README.md)

> Interface labels are quoted in their original Chinese — the shipped UI is in
> Chinese, so `已安装` is the actual tab text, not a translation of it.

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
  [`registry/skills.json`](registry/skills.json) — 3 entries at the time of
  writing. The catalog only accepts entries carrying a license that permits
  redistribution, so entries with no declared license, `NOASSERTION`, a
  non-commercial term or a copyleft term are turned away; see
  [`registry/README.md`](registry/README.md).
- **Filter and sort** the way the plugin market does: sort by stars, date added
  or name, in either direction, and restrict the list to entries added in the
  last 7 / 30 / 90 days or year.
- **Every card links out** to the source repository, and to the exact `SKILL.md`
  it installs from.
- **Provenance is shown, not invented.** A card carries `版本 v2.15.0` when the
  upstream repository publishes releases, and `提交 063bee9` when it does not.
  When the catalog has no star counts, the stars sort says so rather than
  silently returning the list in a different order.
- **Categories are a closed list** (`ui`, `dev`, `docs`, `infra`, `writing`, …),
  so the filter has a handful of real buckets instead of one per entry.
- If `raw.githubusercontent.com` is unreachable (some networks reset connections
  to it while `api.github.com` keeps working), the fetch falls back to the GitHub
  contents API and decodes the same file. Set `GITHUB_TOKEN` to lift the
  unauthenticated rate limit on that route.
- Installing an entry downloads `https://codeload.github.com/<repo>/tar.gz/<ref>`,
  extracts only the directory holding the skill, and writes it into your chosen
  root.
- `registryUrl` points it at any other catalog with the same shape.

Submissions go through a pull request against `registry/data/skills/`. The format
and the requirements are in [`registry/README.md`](registry/README.md); the
market footer also carries a **申请收录** link and a copyable entry template.

## About

The **关于** tab reports what is installed and where the project lives.

- **Installed version**, read from this package's own `package.json` at runtime
  rather than baked in at build time, so it always matches what is on disk. When
  the manifest cannot be read the panel says so instead of printing a placeholder.
- **Check for updates** compares that against the version on the default branch
  and reports one of four outcomes: up to date, a newer version available, ahead
  of the published version (an unreleased commit), or could not check. It runs
  only when you press the button — a panel that calls a rate-limited API every
  time it is opened is a bad citizen.
- **Project repository**, **releases**, and a link to the browsable directory of
  entry files. The last one is offered only when the active catalog is this
  repository's own, because a foreign `registryUrl` has no page here to link to.
- The URL the catalog is actually fetched from, shown as text rather than as a
  link: it is machine-readable JSON, and a link to it would be unreadable in a
  browser. Shown this way, a custom `registryUrl` is also visible at a glance.
- The `dsh plugin --profile desktop add github:…` command, ready to copy.

The check is best-effort. Being offline, rate limited, or pointed at a moved
repository leaves the version visible and the reason stated; it never invents a
number. Set `GITHUB_TOKEN` to lift the unauthenticated API limit on the check.

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
| `about` | GET | Version, repository coordinates, and (with `?check=1`) the update comparison |
| `health` | GET | Liveness and the resolved access mode |

Writes carry `{ name, path }`; the host re-scans the roots and refuses the write
unless a skill with that exact name is still at that exact path. A path the client
invented is never acted on.

## Tests

```sh
node --test "test/**/*.test.mjs"
```

131 tests, no network and no `npm install`.

- **Integration** boots the plugin itself: `apply()` is called with a fake cordis
  context, the routes it registers are served over a real `node:http` server, and
  they are driven with real HTTP requests against real files — list, single and
  batch toggles, read/write, create, trash and restore, ZIP / upload / host-path
  import, the market (catalog, tarball install, bad registry), every status code,
  and the access fence including a spoofed LAN `Host`.
- **Unit** covers the frontmatter rewriter (CRLF preservation, YAML quoting
  round-trips), the ZIP and TAR readers, archive path safety, install planning,
  root discovery and shadowing, trash and restore, the access fence, and the
  registry parser and validator.
- **Browser** runs the client bundle against a minimal renderer that implements
  the hooks the panel uses, and asserts the loader contract, the slot
  registrations, real render output for a payload, request bodies, and that the
  dictionaries, the `API` map and the host's `ROUTES` stay in step.

## License

MIT. See [LICENSE](LICENSE).
