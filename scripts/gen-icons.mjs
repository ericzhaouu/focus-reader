import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from './crc32.mjs';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const SIZES = [16, 32, 48, 128];

const BRAND = [79, 70, 229]; // indigo-600
const BRAND_DARK = [67, 56, 202]; // indigo-700
const FG = [255, 255, 255];

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([len, typed, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Rounded square background with a white bookmark ribbon, evaluated in normalised
// [0,1] space and 4x supersampled for anti-aliasing.
function sampleBackground(x, y) {
  const r = 0.22;
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
  return Math.hypot(dx, dy) <= r;
}

function sampleRibbon(x, y) {
  if (x < 0.33 || x > 0.67 || y < 0.19 || y > 0.81) return false;
  // V-shaped notch cut out of the bottom edge, forming the classic bookmark tail.
  const notchTop = 0.6;
  if (y > notchTop) {
    const t = (y - notchTop) / (0.81 - notchTop);
    return Math.abs(x - 0.5) >= 0.17 * t;
  }
  return true;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (sampleBackground(x, y)) {
            bg++;
            if (sampleRibbon(x, y)) fg++;
          }
        }
      }
      const total = SS * SS;
      const bgA = bg / total;
      const fgA = fg / total;
      const idx = (py * size + px) * 4;
      if (bgA === 0) continue;
      const gradient = py / size;
      const base = [
        BRAND[0] + (BRAND_DARK[0] - BRAND[0]) * gradient,
        BRAND[1] + (BRAND_DARK[1] - BRAND[1]) * gradient,
        BRAND[2] + (BRAND_DARK[2] - BRAND[2]) * gradient,
      ];
      const mix = fgA / Math.max(bgA, 1e-6);
      rgba[idx] = Math.round(base[0] * (1 - mix) + FG[0] * mix);
      rgba[idx + 1] = Math.round(base[1] * (1 - mix) + FG[1] * mix);
      rgba[idx + 2] = Math.round(base[2] * (1 - mix) + FG[2] * mix);
      rgba[idx + 3] = Math.round(bgA * 255);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, render(size));
  console.log(`wrote ${file}`);
}
