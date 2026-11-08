// Opens a visible Chrome window on the built app with the SYNTHETIC sample well loaded (for hands-on trying).
//   npm run build && node scripts/demo.mjs
import puppeteer from 'puppeteer-core';
import { startPreview, findBrowser, seedInPage } from './lib/e2e-common.mjs';

const PORT = 4195, BASE = `http://localhost:${PORT}/`;
const server = await startPreview(PORT);
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: false, defaultViewport: null, args: ['--no-first-run', '--start-maximized'] });
const page = (await browser.pages())[0];
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.waitForSelector('h1');
const empty = process.argv.includes('--empty'); // start with no data (e.g. to try the Excel project import)
if (!empty) await page.evaluate(seedInPage);
await page.evaluate(() => localStorage.setItem('welllog.prefs.v1', JSON.stringify({ lang: 'ar', theme: 'light', sidebarCollapsed: false })));
await page.goto(`${BASE}#/${empty ? 'projects' : 'viewer'}`, { waitUntil: 'networkidle0' });
await page.reload({ waitUntil: 'networkidle0' });
console.log('Demo open. Close the Chrome window to finish.');
browser.on('disconnected', () => { server.kill(); process.exit(0); });
