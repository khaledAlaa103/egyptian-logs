// Shared helpers for the browser end-to-end scripts: preview server, Chrome/Edge launcher, raw IndexedDB seeding.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findBrowser() {
  const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => existsSync(p));
  if (!exe) { console.error('No Chrome/Edge found. Set CHROME_PATH.'); process.exit(2); }
  return exe;
}

export async function startPreview(port) {
  if (!existsSync(join(root, 'dist/index.html'))) { console.error('dist/ not built. Run: npm run build'); process.exit(2); }
  const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch { /* starting */ } await sleep(250); }
  return server;
}

export async function launch(opts = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'welllog-e2e-'));
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, userDataDir: profile, args: ['--no-first-run'], ...opts });
  return { browser, cleanup: async () => { await browser.close(); try { rmSync(profile, { recursive: true, force: true }); } catch { /* busy */ } } };
}

/** Writes a synthetic project/well/curves/intervals/sample straight into the app's IndexedDB (runs inside the page). */
export const seedInPage = () => new Promise((resolveSeed, reject) => {
  const open = indexedDB.open('welllog-pro');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction(['projects', 'wells', 'logMeasurements', 'formations', 'waterSamples'], 'readwrite');
    const now = new Date().toISOString();
    const put = (s, v) => new Promise((r) => { const q = tx.objectStore(s).add(v); q.onsuccess = () => r(q.result); });
    (async () => {
      const pid = await put('projects', { name: 'Synthetic QA project', client: 'QA', description: 'synthetic', status: 'active', createdAt: now, updatedAt: now });
      const wid = await put('wells', { projectId: pid, wellId: 'QA-1', name: 'Synthetic QA well', status: 'active', totalDepth: 100, country: 'Egypt', wellType: 'water', createdAt: now, updatedAt: now });
      const depth = Array.from({ length: 201 }, (_, i) => i * 0.5);
      const mk = (curveId, unit, f) => ({ wellId: wid, curveId, unit, depthUnit: 'm', depth, values: depth.map(f), source: 'manual', enteredUnit: unit, header: null, meta: {}, importedAt: now, updatedAt: now });
      await put('logMeasurements', mk('gr', 'gAPI', (d) => (d > 40 && d < 70 ? 30 : 100)));
      await put('logMeasurements', mk('res_deep', 'ohm.m', (d) => (d > 40 && d < 70 ? 20 : 3)));
      await put('logMeasurements', mk('density', 'g/cm3', (d) => (d > 40 && d < 70 ? 2.2 : 2.5)));
      await put('formations', { wellId: wid, top: 0, bottom: 40, name: 'Clay', lithology: 'clay', waterBearing: 'unknown', createdAt: now, updatedAt: now });
      await put('formations', { wellId: wid, top: 40, bottom: 70, name: 'Sand', lithology: 'sand', waterBearing: 'probable', createdAt: now, updatedAt: now });
      await put('waterSamples', { wellId: wid, sampleId: 'S1', depthTop: 50, tds: 800, ecUScm: 1250, ecEntered: 1250, ecUnit: 'uS/cm', ecTemp: 25, rw: null, rwTemp: null, source: 'synthetic', notes: '', createdAt: now });
      tx.oncomplete = () => { db.close(); resolveSeed(wid); };
    })().catch(reject);
  };
});

export const ROUTES = ['', 'projects', 'wells', 'import', 'viewer', 'interpretation', 'formations', 'water', 'results', 'reports', 'settings'];

/** Select the seeded well on pages that have a well picker. */
export async function pickWell(page) {
  if (await page.$('.well-picker select')) {
    const v = await page.evaluate(() => document.querySelector('.well-picker select option:nth-child(2)')?.value);
    if (v) { await page.select('.well-picker select', v); await sleep(900); }
  }
}
