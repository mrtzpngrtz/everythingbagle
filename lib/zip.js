/* === MINIMAL ZIP (store-only writer, store+deflate reader) ===
   Board exports embed every upload as base64 inside one JSON file. That inflates
   by 33% and forces both sides to hold the whole thing as a single JavaScript
   string, which caps out around 512MB-1GB depending on the engine. A ZIP has no
   such ceiling: the server streams it and never holds more than one chunk.

   No dependency — uploads are already-compressed media, so entries are STORED
   rather than deflated. The reader accepts deflated entries too, so a ZIP
   repacked by another tool still imports. */

const fs = require('fs');
const zlib = require('zlib');

const LOCAL_SIG   = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG    = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const MAX_ZIP32 = 0xffffffff;

// ── CRC32 ────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf, seed = 0) {
  let c = ~seed;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// Streamed so a 50MB upload never lands in memory in one piece
function crc32File(filePath) {
  return new Promise((resolve, reject) => {
    let value = 0;
    fs.createReadStream(filePath)
      .on('data', chunk => { value = crc32(chunk, value); })
      .on('error', reject)
      .on('end', () => resolve(value));
  });
}

// ── DOS timestamp ────────────────────────────────────────────────────────
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

// ── Writing ──────────────────────────────────────────────────────────────
function localHeader(entry) {
  const name = Buffer.from(entry.name, 'utf8');
  const buf = Buffer.alloc(30 + name.length);
  buf.writeUInt32LE(LOCAL_SIG, 0);
  buf.writeUInt16LE(20, 4);            // version needed
  buf.writeUInt16LE(0x0800, 6);        // flags: UTF-8 names
  buf.writeUInt16LE(0, 8);             // method: stored
  buf.writeUInt16LE(entry.dos.time, 10);
  buf.writeUInt16LE(entry.dos.date, 12);
  buf.writeUInt32LE(entry.crc, 14);
  buf.writeUInt32LE(entry.size, 18);   // compressed == uncompressed when stored
  buf.writeUInt32LE(entry.size, 22);
  buf.writeUInt16LE(name.length, 26);
  buf.writeUInt16LE(0, 28);            // extra length
  name.copy(buf, 30);
  return buf;
}

function centralHeader(entry) {
  const name = Buffer.from(entry.name, 'utf8');
  const buf = Buffer.alloc(46 + name.length);
  buf.writeUInt32LE(CENTRAL_SIG, 0);
  buf.writeUInt16LE(20, 4);            // version made by
  buf.writeUInt16LE(20, 6);            // version needed
  buf.writeUInt16LE(0x0800, 8);        // flags: UTF-8 names
  buf.writeUInt16LE(0, 10);            // method: stored
  buf.writeUInt16LE(entry.dos.time, 12);
  buf.writeUInt16LE(entry.dos.date, 14);
  buf.writeUInt32LE(entry.crc, 16);
  buf.writeUInt32LE(entry.size, 20);
  buf.writeUInt32LE(entry.size, 24);
  buf.writeUInt16LE(name.length, 28);
  buf.writeUInt16LE(0, 30);            // extra
  buf.writeUInt16LE(0, 32);            // comment
  buf.writeUInt16LE(0, 34);            // disk number
  buf.writeUInt16LE(0, 36);            // internal attrs
  buf.writeUInt32LE(0, 38);            // external attrs
  buf.writeUInt32LE(entry.offset, 42);
  name.copy(buf, 46);
  return buf;
}

function eocd(count, cdSize, cdOffset) {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(EOCD_SIG, 0);
  buf.writeUInt16LE(0, 4);
  buf.writeUInt16LE(0, 6);
  buf.writeUInt16LE(count, 8);
  buf.writeUInt16LE(count, 10);
  buf.writeUInt32LE(cdSize, 12);
  buf.writeUInt32LE(cdOffset, 16);
  buf.writeUInt16LE(0, 20);            // comment length
  return buf;
}

function writeChunk(out, buf) {
  return new Promise((resolve, reject) => {
    // Respect backpressure — a slow client must not make us buffer the whole board
    if (out.write(buf)) return resolve();
    out.once('drain', resolve);
    out.once('error', reject);
  });
}

function pipeFile(out, filePath) {
  return new Promise((resolve, reject) => {
    const src = fs.createReadStream(filePath);
    src.on('error', reject);
    src.on('end', resolve);
    src.pipe(out, { end: false });
  });
}

/**
 * Streams a ZIP into a writable (an Express response).
 * sources: [{ name, filePath }] for files on disk, or [{ name, buffer }] for
 * generated content such as board.json.
 * Sizes are pre-computed so the entries carry real CRCs and lengths in their
 * local headers — no data descriptors, which some unpackers handle poorly.
 */
async function streamZip(out, sources) {
  const entries = [];
  let offset = 0;

  for (const source of sources) {
    const isBuffer = source.buffer !== undefined;
    const size = isBuffer ? source.buffer.length : fs.statSync(source.filePath).size;
    const crc = isBuffer ? crc32(source.buffer) : await crc32File(source.filePath);
    const mtime = isBuffer ? new Date() : fs.statSync(source.filePath).mtime;

    const entry = { name: source.name, size, crc, offset, dos: dosDateTime(mtime) };
    if (offset + size > MAX_ZIP32) {
      throw new Error('Archive exceeds the 4GB ZIP limit');
    }

    const header = localHeader(entry);
    await writeChunk(out, header);
    if (isBuffer) await writeChunk(out, source.buffer);
    else await pipeFile(out, source.filePath);

    offset += header.length + size;
    entries.push(entry);
  }

  const central = Buffer.concat(entries.map(centralHeader));
  await writeChunk(out, central);
  await writeChunk(out, eocd(entries.length, central.length, offset));
  out.end();
}

/** Total byte length streamZip will produce, so Content-Length can be set. */
function zipSize(sources) {
  let total = 0;
  for (const source of sources) {
    const nameLen = Buffer.byteLength(source.name, 'utf8');
    const size = source.buffer !== undefined
      ? source.buffer.length
      : fs.statSync(source.filePath).size;
    total += 30 + nameLen + size;   // local header + data
    total += 46 + nameLen;          // central directory record
  }
  return total + 22;                // EOCD
}

// ── Reading ──────────────────────────────────────────────────────────────
function readAt(fd, length, position) {
  const buf = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const n = fs.readSync(fd, buf, read, length - read, position + read);
    if (n === 0) break;
    read += n;
  }
  return read === length ? buf : buf.subarray(0, read);
}

/**
 * Reads the central directory only — entry data stays on disk and is pulled out
 * per entry, so importing a multi-GB archive never loads it into memory.
 */
function openZip(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    if (fileSize < 22) throw new Error('Not a ZIP file');

    // EOCD sits at the end, after an optional comment of up to 64KB
    const tailLen = Math.min(fileSize, 22 + 0xffff);
    const tail = readAt(fd, tailLen, fileSize - tailLen);
    let eocdPos = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) { eocdPos = i; break; }
    }
    if (eocdPos === -1) throw new Error('Not a ZIP file (no end-of-central-directory record)');

    let count = tail.readUInt16LE(eocdPos + 10);
    let cdSize = tail.readUInt32LE(eocdPos + 12);
    let cdOffset = tail.readUInt32LE(eocdPos + 16);

    // ZIP64: the 32-bit fields are saturated and the real values live in the
    // ZIP64 end-of-central-directory record the locator points at.
    if (count === 0xffff || cdOffset === MAX_ZIP32 || cdSize === MAX_ZIP32) {
      for (let i = eocdPos - 20; i >= 0; i--) {
        if (tail.readUInt32LE(i) === ZIP64_LOCATOR_SIG) {
          const z64Offset = Number(tail.readBigUInt64LE(i + 8));
          const z64 = readAt(fd, 56, z64Offset);
          count = Number(z64.readBigUInt64LE(32));
          cdSize = Number(z64.readBigUInt64LE(40));
          cdOffset = Number(z64.readBigUInt64LE(48));
          break;
        }
      }
    }

    const cd = readAt(fd, cdSize, cdOffset);
    const entries = [];
    let pos = 0;
    for (let i = 0; i < count && pos + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(pos) !== CENTRAL_SIG) break;
      const method = cd.readUInt16LE(pos + 10);
      const compressedSize = cd.readUInt32LE(pos + 20);
      const size = cd.readUInt32LE(pos + 24);
      const nameLen = cd.readUInt16LE(pos + 28);
      const extraLen = cd.readUInt16LE(pos + 30);
      const commentLen = cd.readUInt16LE(pos + 32);
      const localOffset = cd.readUInt32LE(pos + 42);
      const name = cd.toString('utf8', pos + 46, pos + 46 + nameLen);
      entries.push({ name, method, compressedSize, size, localOffset });
      pos += 46 + nameLen + extraLen + commentLen;
    }

    // The local header repeats the name/extra lengths, and its extra field can
    // differ from the central one — so the data offset must come from there.
    entries.forEach(entry => {
      const head = readAt(fd, 30, entry.localOffset);
      if (head.readUInt32LE(0) !== LOCAL_SIG) throw new Error(`Corrupt entry: ${entry.name}`);
      entry.dataOffset = entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    });

    return { fd, entries };
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }
}

function inflateIfNeeded(entry, buf) {
  if (entry.method === 0) return buf;
  if (entry.method === 8) return zlib.inflateRawSync(buf);
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

function readEntryBuffer(zip, entry) {
  return inflateIfNeeded(entry, readAt(zip.fd, entry.compressedSize, entry.dataOffset));
}

function extractEntryToFile(zip, entry, destPath) {
  if (entry.method === 0) {
    // Copy in chunks so a large video never sits in memory
    const dest = fs.openSync(destPath, 'w');
    try {
      const CHUNK = 1 << 20;
      let written = 0;
      while (written < entry.compressedSize) {
        const chunk = readAt(zip.fd, Math.min(CHUNK, entry.compressedSize - written), entry.dataOffset + written);
        if (chunk.length === 0) break;
        fs.writeSync(dest, chunk);
        written += chunk.length;
      }
    } finally {
      fs.closeSync(dest);
    }
  } else {
    fs.writeFileSync(destPath, readEntryBuffer(zip, entry));
  }
}

function closeZip(zip) {
  try { fs.closeSync(zip.fd); } catch {}
}

module.exports = {
  streamZip, zipSize,
  openZip, closeZip, readEntryBuffer, extractEntryToFile,
  crc32,
};
