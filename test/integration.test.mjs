/**
 * Host-half integration tests.
 *
 * The unit suites exercise the modules; this one boots the *plugin*: it calls
 * `apply()` with a fake cordis context, serves the routes it registers over a
 * real `node:http` server, and drives them with real HTTP requests against real
 * files on disk. That covers the seams the unit tests cannot — request bodies,
 * methods, the access fence, status codes and the JSON shapes the browser half
 * actually consumes.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { apply } from "../lib/index.js";
import { makeTarGz, makeZip, skill } from "./helpers.mjs";

/** Boot the plugin over a real HTTP server and return its coordinates. */
async function boot({ config = {}, cwd } = {}) {
  const routes = new Map();
  const warnings = [];
  const ctx = {
    webServer: {
      register(entry) {
        routes.set(entry.path, entry.handler);
        return () => routes.delete(entry.path);
      },
    },
    effect(fn) {
      const cleanup = fn();
      return typeof cleanup === "function" ? cleanup : () => {};
    },
    get(name) {
      if (name === "sessions") return { list: () => [{ header: { cwd } }] };
      return undefined;
    },
    logger: { warn: (message) => warnings.push(String(message)) },
  };
  apply(ctx, config);
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const handler = routes.get(path);
    if (handler === undefined) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "no route" }));
      return;
    }
    handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/dsh-skill-manager`;
  return {
    port,
    base,
    warnings,
    routes,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function call(base, route, options = {}) {
  const query = options.query === undefined ? "" : `?${new URLSearchParams(options.query)}`;
  const init = { method: options.method ?? "GET", headers: {} };
  if (options.raw !== undefined) {
    init.body = options.raw;
    init.headers["content-type"] = options.contentType ?? "application/octet-stream";
  } else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers["content-type"] = "application/json";
  }
  const response = await fetch(`${base}/${route}${query}`, init);
  const text = await response.text();
  let payload;
  try {
    payload = text === "" ? {} : JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload };
}

/** A temporary harness home with a project and a couple of installed skills. */
async function scaffold() {
  const root = await mkdtemp(join(tmpdir(), "skill-manager-it-"));
  const dshHome = join(root, "home");
  const project = join(root, "project");
  const custom = join(root, "custom");
  await mkdir(join(dshHome, "skills", "alpha-skill"), { recursive: true });
  await mkdir(join(dshHome, "skills", "beta-skill"), { recursive: true });
  await mkdir(join(project, ".git"), { recursive: true });
  await mkdir(join(project, ".dsh", "skills", "project-skill"), { recursive: true });
  await mkdir(custom, { recursive: true });
  await writeFile(join(dshHome, "skills", "alpha-skill", "SKILL.md"), skill("alpha-skill", "Alpha."), "utf8");
  await writeFile(
    join(dshHome, "skills", "beta-skill", "SKILL.md"),
    ['---', "name: beta-skill", "description: Beta.", "metadata:", "  owner: someone", "---", "", "# Beta", ""].join("\n"),
    "utf8",
  );
  await writeFile(join(project, ".dsh", "skills", "project-skill", "SKILL.md"), skill("project-skill", "Project."), "utf8");
  const config = { dshHome, agentsHome: join(root, "agents"), customSkillDirs: [custom] };
  return { root, dshHome, project, custom, config, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("list reports the roots, targets and skills the panel renders", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const { status, payload } = await call(server.base, "list", { query: { cwd: scene.project } });
    assert.equal(status, 200);
    assert.equal(payload.cwd, scene.project);
    assert.deepEqual(
      payload.skills.map((record) => record.name).sort(),
      ["alpha-skill", "beta-skill", "project-skill"],
    );
    assert.deepEqual(
      payload.roots.map((root) => root.source),
      ["project-dsh", "project-agents", "custom:0", "user-dsh", "user-agents"],
    );
    assert.deepEqual(
      payload.targets.map((target) => target.id),
      ["user", "project", "custom:0"],
    );
    const userRoot = payload.roots.find((root) => root.source === "user-dsh");
    assert.equal(userRoot.skillCount, 2);
    assert.equal(userRoot.writable, true);
    assert.equal(payload.roots.find((root) => root.source === "user-agents").writable, false);
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("an unknown route is a 404 from the server, a wrong method a 405 from the plugin", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    assert.equal((await call(server.base, "nope")).status, 404);
    const method = await call(server.base, "list", { method: "POST", body: {} });
    assert.equal(method.status, 405);
    assert.match(method.payload.error, /method not allowed/u);
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("a LAN host without a pairing cookie is refused on every route", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const status = await new Promise((resolve, reject) => {
      // Host is overridden so the request looks like it arrived over the LAN while
      // the socket is still loopback.
      const request = httpRequest(
        { host: "127.0.0.1", port: server.port, path: "/api/dsh-skill-manager/list", method: "GET", setHost: false, headers: { Host: "192.168.1.22:9" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(status, 403);
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("access=lan admits a same-origin LAN caller", async () => {
  const scene = await scaffold();
  const server = await boot({ config: { ...scene.config, access: "lan" }, cwd: scene.project });
  try {
    const status = await new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: server.port,
          path: "/api/dsh-skill-manager/health",
          method: "GET",
          setHost: false,
          headers: { Host: "192.168.1.22:9", Origin: "http://192.168.1.22:9" },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(status, 200);
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("a single toggle rewrites the file and reports the new state", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const file = join(scene.dshHome, "skills", "alpha-skill", "SKILL.md");
    const off = await call(server.base, "set-enabled", {
      method: "POST",
      body: { name: "alpha-skill", path: file, enabled: false, cwd: scene.project },
    });
    assert.equal(off.status, 200);
    assert.equal(off.payload.modelInvocable, false);
    assert.match(await readFile(file, "utf8"), /^disable-model-invocation: true$/mu);

    const on = await call(server.base, "set-enabled", {
      method: "POST",
      body: { name: "alpha-skill", path: file, enabled: true, both: true, cwd: scene.project },
    });
    assert.equal(on.status, 200);
    assert.equal(on.payload.modelInvocable, true);
    assert.equal(on.payload.userInvocable, true);
    const text = await readFile(file, "utf8");
    assert.equal(text.includes("disable-model-invocation"), false, "enabling removes the key rather than writing false");
    assert.equal(text.includes("user-invocable"), false);
    assert.match(text, /description: Alpha\./u);
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("a toggle with a stale path is refused instead of writing elsewhere", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const wrong = join(scene.dshHome, "skills", "alpha-skill", "NOT-SKILL.md");
    const response = await call(server.base, "set-enabled", {
      method: "POST",
      body: { name: "alpha-skill", path: wrong, enabled: false, cwd: scene.project },
    });
    assert.equal(response.status, 404);
    assert.match(await readFile(join(scene.dshHome, "skills", "alpha-skill", "SKILL.md"), "utf8"), /description: Alpha\./u);
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("batch toggling reports a per-skill status and skips read-only roots", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const list = await call(server.base, "list", { query: { cwd: scene.project } });
    const items = list.payload.skills
      .filter((record) => ["alpha-skill", "beta-skill", "project-skill"].includes(record.name))
      .map((record) => ({ name: record.name, path: record.path }));
    items.push({ name: "ghost", path: join(scene.root, "ghost", "SKILL.md") });

    const response = await call(server.base, "set-enabled-batch", {
      method: "POST",
      body: { items, enabled: false, both: true, cwd: scene.project },
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.changed, 3);
    assert.equal(response.payload.results.find((result) => result.name === "ghost").status, "missing");

    for (const name of ["alpha-skill", "beta-skill"]) {
      const text = await readFile(join(scene.dshHome, "skills", name, "SKILL.md"), "utf8");
      assert.match(text, /^disable-model-invocation: true$/mu, name);
      assert.match(text, /^user-invocable: false$/mu, name);
    }
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("read then write round-trips a skill without disturbing unknown frontmatter", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const file = join(scene.dshHome, "skills", "beta-skill", "SKILL.md");
    const read = await call(server.base, "read", { query: { name: "beta-skill", path: file, cwd: scene.project } });
    assert.equal(read.status, 200);
    assert.equal(read.payload.description, "Beta.");
    assert.equal(read.payload.content, "# Beta");
    assert.equal(read.payload.readOnly, false);
    assert.equal(read.payload.symlink, false);

    const write = await call(server.base, "write", {
      method: "POST",
      body: { name: "beta-skill", path: file, description: "Beta, revised: with a colon.", whenToUse: "When beta.", content: "# Beta\n\nNew body.", cwd: scene.project },
    });
    assert.equal(write.status, 200);
    const text = await readFile(file, "utf8");
    assert.match(text, /^description: "Beta, revised: with a colon\."$/mu);
    assert.match(text, /^metadata:$/mu, "an unknown key survives the edit");
    assert.match(text, /^ {2}owner: someone$/mu);
    assert.match(text, /New body\./u);

    const again = await call(server.base, "read", { query: { name: "beta-skill", path: file, cwd: scene.project } });
    assert.equal(again.payload.description, "Beta, revised: with a colon.");
    assert.equal(again.payload.whenToUse, "When beta.");
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("creating a skill makes it visible to the next list", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const created = await call(server.base, "create", {
      method: "POST",
      body: { name: "made-up", description: "Made up on the spot.", target: "user", content: "# Made", cwd: scene.project },
    });
    assert.equal(created.status, 200);
    const file = join(scene.dshHome, "skills", "made-up", "SKILL.md");
    assert.equal(existsSync(file), true);
    const text = await readFile(file, "utf8");
    assert.match(text, /^name: made-up$/mu);
    assert.match(text, /# Made/u);

    const duplicate = await call(server.base, "create", {
      method: "POST",
      body: { name: "made-up", description: "Again.", target: "user", cwd: scene.project },
    });
    assert.equal(duplicate.status, 409);

    const bad = await call(server.base, "create", {
      method: "POST",
      body: { name: "Not Kebab", description: "Nope.", target: "user", cwd: scene.project },
    });
    assert.equal(bad.status, 400);

    const list = await call(server.base, "list", { query: { cwd: scene.project } });
    assert.ok(list.payload.skills.some((record) => record.name === "made-up"));
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("removing a skill is reversible through the trash", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const file = join(scene.dshHome, "skills", "alpha-skill", "SKILL.md");
    const removed = await call(server.base, "remove", { method: "POST", body: { name: "alpha-skill", path: file, cwd: scene.project } });
    assert.equal(removed.status, 200);
    assert.equal(existsSync(join(scene.dshHome, "skills", "alpha-skill")), false);

    const trash = await call(server.base, "trash");
    assert.equal(trash.status, 200);
    assert.equal(trash.payload.items.length, 1);
    assert.equal(trash.payload.items[0].name, "alpha-skill");

    const restored = await call(server.base, "restore", {
      method: "POST",
      body: { entry: trash.payload.items[0].entry, target: "user", cwd: scene.project },
    });
    assert.equal(restored.status, 200);
    assert.match(await readFile(join(scene.dshHome, "skills", "alpha-skill", "SKILL.md"), "utf8"), /name: alpha-skill/u);

    const traversal = await call(server.base, "restore", { method: "POST", body: { entry: "../escape", cwd: scene.project } });
    assert.equal(traversal.status, 400);
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("importing a ZIP installs every skill it carries", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const archive = makeZip([
      { path: "pack/zip-one/SKILL.md", data: skill("zip-one") },
      { path: "pack/zip-one/scripts/run.sh", data: "#!/bin/sh\n" },
      { path: "pack/zip-two/SKILL.md", data: skill("zip-two") },
    ]);
    const response = await call(server.base, "import-zip", {
      method: "POST",
      raw: archive,
      contentType: "application/zip",
      query: { target: "user", overwrite: "skip", cwd: scene.project },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(
      response.payload.results.map((result) => `${result.name}:${result.status}`).sort(),
      ["zip-one:installed", "zip-two:installed"],
    );
    assert.equal(await readFile(join(scene.dshHome, "skills", "zip-one", "scripts", "run.sh"), "utf8"), "#!/bin/sh\n");

    // A second import of the same archive skips rather than clobbering.
    const again = await call(server.base, "import-zip", {
      method: "POST",
      raw: archive,
      contentType: "application/zip",
      query: { target: "user", overwrite: "skip", cwd: scene.project },
    });
    assert.deepEqual(again.payload.results.map((result) => result.status), ["skipped", "skipped"]);

    // With overwrite=trash the old copy becomes recoverable.
    const replace = await call(server.base, "import-zip", {
      method: "POST",
      raw: archive,
      contentType: "application/zip",
      query: { target: "user", overwrite: "trash", cwd: scene.project },
    });
    assert.deepEqual(replace.payload.results.map((result) => result.status), ["installed", "installed"]);
    const trash = await call(server.base, "trash");
    assert.equal(trash.payload.items.filter((item) => item.name === "zip-one").length, 1);
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("importing a hostile ZIP is refused without touching the root", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const archive = makeZip([{ path: "../escape/SKILL.md", data: skill("escape") }]);
    const response = await call(server.base, "import-zip", {
      method: "POST",
      raw: archive,
      contentType: "application/zip",
      query: { target: "user", cwd: scene.project },
    });
    assert.equal(response.status, 400);
    assert.equal(existsSync(join(scene.root, "escape")), false);
    assert.equal(existsSync(join(scene.dshHome, "escape")), false);
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("importing base64 uploads works for a folder the browser read", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const files = [
      { path: "picked/uploaded-skill/SKILL.md", data: Buffer.from(skill("uploaded-skill")).toString("base64") },
      { path: "picked/uploaded-skill/notes.txt", data: Buffer.from("hello").toString("base64") },
    ];
    const response = await call(server.base, "import-files", {
      method: "POST",
      body: { files, target: "user", overwrite: "skip", cwd: scene.project },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.payload.results.map((result) => `${result.name}:${result.status}`), ["uploaded-skill:installed"]);
    assert.equal(await readFile(join(scene.dshHome, "skills", "uploaded-skill", "notes.txt"), "utf8"), "hello");
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("importing from a host path reads a directory the harness can reach", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const source = join(scene.root, "source", "host-skill");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "SKILL.md"), skill("host-skill"), "utf8");

    const response = await call(server.base, "import-path", {
      method: "POST",
      body: { sourcePath: join(scene.root, "source"), target: "project", overwrite: "skip", cwd: scene.project },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.payload.results.map((result) => result.status), ["installed"]);
    assert.equal(existsSync(join(scene.project, ".dsh", "skills", "host-skill", "SKILL.md")), true);
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("the market browses a catalog and installs an entry from a repository tarball", async () => {
  const scene = await scaffold();
  const catalog = {
    version: 1,
    skills: [
      { id: "acme/widgets#skills/market-skill/SKILL.md", name: "market-skill", repo: "acme/widgets", path: "skills/market-skill/SKILL.md", ref: "main", description: { en: "From the market." } },
    ],
  };
  const registry = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(catalog));
  });
  await new Promise((resolve) => registry.listen(0, "127.0.0.1", resolve));
  const registryUrl = `http://127.0.0.1:${registry.address().port}/skills.json`;

  const tarball = makeTarGz([
    { path: "widgets-main/skills/market-skill/SKILL.md", data: skill("market-skill") },
    { path: "widgets-main/skills/market-skill/data/table.csv", data: "a,b\n" },
    { path: "widgets-main/README.md", data: "# widgets\n" },
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://codeload.github.com/")) {
      return new Response(tarball, { status: 200 });
    }
    return await originalFetch(url, init);
  };

  const server = await boot({ config: { ...scene.config, registryUrl }, cwd: scene.project });
  try {
    const browse = await call(server.base, "market", { query: { cwd: scene.project, refresh: "1" } });
    assert.equal(browse.status, 200);
    assert.equal(browse.payload.skills.length, 1);
    assert.equal(browse.payload.skills[0].installed, false);

    const install = await call(server.base, "market-install", {
      method: "POST",
      body: { id: catalog.skills[0].id, target: "user", overwrite: "skip", cwd: scene.project },
    });
    assert.equal(install.status, 200);
    assert.deepEqual(install.payload.results.map((result) => result.status), ["installed"]);
    assert.match(await readFile(join(scene.dshHome, "skills", "market-skill", "SKILL.md"), "utf8"), /name: market-skill/u);
    assert.equal(await readFile(join(scene.dshHome, "skills", "market-skill", "data", "table.csv"), "utf8"), "a,b\n");
    assert.equal(existsSync(join(scene.dshHome, "skills", "market-skill", "README.md")), false, "files outside the skill directory are not installed");

    const after = await call(server.base, "market", { query: { cwd: scene.project } });
    assert.equal(after.payload.skills[0].installed, true);

    const unknown = await call(server.base, "market-install", { method: "POST", body: { id: "not-in-the-catalog", cwd: scene.project } });
    assert.equal(unknown.status, 404);
  } finally {
    await server.close();
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => registry.close(resolve));
    await scene.cleanup();
  }
});

test("an unreachable registry is reported as a bad gateway, not a crash", async () => {
  const scene = await scaffold();
  const server = await boot({ config: { ...scene.config, registryUrl: "http://127.0.0.1:1/skills.json" }, cwd: scene.project });
  try {
    const response = await call(server.base, "market", { query: { cwd: scene.project, refresh: "1" } });
    assert.equal(response.status, 502);
    assert.match(response.payload.error, /cannot reach the skill registry/u);
    assert.ok(server.warnings.some((warning) => warning.includes("skill-manager")) === false, "a handled market failure is not logged as a defect");
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("a registry URL with a non-http scheme is refused", async () => {
  const scene = await scaffold();
  const server = await boot({ config: { ...scene.config, registryUrl: "file:///etc/passwd" }, cwd: scene.project });
  try {
    const response = await call(server.base, "market", { query: { refresh: "1" } });
    assert.equal(response.status, 502);
    assert.match(response.payload.error, /invalid registry URL/u);
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("about reports the installed version without a network check", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const response = await call(server.base, "about");
    assert.equal(response.status, 200);
    assert.equal(response.payload.name, "skill-manager");
    assert.match(response.payload.version, /^\d+\.\d+\.\d+/u, "the version comes from the shipped manifest");
    assert.equal(response.payload.repo, "MyRemme/dsh-skill-manager");
    assert.equal(response.payload.repoUrl, "https://github.com/MyRemme/dsh-skill-manager");
    assert.equal(response.payload.submitUrl, "https://github.com/MyRemme/dsh-skill-manager/issues/new");
    assert.equal(response.payload.entriesUrl, "https://github.com/MyRemme/dsh-skill-manager/tree/main/registry/data/skills");
    assert.equal(response.payload.update.status, "unchecked", "no check is made unless asked");
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("about withholds the entries link when the catalog is not this repository's", async () => {
  const scene = await scaffold();
  const server = await boot({ config: { ...scene.config, registryUrl: "https://raw.example.invalid/skills.json" }, cwd: scene.project });
  try {
    const response = await call(server.base, "about");
    assert.equal(response.status, 200);
    assert.equal(response.payload.entriesUrl, null, "there is no page in this repo for a foreign catalog");
    assert.equal(response.payload.registryUrl, "https://raw.example.invalid/skills.json", "but the source is reported");
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("about reports a newer version when the remote manifest is ahead", async () => {
  const scene = await scaffold();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.github.com/repos/MyRemme/dsh-skill-manager")) {
      const body = JSON.stringify({ name: "dsh-skill-manager", version: "99.0.0" });
      return new Response(JSON.stringify({ content: Buffer.from(body, "utf8").toString("base64"), size: body.length }), { status: 200 });
    }
    return await originalFetch(url, init);
  };
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const response = await call(server.base, "about", { query: { check: "1" } });
    assert.equal(response.status, 200);
    assert.equal(response.payload.update.status, "behind");
    assert.equal(response.payload.update.latest, "99.0.0");
    assert.notEqual(response.payload.update.current, "99.0.0");
  } finally {
    await server.close();
    globalThis.fetch = originalFetch;
    await scene.cleanup();
  }
});

test("about survives an unreachable update source and says so", async () => {
  const scene = await scaffold();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.github.com")) throw new Error("read ECONNRESET");
    return await originalFetch(url, init);
  };
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const response = await call(server.base, "about", { query: { check: "1" } });
    assert.equal(response.status, 200, "a failed check is still a successful read");
    assert.equal(response.payload.update.status, "unknown");
    assert.match(String(response.payload.update.error), /cannot reach/u);
    assert.match(response.payload.version, /^\d+\.\d+\.\d+/u, "the local version is still reported");
  } finally {
    await server.close();
    globalThis.fetch = originalFetch;
    await scene.cleanup();
  }
});

test("health reports the resolved access mode and catalog", async () => {
  const scene = await scaffold();
  const server = await boot({ config: { ...scene.config, access: "loopback", registryUrl: "https://example.invalid/skills.json" }, cwd: scene.project });
  try {
    const response = await call(server.base, "health");
    assert.equal(response.status, 200);
    assert.deepEqual(response.payload, {
      ok: true,
      name: "skill-manager",
      access: "loopback",
      registryUrl: "https://example.invalid/skills.json",
    });
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("a malformed JSON body is a 400 with a usable message", async () => {
  const scene = await scaffold();
  const server = await boot({ config: scene.config, cwd: scene.project });
  try {
    const response = await call(server.base, "set-enabled", { method: "POST", raw: "{not json", contentType: "application/json" });
    assert.equal(response.status, 400);
    assert.match(response.payload.error, /invalid JSON body/u);
  } finally {
    await server.close();
    await scene.cleanup();
  }
});

test("an oversized body is a 413 rather than a truncated write", async () => {
  const scene = await scaffold();
  const server = await boot({ config: { ...scene.config, maxUploadBytes: 512 }, cwd: scene.project });
  try {
    const response = await call(server.base, "import-zip", {
      method: "POST",
      raw: Buffer.alloc(4096, 7),
      contentType: "application/zip",
      query: { target: "user", cwd: scene.project },
    });
    assert.equal(response.status, 413);
    assert.match(response.payload.error, /exceeds/u);
  } finally {
    await server.close();
    await scene.cleanup();
  }
});
