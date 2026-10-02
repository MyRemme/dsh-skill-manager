# Skill registry

[中文](README.zh.md)

`skills.json` is the catalog the plugin's **市场** (Market) tab downloads. It is
built from one YAML file per skill, so two people submitting at the same time
never touch the same file.

```
registry/
├── skills.json                 generated — do not edit by hand
├── data/skills/*.yml           one entry per skill
└── scripts/build-registry.mjs  validate + build + verify
```

## Submit a skill

Open a pull request that adds **one file**:
`registry/data/skills/<owner>__<repo>--<skill>.yml`

```yaml
repo: acme/widget-skills            # required — owner/name of the repository
name: widget-helper                 # required — must equal the SKILL.md frontmatter `name`
path: skills/widget-helper/SKILL.md # required — where the SKILL.md sits in that repo
ref: main                           # optional — branch, tag or commit; defaults to main
category: docs                      # optional — one lowercase word such as ui, docs, dev, security
tags: [writing, markdown]           # optional — at most 8, lowercase with hyphens
license: MIT                        # optional — only if the upstream repository declares one
description:
  en: Reviews prose for the style guide. Use when asked to audit docs or tighten wording.
  zh: 按风格指南审阅文案。适用于「审一下文档」「把措辞收紧」这类请求。  # optional
```

`description.en` is required and everything else is optional. A missing Chinese
line is our problem, not a reason to reject the entry.

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
  "version": 1,
  "generatedAt": "2026-10-05T09:00:00.000Z",
  "skills": [
    {
      "id": "acme/widget-skills#skills/widget-helper/SKILL.md",
      "name": "widget-helper",
      "repo": "acme/widget-skills",
      "path": "skills/widget-helper/SKILL.md",
      "ref": "main",
      "category": "docs",
      "tags": ["writing"],
      "license": "MIT",
      "author": "acme",
      "stars": 128,
      "description": { "en": "…", "zh": "…" }
    }
  ]
}
```

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
