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

  /**
   * React flattens nested child arrays and drops holes before rendering. The
   * harness has to do the same or `h("select", p, option, list.map(...))` yields
   * a nested array that no caller can index the way React allows.
   */
  function flattenChildren(value, out = []) {
    if (Array.isArray(value)) {
      for (const child of value) flattenChildren(child, out);
      return out;
    }
    if (value === null || value === undefined || value === false || value === true) return out;
    out.push(value);
    return out;
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
      // Record host children flattened, the way React hands them to a host
      // component, so assertions can read `.props.children` as a list.
      const props = { ...element.props };
      if ("children" in props) {
        const flat = flattenChildren(props.children);
        props.children = flat.length === 1 ? flat[0] : flat;
      }
      nodes.push({ kind: "host", tag: element.type, props, path });
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

/**
 * Drive the locale the way the shell does, so a component that subscribed to
 * `ctx.locale` through `apply` observes the switch. A bundle evaluated without
 * `apply` has no subscription, in which case this is a no-op.
 */
let localeDriver;
function setClientLanguage(active) {
  if (localeDriver === undefined) return;
  localeDriver(active);
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

/** Build a locale service whose active language the test can change. */
function localeService() {
  const listeners = new Set();
  let active = "zh";
  localeDriver = (next) => {
    active = next === "en" ? "en" : "zh";
    for (const listener of listeners) listener();
  };
  return {
    register: () => () => {},
    snapshot: () => ({ active }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
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

test("the stylesheet is injected while the factory materializes", () => {
  // The module system claims <style> tags that appear during materialization and
  // tags them for its HMR bookkeeping, so the injection cannot be deferred to
  // apply(). A second materialization must not add a duplicate.
  const appended = [];
  let created;
  const original = globalThis.document;
  globalThis.document = {
    getElementById: () => created ?? null,
    createElement: () => {
      created = { id: undefined, textContent: "" };
      return created;
    },
    head: { appendChild: (node) => appended.push(node) },
  };
  try {
    evaluate(createHarness().React);
    assert.equal(appended.length, 1, "materialization injects exactly one stylesheet");
    assert.equal(appended[0].id, "dsh-skill-manager-style");
    assert.ok(appended[0].textContent.includes(".skm-panel"), "the stylesheet carries the panel rules");
    evaluate(createHarness().React);
    assert.equal(appended.length, 1, "a re-materialized bundle does not add a second copy");
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

test("apply tolerates a context without a locale service", () => {
  const { exports } = evaluate(createHarness().React);
  const registrations = [];
  assert.doesNotThrow(() =>
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
    }),
  );
  assert.equal(registrations.length, 2);
});

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
  version: 2,
  skills: [
    {
      id: "acme/one#skills/alpha/SKILL.md",
      name: "alpha-skill",
      repo: "acme/one",
      path: "skills/alpha/SKILL.md",
      ref: "main",
      category: "docs",
      tags: ["writing"],
      version: "2.15.0",
      license: "MIT",
      added: "2026-09-01",
      description: { en: "Writes docs.", zh: "写文档。" },
      installed: true,
      stars: 40,
    },
    {
      id: "acme/two#skills/delta/SKILL.md",
      name: "delta-skill",
      repo: "acme/two",
      path: "skills/delta/SKILL.md",
      ref: "main",
      category: "infra",
      tags: [],
      commit: "063bee9",
      added: "2026-08-28",
      description: { en: "Runs tools.", zh: "跑工具。" },
      installed: false,
      stars: 12,
    },
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
    effect: (fn) => {
      const cleanup = fn();
      return typeof cleanup === "function" ? cleanup : () => {};
    },
    get: () => undefined,
    locale: localeService(),
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

/** Open the market tab and return the repainted state. */
async function openMarket() {
  const started = await startPanel();
  const market = started.harness.hosts("button").find((node) => node.props.children === "市场");
  market.props.onClick();
  const text = await started.harness.repaint();
  return { ...started, text };
}

test("the market tab lists registry entries and marks installed ones", async () => {
  const { harness, text } = await openMarket();
  assert.ok(text.includes("delta-skill"), "an uninstalled entry appears");
  assert.ok(text.includes("写文档。"), "the Chinese description is preferred");
  assert.ok(text.includes("★ 12"), "stars render when the registry provides them");
  assert.equal(harness.components("MarketCard").length, 2);
});

test("every market card links to the repository it came from", async () => {
  const { harness } = await openMarket();
  const links = harness.hosts("a").map((node) => node.props.href);
  assert.ok(links.includes("https://github.com/acme/one"), "the repo link is present");
  assert.ok(links.includes("https://github.com/acme/two"));
  assert.ok(
    links.includes("https://github.com/acme/one/blob/main/skills/alpha/SKILL.md"),
    "a deep link to the exact SKILL.md is present",
  );
  // Every card carries at least one outward link; a card with no way to reach the
  // source project is the bug this guards.
  for (const card of harness.components("MarketCard")) {
    assert.ok(typeof card.props.entry.repo === "string" && card.props.entry.repo.includes("/"));
  }
});

test("a version badge is shown when upstream declares one, a commit when it does not", async () => {
  const { text } = await openMarket();
  assert.ok(text.includes("版本 v2.15.0"), "the real semver from the upstream release is shown");
  assert.ok(text.includes("提交 063bee9"), "an entry with no release shows the pinned commit instead of a fake version");
  assert.equal(text.includes("版本 063bee9"), false, "a commit must never be labelled as a version");
});

test("categories are rendered from the closed list, in the active language", async () => {
  const { harness, text } = await openMarket();
  assert.ok(text.includes("写作与文档"), "the docs category renders its Chinese label");
  assert.ok(text.includes("运维与部署"), "the infra category renders too");
  const select = harness.hosts("select").find((node) => node.props.className === "skm-select");
  assert.ok(select !== undefined, "the category filter renders");
  const options = Array.isArray(select.props.children) ? select.props.children : [select.props.children];
  assert.deepEqual(options.map((node) => node.props.value), ["all", "docs", "infra"]);
  assert.equal(options[0].props.children, "全部分类");
});

test("switching language re-renders the market in English", async () => {
  const { harness, text } = await openMarket();
  assert.ok(text.includes("全部分类"), "Chinese by default");
  setClientLanguage("en");
  const after = await harness.repaint();
  assert.ok(after.includes("All categories"), "the category placeholder follows the locale");
  assert.ok(after.includes("Writing & docs"), "category labels follow too");
  assert.ok(after.includes("★ 12"), "numbers survive the switch");
  setClientLanguage("zh");
  const back = await harness.repaint();
  assert.ok(back.includes("全部分类"), "and it switches back");
});

/** Find a filter-menu option by its visible label. */
function menuOption(harness, label) {
  return harness
    .hosts("button")
    .filter((node) => node.props.className === "skm-menuItem")
    .find((node) => {
      const parts = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
      return parts.some((part) => part?.props?.children === label);
    });
}

test("the category filter narrows the list", async () => {
  const { harness } = await openMarket();
  const select = harness.hosts("select").find((node) => node.props.className === "skm-select");
  select.props.onChange({ target: { value: "infra" } });
  const after = await harness.repaint();
  assert.ok(after.includes("delta-skill"));
  assert.equal(after.includes("alpha-skill"), false);
  assert.equal(harness.components("MarketCard").length, 1);
});

test("the filter menu carries sort field, direction and time range", async () => {
  const { harness, text } = await openMarket();
  assert.ok(text.includes("筛选"), "the filter control renders");
  const trigger = harness.hosts("button").find((node) => typeof node.props.children === "string" && node.props.children.startsWith("筛选"));
  trigger.props.onClick();
  const open = await harness.repaint();
  for (const label of ["排序字段", "排序方向", "发布时间范围", "Star 数", "收录时间", "名称", "降序", "升序", "全部时间", "最近 7 天", "最近 30 天", "最近 90 天", "最近 1 年"]) {
    assert.ok(open.includes(label), `the menu must offer ${label}`);
  }
});

test("choosing a sort direction reorders the cards", async () => {
  const { harness } = await openMarket();
  const names = () => harness.components("MarketCard").map((node) => node.props.entry.name);
  assert.deepEqual(names(), ["alpha-skill", "delta-skill"], "stars descending puts 40 before 12");
  const trigger = harness.hosts("button").find((node) => typeof node.props.children === "string" && node.props.children.startsWith("筛选"));
  trigger.props.onClick();
  await harness.repaint();
  const asc = menuOption(harness, "升序");
  assert.ok(asc !== undefined, "the ascending option is present");
  asc.props.onClick();
  await harness.repaint();
  assert.deepEqual(names(), ["delta-skill", "alpha-skill"], "ascending reverses the order");
});

test("the time range drops entries outside the window", async () => {
  const { harness } = await openMarket();
  const trigger = harness.hosts("button").find((node) => typeof node.props.children === "string" && node.props.children.startsWith("筛选"));
  trigger.props.onClick();
  await harness.repaint();
  const recent = menuOption(harness, "最近 7 天");
  assert.ok(recent !== undefined, "the 7-day option is present");
  recent.props.onClick();
  await harness.repaint();
  // Both fixtures were added months before the test runs, so a 7-day window
  // leaves nothing rather than silently ignoring the filter.
  assert.equal(harness.components("MarketCard").length, 0);
});

test("a sort field the catalog cannot answer says so instead of reordering", async () => {
  const started = await startPanel({
    market: { url: "https://example.invalid/s.json", version: 2, cached: false, skills: [{ id: "a/b#s", name: "no-stars", repo: "a/b", path: "s", category: "ui", description: { en: "No stars." }, installed: false }] },
  });
  const market = started.harness.hosts("button").find((node) => node.props.children === "市场");
  market.props.onClick();
  const text = await started.harness.repaint();
  assert.ok(text.includes("目录未提供 Star 数"), "the caveat is surfaced rather than faked");
});

test("the submission panel exposes a link and a copyable template", async () => {
  const { harness, text } = await openMarket();
  assert.ok(text.includes("申请收录 skill"), "the submission heading renders");
  assert.ok(text.includes("repo: owner/name"), "the entry template is shown");
  const links = harness.hosts("a").map((node) => node.props.href);
  assert.ok(links.includes("https://github.com/MyRemme/dsh-skill-manager/issues/new"), "the submission link points at the tracker");
  const openLink = harness.hosts("a").find((node) => node.props.children === "申请收录");
  assert.ok(openLink !== undefined, "the submit control is a real link, so middle-click and copy-link work");
  assert.equal(openLink.props.target, "_blank");
});

test("a rejected clipboard write is reported, not swallowed", async () => {
  const started = await startPanel();
  const market = started.harness.hosts("button").find((node) => node.props.children === "市场");
  market.props.onClick();
  await started.harness.repaint();
  const copy = started.harness.hosts("button").find((node) => node.props.children === "复制条目模板");
  assert.ok(copy !== undefined, "the copy control renders");
  await copy.props.onClick();
  // The harness provides no clipboard at all, which is the same failure shape as
  // a denied permission: it must be reported, not thrown.
  const text = await started.harness.repaint();
  assert.ok(text.includes("复制失败"), "the failure reaches the user");
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
