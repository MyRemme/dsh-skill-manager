/**
 * Archive readers for skill import: ZIP (stored + deflate) and TAR.GZ.
 *
 * Both readers return a flat list of regular files with POSIX-style relative
 * paths. Neither writes to disk — extraction is planned and validated first, so
 * a hostile archive can never escape the destination root. Symlinks, hardlinks
 * and device nodes are dropped rather than materialised.
 *
 * @module dsh-skill-manager/archive
 */
import { gunzipSync, inflateRawSync } from "node:zlib";

/** Raised when an archive exceeds a configured limit or is structurally invalid. */
export class ArchiveError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArchiveError";
  }
}

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_EOCD = 0x06054b50;
const ZIP64_EOCD_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_EXTRA = 0x0001;

/**
 * Normalise an archive member name into a safe POSIX relative path.
 * @param name - raw member name.
 * @returns the cleaned relative path.
 * @throws ArchiveError for absolute paths, drive letters and `..` traversal.
 */
export function safeRelativePath(name) {
  const unified = String(name).replace(/\\/gu, "/");
  if (unified.startsWith("/")) throw new ArchiveError(`absolute archive path: ${name}`);
  if (/^[A-Za-z]:/u.test(unified)) throw new ArchiveError(`drive-qualified archive path: ${name}`);
  const parts = [];
  for (const part of unified.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw new ArchiveError(`archive path escapes its root: ${name}`);
    parts.push(part);
  }
  if (parts.length === 0) throw new ArchiveError(`empty archive path: ${name}`);
  return parts.join("/");
}

function findEocd(buffer) {
  const floor = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= floor; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_EOCD) continue;
    if (offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) return offset;
  }
  return -1;
}

function readZip64Extra(extra, entry) {
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor);
    const size = extra.readUInt16LE(cursor + 2);
    const body = extra.subarray(cursor + 4, cursor + 4 + size);
    if (id === ZIP64_EXTRA) {
      let at = 0;
      if (entry.uncompressedSize === 0xffffffff && at + 8 <= body.length) {
        entry.uncompressedSize = Number(body.readBigUInt64LE(at));
        at += 8;
      }
      if (entry.compressedSize === 0xffffffff && at + 8 <= body.length) {
        entry.compressedSize = Number(body.readBigUInt64LE(at));
        at += 8;
      }
      if (entry.localOffset === 0xffffffff && at + 8 <= body.length) {
        entry.localOffset = Number(body.readBigUInt64LE(at));
      }
      return;
    }
    cursor += 4 + size;
  }
}

function readZip64Eocd(buffer, eocd) {
  const locator = eocd - 20;
  if (locator < 0 || buffer.readUInt32LE(locator) !== ZIP64_EOCD_LOCATOR) return undefined;
  const offset = Number(buffer.readBigUInt64LE(locator + 8));
  if (offset < 0 || offset + 56 > buffer.length || buffer.readUInt32LE(offset) !== ZIP64_EOCD) return undefined;
  return { count: Number(buffer.readBigUInt64LE(offset + 32)), centralOffset: Number(buffer.readBigUInt64LE(offset + 48)) };
}

/**
 * Read every regular file out of a ZIP buffer.
 * @param buffer - the whole archive.
 * @param options - `maxEntries` and `maxTotalBytes` caps.
 * @returns file entries in central-directory order.
 */
export function readZip(buffer, options = {}) {
  const maxEntries = options.maxEntries ?? 4096;
  const maxTotalBytes = options.maxTotalBytes ?? 64 * 1024 * 1024;
  const eocd = findEocd(buffer);
  if (eocd === -1) throw new ArchiveError("not a ZIP archive (end-of-central-directory record not found)");
  const zip64 = readZip64Eocd(buffer, eocd);
  const count = zip64?.count ?? buffer.readUInt16LE(eocd + 10);
  let cursor = zip64?.centralOffset ?? buffer.readUInt32LE(eocd + 16);
  if (count > maxEntries) throw new ArchiveError(`archive has ${count} entries, limit is ${maxEntries}`);

  const entries = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== ZIP_CENTRAL) {
      throw new ArchiveError("corrupt ZIP central directory");
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const entry = {
      method,
      compressedSize: buffer.readUInt32LE(cursor + 20),
      uncompressedSize: buffer.readUInt32LE(cursor + 24),
      localOffset: buffer.readUInt32LE(cursor + 42),
      name: buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength),
    };
    readZip64Extra(buffer.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength), entry);
    cursor += 46 + nameLength + extraLength + commentLength;

    const unixMode = externalAttributes >>> 16;
    const isDirectory = entry.name.endsWith("/") || (unixMode & 0o170000) === 0o040000;
    const isSymlink = (unixMode & 0o170000) === 0o120000;
    if (isDirectory || isSymlink) continue;
    if (entry.name === "" || entry.name.endsWith("/")) continue;

    const path = safeRelativePath(entry.name);
    const data = inflateZipEntry(buffer, entry);
    total += data.length;
    if (total > maxTotalBytes) throw new ArchiveError(`archive expands past ${maxTotalBytes} bytes`);
    entries.push({ path, data });
  }
  return entries;
}

function inflateZipEntry(buffer, entry) {
  const local = entry.localOffset;
  if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== ZIP_LOCAL) {
    throw new ArchiveError(`corrupt ZIP local header for ${entry.name}`);
  }
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw new ArchiveError(`truncated ZIP entry ${entry.name}`);
  const raw = buffer.subarray(start, end);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) {
    const inflated = inflateRawSync(raw);
    if (entry.uncompressedSize !== 0 && inflated.length !== entry.uncompressedSize) {
      throw new ArchiveError(`ZIP entry ${entry.name} has an inconsistent size`);
    }
    return inflated;
  }
  throw new ArchiveError(`unsupported ZIP compression method ${entry.method} for ${entry.name}`);
}

function readTarString(block, offset, length) {
  const slice = block.subarray(offset, offset + length);
  const stop = slice.indexOf(0);
  return slice.toString("utf8", 0, stop === -1 ? slice.length : stop);
}

function readTarSize(block) {
  const text = readTarString(block, 124, 12).trim();
  if (text === "") return 0;
  const value = Number.parseInt(text, 8);
  if (!Number.isFinite(value) || value < 0) throw new ArchiveError("corrupt TAR size field");
  return value;
}

/**
 * Read every regular file out of a gzipped TAR buffer.
 * @param buffer - the whole `.tar.gz` archive.
 * @param options - `maxEntries` and `maxTotalBytes` caps.
 * @returns file entries in archive order.
 */
export function readTarGz(buffer, options = {}) {
  const maxEntries = options.maxEntries ?? 4096;
  const maxTotalBytes = options.maxTotalBytes ?? 64 * 1024 * 1024;
  const tar = gunzipSync(buffer, { maxOutputLength: maxTotalBytes + 1024 * 1024 });
  const entries = [];
  let cursor = 0;
  let total = 0;
  let longName;
  let paxName;
  while (cursor + 512 <= tar.length) {
    const block = tar.subarray(cursor, cursor + 512);
    if (block.every((byte) => byte === 0)) break;
    const size = readTarSize(block);
    const type = String.fromCharCode(block[156] === 0 ? 0x30 : block[156]);
    const dataStart = cursor + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new ArchiveError("truncated TAR entry");
    const data = tar.subarray(dataStart, dataEnd);
    cursor = dataStart + Math.ceil(size / 512) * 512;

    if (type === "L") {
      longName = data.toString("utf8").replace(/\0+$/u, "");
      continue;
    }
    if (type === "x" || type === "g") {
      const text = data.toString("utf8");
      const match = /^\d+ path=(.*)$/mu.exec(text);
      if (match !== null) paxName = match[1];
      continue;
    }
    // A pending long name belongs to the next real header, whatever its type, so
    // it is cleared here rather than only on the path that yields an entry.
    const header = readTarString(block, 0, 100);
    const prefix = readTarString(block, 345, 155);
    const raw = longName ?? paxName ?? (prefix === "" ? header : `${prefix}/${header}`);
    longName = undefined;
    paxName = undefined;
    if (type !== "0" && type !== "7") continue;
    if (raw === "") continue;

    const path = safeRelativePath(raw);
    total += data.length;
    if (total > maxTotalBytes) throw new ArchiveError(`archive expands past ${maxTotalBytes} bytes`);
    if (entries.length >= maxEntries) throw new ArchiveError(`archive has more than ${maxEntries} entries`);
    entries.push({ path, data: Buffer.from(data) });
  }
  return entries;
}

/**
 * Drop the single shared top-level directory from an archive's file list.
 * GitHub branch tarballs always wrap their payload in `<repo>-<ref>/`.
 * @param entries - file entries.
 * @returns entries with the wrapper removed, or the input when there is none.
 */
export function stripSingleRoot(entries) {
  if (entries.length === 0) return entries;
  const first = entries[0].path.split("/")[0];
  if (!entries.every((entry) => entry.path.startsWith(`${first}/`))) return entries;
  return entries.map((entry) => ({ path: entry.path.slice(first.length + 1), data: entry.data }));
}
