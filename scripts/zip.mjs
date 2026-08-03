/**
 * Packs dist/ into a Chrome Web Store upload zip. Implemented with node:zlib so the
 * repo needs no archiving dependency.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from './crc32.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const RELEASE_DIR = join(ROOT, 'release');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function dosDateTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function createZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, day } = dosDateTime(new Date());

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuf, end]);
}

const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
const files = walk(DIST).map((full) => ({
  name: relative(DIST, full).split('\\').join('/'),
  data: readFileSync(full),
}));

mkdirSync(RELEASE_DIR, { recursive: true });
const target = join(RELEASE_DIR, `focus-reader-v${manifest.version}.zip`);
writeFileSync(target, createZip(files));

const size = (statSync(target).size / 1024).toFixed(1);
console.log(`packed ${files.length} files -> ${relative(ROOT, target)} (${size} KB)`);
