/**
 * dsh-skill-manager — host half.
 *
 * Mounts the `/api/dsh-skill-manager` route family over the shared web server:
 * skill discovery grouped by source root, per-skill and batch enable/disable,
 * authoring, reversible removal, folder / ZIP / server-path import, and a
 * PR-fed skill market.
 *
 * The browser half lives in `./client` and talks to these routes over
 * same-origin fetch; the access fence in `./guard` decides who may enter.
 *
 * @module dsh-skill-manager
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  applyEnabled,
  locateFrontmatter,
  renderSkillFile,
  setField,
  splitBody,
  yamlScalar,
} from "./frontmatter.js";
import { isAllowed } from "./guard.js";
import { installFromDirectory, installFromUploads, installFromZip } from "./install.js";
import { DEFAULT_REGISTRY_URL, MarketError, fetchCatalog, installFromMarket } from "./market.js";
import { REPO, REPO_URL, SUBMIT_URL, compare, fetchLatestVersion } from "./update.js";
import {
  TRASH_DIR,
  assertInside,
  discoverSkills,
  findProjectRoot,
  isSkillName,
  listTrash,
  resolveRoots,
  resolveTargetPath,
  resolveTargets,
  restoreTrash,
  trashFileSkill,
  trashSkill,
  writeSkillFile,
} from "./roots.js";

/** Stable cordis plugin name. */
export const name = "skill-manager";

/** Services required before the routes can mount. */
export const inject = ["webServer"];

const ROUTES = {
  list: "/api/dsh-skill-manager/list",
  read: "/api/dsh-skill-manager/read",
  setEnabled: "/api/dsh-skill-manager/set-enabled",
  setEnabledBatch: "/api/dsh-skill-manager/set-enabled-batch",
  write: "/api/dsh-skill-manager/write",
  create: "/api/dsh-skill-manager/create",
  remove: "/api/dsh-skill-manager/remove",
  trash: "/api/dsh-skill-manager/trash",
  restore: "/api/dsh-skill-manager/restore",
  importZip: "/api/dsh-skill-manager/import-zip",
  importFiles: "/api/dsh-skill-manager/import-files",
  importPath: "/api/dsh-skill-manager/import-path",
  market: "/api/dsh-skill-manager/market",
  marketInstall: "/api/dsh-skill-manager/market-install",
  about: "/api/dsh-skill-manager/about",
  health: "/api/dsh-skill-manager/health",
};

const MiB = 1024 * 1024;

/** Raised when a request body exceeds its cap. */
class BodyTooLargeError extends Error {}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readBody(request, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw new BodyTooLargeError(`request body exceeds ${limit} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request, limit) {
  const raw = await readBody(request, limit);
  if (raw.length === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new Error(`invalid JSON body: ${String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected a JSON object body");
  }
  return parsed;
}

function queryParam(request, key) {
  return new URL(request.url ?? "/", "http://localhost").searchParams.get(key) ?? undefined;
}

function stringParam(value, fallback) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

/** Read a skill file, returning undefined instead of throwing. */
async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Collapse a multi-line value into one YAML-safe scalar. */
function line(value) {
  return yamlScalar(String(value).replace(/\s*\r?\n\s*/gu, " ").trim());
}

/**
 * Read this package's own version.
 *
 * Resolved from the module's own location rather than from a build-time constant,
 * so an installed copy reports what is actually on disk. A packaged deployment
 * that cannot see its manifest reports `unknown` instead of guessing.
 *
 * @returns the version string, or undefined when it cannot be read.
 */
function readOwnVersion() {
  try {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof manifest.version === "string" && manifest.version !== "" ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the route table.
 * @param ctx - host plugin context.
 * @param config - resolved configuration.
 * @returns route descriptors for `ctx.webServer.register`.
 */
function makeRoutes(ctx, config) {
  const cache = new Map();
  const archiveLimits = {
    maxEntries: config.maxEntries,
    maxTotalBytes: config.maxExtractBytes,
    maxFileBytes: config.maxFileBytes,
    maxSkills: config.maxSkills,
  };

  const sessionCwds = () => {
    try {
      const sessions = typeof ctx.get === "function" ? ctx.get("sessions", false) : undefined;
      if (sessions === undefined || typeof sessions.list !== "function") return [];
      return sessions
        .list()
        .map((session) => session?.header?.cwd)
        .filter((cwd) => typeof cwd === "string" && cwd !== "");
    } catch {
      return [];
    }
  };

  const defaultCwd = () => sessionCwds()[0] ?? process.cwd();
  const cwdOf = (request, body) => stringParam(body?.cwd, queryParam(request, "cwd") ?? defaultCwd());
  const trashRoot = () => join(config.dshHome, "skills", TRASH_DIR);

  /** Re-scan and return the skill whose name and path both still match. */
  const resolveScanned = async (cwd, skillName, expectedPath) => {
    const { skills } = await discoverSkills(resolveRoots({ ...config, cwd }));
    return skills.find((candidate) => candidate.name === skillName && candidate.path === expectedPath);
  };

  const snapshot = async (cwd) => {
    const roots = resolveRoots({ ...config, cwd });
    const { skills, complete, failures } = await discoverSkills(roots);
    const counts = new Map();
    for (const skill of skills) counts.set(skill.root, (counts.get(skill.root) ?? 0) + 1);
    return {
      cwd,
      projectRoot: findProjectRoot(cwd),
      targets: resolveTargets(config, cwd).map((target) => ({ ...target, exists: existsSync(target.path) })),
      roots: roots.map((root) => ({ ...root, exists: existsSync(root.path), skillCount: counts.get(root.source) ?? 0 })),
      skills,
      complete,
      failures,
      trashRoot: trashRoot(),
    };
  };

  const route = (path, method, handler) => ({
    kind: "exact",
    path,
    handler: async (request, response) => {
      if (!isAllowed(ctx, request, config.access)) {
        sendJson(response, 403, { error: "forbidden: this client is not allowed to manage skills" });
        return;
      }
      if (request.method !== method) {
        sendJson(response, 405, { error: `method not allowed: ${request.method}` });
        return;
      }
      try {
        await handler(request, response);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          sendJson(response, 413, { error: error.message });
          return;
        }
        if (error instanceof MarketError) {
          sendJson(response, 502, { error: error.message });
          return;
        }
        ctx.logger?.warn?.(`skill-manager: ${String(error)}`);
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    },
  });

  /** Load a skill the client claims exists, enforcing the write permissions. */
  const loadWritable = async (request, response, body, { allowSymlink = false } = {}) => {
    const cwd = cwdOf(request, body);
    if (!isSkillName(body.name) || typeof body.path !== "string") {
      sendJson(response, 400, { error: "expected { name, path }" });
      return undefined;
    }
    const skill = await resolveScanned(cwd, body.name, body.path);
    if (skill === undefined) {
      sendJson(response, 404, { error: `${body.name} is not installed at that path; refresh and retry` });
      return undefined;
    }
    if (skill.writable !== true) {
      sendJson(response, 403, { error: `${skill.root} is not writable by the manager` });
      return undefined;
    }
    if (skill.symlink === true && !allowSymlink) {
      sendJson(response, 400, { error: "linked skills cannot be edited or removed in place" });
      return undefined;
    }
    const raw = await readText(skill.path);
    if (raw === undefined) {
      sendJson(response, 500, { error: `cannot read ${skill.path}` });
      return undefined;
    }
    return { skill, raw, cwd };
  };

  return [
    route(ROUTES.health, "GET", async (_request, response) => {
      sendJson(response, 200, { ok: true, name, access: config.access, registryUrl: config.registryUrl });
    }),

    route(ROUTES.about, "GET", async (request, response) => {
      const current = readOwnVersion();
      const check = queryParam(request, "check") === "1";
      const payload = {
        name,
        version: current ?? null,
        repo: REPO,
        repoUrl: REPO_URL,
        submitUrl: SUBMIT_URL,
        registryUrl: config.registryUrl,
        access: config.access,
        ...(check ? {} : { update: { status: "unchecked" } }),
      };
      if (!check) {
        sendJson(response, 200, payload);
        return;
      }
      // The lookup is best-effort: being offline, rate limited or pointed at a
      // moved repository must not make the About panel fail. It reports what it
      // could not learn instead.
      try {
        const latest = await fetchLatestVersion({ url: config.updateUrl });
        sendJson(response, 200, { ...payload, update: { ...compare(current, latest.version), latestRef: latest.ref, latestUrl: latest.url } });
      } catch (error) {
        sendJson(response, 200, { ...payload, update: { status: "unknown", current: current ?? null, error: error instanceof Error ? error.message : String(error) } });
      }
    }),

    route(ROUTES.list, "GET", async (request, response) => {
      sendJson(response, 200, await snapshot(cwdOf(request, undefined)));
    }),

    route(ROUTES.read, "GET", async (request, response) => {
      const cwd = queryParam(request, "cwd") ?? defaultCwd();
      const skillName = queryParam(request, "name");
      const path = queryParam(request, "path");
      if (typeof path !== "string" || !isSkillName(skillName)) {
        sendJson(response, 400, { error: "expected ?name=<kebab-case>&path=<absolute SKILL.md>" });
        return;
      }
      const skill = await resolveScanned(cwd, skillName, path);
      if (skill === undefined) {
        sendJson(response, 404, { error: `${skillName} is not installed at that path` });
        return;
      }
      const raw = (await readText(skill.path)) ?? "";
      sendJson(response, 200, {
        name: skill.name,
        path: skill.path,
        description: skill.description,
        ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
        content: splitBody(raw).trim(),
        readOnly: skill.writable !== true,
        symlink: skill.symlink === true,
        form: skill.form,
      });
    }),

    route(ROUTES.setEnabled, "POST", async (request, response) => {
      const body = await readJson(request, MiB);
      const loaded = await loadWritable(request, response, body, { allowSymlink: true });
      if (loaded === undefined) return;
      const { skill, raw, cwd } = loaded;
      if (typeof body.enabled !== "boolean") {
        sendJson(response, 400, { error: "expected { name, path, enabled }" });
        return;
      }
      await writeSkillFile(skill.path, applyEnabled(raw, body.enabled, { both: body.both === true }));
      const updated = await resolveScanned(cwd, skill.name, skill.path);
      sendJson(response, 200, {
        name: skill.name,
        path: skill.path,
        modelInvocable: updated?.modelInvocable ?? body.enabled,
        userInvocable: updated?.userInvocable ?? true,
      });
    }),

    route(ROUTES.setEnabledBatch, "POST", async (request, response) => {
      const body = await readJson(request, 4 * MiB);
      if (typeof body.enabled !== "boolean" || !Array.isArray(body.items)) {
        sendJson(response, 400, { error: "expected { items: [{ name, path }], enabled }" });
        return;
      }
      const cwd = cwdOf(request, body);
      const { skills } = await discoverSkills(resolveRoots({ ...config, cwd }));
      const index = new Map(skills.map((skill) => [`${skill.name}\u0000${skill.path}`, skill]));
      const results = [];
      for (const item of body.items) {
        const skill = index.get(`${item?.name}\u0000${item?.path}`);
        if (skill === undefined) {
          results.push({ name: item?.name, status: "missing" });
          continue;
        }
        if (skill.writable !== true) {
          results.push({ name: skill.name, status: "read-only", root: skill.root });
          continue;
        }
        try {
          const raw = await readText(skill.path);
          if (raw === undefined) {
            results.push({ name: skill.name, status: "failed", reason: "unreadable" });
            continue;
          }
          await writeSkillFile(skill.path, applyEnabled(raw, body.enabled, { both: body.both === true }));
          results.push({ name: skill.name, status: "ok" });
        } catch (error) {
          results.push({ name: skill.name, status: "failed", reason: String(error) });
        }
      }
      sendJson(response, 200, {
        changed: results.filter((result) => result.status === "ok").length,
        total: results.length,
        results,
      });
    }),

    route(ROUTES.write, "POST", async (request, response) => {
      const body = await readJson(request, 8 * MiB);
      if (typeof body.description !== "string" || body.description.trim() === "") {
        sendJson(response, 400, { error: "description is required" });
        return;
      }
      const loaded = await loadWritable(request, response, body);
      if (loaded === undefined) return;
      const { skill, raw } = loaded;
      let next = setField(raw, "description", line(body.description));
      const whenToUse = typeof body.whenToUse === "string" ? body.whenToUse.trim() : "";
      next = setField(next, "whenToUse", whenToUse === "" ? undefined : line(whenToUse));
      if (typeof body.content === "string") {
        const block = locateFrontmatter(next);
        const head = block === undefined ? `---\nname: ${line(skill.name)}\n---\n` : next.slice(0, block.end);
        const text = body.content.replace(/\r\n/gu, "\n").trim();
        next = `${head}\n${text}\n`;
      }
      await writeSkillFile(skill.path, next);
      sendJson(response, 200, { name: skill.name, path: skill.path });
    }),

    route(ROUTES.create, "POST", async (request, response) => {
      const body = await readJson(request, 8 * MiB);
      if (!isSkillName(body.name)) {
        sendJson(response, 400, { error: "name must be kebab-case: lowercase letters and digits joined by single hyphens" });
        return;
      }
      if (typeof body.description !== "string" || body.description.trim() === "") {
        sendJson(response, 400, { error: "description is required" });
        return;
      }
      const cwd = cwdOf(request, body);
      const destination = resolveTargetPath(config, cwd, body.target ?? "user");
      const skillDir = assertInside(destination, join(destination, body.name));
      if (existsSync(skillDir) && body.overwrite !== true) {
        sendJson(response, 409, { error: `${body.name} already exists in ${destination}` });
        return;
      }
      const file = join(skillDir, "SKILL.md");
      await writeSkillFile(
        file,
        renderSkillFile({
          name: body.name,
          description: body.description,
          whenToUse: typeof body.whenToUse === "string" ? body.whenToUse : undefined,
          content: typeof body.content === "string" ? body.content : undefined,
          modelInvocable: body.modelInvocable === false ? false : undefined,
          userInvocable: body.userInvocable === false ? false : undefined,
        }),
      );
      sendJson(response, 200, { name: body.name, path: file, target: body.target ?? "user" });
    }),

    route(ROUTES.remove, "POST", async (request, response) => {
      const body = await readJson(request, MiB);
      const loaded = await loadWritable(request, response, body);
      if (loaded === undefined) return;
      const { skill } = loaded;
      const moved = skill.form === "directory" ? await trashSkill(skill, trashRoot()) : await trashFileSkill(skill, trashRoot());
      sendJson(response, 200, { name: skill.name, trashPath: moved });
    }),

    route(ROUTES.trash, "GET", async (_request, response) => {
      sendJson(response, 200, { trashRoot: trashRoot(), items: await listTrash(trashRoot()) });
    }),

    route(ROUTES.restore, "POST", async (request, response) => {
      const body = await readJson(request, MiB);
      if (typeof body.entry !== "string" || /[/\\]/u.test(body.entry) || body.entry.includes("..")) {
        sendJson(response, 400, { error: "expected { entry: <trash entry name> }" });
        return;
      }
      const cwd = cwdOf(request, body);
      const item = (await listTrash(trashRoot())).find((candidate) => candidate.entry === body.entry);
      if (item === undefined) {
        sendJson(response, 404, { error: `${body.entry} is not in the trash` });
        return;
      }
      const restored = await restoreTrash(item, resolveTargetPath(config, cwd, body.target ?? "user"));
      sendJson(response, 200, { name: item.name, path: restored });
    }),

    route(ROUTES.importZip, "POST", async (request, response) => {
      const cwd = queryParam(request, "cwd") ?? defaultCwd();
      const destination = resolveTargetPath(config, cwd, queryParam(request, "target") ?? "user");
      const buffer = await readBody(request, config.maxUploadBytes);
      if (buffer.length === 0) {
        sendJson(response, 400, { error: "empty body: POST the .zip bytes" });
        return;
      }
      const results = await installFromZip(buffer, {
        destinationRoot: destination,
        trashRoot: trashRoot(),
        overwrite: queryParam(request, "overwrite") === "trash" ? "trash" : "skip",
        ...archiveLimits,
      });
      sendJson(response, 200, { destination, results });
    }),

    route(ROUTES.importFiles, "POST", async (request, response) => {
      const body = await readJson(request, config.maxUploadBytes * 2);
      if (!Array.isArray(body.files) || body.files.length === 0) {
        sendJson(response, 400, { error: "expected { files: [{ path, data }] }" });
        return;
      }
      const cwd = cwdOf(request, body);
      const destination = resolveTargetPath(config, cwd, body.target ?? "user");
      const results = await installFromUploads(body.files, {
        destinationRoot: destination,
        trashRoot: trashRoot(),
        overwrite: body.overwrite === "trash" ? "trash" : "skip",
        ...archiveLimits,
      });
      sendJson(response, 200, { destination, results });
    }),

    route(ROUTES.importPath, "POST", async (request, response) => {
      const body = await readJson(request, MiB);
      if (typeof body.sourcePath !== "string" || body.sourcePath.trim() === "") {
        sendJson(response, 400, { error: "expected { sourcePath }" });
        return;
      }
      const cwd = cwdOf(request, body);
      const source = body.sourcePath.trim();
      const results = await installFromDirectory(source, {
        destinationRoot: resolveTargetPath(config, cwd, body.target ?? "user"),
        trashRoot: trashRoot(),
        overwrite: body.overwrite === "trash" ? "trash" : "skip",
        ...archiveLimits,
      });
      sendJson(response, 200, { sourcePath: source, results });
    }),

    route(ROUTES.market, "GET", async (request, response) => {
      const url = queryParam(request, "url") ?? config.registryUrl;
      const { catalog, fetchedAt, cached } = await fetchCatalog({
        url,
        ttlMs: config.registryTtlMs,
        force: queryParam(request, "refresh") === "1",
        cache,
      });
      const cwd = queryParam(request, "cwd") ?? defaultCwd();
      const { skills } = await discoverSkills(resolveRoots({ ...config, cwd }));
      const installed = new Set(skills.map((skill) => skill.name));
      sendJson(response, 200, {
        url,
        fetchedAt,
        cached,
        version: catalog.version,
        ...(catalog.generatedAt === undefined ? {} : { generatedAt: catalog.generatedAt }),
        skills: catalog.skills.map((entry) => ({ ...entry, installed: installed.has(entry.name) })),
      });
    }),

    route(ROUTES.marketInstall, "POST", async (request, response) => {
      const body = await readJson(request, MiB);
      if (typeof body.id !== "string" || body.id === "") {
        sendJson(response, 400, { error: "expected { id }" });
        return;
      }
      const cwd = cwdOf(request, body);
      const { catalog } = await fetchCatalog({
        url: stringParam(body.registryUrl, config.registryUrl),
        ttlMs: config.registryTtlMs,
        cache,
      });
      const entry = catalog.skills.find((candidate) => candidate.id === body.id || candidate.name === body.id);
      if (entry === undefined) {
        sendJson(response, 404, { error: `${body.id} is not in the registry` });
        return;
      }
      const installed = await installFromMarket(entry, {
        destinationRoot: resolveTargetPath(config, cwd, body.target ?? "user"),
        trashRoot: trashRoot(),
        overwrite: body.overwrite === "trash" ? "trash" : "skip",
        ...archiveLimits,
      });
      sendJson(response, 200, {
        id: entry.id,
        name: entry.name,
        source: installed.source,
        results: installed.results,
      });
    }),
  ];
}

/**
 * Mount the manager's routes.
 * @param ctx - host plugin context.
 * @param rawConfig - cordis plugin config.
 */
export function apply(ctx, rawConfig = {}) {
  const config = {
    enabled: rawConfig.enabled !== false,
    access: ["loopback", "paired", "lan"].includes(rawConfig.access) ? rawConfig.access : "paired",
    registryUrl: stringParam(rawConfig.registryUrl, DEFAULT_REGISTRY_URL),
    registryTtlMs: Number.isFinite(rawConfig.registryTtlMs) ? rawConfig.registryTtlMs : 10 * 60 * 1000,
    updateUrl: typeof rawConfig.updateUrl === "string" && rawConfig.updateUrl !== "" ? rawConfig.updateUrl : undefined,
    dshHome: stringParam(rawConfig.dshHome, process.env.DSH_HOME ?? join(homedir(), ".dsh")),
    agentsHome: stringParam(rawConfig.agentsHome, process.env.DSH_AGENTS_HOME ?? join(homedir(), ".agents")),
    customSkillDirs: Array.isArray(rawConfig.customSkillDirs) ? rawConfig.customSkillDirs.filter((entry) => typeof entry === "string") : [],
    maxUploadBytes: Number.isFinite(rawConfig.maxUploadBytes) ? rawConfig.maxUploadBytes : 16 * MiB,
    maxExtractBytes: Number.isFinite(rawConfig.maxExtractBytes) ? rawConfig.maxExtractBytes : 64 * MiB,
    maxEntries: Number.isFinite(rawConfig.maxEntries) ? rawConfig.maxEntries : 4096,
    maxFileBytes: Number.isFinite(rawConfig.maxFileBytes) ? rawConfig.maxFileBytes : 8 * MiB,
    maxSkills: Number.isFinite(rawConfig.maxSkills) ? rawConfig.maxSkills : 64,
  };
  if (!config.enabled) return;
  const routes = makeRoutes(ctx, config);
  ctx.effect(() => {
    const disposers = routes.map((entry) => ctx.webServer.register(entry));
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, "skill-manager: routes");
}
