/**
 * dsh-skill-manager — browser half.
 *
 * Hand-written in the harness' module-loader format: the shell evaluates this
 * file and calls `factory` with a CommonJS-style `require` that resolves
 * `react` from the host runtime. There is no build step.
 *
 * Four surfaces share one panel: 已安装 (installed), 市场 (market), 导入
 * (import) and 新建 (create). The host routes are reached over same-origin
 * fetch through document-relative paths, because the GUI is served with
 * `<base href="./">` and a root-absolute path would escape a sub-path deploy.
 */
window.__ModuleLoader__.load({
  id: "dsh-skill-manager",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useState } = React;

    const PANEL_ID = "skill-manager";
    const PANEL_ORDER = 31;
    const NS = "dsh-skill-manager";

    const API = {
      list: "api/dsh-skill-manager/list",
      read: "api/dsh-skill-manager/read",
      setEnabled: "api/dsh-skill-manager/set-enabled",
      setEnabledBatch: "api/dsh-skill-manager/set-enabled-batch",
      write: "api/dsh-skill-manager/write",
      create: "api/dsh-skill-manager/create",
      remove: "api/dsh-skill-manager/remove",
      trash: "api/dsh-skill-manager/trash",
      restore: "api/dsh-skill-manager/restore",
      importZip: "api/dsh-skill-manager/import-zip",
      importFiles: "api/dsh-skill-manager/import-files",
      importPath: "api/dsh-skill-manager/import-path",
      market: "api/dsh-skill-manager/market",
      marketInstall: "api/dsh-skill-manager/market-install",
      about: "api/dsh-skill-manager/about",
    };

    /** One failed request, carrying the host's message verbatim. */
    class ApiError extends Error {}

    async function request(path, options = {}) {
      const url = options.query === undefined ? path : `${path}?${new URLSearchParams(options.query).toString()}`;
      const init = { method: options.method ?? "GET", headers: {} };
      if (options.raw !== undefined) {
        init.body = options.raw;
        init.headers["content-type"] = options.contentType ?? "application/octet-stream";
      } else if (options.body !== undefined) {
        init.body = JSON.stringify(options.body);
        init.headers["content-type"] = "application/json; charset=utf-8";
      }
      const response = await fetch(url, init);
      const text = await response.text();
      let payload;
      try {
        payload = text === "" ? {} : JSON.parse(text);
      } catch {
        payload = { error: text.slice(0, 400) };
      }
      if (!response.ok) throw new ApiError(payload.error ?? `HTTP ${response.status}`);
      return payload;
    }

    // ---------------------------------------------------------------- locale

    const zh = {
      "entry.label": "技能管理",
      "panel.title": "技能管理",
      "panel.back": "返回会话",
      "panel.refresh": "刷新",
      "tab.installed": "已安装",
      "tab.market": "市场",
      "tab.import": "导入",
      "tab.create": "新建",
      "search.skills": "按名称或描述过滤…",
      "search.market": "搜索技能、仓库或标签…",
      "filter.root": "来源",
      "filter.workspace": "工作区",
      "filter.category": "分类",
      "filter.all": "全部",
      "action.selectAll": "全选",
      "action.selectNone": "清空选择",
      "action.enable": "启用",
      "action.disable": "禁用",
      "action.batchEnable": "批量启用",
      "action.batchDisable": "批量禁用",
      "option.both": "同时禁止 /name 手动调用",
      "action.groupEnable": "本组全启用",
      "action.groupDisable": "本组全禁用",
      "action.save": "保存",
      "action.cancel": "取消",
      "action.edit": "编辑",
      "action.delete": "删除",
      "action.restore": "恢复",
      "action.install": "安装",
      "action.installed": "已安装",
      "action.upload": "上传 ZIP",
      "action.pickFolder": "选择文件夹",
      "action.importPath": "从主机路径导入",
      "action.create": "创建技能",
      "action.pickZip": "选择 .zip 文件",
      "label.model": "模型",
      "label.user": "手动",
      "label.readOnly": "只读",
      "label.shadowed": "被覆盖",
      "label.symlink": "链接",
      "label.on": "可调用",
      "label.off": "已禁用",
      "summary.total": "共 {n} 个技能",
      "summary.selected": "已选 {n} 个",
      "summary.empty": "这个来源下还没有技能。",
      "summary.noMatch": "没有匹配的技能。",
      "summary.marketEmpty": "注册表里没有条目。",
      "filter.menu": "筛选",
      "filter.sort": "排序字段",
      "filter.dir": "排序方向",
      "filter.time": "发布时间范围",
      "sort.stars": "Star 数",
      "sort.added": "收录时间",
      "sort.name": "名称",
      "sortDesc": "降序",
      "sortAsc": "升序",
      "sortNewest": "最新在前",
      "sortOldest": "最旧在前",
      "time.all": "全部时间",
      "time.7d": "最近 7 天",
      "time.30d": "最近 30 天",
      "time.90d": "最近 90 天",
      "time.1y": "最近 1 年",
      "sortUnsorted": "目录未提供 Star 数，按该字段排序时保持原有顺序。",
      "accept.title": "申请收录 skill",
      "accept.hint": "把你自己的 skill 提交到目录。提一个 PR，只加一个文件。",
      "accept.open": "申请收录",
      "accept.toggle": "申请收录 skill",
      "accept.close": "收起",
      "about.tab": "关于",
      "about.version": "当前版本",
      "about.check": "检查更新",
      "about.checking": "正在检查…",
      "about.upToDate": "已是最新版本。",
      "about.behind": "有新版本 {version} 可用。",
      "about.ahead": "本地版本高于发布版本（{version}），可能来自未发布的提交。",
      "about.unknown": "无法检查更新：{error}",
      "about.unavailable": "读不到版本号。",
      "about.repo": "项目仓库",
      "about.releases": "查看发布",
      "about.registry": "技能目录",
      "about.access": "访问范围",
      "about.updateHint": "本插件以 git 依赖安装，更新命令：",
      "about.copy": "复制更新命令",
      "about.copied": "更新命令已复制。",
      "accept.template": "复制条目模板",
      "accept.copied": "模板已复制到剪贴板。",
      "copy.failed": "复制失败，请手动选取。",
      "card.repo": "打开仓库",
      "card.version": "版本",
      "card.commit": "提交",
      "card.added": "收录于",
      "card.license": "许可",
      "card.licenseNone": "上游未声明",
      "card.category": "分类",
      "cat.all": "全部分类",
      "trash.title": "回收站",
      "trash.empty": "回收站是空的。",
      "trash.restoreTo": "恢复到",
      "import.target": "安装到",
      "import.overwrite": "同名技能",
      "import.skip": "跳过",
      "import.replace": "移入回收站后覆盖",
      "import.zipHint": "上传一个包含 SKILL.md 的 .zip 包。",
      "import.folderHint": "选择含 SKILL.md 的文件夹，或该文件夹的父目录。",
      "import.pathHint": "主机上的绝对路径，指向文件夹。",
      "create.name": "技能名",
      "create.description": "描述",
      "create.whenToUse": "适用场景（可选）",
      "create.content": "正文（Markdown）",
      "create.userInvocable": "允许 /name 手动调用",
      "create.modelInvocable": "允许模型自动调用",
      "create.hint": "技能名必须是小写字母、数字与单个连字符。",
      "empty.pending": "加载中…",
      "empty.error": "出错了",
      "done.changed": "{n} 个技能已{verb}。",
      "verb.enabled": "启用",
      "verb.disabled": "禁用",
      "done.installed": "已安装：{list}",
      "done.restored": "已恢复到 {path}",
      "done.created": "已创建 {path}",
      "done.saved": "已保存 {name}",
      "done.deleted": "已移入回收站：{name}",
      "confirm.delete": "把 {name} 移入回收站？可以再恢复。",
      "edit.title": "编辑 {name}",
      "edit.description": "描述",
      "edit.whenToUse": "适用场景",
      "edit.content": "正文",
      "edit.note": "只改描述、适用场景与正文；技能名、位置和启用状态保持不变。",
      "entry.element": "条",
    };

    const en = {
      "entry.label": "Skill manager",
      "panel.title": "Skill manager",
      "panel.back": "Back to chat",
      "panel.refresh": "Refresh",
      "tab.installed": "Installed",
      "tab.market": "Market",
      "tab.import": "Import",
      "tab.create": "New",
      "search.skills": "Filter by name or description…",
      "search.market": "Search skills, repos or tags…",
      "filter.root": "Source",
      "filter.workspace": "Workspace",
      "filter.category": "Category",
      "filter.all": "All",
      "action.selectAll": "Select all",
      "action.selectNone": "Clear selection",
      "action.enable": "Enable",
      "action.disable": "Disable",
      "action.batchEnable": "Enable selected",
      "action.batchDisable": "Disable selected",
      "option.both": "Also block manual /name invocation",
      "action.groupEnable": "Enable group",
      "action.groupDisable": "Disable group",
      "action.save": "Save",
      "action.cancel": "Cancel",
      "action.edit": "Edit",
      "action.delete": "Delete",
      "action.restore": "Restore",
      "action.install": "Install",
      "action.installed": "Installed",
      "action.upload": "Upload ZIP",
      "action.pickFolder": "Choose folder",
      "action.importPath": "Import from host path",
      "action.create": "Create skill",
      "action.pickZip": "Choose a .zip file",
      "label.model": "Model",
      "label.user": "Manual",
      "label.readOnly": "Read-only",
      "label.shadowed": "Shadowed",
      "label.symlink": "Linked",
      "label.on": "Invocable",
      "label.off": "Disabled",
      "summary.total": "{n} skills",
      "summary.selected": "{n} selected",
      "summary.empty": "No skills in this source yet.",
      "summary.noMatch": "Nothing matches that filter.",
      "summary.marketEmpty": "The registry has no entries.",
      "filter.menu": "Filter",
      "filter.sort": "Sort by",
      "filter.dir": "Direction",
      "filter.time": "Added within",
      "sort.stars": "Stars",
      "sort.added": "Date added",
      "sort.name": "Name",
      "sortDesc": "Descending",
      "sortAsc": "Ascending",
      "sortNewest": "Newest first",
      "sortOldest": "Oldest first",
      "time.all": "Any time",
      "time.7d": "Last 7 days",
      "time.30d": "Last 30 days",
      "time.90d": "Last 90 days",
      "time.1y": "Last year",
      "sortUnsorted": "The catalog carries no star counts, so this field keeps the existing order.",
      "accept.title": "Submit a skill",
      "accept.hint": "Get your own skill into the catalog. One pull request, one file.",
      "accept.open": "Submit a skill",
      "accept.toggle": "Submit a skill",
      "accept.close": "Close",
      "about.tab": "About",
      "about.version": "Installed version",
      "about.check": "Check for updates",
      "about.checking": "Checking…",
      "about.upToDate": "Up to date.",
      "about.behind": "Version {version} is available.",
      "about.ahead": "This copy is ahead of the published version ({version}) — probably an unreleased commit.",
      "about.unknown": "Could not check for updates: {error}",
      "about.unavailable": "The version could not be read.",
      "about.repo": "Repository",
      "about.releases": "Releases",
      "about.registry": "Registry",
      "about.access": "Access",
      "about.updateHint": "This plugin installs as a git dependency. To update:",
      "about.copy": "Copy the update command",
      "about.copied": "Update command copied.",
      "accept.template": "Copy the entry template",
      "accept.copied": "Template copied to the clipboard.",
      "copy.failed": "Copy failed — select the text manually.",
      "card.repo": "Open repository",
      "card.version": "Version",
      "card.commit": "Commit",
      "card.added": "Added",
      "card.license": "License",
      "card.licenseNone": "not declared upstream",
      "card.category": "Category",
      "cat.all": "All categories",
      "trash.title": "Trash",
      "trash.empty": "The trash is empty.",
      "trash.restoreTo": "Restore to",
      "import.target": "Install into",
      "import.overwrite": "Existing skill",
      "import.skip": "Skip",
      "import.replace": "Move to trash, then overwrite",
      "import.zipHint": "Upload a .zip that contains a SKILL.md.",
      "import.folderHint": "Choose a folder holding SKILL.md, or its parent.",
      "import.pathHint": "An absolute path on the host, pointing at a folder.",
      "create.name": "Skill name",
      "create.description": "Description",
      "create.whenToUse": "When to use (optional)",
      "create.content": "Body (Markdown)",
      "create.userInvocable": "Allow manual /name invocation",
      "create.modelInvocable": "Allow model invocation",
      "create.hint": "Names use lowercase letters, digits and single hyphens.",
      "empty.pending": "Loading…",
      "empty.error": "Something went wrong",
      "done.changed": "{n} skills {verb}.",
      "verb.enabled": "enabled",
      "verb.disabled": "disabled",
      "done.installed": "Installed: {list}",
      "done.restored": "Restored to {path}",
      "done.created": "Created {path}",
      "done.saved": "Saved {name}",
      "done.deleted": "Moved to trash: {name}",
      "confirm.delete": "Move {name} to the trash? It can be restored.",
      "edit.title": "Edit {name}",
      "edit.description": "Description",
      "edit.whenToUse": "When to use",
      "edit.content": "Body",
      "edit.note": "Only the description, whenToUse and body change; name, location and invocation state stay as they are.",
      "entry.element": "entry",
    };

    function interpolate(template, values) {
      return String(template).replace(/\{(\w+)\}/gu, (_, key) => (key in values ? String(values[key]) : `{${key}}`));
    }

    let translate = (key, values) => (key in zh ? (values === undefined ? zh[key] : interpolate(zh[key], values)) : key);
    /** Active language id; components read it to pick a description variant. */
    let activeLang = "zh";
    /** Components wanting a re-render on a language switch subscribe here. */
    const langSubscribers = new Set();

    function setTranslator(active) {
      const next = active === "en" ? "en" : "zh";
      translate = (key, values) => {
        const dict = next === "en" ? en : zh;
        const template = key in dict ? dict[key] : key;
        return values === undefined ? template : interpolate(template, values);
      };
      const changed = next !== activeLang;
      activeLang = next;
      if (!changed) return;
      for (const notify of langSubscribers) {
        try {
          notify(next);
        } catch {
          /* a broken subscriber must not stop the others */
        }
      }
    }

    /**
     * Re-render this component when the locale changes.
     * @returns the active language id.
     */
    function useLang() {
      const [value, setValue] = useState(activeLang);
      useEffect(() => {
        langSubscribers.add(setValue);
        return () => {
          langSubscribers.delete(setValue);
        };
      }, []);
      return value;
    }

    const t = (key, values) => translate(key, values);

    // ----------------------------------------------------------------- styles

    const STYLE_ID = "dsh-skill-manager-style";
    const CSS = `
.skm-panel{height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;padding:calc(var(--dsh-frame-top-clearance, 0px) + 12px) 16px 16px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:var(--dsw-font-family);box-sizing:border-box}
.skm-header{flex:none;display:flex;align-items:center;gap:10px}
.skm-title{flex:1;margin:0;font-size:16px;font-weight:700;white-space:nowrap}
.skm-tabs{flex:none;display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.skm-tab{background:0 0;border:none;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;padding:7px 14px;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.skm-tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.skm-tab[data-active]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary);font-weight:600}
.skm-body{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
.skm-toolbar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.skm-search{flex:0 260px;min-width:120px}
.skm-input,.skm-search{width:auto;padding:7px 12px;font-size:13px;font-family:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid transparent;border-radius:999px;outline:none;box-sizing:border-box;transition:border-color .12s,background .12s}
.skm-input:hover,.skm-search:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.skm-input:focus,.skm-search:focus,.skm-textarea:focus{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-base)}
.skm-input::placeholder,.skm-search::placeholder{color:var(--dsw-alias-label-tertiary)}

.skm-textarea{width:100%;min-height:110px;padding:10px 12px;font-size:13px;line-height:1.55;font-family:var(--dsw-mono-font-family,ui-monospace,Menlo,Consolas,monospace);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid transparent;border-radius:12px;outline:none;resize:vertical;box-sizing:border-box;transition:border-color .12s,background .12s}
.skm-textarea::placeholder{color:var(--dsw-alias-label-tertiary)}
.skm-button{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;font-size:13px;font-family:inherit;line-height:1.35;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid transparent;border-radius:999px;cursor:pointer;transition:background .12s,color .12s,border-color .12s}
.skm-button:hover:not(:disabled){background:var(--dsw-alias-border-l1)}
.skm-button:disabled{opacity:.4;cursor:not-allowed}
.skm-button[data-active]{background:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-border-l2)}
.skm-button[data-primary]{color:#fff;background:var(--dsw-alias-state-business-primary)}
.skm-button[data-primary]:hover:not(:disabled){filter:brightness(1.08)}
.skm-button[data-danger]{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary))}
.skm-button[data-tiny]{padding:4px 10px;font-size:12px}
a.skm-button{text-decoration:none}
.skm-caret{font-size:10px;opacity:.6}
.skm-spacer{flex:1}
.skm-count{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.skm-group{display:flex;flex-direction:column;gap:6px}
.skm-groupHead{display:flex;align-items:center;gap:8px;padding:4px 2px;font-size:12px;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1)}
.skm-groupPath{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;flex:1}
.skm-row{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid transparent;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover);transition:border-color .12s}
.skm-row:hover{border-color:var(--dsw-alias-border-l2)}
.skm-rowMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.skm-nameRow{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.skm-name{font-size:13px;font-weight:600;word-break:break-all}
.skm-desc{font-size:12px;line-height:1.45;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.skm-when{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.skm-badge{padding:2px 9px;font-size:11px;line-height:1.5;border-radius:999px;border:none;background:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.skm-badge[data-tone="on"]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent)}
.skm-badge[data-tone="off"]{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-border-l1);opacity:.75}
.skm-badge[data-tone="warn"]{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary));background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,transparent) 16%,transparent)}
.skm-rowActions{flex:none;display:flex;align-items:center;gap:6px}
.skm-switch{position:relative;flex:none;width:34px;height:19px;padding:0;background:var(--dsw-alias-border-l2);border:none;border-radius:999px;cursor:pointer;transition:background .12s}
.skm-switch[data-on]{background:var(--dsw-alias-state-business-primary)}
.skm-switch:disabled{opacity:.45;cursor:not-allowed}
.skm-thumb{position:absolute;top:2px;left:2px;width:15px;height:15px;background:#fff;border-radius:50%;transition:transform .12s}
.skm-switch[data-on] .skm-thumb{transform:translateX(15px)}
.skm-check{flex:none;margin-top:3px;width:14px;height:14px;cursor:pointer}
.skm-card{display:flex;flex-direction:column;gap:5px;padding:11px 13px;border:1px solid transparent;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover);transition:border-color .12s}
.skm-card:hover{border-color:var(--dsw-alias-border-l2)}
.skm-cardHead{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.skm-link{font-size:12px;color:var(--dsw-alias-label-secondary);text-decoration:none;padding:2px 0}
.skm-link:hover{color:var(--dsw-alias-state-business-primary);text-decoration:none}
.skm-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.skm-notice{padding:8px 12px;font-size:12px;border-radius:10px;border:none;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.skm-notice[data-tone="error"]{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary));background:color-mix(in srgb,var(--dsw-alias-state-error-primary,transparent) 14%,transparent)}
.skm-notice[data-tone="ok"]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}
.skm-modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);backdrop-filter:blur(2px);z-index:60;padding:24px}
.skm-modalBox{width:min(760px,100%);max-height:100%;overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding:20px;border-radius:16px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 24px 60px rgba(0,0,0,.4)}
.skm-submit{padding:14px;border-radius:14px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-state-business-primary)}
.skm-cardLinks{display:flex;flex-wrap:wrap;gap:10px;font-size:12px}
.skm-cardMeta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px}
.skm-menuWrap{position:relative;display:inline-block}
.skm-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:40;min-width:210px;max-height:min(60vh,420px);overflow-y:auto;padding:6px;border-radius:14px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 12px 32px rgba(0,0,0,.32)}
.skm-menu[data-align="right"]{left:auto;right:0}
.skm-menuLabel{padding:8px 12px 4px;font-size:11px;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary)}
.skm-menuSep{height:1px;margin:5px 10px;background:var(--dsw-alias-border-l1)}
.skm-menuItem{display:flex;align-items:center;gap:10px;width:100%;padding:7px 12px;font-size:13px;font-family:inherit;text-align:left;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:9px;cursor:pointer}
.skm-menuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.skm-menuItem[aria-selected="true"]{color:var(--dsw-alias-state-business-primary)}
.skm-menuTick{flex:none;width:14px;font-size:12px;color:var(--dsw-alias-state-business-primary)}
.skm-menuText{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;overflow:hidden}
.skm-menuText>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.skm-menuHint{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.skm-list{display:flex;flex-direction:column;gap:6px}
.skm-pre{max-height:240px;overflow:auto;margin:0;padding:12px 14px;font-size:12px;line-height:1.6;font-family:var(--dsw-mono-font-family,ui-monospace,Menlo,Consolas,monospace);background:var(--dsw-alias-interactive-bg-hover);border-radius:12px}
`;

    /**
     * Inject the stylesheet once.
     *
     * This runs during factory materialization, not from `apply`: the module
     * system claims `<style>` tags that appear while a factory materializes and
     * tags them with `data-plugin` for its HMR bookkeeping. Injecting later would
     * leave the tag unowned. The `id` guard keeps a re-materialized bundle from
     * adding a second copy.
     */
    function ensureStyles() {
      if (typeof document === "undefined") return;
      if (document.getElementById(STYLE_ID) !== null) return;
      const node = document.createElement("style");
      node.id = STYLE_ID;
      node.textContent = CSS;
      document.head.appendChild(node);
    }

    // ------------------------------------------------------------ primitives

    const Button = ({ children, onClick, disabled, primary, danger, title }) =>
      h(
        "button",
        {
          type: "button",
          className: "skm-button",
          onClick,
          disabled: disabled === true,
          title,
          ...(primary === true ? { "data-primary": "" } : {}),
          ...(danger === true ? { "data-danger": "" } : {}),
        },
        children,
      );

    const Switch = ({ on, onToggle, disabled, title }) =>
      h(
        "button",
        {
          type: "button",
          className: "skm-switch",
          role: "switch",
          "aria-checked": on ? "true" : "false",
          disabled: disabled === true,
          title,
          onClick: (event) => {
            event.stopPropagation();
            onToggle();
          },
          ...(on ? { "data-on": "" } : {}),
        },
        h("span", { className: "skm-thumb" }),
      );

    const Badge = ({ children, tone }) => h("span", { className: "skm-badge", ...(tone ? { "data-tone": tone } : {}) }, children);

    const Notice = ({ tone, children }) =>
      children === undefined || children === null || children === "" ? null : h("div", { className: "skm-notice", ...(tone ? { "data-tone": tone } : {}) }, children);

    const Field = ({ label, children }) => h("label", { className: "skm-field" }, h("span", null, label), children);

    /**
     * Load once per dependency change and expose a manual reload.
     * @param work - async producer of the value.
     * @param deps - React dependency list controlling both the load and the reload.
     * @returns `[{ pending, value, error }, reload]`.
     */
    function useAsync(work, deps) {
      const [state, setState] = useState({ pending: true });
      const workRef = React.useRef(work);
      workRef.current = work;
      const load = useCallback(async () => {
        // The previous payload stays in `value` while the reload is in flight so
        // the panel keeps rendering instead of flashing back to a loading screen
        // and losing the active tab, the search box and the selection.
        setState((current) => ({ ...current, pending: true, error: undefined }));
        try {
          setState({ pending: false, value: await workRef.current() });
        } catch (error) {
          setState((current) => ({ ...current, pending: false, error: error instanceof Error ? error.message : String(error) }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
      useEffect(() => {
        let live = true;
        (async () => {
          try {
            const value = await workRef.current();
            if (live) setState({ pending: false, value });
          } catch (error) {
            if (live) setState({ pending: false, error: error instanceof Error ? error.message : String(error) });
          }
        })();
        return () => {
          live = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
      return [state, load];
    }

    // ----------------------------------------------------------- installed

    const ROOT_LABELS = {
      "project-dsh": "项目 .dsh/skills",
      "project-agents": "项目 .agents/skills",
      "user-dsh": "用户 ~/.dsh/skills",
      "user-agents": "用户 ~/.agents/skills",
    };

    const rootLabel = (source) => (source in ROOT_LABELS ? ROOT_LABELS[source] : source.startsWith("custom:") ? `自定义目录 ${source.slice(7)}` : source);

    const matchesSkill = (skill, needle) => {
      if (needle === "") return true;
      const haystack = `${skill.name} ${skill.description} ${skill.whenToUse ?? ""}`.toLowerCase();
      return haystack.includes(needle.toLowerCase());
    };

    function SkillRow({ skill, selected, onSelect, onToggle, onEdit, onDelete, busy }) {
      const toggleTitle = skill.modelInvocable ? t("label.off") : t("label.on");
      return h(
        "div",
        { className: "skm-row" },
        h("input", {
          type: "checkbox",
          className: "skm-check",
          checked: selected,
          disabled: skill.writable !== true,
          onChange: () => onSelect(skill),
        }),
        h(
          "div",
          { className: "skm-rowMain" },
          h(
            "div",
            { className: "skm-nameRow" },
            h("span", { className: "skm-name" }, skill.name),
            h(Badge, { tone: skill.modelInvocable ? "on" : "off" }, `${t("label.model")} · ${skill.modelInvocable ? t("label.on") : t("label.off")}`),
            h(Badge, { tone: skill.userInvocable ? "on" : "off" }, `${t("label.user")} · ${skill.userInvocable ? t("label.on") : t("label.off")}`),
            skill.writable !== true ? h(Badge, { tone: "warn" }, t("label.readOnly")) : null,
            skill.shadowed === true ? h(Badge, { tone: "warn" }, t("label.shadowed")) : null,
            skill.symlink === true ? h(Badge, null, t("label.symlink")) : null,
          ),
          h("div", { className: "skm-desc" }, skill.description),
          skill.whenToUse ? h("div", { className: "skm-when" }, skill.whenToUse) : null,
        ),
        h(
          "div",
          { className: "skm-rowActions" },
          h(Switch, {
            on: skill.modelInvocable,
            disabled: busy || skill.writable !== true,
            title: toggleTitle,
            onToggle: () => onToggle(skill),
          }),
          h(Button, { onClick: () => onEdit(skill), disabled: skill.writable !== true || skill.symlink === true }, t("action.edit")),
          h(Button, { danger: true, onClick: () => onDelete(skill), disabled: skill.writable !== true || skill.symlink === true }, t("action.delete")),
        ),
      );
    }

    const PREFERRED_KEY = "dsh-skill-manager.preferredTarget";
    const PREFERRED_OVERWRITE_KEY = "dsh-skill-manager.overwrite";

    function readPreference(key, fallback) {
      try {
        const value = window.localStorage.getItem(key);
        return value === null ? fallback : value;
      } catch {
        return fallback;
      }
    }

    function writePreference(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* storage is optional */
      }
    }

    /**
     * Where an install goes and what happens to a name collision. Both controls
     * use the shared dropdown shell so a row of them reads as one set.
     */
    function TargetPicker({ targets, value, onChange, overwrite, onOverwriteChange, showOverwrite = true, openMenu, toggleMenu }) {
      return h(
        "div",
        { className: "skm-toolbar" },
        h(Picker, {
          label: t("import.target"),
          value,
          options: targets.map((target) => ({ value: target.id, label: target.label, hint: target.path })),
          onChange,
          open: openMenu === "target",
          onToggle: () => toggleMenu("target"),
        }),
        showOverwrite
          ? h(Picker, {
              label: t("import.overwrite"),
              value: overwrite,
              options: [
                { value: "skip", label: t("import.skip") },
                { value: "trash", label: t("import.replace") },
              ],
              onChange: onOverwriteChange,
              open: openMenu === "overwrite",
              onToggle: () => toggleMenu("overwrite"),
            })
          : null,
      );
    }

    function InstalledTab({ data, reload, notify }) {
      const [needle, setNeedle] = useState("");
      const [rootFilter, setRootFilter] = useState("all");
      const [selected, setSelected] = useState(() => new Set());
      const [busy, setBusy] = useState(false);
      const [editing, setEditing] = useState(undefined);
      const [trash, setTrash] = useState(undefined);
      const [restoreTarget, setRestoreTarget] = useState(() => readPreference(PREFERRED_KEY, "user"));
      const [both, setBoth] = useState(() => readPreference("dsh-skill-manager.both", "0") === "1");
      /** One dropdown open at a time across this tab. */
      const [openMenu, setOpenMenu] = useState(undefined);
      const toggleMenu = (id) => setOpenMenu((current) => (current === id ? undefined : id));

      const skills = data.skills ?? [];
      const visible = useMemo(
        () => skills.filter((skill) => (rootFilter === "all" || skill.root === rootFilter) && matchesSkill(skill, needle)),
        [skills, rootFilter, needle],
      );

      const groups = useMemo(() => {
        const map = new Map();
        for (const skill of visible) {
          if (!map.has(skill.root)) map.set(skill.root, []);
          map.get(skill.root).push(skill);
        }
        return [...map.entries()];
      }, [visible]);

      const selectable = useMemo(() => visible.filter((skill) => skill.writable === true), [visible]);
      const selectedSkills = useMemo(() => visible.filter((skill) => selected.has(`${skill.name}\u0000${skill.path}`)), [visible, selected]);

      useEffect(() => {
        setSelected((current) => {
          const live = new Set(skills.map((skill) => `${skill.name}\u0000${skill.path}`));
          const next = new Set([...current].filter((key) => live.has(key)));
          return next.size === current.size ? current : next;
        });
      }, [skills]);

      const keyOf = (skill) => `${skill.name}\u0000${skill.path}`;

      const rememberBoth = (next) => {
        setBoth(next);
        writePreference("dsh-skill-manager.both", next ? "1" : "0");
      };

      const toggleOne = async (skill) => {
        setBusy(true);
        try {
          await request(API.setEnabled, { method: "POST", body: { name: skill.name, path: skill.path, enabled: !skill.modelInvocable, both, cwd: data.cwd } });
          notify("ok", t("done.changed", { n: 1, verb: skill.modelInvocable ? t("verb.disabled") : t("verb.enabled") }));
          await reload();
        } catch (error) {
          notify("error", String(error.message ?? error));
        } finally {
          setBusy(false);
        }
      };

      const toggleMany = async (list, enabled) => {
        if (list.length === 0) return;
        setBusy(true);
        try {
          const payload = await request(API.setEnabledBatch, {
            method: "POST",
            body: { items: list.map((skill) => ({ name: skill.name, path: skill.path })), enabled, both, cwd: data.cwd },
          });
          notify("ok", t("done.changed", { n: payload.changed, verb: enabled ? t("verb.enabled") : t("verb.disabled") }));
          if (payload.results.some((result) => result.status !== "ok")) {
            notify("error", payload.results.filter((result) => result.status !== "ok").map((result) => `${result.name}: ${result.status}`).join("；"));
          }
          await reload();
        } catch (error) {
          notify("error", String(error.message ?? error));
        } finally {
          setBusy(false);
        }
      };

      const remove = async (skill) => {
        if (!confirm(t("confirm.delete", { name: skill.name }))) return;
        setBusy(true);
        try {
          await request(API.remove, { method: "POST", body: { name: skill.name, path: skill.path, cwd: data.cwd } });
          notify("ok", t("done.deleted", { name: skill.name }));
          await reload();
          await loadTrash();
        } catch (error) {
          notify("error", String(error.message ?? error));
        } finally {
          setBusy(false);
        }
      };

      const loadTrash = async () => {
        try {
          setTrash(await request(API.trash));
        } catch (error) {
          setTrash({ items: [], error: String(error.message ?? error) });
        }
      };

      useEffect(() => {
        loadTrash();
      }, [data.cwd]);

      const restore = async (item, target) => {
        setBusy(true);
        try {
          const payload = await request(API.restore, { method: "POST", body: { entry: item.entry, target, cwd: data.cwd } });
          notify("ok", t("done.restored", { path: payload.path }));
          await loadTrash();
          await reload();
        } catch (error) {
          notify("error", String(error.message ?? error));
        } finally {
          setBusy(false);
        }
      };

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "skm-toolbar" },
          h("input", {
            className: "skm-search",
            placeholder: t("search.skills"),
            value: needle,
            onChange: (event) => setNeedle(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Escape") setNeedle("");
            },
          }),
          h(Picker, {
            label: t("filter.root"),
            value: rootFilter,
            options: [
              { value: "all", label: t("filter.all") },
              ...(data.roots ?? []).map((root) => ({ value: root.source, label: `${rootLabel(root.source)} (${root.skillCount})` })),
            ],
            onChange: setRootFilter,
            open: openMenu === "root",
            onToggle: () => toggleMenu("root"),
          }),
          h("span", { className: "skm-count" }, t("summary.total", { n: visible.length })),
          selectedSkills.length > 0 ? h("span", { className: "skm-count" }, t("summary.selected", { n: selectedSkills.length })) : null,
          h(
            "label",
            { className: "skm-field", style: { flexDirection: "row", alignItems: "center", gap: "6px" }, title: t("option.both") },
            h("input", { type: "checkbox", checked: both, onChange: (event) => rememberBoth(event.target.checked) }),
            t("option.both"),
          ),
          h("span", { className: "skm-spacer" }),
          h(Button, { onClick: () => setSelected(new Set(selectable.map(keyOf))), disabled: selectable.length === 0 }, t("action.selectAll")),
          h(Button, { onClick: () => setSelected(new Set()), disabled: selectedSkills.length === 0 }, t("action.selectNone")),
          h(Button, { primary: true, onClick: () => toggleMany(selectedSkills, true), disabled: busy || selectedSkills.length === 0 }, t("action.batchEnable")),
          h(Button, { onClick: () => toggleMany(selectedSkills, false), disabled: busy || selectedSkills.length === 0 }, t("action.batchDisable")),
        ),

        groups.length === 0 ? h(Notice, null, skills.length === 0 ? t("summary.empty") : t("summary.noMatch")) : null,

        groups.map(([source, list]) =>
          h(
            "div",
            { className: "skm-group", key: source },
            h(
              "div",
              { className: "skm-groupHead" },
              h("span", null, rootLabel(source)),
              h("span", { className: "skm-count" }, String(list.length)),
              h("span", { className: "skm-groupPath", title: (data.roots ?? []).find((root) => root.source === source)?.path ?? "" }, (data.roots ?? []).find((root) => root.source === source)?.path ?? ""),
              h(Button, { onClick: () => toggleMany(list.filter((skill) => skill.writable === true), true), disabled: busy }, t("action.groupEnable")),
              h(Button, { onClick: () => toggleMany(list.filter((skill) => skill.writable === true), false), disabled: busy }, t("action.groupDisable")),
            ),
            h(
              "div",
              { className: "skm-list" },
              list.map((skill) =>
                h(SkillRow, {
                  key: keyOf(skill),
                  skill,
                  selected: selected.has(keyOf(skill)),
                  busy,
                  onSelect: (target) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(keyOf(target))) next.delete(keyOf(target));
                      else next.add(keyOf(target));
                      return next;
                    }),
                  onToggle: toggleOne,
                  onEdit: (target) => setEditing(target),
                  onDelete: remove,
                }),
              ),
            ),
          ),
        ),

        h(
          "div",
          { className: "skm-group" },
          h(
            "div",
            { className: "skm-groupHead" },
            h("span", null, t("trash.title")),
            h("span", { className: "skm-count" }, String((trash?.items ?? []).length)),
            h("span", { className: "skm-groupPath" }, trash?.trashRoot ?? ""),
            h(Picker, {
              label: t("trash.restoreTo"),
              value: restoreTarget,
              options: (data.targets ?? []).map((target) => ({ value: target.id, label: target.label, hint: target.path })),
              onChange: setRestoreTarget,
              open: openMenu === "restore",
              onToggle: () => toggleMenu("restore"),
            }),
            h(Button, { onClick: loadTrash }, t("panel.refresh")),
          ),
          trash?.items === undefined || trash.items.length === 0
            ? h(Notice, null, t("trash.empty"))
            : h(
                "div",
                { className: "skm-list" },
                trash.items.map((item) =>
                  h(
                    "div",
                    { className: "skm-row", key: item.entry },
                    h(
                      "div",
                      { className: "skm-rowMain" },
                      h("div", { className: "skm-nameRow" }, h("span", { className: "skm-name" }, item.name), h(Badge, null, item.directory ? "dir" : "file")),
                      h("div", { className: "skm-when" }, item.entry),
                    ),
                    h(Button, { onClick: () => restore(item, restoreTarget), disabled: busy }, t("action.restore")),
                  ),
                ),
              ),
        ),

        editing === undefined
          ? null
          : h(EditDialog, {
              skill: editing,
              cwd: data.cwd,
              onClose: () => setEditing(undefined),
              onDone: async (message) => {
                setEditing(undefined);
                notify("ok", message);
                await reload();
              },
            }),
      );
    }

    function EditDialog({ skill, cwd, onClose, onDone }) {
      const [form, setForm] = useState({ description: skill.description, whenToUse: skill.whenToUse ?? "", content: "" });
      const [pending, setPending] = useState(true);
      const [error, setError] = useState(undefined);

      useEffect(() => {
        let live = true;
        (async () => {
          try {
            const payload = await request(API.read, { query: { name: skill.name, path: skill.path, cwd } });
            if (live) {
              setForm({ description: payload.description ?? "", whenToUse: payload.whenToUse ?? "", content: payload.content ?? "" });
              setPending(false);
            }
          } catch (caught) {
            if (live) {
              setError(String(caught.message ?? caught));
              setPending(false);
            }
          }
        })();
        return () => {
          live = false;
        };
      }, [skill.name, skill.path, cwd]);

      const save = async () => {
        setPending(true);
        setError(undefined);
        try {
          await request(API.write, { method: "POST", body: { name: skill.name, path: skill.path, cwd, ...form } });
          await onDone(t("done.saved", { name: skill.name }));
        } catch (caught) {
          setError(String(caught.message ?? caught));
          setPending(false);
        }
      };

      return h(
        "div",
        { className: "skm-modal", onClick: (event) => event.target === event.currentTarget && onClose() },
        h(
          "div",
          { className: "skm-modalBox" },
          h("h3", { className: "skm-title" }, t("edit.title", { name: skill.name })),
          h(Notice, null, t("edit.note")),
          h(Notice, { tone: "error" }, error),
          h(Field, { label: t("edit.description") }, h("textarea", { className: "skm-textarea", style: { minHeight: "70px" }, value: form.description, onChange: (event) => setForm({ ...form, description: event.target.value }) })),
          h(Field, { label: t("edit.whenToUse") }, h("textarea", { className: "skm-textarea", style: { minHeight: "60px" }, value: form.whenToUse, onChange: (event) => setForm({ ...form, whenToUse: event.target.value }) })),
          h(Field, { label: t("edit.content") }, h("textarea", { className: "skm-textarea", value: form.content, onChange: (event) => setForm({ ...form, content: event.target.value }) })),
          h(
            "div",
            { className: "skm-toolbar" },
            h("span", { className: "skm-spacer" }),
            h(Button, { onClick: onClose }, t("action.cancel")),
            h(Button, { primary: true, onClick: save, disabled: pending }, pending ? t("empty.pending") : t("action.save")),
          ),
        ),
      );
    }

    // -------------------------------------------------------------- market

    /** Category keys, kept in sync with registry/schema.mjs. */
    const CATEGORY_LABELS = {
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

    /** Where a submission is filed, and what it should contain. */
    const SUBMIT_URL = "https://github.com/MyRemme/dsh-skill-manager/issues/new";
    const SUBMIT_TEMPLATE = [
      "repo: owner/name            # the repository holding the skill",
      "name: my-skill              # must equal the SKILL.md frontmatter `name`",
      "path: skills/my-skill/SKILL.md",
      "category: ui                # one of the catalog categories",
      "description:",
      "  en: One line on what it does and when to use it.",
      "  zh: 一句话说明它做什么、什么时候用。",
    ].join("\n");

    /** Sort fields the catalog can actually answer. */
    const SORT_FIELDS = [
      { key: "stars", label: "sort.stars" },
      { key: "added", label: "sort.added" },
      { key: "name", label: "sort.name" },
    ];
    const TIME_RANGES = [
      { key: "all", label: "time.all", days: 0 },
      { key: "7d", label: "time.7d", days: 7 },
      { key: "30d", label: "time.30d", days: 30 },
      { key: "90d", label: "time.90d", days: 90 },
      { key: "1y", label: "time.1y", days: 365 },
    ];

    /**
     * The one dropdown shell every picker in this panel uses.
     *
     * A native `<select>` cannot be styled into the harness' controls, so the
     * pickers are built here instead. `items` is a flat list of labelled
     * sections, separators and options; the caller owns only the values.
     *
     * @param props - label, items, onSelect, open, onToggle, align.
     */
    function Dropdown({ label, items, onSelect, open, onToggle, align }) {
      return h(
        "div",
        { className: "skm-menuWrap" },
        h(
          "button",
          {
            type: "button",
            className: "skm-button",
            "aria-expanded": open ? "true" : "false",
            ...(open ? { "data-active": "" } : {}),
            onClick: onToggle,
          },
          h("span", null, label),
          h("span", { className: "skm-caret" }, open ? "▴" : "▾"),
        ),
        open
          ? h(
              "div",
              { className: "skm-menu", ...(align === "right" ? { "data-align": "right" } : {}) },
              items.map((item) => {
                if (item.type === "separator") return h("div", { key: item.id, className: "skm-menuSep" });
                if (item.type === "label") return h("div", { key: item.id, className: "skm-menuLabel" }, item.text);
                return h(
                  "button",
                  {
                    key: item.id,
                    type: "button",
                    className: "skm-menuItem",
                    "aria-selected": item.selected ? "true" : "false",
                    title: item.hint ?? undefined,
                    onClick: () => {
                      onSelect(item.id);
                      onToggle();
                    },
                  },
                  h("span", { className: "skm-menuTick" }, item.selected ? "✓" : ""),
                  h(
                    "span",
                    { className: "skm-menuText" },
                    h("span", null, item.label),
                    item.hint === undefined ? null : h("span", { className: "skm-menuHint" }, item.hint),
                  ),
                );
              }),
            )
          : null,
      );
    }

    /**
     * The filter dropdown: sort field, direction and time range.
     */
    function FilterMenu({ lang, sortField, sortDir, timeRange, onSelect, open, onToggle }) {
      const dirLabel = (dir) => {
        if (sortField === "added") return dir === "desc" ? "sortNewest" : "sortOldest";
        return dir === "desc" ? "sortDesc" : "sortAsc";
      };
      const items = [
        { type: "label", id: "l-sort", text: t("filter.sort") },
        ...SORT_FIELDS.map((field) => ({ type: "option", id: `field:${field.key}`, label: t(field.label), selected: sortField === field.key })),
        { type: "separator", id: "s1" },
        { type: "label", id: "l-dir", text: t("filter.dir") },
        ...["desc", "asc"].map((dir) => ({ type: "option", id: `dir:${dir}`, label: t(dirLabel(dir)), selected: sortDir === dir })),
        { type: "separator", id: "s2" },
        { type: "label", id: "l-time", text: t("filter.time") },
        ...TIME_RANGES.map((range) => ({ type: "option", id: `time:${range.key}`, label: t(range.label), selected: timeRange === range.key })),
      ];
      return h(Dropdown, { label: t("filter.menu"), items, onSelect, open, onToggle });
    }

    /**
     * A single-choice picker over plain string values, built on the same shell
     * as the filter menu so a row of controls reads as one set.
     *
     * @param props - label, value, options (`{ value, label }`), onChange.
     */
    function Picker({ label, value, options, onChange, open, onToggle }) {
      const current = options.find((option) => option.value === value);
      const items = options.map((option) => ({
        type: "option",
        id: option.value,
        label: option.label,
        hint: option.hint,
        selected: option.value === value,
      }));
      return h(Dropdown, {
        label: `${label}${current === undefined ? "" : ` · ${current.label}`}`,
        items,
        onSelect: onChange,
        open,
        onToggle,
      });
    }

    /** One market card: linkable repo, version, category, license, install. */
    function MarketCard({ entry, busy, lang, onInstall }) {
      const label = (key) => {
        const value = CATEGORY_LABELS[key];
        return value === undefined ? key : value[lang === "en" ? "en" : "zh"];
      };
      const repoUrl = `https://github.com/${entry.repo}`;
      const pathUrl = entry.path === undefined ? repoUrl : `${repoUrl}/blob/${encodeURIComponent(entry.ref ?? "main")}/${entry.path}`;
      const provenance =
        entry.version !== undefined
          ? { label: t("card.version"), value: `v${entry.version}`, title: `${entry.repo} ${entry.ref ?? ""}`.trim() }
          : entry.commit !== undefined
            ? { label: t("card.commit"), value: entry.commit, title: `${entry.repo}@${entry.ref ?? "main"}` }
            : undefined;
      const license = entry.license === undefined ? { text: t("card.licenseNone"), muted: true } : { text: entry.license, muted: false };

      return h(
        "div",
        { className: "skm-card" },
        h(
          "div",
          { className: "skm-cardHead" },
          h("span", { className: "skm-name" }, entry.name),
          entry.category === undefined ? null : h(Badge, null, label(entry.category)),
          provenance === undefined ? null : h(Badge, { tone: "on" }, `${provenance.label} ${provenance.value}`),
          Number.isInteger(entry.stars) ? h(Badge, null, `★ ${entry.stars}`) : null,
          h("span", { className: "skm-spacer" }),
          entry.installed ? h(Badge, { tone: "on" }, t("action.installed")) : null,
          h(Button, { primary: entry.installed !== true, disabled: busy, onClick: () => onInstall(entry) }, t("action.install")),
        ),
        h(
          "div",
          { className: "skm-cardLinks" },
          h("a", { className: "skm-link", href: repoUrl, target: "_blank", rel: "noreferrer", title: t("card.repo") }, `↗ ${entry.repo}`),
          entry.path === undefined ? null : h("a", { className: "skm-link", href: pathUrl, target: "_blank", rel: "noreferrer", title: entry.path }, `↗ ${entry.path}`),
        ),
        h("div", { className: "skm-desc" }, entry.description?.[lang === "en" ? "en" : "zh"] ?? entry.description?.en ?? entry.description?.zh ?? ""),
        h(
          "div",
          { className: "skm-cardMeta" },
          license.muted ? h("span", { className: "skm-when" }, `${t("card.license")}: ${license.text}`) : h("span", { className: "skm-when" }, `${t("card.license")}: ${license.text}`),
          entry.added === undefined ? null : h("span", { className: "skm-when" }, `${t("card.added")} ${entry.added}`),
          ...(entry.tags ?? []).slice(0, 5).map((tag) => h(Badge, { key: tag }, tag)),
        ),
      );
    }

    /**
     * The submission panel: what to send and where.
     *
     * Collapsed behind a toolbar toggle rather than parked under the list. The
     * instructions belong with the controls that act on the catalog, but an
     * always-open block of prose and a code sample would push the first result
     * off the screen.
     */
    function SubmitPanel({ lang, notify, open, onToggle }) {
      // A real anchor, not window.open: it keeps middle-click and copy-link
      // working, and it does not depend on a browser global that a shell may not
      // provide.
      const copy = async () => {
        try {
          if (typeof navigator === "undefined" || navigator.clipboard === undefined) throw new Error("clipboard unavailable");
          await navigator.clipboard.writeText(SUBMIT_TEMPLATE);
          notify("ok", t("accept.copied"));
        } catch {
          notify("error", t("copy.failed"));
        }
      };
      return h(
        React.Fragment,
        null,
        h(
          "button",
          { type: "button", className: "skm-button", ...(open ? { "data-active": "" } : {}), onClick: onToggle },
          h("span", null, t("accept.toggle")),
          h("span", { className: "skm-caret" }, open ? "▴" : "▾"),
        ),
        open
          ? h(
              "div",
              { className: "skm-card skm-submit" },
              h(
                "div",
                { className: "skm-cardHead" },
                h("span", { className: "skm-name" }, t("accept.title")),
                h("span", { className: "skm-spacer" }),
                h(Button, { onClick: onToggle }, t("accept.close")),
              ),
              h("div", { className: "skm-desc" }, t("accept.hint")),
              h("pre", { className: "skm-pre" }, SUBMIT_TEMPLATE),
              h(
                "div",
                { className: "skm-toolbar" },
                h("a", { className: "skm-button", href: SUBMIT_URL, target: "_blank", rel: "noreferrer", "data-primary": "" }, t("accept.open")),
                h(Button, { onClick: copy }, t("accept.template")),
              ),
            )
          : null,
      );
    }

    /**
     * The About panel: what this is, what version is installed, whether that is
     * the newest one, and where the project lives.
     *
     * The update check is an explicit button, not something that fires on mount:
     * it costs a network round trip against a rate-limited API, and a panel that
     * silently phones home every time you open it is a bad citizen.
     */
    function AboutTab({ lang, notify }) {
      const [state, reload] = useAsync(() => request(API.about), []);
      const [check, setCheck] = useState({ status: "idle" });
      const [copyState, setCopyState] = useState("idle");

      const info = state.value;
      const updateCommand = `dsh plugin --profile desktop add github:${info?.repo ?? "MyRemme/dsh-skill-manager"}`;

      const runCheck = async () => {
        setCheck({ status: "checking" });
        try {
          const payload = await request(API.about, { query: { check: "1" } });
          setCheck({ status: "done", update: payload.update });
        } catch (error) {
          setCheck({ status: "done", update: { status: "unknown", error: error instanceof Error ? error.message : String(error) } });
        }
      };

      const copy = async () => {
        try {
          if (typeof navigator === "undefined" || navigator.clipboard === undefined) throw new Error("clipboard unavailable");
          await navigator.clipboard.writeText(updateCommand);
          setCopyState("done");
          notify("ok", t("about.copied"));
        } catch {
          setCopyState("failed");
          notify("error", t("copy.failed"));
        }
      };

      if (info === undefined) {
        return h(Notice, { tone: state.error === undefined ? undefined : "error" }, state.error ?? t("empty.pending"));
      }

      const update = check.status === "done" ? check.update : undefined;
      const statusLine = () => {
        if (check.status === "checking") return t("about.checking");
        if (update === undefined) return undefined;
        if (update.status === "current") return t("about.upToDate");
        if (update.status === "behind") return t("about.behind", { version: update.latest });
        if (update.status === "ahead") return t("about.ahead", { version: update.latest });
        return t("about.unknown", { error: update.error ?? "?" });
      };
      const line = statusLine();

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "skm-card" },
          h(
            "div",
            { className: "skm-cardHead" },
            h("span", { className: "skm-name" }, "dsh-skill-manager"),
            info.version === null ? h(Badge, { tone: "warn" }, t("about.unavailable")) : h(Badge, { tone: "on" }, `v${info.version}`),
            h("span", { className: "skm-spacer" }),
            h(Button, { onClick: runCheck, disabled: check.status === "checking" }, t("about.check")),
          ),
          h(
            "div",
            { className: "skm-cardMeta" },
            h("span", { className: "skm-when" }, `${t("about.version")}: ${info.version ?? "?"}`),
            h("span", { className: "skm-when" }, `${t("about.access")}: ${info.access}`),
          ),
          line === undefined ? null : h(Notice, null, line),
          h(
            "div",
            { className: "skm-cardLinks" },
            h("a", { className: "skm-link", href: info.repoUrl, target: "_blank", rel: "noreferrer" }, `↗ ${t("about.repo")} · ${info.repo}`),
            h("a", { className: "skm-link", href: `${info.repoUrl}/releases`, target: "_blank", rel: "noreferrer" }, `↗ ${t("about.releases")}`),
            h("a", { className: "skm-link", href: info.registryUrl, target: "_blank", rel: "noreferrer" }, `↗ ${t("about.registry")}`),
          ),
        ),
        h(
          "div",
          { className: "skm-card" },
          h("span", { className: "skm-name" }, t("about.updateHint")),
          h("pre", { className: "skm-pre" }, updateCommand),
          h(
            "div",
            { className: "skm-toolbar" },
            h(Button, { onClick: copy, primary: copyState === "idle" }, t("about.copy")),
          ),
        ),
      );
    }

    function MarketTab({ data, reload, notify, lang }) {
      const [needle, setNeedle] = useState("");
      const [category, setCategory] = useState("all");
      const [sortField, setSortField] = useState("stars");
      const [sortDir, setSortDir] = useState("desc");
      const [timeRange, setTimeRange] = useState("all");
      // The first load accepts a cached catalog; every manual refresh asks the
      // host to refetch it.
      const [nonce, setNonce] = useState(0);
      const [state, refresh] = useAsync(
        () => request(API.market, { query: { cwd: data.cwd, ...(nonce > 0 ? { refresh: "1" } : {}) } }),
        [data.cwd, nonce],
      );
      const [busy, setBusy] = useState(undefined);
      const [lastResults, setLastResults] = useState(undefined);
      const [submitOpen, setSubmitOpen] = useState(false);
      // One dropdown open at a time, so the category menu and the filter menu
      // never stack on top of each other.
      const [openMenu, setOpenMenu] = useState(undefined);
      const toggleMenu = (id) => setOpenMenu((current) => (current === id ? undefined : id));

      const entries = state.value?.skills ?? [];
      const present = useMemo(() => [...new Set(entries.map((entry) => entry.category).filter((value) => typeof value === "string"))], [entries]);
      const starsAvailable = useMemo(() => entries.some((entry) => Number.isInteger(entry.stars)), [entries]);

      const visible = useMemo(() => {
        const cutoffDays = TIME_RANGES.find((range) => range.key === timeRange)?.days ?? 0;
        const cutoff = cutoffDays === 0 ? undefined : Date.now() - cutoffDays * 86400000;
        const filtered = entries.filter((entry) => {
          if (category !== "all" && entry.category !== category) return false;
          if (cutoff !== undefined) {
            if (entry.added === undefined) return false;
            if (Date.parse(`${entry.added}T00:00:00Z`) < cutoff) return false;
          }
          if (needle === "") return true;
          const text = [entry.name, entry.repo, ...(entry.tags ?? []), entry.description?.zh ?? "", entry.description?.en ?? ""].join(" ").toLowerCase();
          return text.includes(needle.toLowerCase());
        });
        // A field the catalog cannot answer must not silently reorder the list.
        const direction = sortDir === "asc" ? 1 : -1;
        if (sortField === "stars" && !starsAvailable) return filtered;
        return [...filtered].sort((a, b) => {
          if (sortField === "name") return direction * String(a.name).localeCompare(String(b.name));
          if (sortField === "added") return direction * String(a.added ?? "").localeCompare(String(b.added ?? ""));
          return direction * ((a.stars ?? 0) - (b.stars ?? 0));
        });
      }, [entries, category, needle, sortField, sortDir, timeRange, starsAvailable]);

      const onFilterSelect = (id) => {
        if (id.startsWith("field:")) setSortField(id.slice(6));
        else if (id.startsWith("dir:")) setSortDir(id.slice(4));
        else if (id.startsWith("time:")) setTimeRange(id.slice(5));
      };

      const install = async (entry) => {
        setBusy(entry.id);
        setLastResults(undefined);
        try {
          const payload = await request(API.marketInstall, {
            method: "POST",
            body: { id: entry.id, target: readPreference(PREFERRED_KEY, "user"), overwrite: readPreference(PREFERRED_OVERWRITE_KEY, "skip"), cwd: data.cwd },
          });
          const installed = payload.results.filter((result) => result.status === "installed").map((result) => result.name);
          const failed = payload.results.filter((result) => result.status !== "installed");
          if (installed.length > 0) notify("ok", t("done.installed", { list: installed.join(", ") }));
          if (failed.length > 0) notify("error", failed.map((result) => `${result.name}: ${result.reason ?? result.status}`).join("；"));
          setLastResults(payload.results);
          await refresh();
          await reload();
        } catch (error) {
          notify("error", String(error.message ?? error));
        } finally {
          setBusy(undefined);
        }
      };

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "skm-toolbar" },
          h("input", { className: "skm-search", placeholder: t("search.market"), value: needle, onChange: (event) => setNeedle(event.target.value) }),
          h(Picker, {
            label: t("filter.category"),
            value: category,
            options: [
              { value: "all", label: t("cat.all") },
              ...present.map((value) => ({ value, label: CATEGORY_LABELS[value]?.[lang === "en" ? "en" : "zh"] ?? value })),
            ],
            onChange: setCategory,
            open: openMenu === "category",
            onToggle: () => toggleMenu("category"),
          }),
          h(FilterMenu, {
            lang,
            sortField,
            sortDir,
            timeRange,
            onSelect: onFilterSelect,
            open: openMenu === "filter",
            onToggle: () => toggleMenu("filter"),
          }),
          h("span", { className: "skm-count" }, t("summary.total", { n: visible.length })),
          h("span", { className: "skm-spacer" }),
          h(SubmitPanel, { lang, notify, open: submitOpen, onToggle: () => setSubmitOpen((value) => !value) }),
          h(Button, { onClick: () => setNonce((value) => value + 1), disabled: state.pending }, t("panel.refresh")),
        ),
        sortField === "stars" && !starsAvailable && entries.length > 0 ? h(Notice, null, t("sortUnsorted")) : null,
        h(Notice, { tone: "error" }, state.error),
        state.pending ? h(Notice, null, t("empty.pending")) : null,
        !state.pending && entries.length === 0 ? h(Notice, null, t("summary.marketEmpty")) : null,
        !state.pending && entries.length > 0 && visible.length === 0 ? h(Notice, null, t("summary.noMatch")) : null,
        h(
          "div",
          { className: "skm-list" },
          visible.map((entry) =>
            h(MarketCard, { key: entry.id, entry, lang, busy: busy === entry.id, onInstall: install }),
          ),
        ),
        lastResults === undefined
          ? null
          : h(
              "div",
              { className: "skm-group" },
              h("div", { className: "skm-groupHead" }, h("span", null, lang === "en" ? "Result" : "结果")),
              h(
                "div",
                { className: "skm-list" },
                lastResults.map((result, index) => h("div", { className: "skm-row", key: `${result.name}-${index}` }, h("div", { className: "skm-rowMain" }, h("div", { className: "skm-nameRow" }, h("span", { className: "skm-name" }, result.name), h(Badge, { tone: result.status === "installed" ? "on" : "warn" }, result.status)), result.path ? h("div", { className: "skm-when" }, result.path) : null))),
              ),
            ),
      );
    }

    // -------------------------------------------------------------- import

    function ImportTab({ data, reload, notify }) {
      const [target, setTarget] = useState(() => readPreference(PREFERRED_KEY, "user"));
      const [overwrite, setOverwrite] = useState(() => readPreference(PREFERRED_OVERWRITE_KEY, "skip"));
      const [busy, setBusy] = useState(false);
      const [results, setResults] = useState(undefined);
      const [hostPath, setHostPath] = useState("");
      const [openMenu, setOpenMenu] = useState(undefined);
      const toggleMenu = (id) => setOpenMenu((current) => (current === id ? undefined : id));

      useEffect(() => writePreference(PREFERRED_KEY, target), [target]);
      useEffect(() => writePreference(PREFERRED_OVERWRITE_KEY, overwrite), [overwrite]);

      const report = async (work, label) => {
        setBusy(true);
        setResults(undefined);
        try {
          const payload = await work();
          setResults(payload.results ?? []);
          const installed = (payload.results ?? []).filter((result) => result.status === "installed");
          if (installed.length > 0) notify("ok", t("done.installed", { list: installed.map((result) => result.name).join(", ") }));
          else notify("error", label);
          await reload();
        } catch (error) {
          notify("error", String(error.message ?? error));
        } finally {
          setBusy(false);
        }
      };

      const uploadZip = (file) =>
        report(async () => {
          const buffer = await file.arrayBuffer();
          return await request(API.importZip, {
            method: "POST",
            raw: buffer,
            contentType: "application/zip",
            query: { target, overwrite, cwd: data.cwd },
          });
        }, "zip");

      const uploadFolder = (fileList) =>
        report(
          async () => {
            const files = [];
            for (const file of fileList) {
              const buffer = await file.arrayBuffer();
              let binary = "";
              const bytes = new Uint8Array(buffer);
              const chunk = 0x8000;
              for (let index = 0; index < bytes.length; index += chunk) {
                binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
              }
              files.push({ path: file.webkitRelativePath || file.name, data: btoa(binary) });
            }
            return await request(API.importFiles, { method: "POST", body: { files, target, overwrite, cwd: data.cwd } });
          },
          "folder",
        );

      const importHostPath = () =>
        report(async () => await request(API.importPath, { method: "POST", body: { sourcePath: hostPath, target, overwrite, cwd: data.cwd } }), "path");

      return h(
        React.Fragment,
        null,
        h(TargetPicker, { targets: data.targets ?? [], value: target, onChange: setTarget, overwrite, onOverwriteChange: setOverwrite, openMenu, toggleMenu }),
        h(
          "div",
          { className: "skm-card" },
          h("span", { className: "skm-name" }, t("action.upload")),
          h("div", { className: "skm-desc" }, t("import.zipHint")),
          h("input", {
            type: "file",
            accept: ".zip,application/zip",
            disabled: busy,
            onChange: (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file !== undefined) uploadZip(file);
            },
          }),
        ),
        h(
          "div",
          { className: "skm-card" },
          h("span", { className: "skm-name" }, t("action.pickFolder")),
          h("div", { className: "skm-desc" }, t("import.folderHint")),
          h("input", {
            type: "file",
            webkitdirectory: "true",
            directory: "true",
            multiple: true,
            disabled: busy,
            onChange: (event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              if (files.length > 0) uploadFolder(files);
            },
          }),
        ),
        h(
          "div",
          { className: "skm-card" },
          h("span", { className: "skm-name" }, t("action.importPath")),
          h("div", { className: "skm-desc" }, t("import.pathHint")),
          h("input", { className: "skm-input", value: hostPath, placeholder: "C:\\path\\to\\skill", onChange: (event) => setHostPath(event.target.value) }),
          h(Button, { primary: true, disabled: busy || hostPath.trim() === "", onClick: importHostPath }, t("action.importPath")),
        ),
        results === undefined
          ? null
          : h(
              "div",
              { className: "skm-list" },
              results.map((result, index) =>
                h(
                  "div",
                  { className: "skm-row", key: `${result.name}-${index}` },
                  h(
                    "div",
                    { className: "skm-rowMain" },
                    h("div", { className: "skm-nameRow" }, h("span", { className: "skm-name" }, result.name), h(Badge, { tone: result.status === "installed" ? "on" : "warn" }, result.status)),
                    h("div", { className: "skm-when" }, result.reason ?? result.path ?? ""),
                  ),
                ),
              ),
            ),
      );
    }

    // -------------------------------------------------------------- create

    function CreateTab({ data, reload, notify }) {
      const [form, setForm] = useState({ name: "", description: "", whenToUse: "", content: "", modelInvocable: true, userInvocable: true });
      const [target, setTarget] = useState(() => readPreference(PREFERRED_KEY, "user"));
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(undefined);
      const [openMenu, setOpenMenu] = useState(undefined);
      const toggleMenu = (id) => setOpenMenu((current) => (current === id ? undefined : id));

      const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(form.name) && form.description.trim() !== "";

      const create = async () => {
        setBusy(true);
        setError(undefined);
        try {
          const payload = await request(API.create, { method: "POST", body: { ...form, target, cwd: data.cwd } });
          notify("ok", t("done.created", { path: payload.path }));
          setForm({ name: "", description: "", whenToUse: "", content: "", modelInvocable: true, userInvocable: true });
          await reload();
        } catch (caught) {
          setError(String(caught.message ?? caught));
        } finally {
          setBusy(false);
        }
      };

      return h(
        React.Fragment,
        null,
        h(Notice, null, t("create.hint")),
        h(TargetPicker, { targets: data.targets ?? [], value: target, onChange: setTarget, overwrite: "skip", onOverwriteChange: () => {}, showOverwrite: false, openMenu, toggleMenu }),
        h(Field, { label: t("create.name") }, h("input", { className: "skm-input", value: form.name, onChange: (event) => setForm({ ...form, name: event.target.value }) })),
        h(Field, { label: t("create.description") }, h("textarea", { className: "skm-textarea", style: { minHeight: "70px" }, value: form.description, onChange: (event) => setForm({ ...form, description: event.target.value }) })),
        h(Field, { label: t("create.whenToUse") }, h("textarea", { className: "skm-textarea", style: { minHeight: "60px" }, value: form.whenToUse, onChange: (event) => setForm({ ...form, whenToUse: event.target.value }) })),
        h(Field, { label: t("create.content") }, h("textarea", { className: "skm-textarea", value: form.content, onChange: (event) => setForm({ ...form, content: event.target.value }) })),
        h(
          "div",
          { className: "skm-toolbar" },
          h("label", { className: "skm-field", style: { flexDirection: "row", alignItems: "center", gap: "6px" } }, h("input", { type: "checkbox", checked: form.modelInvocable, onChange: (event) => setForm({ ...form, modelInvocable: event.target.checked }) }), t("create.modelInvocable")),
          h("label", { className: "skm-field", style: { flexDirection: "row", alignItems: "center", gap: "6px" } }, h("input", { type: "checkbox", checked: form.userInvocable, onChange: (event) => setForm({ ...form, userInvocable: event.target.checked }) }), t("create.userInvocable")),
          h("span", { className: "skm-spacer" }),
          h(Button, { primary: true, disabled: busy || !valid, onClick: create }, t("action.create")),
        ),
        h(Notice, { tone: "error" }, error),
      );
    }

    // --------------------------------------------------------------- panel

    function ManagerPanel({ api }) {
      const [tab, setTab] = useState("installed");
      const [notice, setNotice] = useState(undefined);
      const [data, reload] = useAsync(() => request(API.list), []);
      // Subscribes to the locale, so a language switch re-renders the market
      // cards and the tab labels without a polling timer.
      const lang = useLang();

      const notify = useCallback((tone, message) => {
        setNotice({ tone, message });
        setTimeout(() => setNotice((current) => (current?.message === message ? undefined : current)), 6000);
      }, []);

      if (data.value === undefined) {
        const failed = data.error !== undefined;
        return h(
          "div",
          { className: "skm-panel" },
          h(Notice, failed ? { tone: "error" } : undefined, failed ? `${t("empty.error")}: ${data.error}` : t("empty.pending")),
        );
      }
      const payload = data.value;
      const tabs = [
        ["installed", t("tab.installed")],
        ["market", t("tab.market")],
        ["import", t("tab.import")],
        ["create", t("tab.create")],
        ["about", t("about.tab")],
      ];

      return h(
        "div",
        { className: "skm-panel" },
        h(
          "div",
          { className: "skm-header" },
          h("h2", { className: "skm-title" }, t("panel.title")),
          h(Button, { onClick: () => api.selectPanel(null) }, t("panel.back")),
          h(Button, { onClick: reload, disabled: data.pending }, t("panel.refresh")),
        ),
        h(
          "div",
          { className: "skm-tabs" },
          tabs.map(([id, label]) =>
            h(
              "button",
              {
                key: id,
                type: "button",
                className: "skm-tab",
                onClick: () => setTab(id),
                ...(tab === id ? { "data-active": "" } : {}),
              },
              label,
            ),
          ),
        ),
        h(Notice, { tone: notice?.tone }, notice?.message),
        h(
          "div",
          { className: "skm-body" },
          tab === "installed" ? h(InstalledTab, { data: payload, reload, notify }) : null,
          tab === "market" ? h(MarketTab, { data: payload, reload, notify, lang }) : null,
          tab === "import" ? h(ImportTab, { data: payload, reload, notify }) : null,
          tab === "create" ? h(CreateTab, { data: payload, reload, notify }) : null,
          tab === "about" ? h(AboutTab, { lang, notify }) : null,
        ),
      );
    }

    const PanelIcon = () =>
      h(
        "svg",
        { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" },
        h("path", { d: "M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z" }),
        h("path", { d: "M11 4h7.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H11" }),
        h("path", { d: "M14 9h3M14 13h3" }),
      );

    // ---------------------------------------------------------------- mount

    const inject = ["slots", "locale"];

    function apply(ctx) {
      // Also injected at materialization (see the call at the bottom of the
      // factory): the module system only claims <style> tags that appear while a
      // factory runs, and this second call covers a shell that materializes the
      // bundle in an order where the first injection was not observed.
      ensureStyles();
      const disposers = [];
      try {
        const dispose = ctx.locale?.register?.(NS, { zh, en });
        if (typeof dispose === "function") disposers.push(dispose);
      } catch {
        /* the locale service is optional; the built-in Chinese dictionary stays */
      }
      try {
        const readActive = () => ctx.locale?.snapshot?.()?.active ?? ctx.locale?.getSnapshot?.()?.active;
        setTranslator(readActive() === "en" ? "en" : "zh");
        const stop = ctx.locale?.subscribe?.(() => setTranslator(readActive() === "en" ? "en" : "zh"));
        if (typeof stop === "function") disposers.push(stop);
      } catch {
        /* ignore */
      }

      const api = {
        selectPanel(panelId) {
          try {
            ctx.get?.("layout")?.selectPanel?.(panelId);
          } catch (error) {
            console.warn("[skill-manager] cannot change the active panel:", error);
          }
        },
      };

      try {
        const slots = ctx.slots;
        disposers.push(
          slots.inject("sidebar.panellist", () =>
            slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: PANEL_ORDER, label: () => t("entry.label") }, PanelIcon),
          ),
        );
        disposers.push(
          slots.inject("main", () =>
            slots.register({ name: "main", key: PANEL_ID, inject: () => ({ api }) }, ManagerPanel),
          ),
        );
      } catch (error) {
        console.warn("[skill-manager] panel registration failed:", error);
      }

      ctx.effect?.(() => () => {
        for (const dispose of disposers.splice(0)) dispose();
      }, "skill-manager: ui mounts");
    }

    const exportsObject = { apply, inject, name: NS };

    // Materialization-time side effect; see ensureStyles.
    ensureStyles();

    return exportsObject;
  },
});
