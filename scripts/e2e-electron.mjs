// Real end-to-end test of the desktop app: launches Electron with the production build and drives it over the
// Chrome DevTools protocol. Checks isolation (no Node in the page, frozen allow-listed API), CSP, blocked
// navigation, IPC validation, local data, native-save exports (Excel / PDF image / vector PDF), backup,
// single-instance, and that no network request is ever made.
//   npm run build && npm run e2e:electron
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// E2E_EXE=<path to the packaged WellLog Pro.exe> tests the packaged app (asar) instead of the development launch
const packaged = process.env.E2E_EXE || null;
const electronExe = packaged || join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const appArgs = packaged ? [] : ['.'];
if (!existsSync(electronExe) || !existsSync(join(root, 'dist/index.html'))) { console.error('Need electron binary and dist/. Run: npm run build'); process.exit(2); }

const PORT = Number(process.env.E2E_CDP_PORT || 9333);
const work = mkdtempSync(join(tmpdir(), 'welllog-electron-'));
const userData = join(work, 'profile'), outDir = join(work, 'out');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, WELLLOG_E2E: '1', WELLLOG_E2E_DIR: outDir };
delete env.ELECTRON_RUN_AS_NODE;

const proc = spawn(electronExe, [...appArgs, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], { cwd: root, env, stdio: 'ignore' });
let browser;
let exitCode = 0;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* starting */ } await sleep(500); }
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  let page;
  for (let i = 0; i < 40 && !page; i++) { page = (await browser.pages()).find((p) => p.url().startsWith('app://welllog/')); if (!page) await sleep(500); }
  if (!page) throw new Error('app window not found');
  const requests = [], consoleErrors = [], pageErrors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('h1', { timeout: 20000 });
  check('window loads the app from the private app:// scheme', page.url().startsWith('app://welllog/'), page.url());

  // ---------------- isolation
  const iso = await page.evaluate(() => ({
    require: typeof require, process: typeof process, module: typeof module, buffer: typeof Buffer, ipc: typeof ipcRenderer,
    keys: Object.keys(window.desktop || {}).sort(), frozen: Object.isFrozen(window.desktop), isDesktop: window.desktop?.isDesktop,
  }));
  check('no Node.js in the page (require/process/module/Buffer/ipcRenderer undefined)', iso.require === 'undefined' && iso.process === 'undefined' && iso.module === 'undefined' && iso.buffer === 'undefined' && iso.ipc === 'undefined');
  check('desktop API is frozen and exposes only the allow-listed functions', iso.frozen && JSON.stringify(iso.keys) === JSON.stringify(['getInfo', 'isDesktop', 'openFile', 'printPdf', 'reveal', 'saveFile', 'writeBackup']), iso.keys.join(','));
  const hdr = await page.evaluate(async () => (await fetch('/index.html')).headers.get('content-security-policy'));
  check('Content-Security-Policy header is applied', !!hdr && hdr.includes("default-src 'self'"));
  const enforced = await page.evaluate(() => new Promise((res) => {
    let directive = null;
    document.addEventListener('securitypolicyviolation', (e) => { directive = e.violatedDirective; }, { once: true });
    const s = document.createElement('script'); s.textContent = 'window.__ran = 1'; document.head.appendChild(s);
    setTimeout(() => res({ directive, ran: window.__ran === 1 }), 300);
  }));
  check('CSP is enforced: an injected inline script is blocked and reported', enforced.ran === false && /script-src/.test(enforced.directive || ''), String(enforced.directive));
  consoleErrors.length = 0; pageErrors.length = 0; // the violation above was provoked on purpose

  // ---------------- navigation and windows
  const before = (await browser.pages()).length;
  await page.evaluate(() => { window.open('https://example.com/'); });
  await sleep(700);
  check('window.open to the web is denied (no new window)', (await browser.pages()).length === before);
  await page.evaluate(() => { location.href = 'https://example.com/'; }).catch(() => {});
  await sleep(700);
  check('navigation away from the app is blocked', page.url().startsWith('app://welllog/'), page.url());

  // ---------------- IPC validation
  const info = await page.evaluate(() => window.desktop.getInfo());
  check('getInfo works and reports the local data folder', !!info.version && info.dataDir.startsWith(userData.replace(/\\/g, '\\')) || info.dataDir.toLowerCase().includes('welllog') || info.dataDir === userData, info.dataDir);
  const bad = await page.evaluate(async () => { try { await window.desktop.saveFile({ defaultName: 'run.exe', data: 'x' }); return 'accepted'; } catch (e) { return String(e.message); } });
  check('saving an .exe is rejected by the main process', /not allowed/i.test(bad), bad);
  const trav = await page.evaluate(() => window.desktop.saveFile({ defaultName: '../../../evil.json', data: '{"a":1}' }));
  check('path traversal in a file name is neutralised (file stays in the chosen folder)', trav.ok && resolve(dirname(trav.path)) === resolve(outDir) && trav.path.endsWith('evil.json'), trav.path);
  const badBackup = await page.evaluate(async () => { try { await window.desktop.writeBackup({ json: 'not json' }); return 'accepted'; } catch (e) { return 'rejected'; } });
  check('an invalid backup is rejected', badBackup === 'rejected');
  const badFolder = await page.evaluate(async () => { try { await window.desktop.reveal('C:/Windows'); return 'accepted'; } catch (e) { return 'rejected'; } });
  check('only fixed folders can be revealed (no arbitrary paths)', badFolder === 'rejected');

  // ---------------- data: UI, persistence, seed for reports
  await page.goto('app://welllog/index.html#/projects', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('New project')));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('New project')).click());
  await page.waitForSelector('.modal input');
  await page.type('.modal input', 'Desktop Test Project');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('Desktop Test Project'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.innerText.includes('Desktop Test Project'), { timeout: 10000 });
  check('data is stored locally and survives a reload (IndexedDB under app://)', true);

  // seed a well with curves and intervals directly (same schema as the app)
  await page.evaluate(() => new Promise((resolveSeed, reject) => {
    const open = indexedDB.open('welllog-pro');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result; const tx = db.transaction(['projects', 'wells', 'logMeasurements', 'formations'], 'readwrite'); const now = new Date().toISOString();
      const add = (s, v) => new Promise((r) => { const q = tx.objectStore(s).add(v); q.onsuccess = () => r(q.result); });
      (async () => {
        const proj = await new Promise((r) => { const q = tx.objectStore('projects').getAll(); q.onsuccess = () => r(q.result[0]); });
        const wid = await add('wells', { projectId: proj.id, wellId: 'ELC-1', name: 'Electron test well', status: 'active', totalDepth: 100, createdAt: now, updatedAt: now });
        const depth = Array.from({ length: 201 }, (_, i) => i * 0.5);
        const mk = (curveId, unit, f) => ({ wellId: wid, curveId, unit, depthUnit: 'm', depth, values: depth.map(f), source: 'manual', enteredUnit: unit, header: null, meta: {}, importedAt: now, updatedAt: now });
        await add('logMeasurements', mk('gr', 'gAPI', (d) => (d > 40 && d < 70 ? 30 : 100)));
        await add('logMeasurements', mk('res_deep', 'ohm.m', (d) => (d > 40 && d < 70 ? 20 : 3)));
        await add('formations', { wellId: wid, top: 0, bottom: 40, name: 'Clay', lithology: 'clay', waterBearing: 'unknown', createdAt: now, updatedAt: now });
        await add('formations', { wellId: wid, top: 40, bottom: 70, name: 'Sand', lithology: 'sand', waterBearing: 'probable', createdAt: now, updatedAt: now });
        tx.oncomplete = () => { db.close(); resolveSeed(); };
      })().catch(reject);
    };
  }));

  // ---------------- every section opens under the CSP
  const failed = [];
  for (const r of ['', 'projects', 'wells', 'import', 'viewer', 'interpretation', 'formations', 'water', 'results', 'reports', 'settings']) {
    await page.goto(`app://welllog/index.html#/${r}`, { waitUntil: 'networkidle0' });
    if (!(await page.waitForSelector('h1', { timeout: 8000 }).then(() => true).catch(() => false))) failed.push(r || 'dashboard');
  }
  check('all 11 sections open', failed.length === 0, failed.join(','));

  // ---------------- reports: native save for xlsx, image PDF and vector PDF
  await page.goto('app://welllog/index.html#/reports', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.well-picker select');
  const wellValue = await page.evaluate(() => [...document.querySelectorAll('.well-picker select option')].find((o) => o.textContent.includes('ELC-1'))?.value);
  await page.select('.well-picker select', wellValue);
  await page.waitForFunction(() => document.querySelectorAll('.rdoc .r-h').length >= 10, { timeout: 15000 });
  await sleep(1500);
  const click = (text) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t) && !x.disabled); if (!b) throw new Error('button ' + t); b.click(); }, text);
  const waitFile = async (pred, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const f = existsSync(outDir) ? readdirSync(outDir).filter(pred) : []; if (f.length) return f; await sleep(400); } return []; };
  const textOf = async (file) => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise;
    const tc = await (await doc.getPage(1)).getTextContent();
    return { pages: doc.numPages, text: tc.items.map((i) => i.str).join(' ') };
  };
  await click('Excel workbook');
  const xlsx = await waitFile((f) => f.endsWith('.xlsx'));
  check('Excel report saved through the native-save channel', xlsx.length === 1 && statSync(join(outDir, xlsx[0])).size > 5000, xlsx.join(','));

  await click('Download PDF file');
  const img = await waitFile((f) => f.endsWith('.pdf'));
  await sleep(1500);
  const imgPath = join(outDir, img[0] || 'none.pdf');
  const imgInfo = img.length ? await textOf(imgPath) : { pages: 0, text: '' };
  check('one-click PDF file saved (page images, valid PDF)', img.length === 1 && readFileSync(imgPath).subarray(0, 5).toString() === '%PDF-' && imgInfo.pages >= 3, `${imgInfo.pages} pages, ${statSync(imgPath).size} bytes`);
  // only the footer (well ID and page number) is text; the report body is page images
  check('the image-based PDF has no selectable body text (as documented)', imgInfo.text.trim().length < 40 && !imgInfo.text.includes('Electron test well'), JSON.stringify(imgInfo.text.trim()));
  rmSync(imgPath);

  await click('Print / Save as PDF');
  const vec = await waitFile((f) => f.endsWith('.pdf'));
  await sleep(1500);
  const vecPath = join(outDir, vec[0] || 'none.pdf');
  const vecInfo = vec.length ? await textOf(vecPath) : { pages: 0, text: '' };
  check('vector PDF from the print engine has selectable text (well ID found)', vec.length === 1 && vecInfo.text.includes('ELC-1'), `${vecInfo.pages} pages`);

  // ---------------- backup to Documents folder (redirected to the test folder)
  await page.goto('app://welllog/index.html#/settings', { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');
  await click('Backup now to Documents');
  const backups = await waitFile((f) => f === 'Backups', 10000);
  await sleep(500);
  const bfiles = existsSync(join(outDir, 'Backups')) ? readdirSync(join(outDir, 'Backups')) : [];
  const backupJson = bfiles[0] ? JSON.parse(readFileSync(join(outDir, 'Backups', bfiles[0]), 'utf8')) : null;
  check('one-click backup writes a valid backup file', bfiles.length === 1 && /^welllog-backup-\d{8}-\d{6}\.json$/.test(bfiles[0]) && backupJson?.format === 'welllog-backup' && backupJson.tables.wells.length === 1, bfiles.join(','));
  void backups;

  // ---------------- no network, no errors
  const external = requests.filter((u) => /^https?:/i.test(u));
  check('no network request was made (fully offline-capable)', external.length === 0, external.slice(0, 3).join(' '));
  const csp = consoleErrors.concat(pageErrors).filter((m) => /Content Security Policy|CSP|Refused to/i.test(m));
  check('no CSP violations in normal use', csp.length === 0, csp.slice(0, 2).join(' | '));
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  // ---------------- single instance: a second launch hands over to the first and exits
  const second = spawn(electronExe, [...appArgs, `--remote-debugging-port=${PORT + 1}`, `--user-data-dir=${userData}`], { cwd: root, env, stdio: 'ignore' });
  const code = await new Promise((r) => { const t = setTimeout(() => { second.kill(); r('timeout'); }, 15000); second.on('exit', (c) => { clearTimeout(t); r(c); }); });
  check('a second launch exits immediately (single instance)', code === 0, String(code));
  check('the first window is still running', (await browser.pages()).some((p) => p.url().startsWith('app://welllog/')));
} catch (e) {
  check('e2e run completed', false, String(e.stack || e.message || e));
  exitCode = 1;
} finally {
  try { await browser?.disconnect(); } catch { /* closed */ }
  proc.kill();
  await sleep(800);
  try { rmSync(work, { recursive: true, force: true }); } catch { /* files still locked */ }
}
const failedAny = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedAny.length}/${results.length} checks passed`);
process.exit(exitCode || (failedAny.length ? 1 : 0));
