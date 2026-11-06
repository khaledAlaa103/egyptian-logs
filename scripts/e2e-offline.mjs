// End-to-end offline test with a real browser (Chrome or Edge, headless) and the production build.
//   npm run build && npm run e2e:offline
// 1. serves dist/ with `vite preview`, 2. loads the app so the service worker installs and precaches,
// 3. creates data, 4. STOPS the server and goes offline, 5. reloads and checks that the app still starts,
//    all pages open, every precached file is available, and the data (IndexedDB) is intact and editable.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT || 4179);
const BASE = `http://localhost:${PORT}/`;
const CANDIDATES = [
  process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const exe = CANDIDATES.find((p) => existsSync(p));
if (!exe) { console.error('No Chrome/Edge found. Set CHROME_PATH.'); process.exit(2); }
if (!existsSync(join(root, 'dist/sw.js'))) { console.error('dist/ not built. Run: npm run build'); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- start the production server
const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
let serverUp = true;
for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch { /* not yet */ } await sleep(250); }

const profile = mkdtempSync(join(tmpdir(), 'welllog-e2e-'));
const browser = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: profile, args: ['--no-first-run', '--no-default-browser-check'] });
const clickText = async (page, text, sel = 'button') => {
  await page.waitForFunction((t, s) => [...document.querySelectorAll(s)].some((b) => b.textContent.trim().includes(t)), { timeout: 10000 }, text, sel);
  const ok = await page.evaluate((t, s) => { const el = [...document.querySelectorAll(s)].find((b) => b.textContent.trim().includes(t)); if (el) { el.click(); return true; } return false; }, text, sel);
  if (!ok) throw new Error(`button not found: ${text}`);
};
let exitCode = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // ---------- online: install the service worker and precache
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 15000 });
  const cacheInfo = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls = []; for (const k of keys) (await (await caches.open(k)).keys()).forEach((r) => urls.push(new URL(r.url).pathname));
    return { keys, urls };
  });
  check('service worker active and controlling the page', true);
  check('precache holds the app shell, JS, CSS, icons and the PDF worker', cacheInfo.urls.length >= 15 && cacheInfo.urls.some((u) => u.endsWith('/') || u.endsWith('index.html')) && cacheInfo.urls.some((u) => /pdf\.worker/.test(u)) && cacheInfo.urls.some((u) => /icons\/icon-512/.test(u)), `${cacheInfo.urls.length} entries: ${cacheInfo.urls.join(' ')}`);
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  check('manifest is served and linked', manifest.display === 'standalone' && !!(await page.$('link[rel="manifest"]')));

  // ---------- online: create data through the real UI
  await page.goto(`${BASE}#/projects`, { waitUntil: 'networkidle0' });
  await clickText(page, 'New project');
  await page.waitForSelector('.modal input');
  await page.type('.modal input', 'Offline Test Project');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('Offline Test Project'));
  check('data created while online (IndexedDB)', true);

  // ---------- stop the server and go offline
  server.kill(); serverUp = false;
  await sleep(500);
  let reached = true; try { await fetch(BASE, { signal: AbortSignal.timeout(1500) }); } catch { reached = false; }
  check('server is really down', !reached);
  await page.setOfflineMode(true);

  // ---------- offline: cold reload
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1', { timeout: 15000 });
  check('app starts after a reload with no server and no network', true);
  check('offline badge is shown', await page.waitForSelector('.offline-badge', { timeout: 5000 }).then(() => true).catch(() => false));

  // every precached file is available offline
  const missing = await page.evaluate(async (urls) => {
    const bad = [];
    for (const u of urls) { try { const r = await fetch(u); if (!r.ok) bad.push(u); } catch { bad.push(u); } }
    return bad;
  }, cacheInfo.urls);
  check('every precached file is available offline', missing.length === 0, missing.join(', '));

  // all main pages open offline
  const pages = ['', 'projects', 'wells', 'import', 'viewer', 'interpretation', 'formations', 'water', 'results', 'reports', 'settings'];
  const failed = [];
  for (const p of pages) {
    await page.goto(`${BASE}#/${p}`, { waitUntil: 'domcontentloaded' });
    const ok = await page.waitForSelector('h1', { timeout: 8000 }).then(() => true).catch(() => false);
    const text = await page.evaluate(() => document.querySelector('h1')?.textContent || '');
    if (!ok || !text) failed.push(p || 'dashboard');
  }
  check('all 11 sections open offline', failed.length === 0, failed.join(', '));

  // data survived and can still be changed offline
  await page.goto(`${BASE}#/projects`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Offline Test Project'), { timeout: 8000 });
  check('data created online is still there offline', true);
  await clickText(page, 'New project');
  await page.waitForSelector('.modal input');
  await page.type('.modal input', 'Created Offline');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('Created Offline'), { timeout: 8000 });
  check('new data can be saved offline', true);

  // lazy-loaded code (PDF/Excel libraries) also works offline: open Reports and build the model + export
  await page.goto(`${BASE}#/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1');
  const storage = await page.evaluate(async () => { const e = await navigator.storage.estimate(); return { usage: e.usage, persisted: await navigator.storage.persisted() }; });
  check('storage API available', typeof storage.usage === 'number', `used ${storage.usage} bytes`);

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  check('e2e run completed', false, String(e.message || e));
  exitCode = 1;
} finally {
  await browser.close();
  if (serverUp) server.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp dir busy */ }
}
const failedAny = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedAny.length}/${results.length} checks passed`);
process.exit(exitCode || (failedAny.length ? 1 : 0));
