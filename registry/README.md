# Skill registry

[中文](README.zh.md)

`skills.json` is the catalog the plugin's **市场** (Market) tab downloads. It is
built from one YAML file per skill, so two people submitting at the same time
never touch the same file.

```
registry/
├── skills.json                     generated — do not edit by hand
├── data/skills/*.yml               one entry per skill
└── scripts/
    ├── build-registry.mjs          validate + build + verify
    └── discover.mjs                find candidates on GitHub and apply the license gate
```

## Submit a skill

Open a pull request that adds **one file**:
`registry/data/skills/<owner>__<repo>--<skill>.yml`

```yaml
repo: acme/widget-skills            # required — owner/name of the repository
name: widget-helper                 # required — must equal the SKILL.md frontmatter `name`
path: skills/widget-helper/SKILL.md # required — where the SKILL.md sits in that repo
category: writing                   # required — one key from the list below
ref: main                           # required — branch, tag or commit; there is no default
version: 2.15.0                     # optional — only if upstream publishes releases
commit: 063bee9                     # optional — the revision the entry was checked against
added: 2026-10-02                   # optional — YYYY-MM-DD the entry entered the catalog
tags: [writing, markdown]           # optional — at most 8, lowercase with hyphens
license: MIT                        # required — must be a license that permits redistribution
description:
  en: Reviews prose for the style guide. Use when asked to audit docs or tighten wording.
  zh: 按风格指南审阅文案。适用于「审一下文档」「把措辞收紧」这类请求。  # optional
```

`repo`, `name`, `path`, `category`, `ref`, `license` and `description.en` are
required. A missing Chinese line is our problem, not a reason to reject the entry.

## The admission gates

An entry makes a promise the market then has to keep: press install and the skill
lands on disk. Four gates check that promise before an entry ships.

### 1. The license gate

Listing an entry republishes a repository's coordinates and lets the market
install its files, so an entry carries a license or it does not ship. A missing
license is **not** permission — a repository with no `LICENSE` file is "all rights
reserved" by default — and `NOASSERTION` is **not** a permissive one, it is GitHub
saying the license file exists but could not be identified.

Allowed, and nothing else:

`0BSD` `Apache-2.0` `BSD-2-Clause` `BSD-3-Clause` `CC-BY-4.0` `CC0-1.0` `ISC`
`MIT` `MIT-0` `MPL-2.0` `Unlicense`

Spelling is normalised, so `mit` and `Apache 2.0` are accepted and rewritten to
`MIT` and `Apache-2.0`. Deliberately excluded: `CC-BY-NC-*` and `CC-BY-ND-*`
(non-commercial and no-derivatives are not redistribution rights), and `GPL-*` /
`AGPL-*` (copyleft obligations a catalog cannot track). Changing that list is a
one-line edit in `schema.mjs` — do it in the open, with the reasoning, not as a
quiet exception.

**The gate checks the repository, not the skill file.** A permissive license at a
repository root normally covers what is beneath it, but a skill directory that
carries its own `LICENSE` overrides that. Check before submitting; the build
cannot see it.

### 2. The download-size gate

The installer fetches the **whole repository tarball** and narrows it to one
skill directory only after the download completes (`lib/market.js`,
`fetchRepoTarball`). An archive above the 32 MiB cap therefore fails at the last
step, after transferring everything.

This was not hypothetical. Twelve of the first fifty-nine published entries could
not be installed by anyone — `K-Dense-AI/scientific-agent-skills` is 233 MB,
`NanmiCoder/cc-haha` 125 MB, `wasp-lang/open-saas` 91 MB. "Install" downloaded
tens to hundreds of megabytes and then reported an error, and the catalog build
never noticed, because admission checked quality without checking reachability.

So `inspect.mjs` measures the archive and refuses the whole repository when it
exceeds the cap. A repository over the limit is not admitted with a note; it is
not admitted at all. An entry that cannot be installed is worse than a missing
entry, because it looks like it works.

The limit lives in two files and a test holds them together
(`the admission cap matches the installer's download cap`). If you raise the
installer's `maxBytes`, raise `ARCHIVE_LIMIT_BYTES` in `inspect.mjs` in the same
change or the test fails.

### 3. The verification gate

Every entry has to be true:

- `path` must exist on `ref`, and the `name` in that file's frontmatter must equal
  the entry's `name`. CI reads the file and checks.
- `ref` is required and recorded. There is no default. Two repositories in the
  catalog use `master` and one uses `development`; a silent fallback to `main`
  pointed those entries at paths that do not exist, and only `--check --verify`,
  which probes upstream, caught it.
- A `SKILL.md` with no `name` in its frontmatter is not a skill and is refused.
  Documentation files named `*SKILL.md` and generated stubs were once admitted
  under a name upstream never claimed.
- One skill name may be declared only once across the catalog — the name is the
  install directory name.

### 4. The category gate

`category` must be one of the closed list given under "Finding candidates". An
entry whose category has not been settled goes to `other`; it is not guessed into
a bucket it does not belong to, because a misplaced entry corrupts the filter for
every real member of that bucket.

Run the build after editing entries:

```
node registry/scripts/build-registry.mjs          # rewrite skills.json
node registry/scripts/build-registry.mjs --check  # fail if it is stale
```

## Finding candidates

`discover.mjs` asks the GitHub search API for repositories matching a query,
reads the `license.spdx_id` GitHub already computed, and reports what passes the
gate. One request returns 100 repositories, so a run costs a handful of requests
rather than one per repository.

```
node registry/scripts/discover.mjs --query "claude skills" --pages 2 --min-stars 100
node registry/scripts/discover.mjs --query "agent skills" --json
```

It reads `GITHUB_TOKEN` (or `GH_TOKEN`) from the environment to raise the rate
limit, and works without one on the anonymous budget. The token is never printed
and never written anywhere. Requests are paced to the search endpoint's limit of
10 per minute — the script waits rather than retrying into a block.

**It writes nothing.** A candidate still has to be turned into an entry by hand,
because a repository-level license does not prove the skill file is covered.

`inspect.mjs` is the next step and applies the remaining gates. It reads a
repository's git tree, measures the archive, and verifies every skill file it would
publish:

```
node registry/scripts/inspect.mjs --in _candidates.json                  # report only
node registry/scripts/inspect.mjs --in _candidates.json --write          # create entries
node registry/scripts/inspect.mjs --in _candidates.json --top 30 --per-repo 3 --write
```

`--per-repo` (default 3) is a real ceiling, not a hint: one repository should not
be able to fill the catalog on its own. `--top` (default 30) caps how many
candidates are considered at all.

`category` is a closed list, because a free-text category produces a filter with
one bucket per entry — worse than no filter:

`ui` `dev` `docs` `data` `office` `design` `media` `testing` `security`
`infra` `research` `writing` `agent` `fun` `other`

`other` is a deliberate catch-all, for entries whose category is not yet settled.

The market renders `category` as a filter, `version` or `commit` as a provenance
badge, and `added` as the window for its time filter. Set `version` only when
the upstream repository actually publishes releases: a guessed version is worse
than an absent one, so record the revision you verified against in `commit`
instead.

The file name must match the entry: `owner__repo--skill.yml`. Repository owners
and names keep their original case; the skill part is the kebab-case skill name.

One entry per pull request. Reviewing an entry means reading the skill it points
at, and that work does not get cheaper in bulk. Fixes to existing entries,
category changes and removals are equally welcome.

### What the entry has to be true about

- `path` must point at a file that exists **at `ref`**, and that file's
  frontmatter `name` must equal `name`. CI checks both by reading the file.
- Installing copies the **whole directory** that holds the `SKILL.md`, so sibling
  scripts and assets come along. Keep that directory self-contained.
- The description is read as a claim about the skill. "Audits prose against the
  style guide" should be what it does.
- One skill name may only be claimed once in the whole catalog, because the name
  is the directory the skill is installed into.

### Do not edit `skills.json` by hand

Regenerate and commit it:

```sh
npm run registry:build
```

CI runs `--check`, which fails the pull request when the committed catalog and
the entry files disagree.

## Local commands

```sh
npm run registry:build     # validate every entry and rewrite skills.json
npm run registry:check     # fail when skills.json is stale (what CI runs)
node registry/scripts/build-registry.mjs --verify           # also read each skill upstream
node registry/scripts/build-registry.mjs --verify --strict  # rate limits become errors
node registry/scripts/build-registry.mjs --stars            # refresh star counts
```

`--verify` needs network. Upstream rate limiting is reported as a **warning** so a
pull request is never failed by something unrelated to it; `--strict` promotes
those warnings to errors. Set `GITHUB_TOKEN` to raise the unauthenticated limit
of 60 requests per hour.

## Catalog shape

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
      "version": "2.15.0",          // or "commit": "063bee9"
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

`version` is the catalog document's own schema version. Bumping it is what tells
an older plugin that the shape changed.

`id` is what the plugin sends back when installing. Entries are sorted by `name`
so the generated file only diffs where it actually changed.

## Pointing the plugin elsewhere

The plugin fetches this repository's `registry/skills.json` by default. A profile
can override it:

```yaml
- id: skill-manager
  name: dsh-skill-manager
  config:
    registryUrl: https://example.com/skills.json
```

## Not a security review

Listing a skill records where it lives — nothing more. Installing one downloads
that repository's tarball and writes it into your skill root, and the skill's
text then enters your model's context. Read what you install. Entries that stop
working are removed, but nobody audits the code behind them.
