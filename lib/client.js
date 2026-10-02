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

    function setTranslator(active) {
      translate = (key, values) => {
        const dict = active === "en" ? en : zh;
        const template = key in dict ? dict[key] : key;
        return values === undefined ? template : interpolate(template, values);
      };
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
.skm-search{flex:0 260px;min-width:120px;padding:6px 10px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none}
.skm-select{padding:6px 8px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none}
.skm-input{width:100%;padding:7px 10px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;box-sizing:border-box}
.skm-textarea{width:100%;min-height:200px;padding:8px 10px;font-size:13px;line-height:1.5;font-family:var(--dsw-mono-font-family,ui-monospace,Menlo,Consolas,monospace);color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;resize:vertical;box-sizing:border-box}
.skm-button{display:inline-flex;align-items:center;gap:4px;padding:6px 12px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer}
.skm-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.skm-button:disabled{opacity:.45;cursor:not-allowed}
.skm-button[data-primary]{color:var(--dsw-alias-label-inverse,var(--dsw-alias-bg-base));background:var(--dsw-alias-state-business-primary);border-color:transparent}
.skm-button[data-danger]{color:var(--dsw-alias-state-error-primary,inherit)}
.skm-spacer{flex:1}
.skm-count{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.skm-group{display:flex;flex-direction:column;gap:6px}
.skm-groupHead{display:flex;align-items:center;gap:8px;padding:4px 2px;font-size:12px;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1)}
.skm-groupPath{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;flex:1}
.skm-row{display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}
.skm-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.skm-rowMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.skm-nameRow{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.skm-name{font-size:13px;font-weight:600;word-break:break-all}
.skm-desc{font-size:12px;line-height:1.45;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.skm-when{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.skm-badge{padding:1px 6px;font-size:11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.skm-badge[data-tone="on"]{color:var(--dsw-alias-state-business-primary);border-color:currentColor}
.skm-badge[data-tone="off"]{color:var(--dsw-alias-label-tertiary)}
.skm-badge[data-tone="warn"]{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary))}
.skm-rowActions{flex:none;display:flex;align-items:center;gap:6px}
.skm-switch{position:relative;flex:none;width:34px;height:19px;padding:0;background:var(--dsw-alias-border-l2);border:none;border-radius:999px;cursor:pointer;transition:background .12s}
.skm-switch[data-on]{background:var(--dsw-alias-state-business-primary)}
.skm-switch:disabled{opacity:.45;cursor:not-allowed}
.skm-thumb{position:absolute;top:2px;left:2px;width:15px;height:15px;background:#fff;border-radius:50%;transition:transform .12s}
.skm-switch[data-on] .skm-thumb{transform:translateX(15px)}
.skm-check{flex:none;margin-top:3px;width:14px;height:14px;cursor:pointer}
.skm-card{display:flex;flex-direction:column;gap:4px;padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}
.skm-cardHead{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.skm-link{font-size:11px;color:var(--dsw-alias-label-tertiary);text-decoration:none}
.skm-link:hover{text-decoration:underline}
.skm-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.skm-notice{padding:7px 10px;font-size:12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.skm-notice[data-tone="error"]{color:var(--dsw-alias-state-error-primary,inherit);border-color:currentColor}
.skm-notice[data-tone="ok"]{color:var(--dsw-alias-state-business-primary);border-color:currentColor}
.skm-modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:60;padding:24px}
.skm-modalBox{width:min(760px,100%);max-height:100%;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:12px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1)}
.skm-list{display:flex;flex-direction:column;gap:6px}
.skm-hidden{display:none}
.skm-pre{max-height:220px;overflow:auto;margin:0;padding:8px;font-size:12px;background:var(--dsw-specific-input-major);border-radius:8px}
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

    function TargetPicker({ targets, value, onChange, overwrite, onOverwriteChange, showOverwrite = true }) {
      return h(
        "div",
        { className: "skm-toolbar" },
        h(
          Field,
          { label: t("import.target") },
          h(
            "select",
            { className: "skm-select", value, onChange: (event) => onChange(event.target.value) },
            targets.map((target) => h("option", { key: target.id, value: target.id }, `${target.label} — ${target.path}`)),
          ),
        ),
        showOverwrite
          ? h(
              Field,
              { label: t("import.overwrite") },
              h(
                "select",
                { className: "skm-select", value: overwrite, onChange: (event) => onOverwriteChange(event.target.value) },
                h("option", { value: "skip" }, t("import.skip")),
                h("option", { value: "trash" }, t("import.replace")),
              ),
            )
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
          h(
            "select",
            { className: "skm-select", value: rootFilter, onChange: (event) => setRootFilter(event.target.value) },
            h("option", { value: "all" }, `${t("filter.root")}: ${t("filter.all")}`),
            (data.roots ?? []).map((root) => h("option", { key: root.source, value: root.source }, `${rootLabel(root.source)} (${root.skillCount})`)),
          ),
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
            h(
              "select",
              { className: "skm-select", value: restoreTarget, onChange: (event) => setRestoreTarget(event.target.value) },
              (data.targets ?? []).map((target) => h("option", { key: target.id, value: target.id }, `${t("trash.restoreTo")}: ${target.label}`)),
            ),
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

    function MarketTab({ data, reload, notify }) {
      const [needle, setNeedle] = useState("");
      const [category, setCategory] = useState("all");
      // The first load accepts a cached catalog; every manual refresh asks the
      // host to refetch it.
      const [nonce, setNonce] = useState(0);
      const [state, refresh] = useAsync(
        () => request(API.market, { query: { cwd: data.cwd, ...(nonce > 0 ? { refresh: "1" } : {}) } }),
        [data.cwd, nonce],
      );
      const [busy, setBusy] = useState(undefined);
      const [lastResults, setLastResults] = useState(undefined);

      const entries = state.value?.skills ?? [];
      const categories = useMemo(() => [...new Set(entries.map((entry) => entry.category).filter((value) => typeof value === "string"))].sort(), [entries]);

      const visible = useMemo(
        () =>
          entries.filter((entry) => {
            if (category !== "all" && entry.category !== category) return false;
            if (needle === "") return true;
            const text = [entry.name, entry.repo, ...(entry.tags ?? []), entry.description?.zh ?? "", entry.description?.en ?? ""].join(" ").toLowerCase();
            return text.includes(needle.toLowerCase());
          }),
        [entries, category, needle],
      );

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
          h(
            "select",
            { className: "skm-select", value: category, onChange: (event) => setCategory(event.target.value) },
            h("option", { value: "all" }, `${t("filter.category")}: ${t("filter.all")}`),
            categories.map((value) => h("option", { key: value, value }, value)),
          ),
          h("span", { className: "skm-count" }, t("summary.total", { n: visible.length })),
          h("span", { className: "skm-spacer" }),
          state.value?.url ? h("a", { className: "skm-link", href: state.value.url, target: "_blank", rel: "noreferrer" }, state.value.cached ? `${state.value.url} (cached)` : state.value.url) : null,
          h(Button, { onClick: () => setNonce((value) => value + 1), disabled: state.pending }, t("panel.refresh")),
        ),
        h(Notice, { tone: "error" }, state.error),
        state.pending ? h(Notice, null, t("empty.pending")) : null,
        !state.pending && entries.length === 0 ? h(Notice, null, t("summary.marketEmpty")) : null,
        h(
          "div",
          { className: "skm-list" },
          visible.map((entry) =>
            h(
              "div",
              { className: "skm-card", key: entry.id },
              h(
                "div",
                { className: "skm-cardHead" },
                h("span", { className: "skm-name" }, entry.name),
                entry.category ? h(Badge, null, entry.category) : null,
                ...(entry.tags ?? []).slice(0, 4).map((tag) => h(Badge, { key: tag }, tag)),
                Number.isInteger(entry.stars) ? h(Badge, null, `★ ${entry.stars}`) : null,
                entry.installed ? h(Badge, { tone: "on" }, t("action.installed")) : null,
                h("span", { className: "skm-spacer" }),
                h("a", { className: "skm-link", href: `https://github.com/${entry.repo}`, target: "_blank", rel: "noreferrer" }, entry.repo),
                h(Button, { primary: entry.installed !== true, disabled: busy === entry.id, onClick: () => install(entry) }, t("action.install")),
              ),
              h("div", { className: "skm-desc" }, entry.description?.zh ?? entry.description?.en ?? ""),
              entry.path ? h("div", { className: "skm-when" }, entry.path) : null,
            ),
          ),
        ),
        lastResults === undefined
          ? null
          : h(
              "div",
              { className: "skm-group" },
              h("div", { className: "skm-groupHead" }, h("span", null, "结果")),
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
        h(TargetPicker, { targets: data.targets ?? [], value: target, onChange: setTarget, overwrite, onOverwriteChange: setOverwrite }),
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
        h(TargetPicker, { targets: data.targets ?? [], value: target, onChange: setTarget, overwrite: "skip", onOverwriteChange: () => {}, showOverwrite: false }),
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
          tab === "market" ? h(MarketTab, { data: payload, reload, notify }) : null,
          tab === "import" ? h(ImportTab, { data: payload, reload, notify }) : null,
          tab === "create" ? h(CreateTab, { data: payload, reload, notify }) : null,
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
