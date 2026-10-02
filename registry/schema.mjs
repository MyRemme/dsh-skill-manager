/**
 * Schema constants shared by the registry builder and the plugin.
 *
 * The category list is closed on purpose: a free-text category turns into a
 * filter with 40 one-entry buckets. Adding a category is a one-line change here,
 * and a pull request that needs one has to say why in the description.
 */

/** Accepted `category` values, with the Chinese label the market renders. */
export const CATEGORIES = {
  ui: { zh: "界面与设计", en: "UI & design" },
  dev: { zh: "开发与构建", en: "Development" },
  docs: { zh: "写作与文档", en: "Writing & docs" },
  data: { zh: "数据与分析", en: "Data & analysis" },
  office: { zh: "办公文档", en: "Office documents" },
  design: { zh: "图形与视觉", en: "Graphics & visual" },
  media: { zh: "音频与视频", en: "Audio & video" },
  testing: { zh: "测试与质量", en: "Testing & QA" },
  security: { zh: "安全与审计", en: "Security" },
  infra: { zh: "运维与部署", en: "Infra & deploy" },
  research: { zh: "检索与研究", en: "Research" },
  writing: { zh: "内容与文案", en: "Content" },
  agent: { zh: "智能体与编排", en: "Agents & orchestration" },
  fun: { zh: "趣味", en: "Fun" },
};

/** Every accepted category key. */
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

/**
 * Licenses an entry is allowed to carry.
 *
 * The rule is not "has a license" but "has a license that permits
 * redistribution", because listing an entry republishes its coordinates and the
 * market installs its files. Anything absent here is rejected, including the
 * two cases that look like a pass but are not:
 *
 *   - no license at all — the default state of a repository with no LICENSE
 *     file is "all rights reserved", which is not permission.
 *   - `NOASSERTION` — GitHub's code for "a license file exists but it could not
 *     be identified". Unidentified is not the same as permissive.
 *
 * Deliberately excluded, and the reason matters if someone asks to add them:
 *   - `CC-BY-NC-*` / `CC-BY-ND-*` — non-commercial and no-derivatives are not
 *     redistribution rights.
 *   - `GPL-*` / `AGPL-*` — copyleft. Mirroring coordinates is arguably fine, but
 *     the safe reading is that a marketplace catalog should not become a
 *     redistribution channel for copyleft obligations we cannot track.
 *     Add them here if that analysis changes; do not add them silently.
 */
export const LICENSE_ALLOW = [
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Unlicense",
];

/**
 * Accepted spellings, normalised to the canonical key above.
 *
 * GitHub reports SPDX identifiers, but hand-written entries in this repository
 * will not, and a rejection caused by `mit` versus `MIT` teaches the submitter
 * nothing.
 */
const LICENSE_ALIASES = {
  apache: "Apache-2.0",
  "apache 2.0": "Apache-2.0",
  "apache-2": "Apache-2.0",
  "apache2": "Apache-2.0",
  bsd: "BSD-3-Clause",
  "bsd-2": "BSD-2-Clause",
  "bsd-3": "BSD-3-Clause",
  cc0: "CC0-1.0",
  "cc0-1.0": "CC0-1.0",
  "cc-by-4": "CC-BY-4.0",
  isc: "ISC",
  mit: "MIT",
  "mit-0": "MIT-0",
  "mpl-2": "MPL-2.0",
  unlicense: "Unlicense",
};

/**
 * Normalise a license string for comparison.
 *
 * @param value - raw license text from an entry or an API response.
 * @returns the canonical identifier, or an empty string when absent.
 */
export function normalizeLicense(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const canonical = LICENSE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
  // Match an allow-list entry case-insensitively so `apache-2.0` still works.
  const match = LICENSE_ALLOW.find((allowed) => allowed.toLowerCase() === canonical.toLowerCase());
  return match ?? canonical;
}

/**
 * Decide whether a license value may be listed.
 *
 * @param value - raw license text.
 * @returns true when the value names an allowed license.
 */
export function isAllowedLicense(value) {
  const normalized = normalizeLicense(value);
  return normalized !== "" && LICENSE_ALLOW.includes(normalized);
}

/** Where a submission pull request is opened. */
export const SUBMIT_URL = "https://github.com/MyRemme/dsh-skill-manager/issues/new";

/** The template a submission should follow. */
export const SUBMIT_TEMPLATE = [
  "### Skill",
  "name: ",
  "repo: ",
  "path: ",
  "category: ",
  "license: ",
  "description: ",
].join("\n");
