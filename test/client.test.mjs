/**
 * Structural and render tests for the browser half.
 *
 * The client ships as a module-loader bundle with no build step, so these tests
 * execute it in Node against a minimal renderer that implements the four hooks
 * the panel uses. That is enough to prove the parts that break in practice: the
 * loader contract, the slot registrations, real render output for a payload, and
 * the key/route vocabulary shared with the host half.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

// ------------------------------------------------------------------ harness

function sameDeps(previous, next) {
  if (previous === undefined || next === undefined) return false;
  if (previous.length !== next.length) return false;
  return previous.every((value, index) => Object.is(value, next[index]));
}

/**
 * A very small renderer: components are plain function calls, hook slots live in
 * a per-path instance, and effects run after each pass until nothing new is
 * queued. It records every host element and component it visited so tests can
 * assert on props without re-invoking a component out of order.
 */
function createHarness() {
  const instances = new Map();
  const effectDeps = new Map();
  const cleanups = new Map();
  const nodes = [];
  let active;
  let root;

  const Fragment = Symbol("Fragment");

  function instanceFor(path) {
    let instance = instances.get(path);
    if (instance === undefined) {
      instance = { hooks: [], effects: {}, cursor: 0 };
      instances.set(path, instance);
    }
    return instance;
  }

  function useState(initial) {
    const instance = active;
    const slot = (instance.hooks[instance.cursor] ??= {});
    instance.cursor += 1;
    if (!("value" in slot)) slot.value = typeof initial === "function" ? initial() : initial;
    return [
      slot.value,
      (next) => {
        slot.value = typeof next === "function" ? next(slot.value) : next;
      },
    ];
  }

  function useRef(initial) {
    const instance = active;
    const slot = (instance.hooks[instance.cursor] ??= {});
    instance.cursor += 1;
    if (!("ref" in slot)) slot.ref = { current: initial };
    return slot.ref;
  }

  function useEffect(fn, deps) {
    const instance = active;
    const index = instance.cursor;
    instance.cursor += 1;
    instance.effects[index] = { fn, deps };
  }

  function useMemo(produce) {
    active.cursor += 1;
    return produce();
  }

  function useCallback(fn) {
    active.cursor += 1;
    return fn;
  }

  const React = { Fragment, createElement, useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect: () => {} };

  function createElement(type, props, ...children) {
    const merged = { ...(props ?? {}) };
    if (children.length === 1) merged.children = children[0];
    else if (children.length > 1) merged.children = children;
    return { type, props: merged };
  }

  function visit(element, path) {
    if (element === null || element === undefined || element === false || element === true) return "";
    if (typeof element === "string" || typeof element === "number") return String(element);
    if (Array.isArray(element)) return element.map((child, index) => visit(child, `${path}[${index}]`)).join(" ");
    if (typeof element.type === "function") {
      const instance = instanceFor(path);
      instance.cursor = 0;
      instance.effects = {};
      nodes.push({ kind: "component", name: element.type.name, props: element.props, path });
      const previous = active;
      active = instance;
      let rendered;
      try {
        rendered = element.type(element.props ?? {});
      } finally {
        active = previous;
      }
      return visit(rendered, `${path}>`);
    }
    if (typeof element.type === "symbol") return visit(element.props?.children, path);
    if (typeof element.type === "string") {
      nodes.push({ kind: "host", tag: element.type, props: element.props, path });
      return visit(element.props?.children, `${path}.`);
    }
    return "";
  }

  async function flush() {
    for (let turn = 0; turn < 24; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  }

  async function paint() {
    let text = "";
    for (let pass = 0; pass < 12; pass += 1) {
      nodes.length = 0;
      text = visit(root, "root");
      const queued = [];
      for (const [path, instance] of instances) {
        for (const index of Object.keys(instance.effects)) {
          const key = `${path}#${index}`;
          const effect = instance.effects[index];
          if (effectDeps.has(key) && sameDeps(effectDeps.get(key), effect.deps)) continue;
          effectDeps.set(key, effect.deps);
          queued.push({ key, effect });
        }
      }
      if (queued.length === 0) return text;
      for (const item of queued) {
        const previous = cleanups.get(item.key);
        if (typeof previous === "function") previous();
        const cleanup = item.effect.fn();
        if (typeof cleanup === "function") cleanups.set(item.key, cleanup);
      }
      await flush();
    }
    return text;
  }

  return {
    React,
    async start(element) {
      root = element;
      return await paint();
    },
    async repaint() {
      return await paint();
    },
    nodes: () => nodes,
    components: (name) => nodes.filter((node) => node.kind === "component" && node.name === name),
    hosts: (tag) => nodes.filter((node) => node.kind === "host" && node.tag === tag),
  };
}

/** Evaluate the bundle with a given React and return its exports. */
function evaluate(React) {
  let definition;
  const window = {
    __ModuleLoader__: { load: (value) => { definition = value; } },
    localStorage: {
      store: new Map(),
      getItem(key) {
        return this.store.has(key) ? this.store.get(key) : null;
      },
      setItem(key, value) {
        this.store.set(key, String(value));
      },
    },
  };
  const require = (id) => {
    if (id === "react") return React;
    throw new Error(`the client required an unexpected module: ${id}`);
  };
  // eslint-disable-next-line no-new-func
  new Function("window", source)(window);
  assert.equal(typeof definition, "object", "the bundle must call window.__ModuleLoader__.load");
  return { definition, exports: definition.factory(require), window };
}

// ------------------------------------------------------------ loader contract

test("the bundle declares an id and a factory", () => {
  const { definition } = evaluate(createHarness().React);
  assert.equal(definition.id, "dsh-skill-manager");
  assert.equal(typeof definition.factory, "function");
});

test("the exports expose the cordis client surface", () => {
  const { exports } = evaluate(createHarness().React);
  assert.equal(typeof exports.apply, "function");
  assert.deepEqual(exports.inject, ["slots", "locale"]);
  assert.equal(exports.name, "dsh-skill-manager");
});

test("apply registers the sidebar row and the main panel under one id", () => {
  const { exports } = evaluate(createHarness().React);
  const registrations = [];
  const injected = [];
  exports.apply({
    slots: {
      inject(name, callback) {
        injected.push(name);
        callback();
        return () => {};
      },
      register(seat, component) {
        registrations.push({ seat, component });
        return () => {};
      },
    },
    effect: () => () => {},
    get: () => undefined,
  });
  assert.deepEqual(injected, ["sidebar.panellist", "main"]);
  assert.equal(registrations.length, 2);
  assert.equal(registrations[0].seat.id, "skill-manager");
  assert.equal(registrations[1].seat.key, "skill-manager", "the panel key must match the sidebar id");
  assert.equal(typeof registrations[1].seat.inject, "function");
  assert.equal(typeof registrations[1].seat.inject().api.selectPanel, "function");
});

test("a failing layout service does not break panel registration", () => {
  const { exports } = evaluate(createHarness().React);
  const registrations = [];
  exports.apply({
    slots: {
      inject: (_name, callback) => {
        callback();
        return () => {};
      },
      register: (seat, component) => {
        registrations.push({ seat, component });
        return () => {};
      },
    },
    effect: () => () => {},
    get: () => ({
      selectPanel: () => {
        throw new Error("no such panel");
      },
    }),
  });
  const api = registrations.find((entry) => entry.seat.name === "main").seat.inject().api;
  assert.doesNotThrow(() => api.selectPanel(null));
});

// -------------------------------------------------------------- dictionaries

function keysOf(blockName) {
  const match = new RegExp(`const ${blockName} = \\{([\\s\\S]*?)\\n {4}\\};`, "u").exec(source);
  assert.ok(match !== null, `${blockName} dictionary must be a top-level object literal`);
  return new Set([...match[1].matchAll(/^\s*"([^"]+)":/gmu)].map((entry) => entry[1]));
}

test("both dictionaries carry exactly the same keys", () => {
  const zh = keysOf("zh");
  const en = keysOf("en");
  assert.ok(zh.size > 40, `expected a populated dictionary, saw ${zh.size}`);
  assert.deepEqual([...zh].filter((key) => !en.has(key)), [], "English is missing keys");
  assert.deepEqual([...en].filter((key) => !zh.has(key)), [], "Chinese is missing keys");
});

test("every translation key used in the client exists in both dictionaries", () => {
  const zh = keysOf("zh");
  const en = keysOf("en");
  const used = new Set([...source.matchAll(/\bt\("([^"]+)"/gu)].map((match) => match[1]));
  assert.ok(used.size > 30, `expected the client to use many keys, saw ${used.size}`);
  assert.deepEqual([...used].filter((key) => !zh.has(key) || !en.has(key)), []);
});

// ------------------------------------------------------------ route contract

function clientApiRoutes() {
  const match = /const API = \{([\s\S]*?)\n {4}\};/u.exec(source);
  assert.ok(match !== null);
  return [...match[1].matchAll(/"(\w+)": "([^"]+)"/gu)].map((entry) => ({ name: entry[1], url: entry[2] }));
}

function hostRoutes() {
  const match = /const ROUTES = \{([\s\S]*?)\n\};/u.exec(hostSource);
  assert.ok(match !== null);
  return new Set([...match[1].matchAll(/(\w+): "([^"]+)"/gu)].map((entry) => entry[2]));
}

test("every client route exists on the host", () => {
  const declared = hostRoutes();
  assert.deepEqual(
    clientApiRoutes()
      .map((entry) => `/${entry.url}`)
      .filter((url) => !declared.has(url)),
    [],
  );
});

test("the client uses document-relative paths so a sub-path deploy still works", () => {
  for (const entry of clientApiRoutes()) {
    assert.equal(entry.url.startsWith("/"), false, `${entry.name} must not be root-absolute`);
    assert.equal(entry.url.startsWith("api/dsh-skill-manager/"), true, `${entry.name} must stay inside the route family`);
  }
});

// --------------------------------------------------------------- rendering

const listPayload = {
  cwd: "C:\\work",
  projectRoot: "C:\\work",
  targets: [
    { id: "user", label: "User (~/.dsh/skills)", path: "C:\\home\\skills", exists: true },
    { id: "project", label: "Project (.dsh/skills)", path: "C:\\work\\.dsh\\skills", exists: false },
  ],
  roots: [
    { source: "project-dsh", rank: 100, path: "C:\\work\\.dsh\\skills", exists: false, skillCount: 1 },
    { source: "user-dsh", rank: 400, path: "C:\\home\\skills", exists: true, skillCount: 2 },
  ],
  skills: [
    { name: "alpha-skill", description: "Alpha does things.", path: "C:\\work\\.dsh\\skills\\alpha-skill\\SKILL.md", root: "project-dsh", rank: 100, form: "directory", writable: true, symlink: false, modelInvocable: true, userInvocable: true, shadowed: false },
    { name: "beta-skill", description: "Beta does other things.", path: "C:\\home\\skills\\beta-skill\\SKILL.md", root: "user-dsh", rank: 400, form: "directory", writable: true, symlink: false, modelInvocable: false, userInvocable: true, shadowed: false },
    { name: "gamma-skill", description: "Gamma is bundled.", path: "C:\\home\\skills\\gamma-skill\\SKILL.md", root: "user-dsh", rank: 400, form: "directory", writable: false, symlink: true, modelInvocable: true, userInvocable: false, shadowed: true },
  ],
  complete: true,
  failures: [],
  trashRoot: "C:\\home\\skills\\.trash",
};

const marketPayload = {
  url: "https://example.invalid/skills.json",
  fetchedAt: Date.now(),
  cached: false,
  version: 1,
  skills: [
    { id: "acme/one#s", name: "alpha-skill", repo: "acme/one", path: "s", category: "docs", tags: ["writing"], description: { en: "Writes docs.", zh: "写文档。" }, installed: true },
    { id: "acme/two#s", name: "delta-skill", repo: "acme/two", path: "skills/delta", category: "tools", tags: [], description: { en: "Runs tools.", zh: "跑工具。" }, installed: false, stars: 12 },
  ],
};

/** Install a fetch stub covering the routes the panel touches. */
function stubFetch(overrides = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    for (const [suffix, payload] of Object.entries(overrides)) {
      if (String(url).includes(suffix)) return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).includes("dsh-skill-manager/list")) return new Response(JSON.stringify(listPayload), { status: 200 });
    if (String(url).includes("dsh-skill-manager/trash")) return new Response(JSON.stringify({ trashRoot: listPayload.trashRoot, items: [] }), { status: 200 });
    if (String(url).includes("dsh-skill-manager/market")) return new Response(JSON.stringify(marketPayload), { status: 200 });
    return new Response(JSON.stringify({ error: `unstubbed ${url}` }), { status: 404 });
  };
  return calls;
}

/** Boot the panel through the slot registration and render it. */
async function startPanel(overrides) {
  const calls = stubFetch(overrides);
  const harness = createHarness();
  const { exports } = evaluate(harness.React);
  let panel;
  exports.apply({
    slots: {
      inject: (_name, callback) => {
        callback();
        return () => {};
      },
      register: (seat, component) => {
        if (seat.name === "main") panel = component;
        return () => {};
      },
    },
    effect: () => () => {},
    get: () => undefined,
  });
  const text = await harness.start(harness.React.createElement(panel, { api: { selectPanel: () => {} } }));
  return { harness, text, calls };
}

test("the installed tab renders every skill, grouped by source", async () => {
  const { harness, text } = await startPanel();
  for (const name of ["alpha-skill", "beta-skill", "gamma-skill"]) assert.ok(text.includes(name), `missing ${name}`);
  assert.ok(text.includes("Alpha does things."));
  assert.ok(text.includes("项目 .dsh/skills"), "the project group label must appear");
  assert.ok(text.includes("用户 ~/.dsh/skills"), "the user group label must appear");
  assert.ok(text.includes("共 3 个技能"), "the count summary must reflect the payload");
  assert.equal(harness.components("SkillRow").length, 3);
});

test("a disabled skill renders its switch off, an enabled one on", async () => {
  const { harness } = await startPanel();
  const rows = harness.components("SkillRow").map((node) => node.props.skill);
  const beta = rows.find((skill) => skill.name === "beta-skill");
  const alpha = rows.find((skill) => skill.name === "alpha-skill");
  assert.equal(beta.modelInvocable, false);
  assert.equal(alpha.modelInvocable, true);
  const switches = harness.hosts("button").filter((node) => node.props.role === "switch");
  assert.equal(switches.length, 3);
  assert.equal(switches.filter((node) => "data-on" in node.props).length, 2, "two of three skills are model-invocable");
  assert.equal(switches.filter((node) => node.props.disabled === true).length, 1, "the read-only skill cannot be toggled");
});

test("read-only and linked skills are badged and their destructive actions disabled", async () => {
  const { harness, text } = await startPanel();
  assert.ok(text.includes("只读"), "a read-only badge is shown");
  assert.ok(text.includes("链接"), "a linked badge is shown");
  assert.ok(text.includes("被覆盖"), "a shadowed badge is shown");
  // Exactly one skill (gamma) is read-only and linked, so exactly one edit and one
  // delete control must be disabled across the whole tree.
  for (const label of ["编辑", "删除"]) {
    const buttons = harness.hosts("button").filter((node) => node.props.children === label);
    assert.equal(buttons.length, 3, `every row renders a ${label} control`);
    assert.equal(buttons.filter((node) => node.props.disabled === true).length, 1, `only the read-only row blocks ${label}`);
  }
});

test("the search box filters rendered rows", async () => {
  const { harness, text } = await startPanel();
  const search = harness.hosts("input").find((node) => node.props.className === "skm-search");
  assert.ok(search !== undefined, "the filter box must render");
  search.props.onChange({ target: { value: "beta" } });
  const after = await harness.repaint();
  assert.ok(after.includes("beta-skill"));
  assert.equal(after.includes("alpha-skill"), false);
  assert.equal(after.includes("gamma-skill"), false);
  assert.equal(harness.components("SkillRow").length, 1);
  assert.ok(text.includes("alpha-skill"), "the first pass is unaffected");
});

test("the source filter narrows the catalog", async () => {
  const { harness, text } = await startPanel();
  const select = harness.hosts("select").find((node) => node.props.value === "all" && node.props.className === "skm-select");
  select.props.onChange({ target: { value: "user-dsh" } });
  const after = await harness.repaint();
  assert.ok(after.includes("beta-skill"));
  assert.equal(after.includes("alpha-skill"), false);
  assert.ok(text.length > 0);
});

test("batching runs against the selection and reports the changed count", async () => {
  const { harness, calls } = await startPanel({
    "set-enabled-batch": { changed: 2, total: 2, results: [{ name: "alpha-skill", status: "ok" }, { name: "beta-skill", status: "ok" }] },
  });
  const selectAll = harness.hosts("button").find((node) => node.props.children === "全选");
  assert.ok(selectAll !== undefined, "the select-all control must render");
  assert.equal(selectAll.props.disabled, false, "two writable skills are selectable");
  selectAll.props.onClick();
  const after = await harness.repaint();
  assert.ok(after.includes("已选 2 个"), "the selection count must appear");

  // Opting into the stronger disable must travel with the request.
  const bothBox = harness.hosts("input").find((node) => node.props.type === "checkbox" && node.props.checked === false);
  assert.ok(bothBox !== undefined, "the both-controls checkbox must render");
  bothBox.props.onChange({ target: { checked: true } });
  await harness.repaint();

  const batch = harness.hosts("button").find((node) => node.props.children === "批量禁用");
  assert.equal(batch.props.disabled, false);
  await batch.props.onClick();
  const settled = await harness.repaint();
  assert.ok(settled.includes("2 个技能已禁用"), "the result notice must be shown");
  const sent = calls.find((call) => String(call.url).includes("set-enabled-batch"));
  assert.ok(sent !== undefined, "the batch route must be called");
  const body = JSON.parse(sent.init.body);
  assert.equal(body.enabled, false);
  assert.equal(body.both, true, "the stronger disable must reach the host");
  assert.deepEqual(body.items.map((item) => item.name).sort(), ["alpha-skill", "beta-skill"]);
});

test("the market tab lists registry entries and marks installed ones", async () => {
  const { harness, text } = await startPanel();
  const market = harness.hosts("button").find((node) => node.props.children === "市场");
  market.props.onClick();
  const after = await harness.repaint();
  assert.ok(after.includes("delta-skill"), "an uninstalled entry appears");
  assert.ok(after.includes("写文档。"), "the Chinese description is preferred");
  assert.ok(after.includes("已安装"), "an installed entry is badged");
  assert.ok(after.includes("★ 12"), "stars render when the registry provides them");
  assert.ok(text.includes("已安装"), "the tab bar label is also 已安装");
});

test("importing from a host path posts the path and shows the outcome", async () => {
  const { harness } = await startPanel({ "import-path": { sourcePath: "C:\\src", results: [{ name: "epsilon-skill", status: "installed", path: "C:\\home\\skills\\epsilon-skill" }] } });
  const importTab = harness.hosts("button").find((node) => node.props.children === "导入");
  importTab.props.onClick();
  await harness.repaint();
  const pathInput = harness.hosts("input").find((node) => typeof node.props.value === "string" && node.props.className === "skm-input");
  assert.ok(pathInput !== undefined, "the host path field must render");
  pathInput.props.onChange({ target: { value: "C:\\src" } });
  await harness.repaint();
  const go = harness.hosts("button").find((node) => node.props.children === "从主机路径导入");
  assert.equal(go.props.disabled, false, "the button enables once a path is typed");
  await go.props.onClick();
  const after = await harness.repaint();
  assert.ok(after.includes("epsilon-skill"), "the import outcome must be listed");
  assert.ok(after.includes("installed"));
});

test("creating a skill keeps the button disabled until the form is valid", async () => {
  const { harness } = await startPanel();
  const createTab = harness.hosts("button").find((node) => node.props.children === "新建");
  createTab.props.onClick();
  await harness.repaint();
  const submit = harness.hosts("button").find((node) => node.props.children === "创建技能");
  assert.equal(submit.props.disabled, true, "an empty form cannot submit");
  const inputs = harness.hosts("input").filter((node) => node.props.className === "skm-input");
  inputs[0].props.onChange({ target: { value: "Bad Name" } });
  await harness.repaint();
  assert.equal(harness.hosts("button").find((node) => node.props.children === "创建技能").props.disabled, true, "a non-kebab name is rejected");
  harness.hosts("input").filter((node) => node.props.className === "skm-input")[0].props.onChange({ target: { value: "good-name" } });
  await harness.repaint();
  const textarea = harness.hosts("textarea")[0];
  textarea.props.onChange({ target: { value: "Does something." } });
  await harness.repaint();
  assert.equal(harness.hosts("button").find((node) => node.props.children === "创建技能").props.disabled, false, "a valid form enables submit");
});

test("toggling one skill keeps the panel mounted, filter and all", async () => {
  const { harness } = await startPanel({
    "set-enabled": { name: "beta-skill", path: "C:\\home\\skills\\beta-skill\\SKILL.md", modelInvocable: true, userInvocable: true },
  });
  const search = harness.hosts("input").find((node) => node.props.className === "skm-search");
  search.props.onChange({ target: { value: "beta" } });
  await harness.repaint();
  assert.equal(harness.components("SkillRow").length, 1, "the filter narrowed the list");

  const target = harness.components("SkillRow")[0].props.skill;
  assert.equal(target.name, "beta-skill");
  await harness.components("SkillRow")[0].props.onToggle(target);
  const text = await harness.repaint();

  assert.equal(text.includes("加载中"), false, "a reload must not flash the loading screen");
  assert.equal(harness.components("SkillRow").length, 1, "the search filter survived the reload");
  assert.ok(text.includes("beta-skill"), "the skill is still listed after the toggle");
});

test("a failing list request surfaces the host error", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "boom" }), { status: 400 });
  const harness = createHarness();
  const { exports } = evaluate(harness.React);
  let panel;
  exports.apply({
    slots: {
      inject: (_name, callback) => {
        callback();
        return () => {};
      },
      register: (seat, component) => {
        if (seat.name === "main") panel = component;
        return () => {};
      },
    },
    effect: () => () => {},
    get: () => undefined,
  });
  const text = await harness.start(harness.React.createElement(panel, { api: { selectPanel: () => {} } }));
  assert.ok(text.includes("boom"), "the host message must reach the user");
});

test("going back asks the layout to select the Conversation", async () => {
  const selected = [];
  stubFetch();
  const harness = createHarness();
  const { exports } = evaluate(harness.React);
  let panel;
  exports.apply({
    slots: {
      inject: (_name, callback) => {
        callback();
        return () => {};
      },
      register: (seat, component) => {
        if (seat.name === "main") panel = component;
        return () => {};
      },
    },
    effect: () => () => {},
    get: (name) => (name === "layout" ? { selectPanel: (id) => selected.push(id) } : undefined),
  });
  await harness.start(harness.React.createElement(panel, { api: { selectPanel: (id) => selected.push(id) } }));
  const back = harness.hosts("button").find((node) => node.props.children === "返回会话");
  assert.ok(back !== undefined, "the back control must render");
  back.props.onClick();
  assert.deepEqual(selected, [null]);
});
