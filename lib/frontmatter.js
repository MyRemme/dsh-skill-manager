/**
 * SKILL.md frontmatter reading and rewriting.
 *
 * Rewrites are line-oriented and preserve every byte outside the field being
 * changed, so unknown frontmatter keys, comments and the body survive an edit
 * untouched. Only the two canonical invocation keys are ever written:
 * `disable-model-invocation` and `user-invocable`.
 *
 * @module dsh-skill-manager/frontmatter
 */

/** Canonical model-invocation key. */
export const MODEL_KEY = "disable-model-invocation";
/** Canonical user-invocation key. */
export const USER_KEY = "user-invocable";
/** Legacy spellings the official parser rejects outright. */
export const LEGACY_KEYS = ["disableModelInvocation", "modelInvocable", "userInvocable"];

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Locate the leading frontmatter block.
 * @param raw - whole file text.
 * @returns the block geometry, or undefined when the file opens without one.
 */
export function locateFrontmatter(raw) {
  const match = FRONTMATTER.exec(raw);
  if (match === null) return undefined;
  return {
    start: match.index,
    bodyStart: match.index + match[0].indexOf("\n") + 1,
    end: match.index + match[0].length,
    inner: match[1],
    eol: raw.slice(0, match.index + match[0].length).includes("\r\n") ? "\r\n" : "\n",
  };
}

/** The file body after the frontmatter block (or the whole text when absent). */
export function splitBody(raw) {
  const block = locateFrontmatter(raw);
  return block === undefined ? raw : raw.slice(block.end);
}

/** Strip matching quotes from a scalar, undoing the escapes YAML would apply. */
function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/gu, "$1");
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/gu, "'");
  }
  return value;
}

/**
 * Read one top-level scalar field from the frontmatter block.
 * @param raw - whole file text.
 * @param key - exact top-level key.
 * @returns the raw scalar text (unquoted), or undefined when absent.
 */
export function readField(raw, key) {
  const block = locateFrontmatter(raw);
  if (block === undefined) return undefined;
  const lines = block.inner.split(/\r?\n/);
  const pattern = new RegExp(`^${key}[ \\t]*:[ \\t]*(.*)$`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = pattern.exec(lines[index]);
    if (match === null) continue;
    const rest = match[1].trim();
    if (rest === "" || /^[|>][-+]?$/.test(rest)) {
      // Block scalar: consume the indented run that follows.
      const collected = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        const line = lines[next];
        if (line.trim() === "") {
          collected.push("");
          continue;
        }
        if (!/^\s/.test(line)) break;
        collected.push(line.trim());
      }
      const text = collected.join("\n").trim();
      return text === "" ? undefined : text;
    }
    return unquote(rest);
  }
  return undefined;
}

/**
 * Parse a YAML boolean the way the official provider does.
 * @param value - raw scalar text.
 * @returns true/false, or undefined when the text is not a recognised boolean.
 */
export function parseBoolean(value) {
  if (value === undefined) return undefined;
  const text = String(value).trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (["true", "yes", "on", "1"].includes(text)) return true;
  if (["false", "no", "off", "0"].includes(text)) return false;
  return undefined;
}

/**
 * Emit a YAML scalar that a strict parser reads back as the same string.
 * @param value - plain text.
 * @returns a safe single-line YAML scalar.
 */
export function yamlScalar(value) {
  const text = String(value);
  const unsafe =
    text === "" ||
    /^\s|\s$/.test(text) ||
    /: |:\t|:$/.test(text) ||
    /^[-?[\]{}#&*!|>'"%@`]/.test(text) ||
    text.includes("\n") ||
    text.includes("\r") ||
    /\s#/.test(text);
  if (!unsafe) return text;
  return `"${text.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

/** Collapse a multi-line description into one safe scalar. */
function scalarFromText(value) {
  return yamlScalar(String(value).replace(/\s*\r?\n\s*/gu, " ").trim());
}

/**
 * Insert, replace or remove one top-level key in the frontmatter block.
 * @param raw - whole file text.
 * @param key - exact top-level key.
 * @param value - replacement scalar text; undefined removes the key.
 * @returns the rewritten file, or the input when nothing changed.
 */
export function setField(raw, key, value) {
  const block = locateFrontmatter(raw);
  const pattern = new RegExp(`^${key}[ \\t]*:`);
  if (block === undefined) {
    if (value === undefined) return raw;
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    return `---${eol}${key}: ${value}${eol}---${eol}${raw}`;
  }
  const lines = block.inner.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  let next;
  if (value === undefined) {
    if (index === -1) return raw;
    next = lines.filter((_, position) => position !== index);
    while (next.length > 0 && next[next.length - 1].trim() === "") next.pop();
  } else if (index === -1) {
    next = [...lines, `${key}: ${value}`];
  } else {
    next = lines.map((line, position) => (position === index ? `${key}: ${value}` : line));
  }
  const { eol } = block;
  return `${raw.slice(0, block.start)}---${eol}${next.join(eol)}${eol}---${eol}${raw.slice(block.end)}`;
}

/**
 * Apply an enable/disable decision to a skill file.
 * @param raw - whole file text.
 * @param enabled - target state.
 * @param options - `both` also drives `user-invocable`.
 * @returns the rewritten file.
 */
export function applyEnabled(raw, enabled, options = {}) {
  let next = setField(raw, MODEL_KEY, enabled ? undefined : "true");
  if (options.both === true) next = setField(next, USER_KEY, enabled ? undefined : "false");
  return next;
}

/**
 * Render a brand-new SKILL.md.
 * @param input - name, description, optional whenToUse, optional body.
 * @returns the file text, LF-terminated.
 */
export function renderSkillFile(input) {
  const lines = ["---", `name: ${yamlScalar(input.name)}`, `description: ${scalarFromText(input.description)}`];
  if (typeof input.whenToUse === "string" && input.whenToUse.trim() !== "") {
    lines.push(`whenToUse: ${scalarFromText(input.whenToUse)}`);
  }
  if (input.userInvocable === false) lines.push(`${USER_KEY}: false`);
  if (input.modelInvocable === false) lines.push(`${MODEL_KEY}: true`);
  lines.push("---", "");
  const body = typeof input.content === "string" ? input.content.replace(/\r\n/gu, "\n").trim() : "";
  lines.push(body === "" ? `# ${input.name}` : body, "");
  return lines.join("\n");
}

/**
 * Read the invocation policy of a skill file.
 * @param raw - whole file text.
 * @returns model/user invocation flags with the official defaults.
 */
export function readInvocation(raw) {
  return {
    modelInvocable: parseBoolean(readField(raw, MODEL_KEY)) !== true,
    userInvocable: parseBoolean(readField(raw, USER_KEY)) !== false,
  };
}

/**
 * Report whether a disabled-looking key uses a spelling the harness rejects.
 * @param raw - whole file text.
 * @returns the offending legacy key, or undefined.
 */
export function findLegacyKey(raw) {
  const block = locateFrontmatter(raw);
  if (block === undefined) return undefined;
  return LEGACY_KEYS.find((key) => new RegExp(`^${key}[ \\t]*:`, "m").test(block.inner));
}
