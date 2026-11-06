// Phone-size layout check: opens every section at 375×812 with touch emulation, seeds a small synthetic
// well directly into IndexedDB, reports any horizontal overflow of the page and saves screenshots.
//   npm run build && npm run e2e:mobile            (screenshots in ./e2e-shots)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT || 4180);
const BASE = `http://localhost:${PORT}/`;
const SHOTS = resolve(process.env.SHOTS_DIR || join(root, 'e2e-shots'));
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => existsSync(p));
if (!exe) { console.error('No Chrome/Edge found. Set CHROME_PATH.'); process.exit(2); }
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ } await sleep(250); }
const profile = mkdtempSync(join(tmpdir(), 'welllog-mobile-'));
const browser = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: profile, args: ['--no-first-run'] });

/** Raw IndexedDB seeding (the app's Dexie database already exists after the first load). */
const seed = () => new Promise((resolveSeed, reject) => {
  const open = indexedDB.open('welllog-pro');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction(['projects', 'wells', 'logMeasurements', 'formations'], 'readwrite');
    const now = new Date().toISOString();
    const put = (s, v) => new Promise((r) => { const q = tx.objectStore(s).add(v); q.onsuccess = () => r(q.result); });
    (async () => {
      const pid = await put('projects', { name: 'Mobile test project', client: '', description: '', status: 'active', createdAt: now, updatedAt: now });
      const wid = await put('wells', { projectId: pid, wellId: 'MOB-1', name: 'Synthetic phone-test well', status: 'active', totalDepth: 100, country: 'Egypt', wellType: 'water', createdAt: now, updatedAt: now });
      const depth = Array.from({ length: 201 }, (_, i) => i * 0.5);
      const mk = (curveId, unit, f) => ({ wellId: wid, curveId, unit, depthUnit: 'm', depth, values: depth.map(f), source: 'manual', enteredUnit: unit, header: null, meta: {}, importedAt: now, updatedAt: now });
      await put('logMeasurements', mk('gr', 'gAPI', (d) => (d > 40 && d < 70 ? 30 : 100)));
      await put('logMeasurements', mk('res_deep', 'ohm.m', (d) => (d > 40 && d < 70 ? 20 : 3)));
      await put('formations', { wellId: wid, top: 0, bottom: 40, name: 'Clay', lithology: 'clay', waterBearing: 'unknown', createdAt: now, updatedAt: now });
      await put('formations', { wellId: wid, top: 40, bottom: 70, name: 'Sand', lithology: 'sand', waterBearing: 'probable', createdAt: now, updatedAt: now });
      tx.oncomplete = () => { db.close(); resolveSeed(wid); };
    })().catch(reject);
  };
});

const ROUTES = ['', 'projects', 'wells', 'import', 'viewer', 'interpretation', 'formations', 'water', 'results', 'reports', 'settings'];
const problems = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');
  await page.evaluate(seed);

  for (const lang of ['en', 'ar']) {
    await page.evaluate((l) => { localStorage.setItem('welllog.prefs.v1', JSON.stringify({ lang: l, theme: 'light', sidebarCollapsed: false })); }, lang);
    for (const r of ROUTES) {
      await page.goto(`${BASE}#/${r}`, { waitUntil: 'networkidle0' });
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('h1');
      // pick the seeded well where the page needs one
      const sel = await page.$('.well-picker select');
      if (sel) { await page.select('.well-picker select', await page.evaluate(() => document.querySelector('.well-picker select option:nth-child(2)')?.value)); await sleep(900); }
      await sleep(400);
      const res = await page.evaluate(() => {
        const vw = Math.min(window.innerWidth, 375); // the device width (the layout viewport grows when something overflows)
        const doc = document.documentElement;
        const offenders = [];
        const scrollable = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
        document.querySelectorAll('.page *, .topbar *, .bottom-nav *').forEach((el) => {
          const b = el.getBoundingClientRect();
          if (b.width && (b.right > vw + 1 || b.left < -1) && !scrollable(el) && getComputedStyle(el).position !== 'fixed') offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} (${Math.round(b.left)}→${Math.round(b.right)})`);
        });
        if (doc.scrollWidth > vw + 1) { // diagnostics: the widest non-fixed elements
          document.querySelectorAll('body *').forEach((el) => { const b = el.getBoundingClientRect(); if (b.width && getComputedStyle(el).position !== 'fixed' && !el.closest('.sidebar') && (b.right > vw + 1)) offenders.push(`[wide] ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} w=${Math.round(b.width)} (${Math.round(b.left)}→${Math.round(b.right)})`); });
        }
        return { scrollWidth: doc.scrollWidth, vw, offenders: [...new Set(offenders)].slice(0, 8), dir: doc.dir };
      });
      const tag = `${lang}-${r || 'dashboard'}`;
      if (res.scrollWidth > res.vw + 1 || res.offenders.length) problems.push(`${tag}: scrollWidth ${res.scrollWidth} > ${res.vw}; ${res.offenders.join('; ')}`);
      if (lang === 'en' || r === 'viewer') await page.screenshot({ path: join(SHOTS, `${tag}.png`) });
    }
  }
} finally {
  await browser.close(); server.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* busy */ }
}
if (problems.length) { console.log('Horizontal overflow found:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log(`Mobile layout OK: ${ROUTES.length} sections × 2 languages at 375 px, no horizontal overflow. Screenshots: ${SHOTS}`);
