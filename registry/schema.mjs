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

/** Where a submission pull request is opened. */
export const SUBMIT_URL = "https://github.com/MyRemme/dsh-skill-manager/issues/new";

/** The template a submission should follow. */
export const SUBMIT_TEMPLATE = [
  "### Skill",
  "name: ",
  "repo: ",
  "path: ",
  "category: ",
  "description: ",
].join("\n");
