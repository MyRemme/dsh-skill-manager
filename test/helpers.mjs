/**
 * Archive builders for the test suite.
 *
 * The readers under test are pure byte parsers, so the fixtures are built here
 * byte by byte rather than checked in as binaries — a failing test then points
 * at a specific field instead of an opaque blob.
 */
import { deflateRawSync, gzipSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function asBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  return Buffer.from(String(data), "utf8");
}

/**
 * Build a ZIP archive.
 * @param files - `{ path, data }` entries.
 * @param options - `store` writes uncompressed entries.
 * @returns the archive bytes.
 */
export function makeZip(files, options = {}) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const data = asBuffer(file.data);
    const crc = crc32(data);
    const method = options.store === true ? 0 : 8;
    const payload = method === 0 ? data : deflateRawSync(data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(payload.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);

    local.push(header, name, payload);
    central.push(entry, name);
    offset += header.length + name.length + payload.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

/**
 * Build a gzipped TAR archive with ustar headers.
 * @param files - `{ path, data, type? }` entries; `type` defaults to a regular file.
 * @returns the `.tar.gz` bytes.
 */
export function makeTarGz(files) {
  const blocks = [];
  for (const file of files) {
    const data = asBuffer(file.data);
    const header = Buffer.alloc(512);
    header.write(file.path.slice(0, 100), 0, "utf8");
    header.write("0000644\0", 100, "utf8");
    header.write("0000000\0", 108, "utf8");
    header.write("0000000\0", 116, "utf8");
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, "utf8");
    header.write("00000000000\0", 136, "utf8");
    header.write("        ", 148, "utf8");
    header.write(file.type ?? "0", 156, "utf8");
    header.write("ustar\0", 257, "utf8");
    header.write("00", 263, "utf8");
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "utf8");
    blocks.push(header, data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** A minimal valid SKILL.md body. */
export function skill(name, description = `The ${name} skill.`) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
}
