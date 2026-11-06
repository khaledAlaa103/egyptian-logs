// Verifies that a production build (dist/) is a complete offline-capable PWA.
// Run:  npm run build && npm run verify:pwa      (exit code 1 when a problem is found)
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, base)));
    else out.push(p.slice(base.length + 1).replace(/\\/g, '/'));
  }
  return out;
}

export async function verifyDist(dist) {
  const problems = [];
  const info = {};
  const need = (cond, msg) => { if (!cond) problems.push(msg); };
  need(existsSync(dist), `dist folder not found: ${dist}`);
  if (problems.length) return { problems, info };

  const files = await walk(dist);
  info.files = files.length;

  // ---- manifest
  need(files.includes('manifest.webmanifest'), 'manifest.webmanifest missing');
  const man = files.includes('manifest.webmanifest') ? JSON.parse(await readFile(join(dist, 'manifest.webmanifest'), 'utf8')) : {};
  need(man.name && man.short_name, 'manifest needs name and short_name');
  need(man.display === 'standalone', 'manifest display must be "standalone"');
  need(man.start_url === './' && man.scope === './', 'manifest start_url/scope must be "./" (relative hosting)');
  const icons = man.icons || [];
  need(icons.some((i) => i.sizes === '192x192'), 'manifest needs a 192x192 icon');
  need(icons.some((i) => i.sizes === '512x512' && i.purpose !== 'maskable'), 'manifest needs a 512x512 icon');
  need(icons.some((i) => i.purpose === 'maskable'), 'manifest needs a maskable icon');
  for (const i of icons) need(files.includes(i.src), `manifest icon not in dist: ${i.src}`);
  need(man.theme_color && man.background_color, 'manifest needs theme_color and background_color');

  // ---- service worker + precache list
  need(files.includes('sw.js'), 'sw.js (service worker) missing');
  const sw = files.includes('sw.js') ? await readFile(join(dist, 'sw.js'), 'utf8') : '';
  const entries = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
  info.precached = new Set(entries).size;
  need(entries.includes('index.html'), 'index.html is not precached');
  need(/createHandlerBoundToURL\("index\.html"\)|NavigationRoute/.test(sw), 'navigation fallback to index.html missing');
  const skip = (f) => f === 'sw.js' || /^workbox-.*\.js$/.test(f) || f.endsWith('.map');
  const shouldCache = files.filter((f) => !skip(f) && /\.(js|mjs|css|html|png|svg|ico|webmanifest|woff2)$/.test(f));
  for (const f of shouldCache) need(entries.includes(f), `not precached (would fail offline): ${f}`);
  need(files.some((f) => /pdf\.worker.*\.mjs$/.test(f)), 'PDF worker not bundled locally');

  // ---- no external resources
  const html = await readFile(join(dist, 'index.html'), 'utf8');
  const ext = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  need(ext.length === 0, `index.html loads external resources: ${ext.join(', ')}`);
  for (const css of files.filter((f) => f.endsWith('.css'))) {
    const t = await readFile(join(dist, css), 'utf8');
    need(!/url\(\s*["']?https?:/.test(t), `${css} references an external URL`);
  }
  for (const f of ['index.html', ...(html.match(/assets\/[^"']+\.js/g) || [])]) need(files.includes(f) || f === 'index.html', `index.html references a missing file: ${f}`);
  const total = (await Promise.all(shouldCache.map(async (f) => (await stat(join(dist, f))).size))).reduce((a, b) => a + b, 0);
  info.precacheBytes = total;
  return { problems, info };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const { problems, info } = await verifyDist(dist);
  if (problems.length) { console.error('PWA verification FAILED:\n- ' + problems.join('\n- ')); process.exit(1); }
  console.log(`PWA OK: ${info.files} files, ${info.precached} precached (${(info.precacheBytes / 1024).toFixed(0)} KiB)`);
}
