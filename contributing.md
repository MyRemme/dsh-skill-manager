# Contributing

[中文](contributing.zh.md)

Two things can be contributed: a **skill** for the market, and **code** for the
plugin.

## Submitting a skill

Add one file under `registry/data/skills/` and open a pull request. The full
format, the requirements and what CI checks are in
[`registry/README.md`](registry/README.md).

The short version: `repo`, `name`, `path` and `description.en` are required;
`name` must equal the `name` in the upstream `SKILL.md`; run
`npm run registry:build` and commit the regenerated `registry/skills.json`.

One entry per pull request. A pull request that rewrites other people's entries
will be sent back.

## Contributing code

Install it into a scratch profile rather than the one you use daily:

```sh
dsh plugin --profile web add github:MyRemme/dsh-skill-manager
```

To work from a checkout, point the profile at the directory:

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-skill-manager
```

### Ground rules

- **No dependencies at runtime.** The host half imports Node builtins only; the
  browser half imports nothing but `react`, which the loader already provides.
  A pull request that adds a runtime dependency needs to argue why.
- **No build step.** `lib/index.js` and `lib/client.js` are the shipped files.
  The client is hand-written in the module-loader format; do not introduce a
  bundler.
- **The two halves must agree.** Every path in `lib/client.js`'s `API` map has to
  exist in `lib/index.js`'s `ROUTES`. A test asserts it; keep it green.
- **Both languages, same keys.** The `zh` and `en` dictionaries must have
  identical key sets, and every `t("…")` must exist in both. Tests cover it.
- **Documentation stays in one language per file.** `README.md` and every
  `README.md` under a subdirectory are English; the `.zh.md` sibling is the
  Chinese translation. Do not interleave the two paragraph by paragraph — that
  is the hardest format to read and the easiest to let drift.

### Before you push

```sh
node --test "test/**/*.test.mjs"
node registry/scripts/build-registry.mjs --check
```

Both run in CI. The test suite needs no network and no `npm install`.

Tests must be platform-neutral. Assume Linux in CI: a hard-coded `C:\…` literal
is one filename there, not a path, so build paths with `node:path` instead of
writing them out.

### Things worth knowing about the code

- **Skill writes are path-checked twice.** The client sends `{ name, path }`, and
  the host re-scans the roots and refuses the write unless a skill with that
  exact name is still at that exact path. Nothing is written based on a path the
  client made up.
- **Installs are planned before anything touches disk.** `planSkills()` reduces an
  archive to a plan; `installSkills()` writes it. A rejected archive leaves the
  roots untouched.
- **Archives never extract directly.** ZIP and TAR readers return in-memory file
  lists with POSIX relative paths; absolute paths, drive letters, `..` and
  symlink members are rejected or dropped.
- **Overwrites go through the trash.** `overwrite: "trash"` renames the existing
  directory aside instead of deleting it, so a mistaken install is recoverable.
- **Only two frontmatter keys are ever written:** `disable-model-invocation` and
  `user-invocable`. Every other byte of a `SKILL.md` survives an edit, including
  keys this plugin does not know about.

## Reporting a bad entry

Open an issue naming the entry file and what is wrong with it — the skill moved,
the repository is gone, the description overstates what it does. Entries that
stop being true are removed.
