// Generates the PNG icons from public/icons/icon.svg (run: npm run icons).
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/icons');
await mkdir(out, { recursive: true });
const svg = await readFile(resolve(out, 'icon.svg'));

const png = (size, file, { pad = 0, bg } = {}) => {
  const inner = Math.round(size * (1 - pad * 2));
  let img = sharp(svg, { density: 384 }).resize(inner, inner);
  if (pad || bg) {
    img = img.extend({ top: Math.round((size - inner) / 2), bottom: size - inner - Math.round((size - inner) / 2), left: Math.round((size - inner) / 2), right: size - inner - Math.round((size - inner) / 2), background: bg || { r: 0, g: 0, b: 0, alpha: 0 } });
  }
  return img.png().toFile(resolve(out, file));
};

await png(192, 'icon-192.png');
await png(512, 'icon-512.png');
await png(512, 'maskable-512.png', { pad: 0.1, bg: '#0b1f3a' }); // maskable: content inside the safe zone on a solid background
await png(180, 'apple-touch-icon.png', { pad: 0.06, bg: '#0b1f3a' });
await png(48, 'favicon-48.png');
await png(256, 'icon-256.png');
// Windows icon (installer, exe, shortcut): several sizes in one .ico, plus a 512 px PNG for other uses
const buildDir = resolve(root, 'build');
await mkdir(buildDir, { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128, 256];
const bufs = await Promise.all(sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer()));
await writeFile(resolve(buildDir, 'icon.ico'), await pngToIco(bufs));
await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(resolve(buildDir, 'icon.png'));
console.log('icons written to', out, 'and', buildDir);
