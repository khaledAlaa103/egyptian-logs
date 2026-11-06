// Smoke test: on every section (English and Arabic) click every visible, enabled button and
// fail on any uncaught exception, React error boundary or console error.
//   npm run build && npm run e2e:smoke
import { startPreview, launch, seedInPage, ROUTES, pickWell, sleep } from './lib/e2e-common.mjs';

const PORT = Number(process.env.E2E_PORT || 4183), BASE = `http://localhost:${PORT}/`;
const SKIP = /delete|remove|clear|حذف|مسح|×/i; // destructive controls are covered by unit/UI tests
const server = await startPreview(PORT);
const { browser, cleanup } = await launch();
const problems = [];
let clicks = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => problems.push(`pageerror @${page.url()}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const txt = m.text();
    if (/Failed to load resource|favicon|net::ERR/.test(txt)) return;
    problems.push(`console.error @${page.url()}: ${txt.slice(0, 200)}`);
  });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');
  await page.evaluate(seedInPage);
  for (const lang of ['en', 'ar']) {
    await page.evaluate((l) => localStorage.setItem('welllog.prefs.v1', JSON.stringify({ lang: l, theme: 'light', sidebarCollapsed: false })), lang);
    for (const r of ROUTES) {
      await page.goto(`${BASE}#/${r}`, { waitUntil: 'networkidle0' });
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('h1');
      await pickWell(page);
      const n = await page.$$eval('main button, [role=main] button', (b) => b.length).catch(() => 0);
      for (let i = 0; i < n; i++) {
        const info = await page.evaluate((idx) => {
          const b = [...document.querySelectorAll('main button, [role=main] button')][idx];
          if (!b || b.disabled || !b.offsetParent) return null;
          return (b.textContent || b.getAttribute('aria-label') || '').trim();
        }, i).catch(() => null);
        if (info == null || SKIP.test(info)) continue;
        await page.evaluate((idx) => [...document.querySelectorAll('main button, [role=main] button')][idx]?.click(), i).catch(() => {});
        clicks++;
        await sleep(60);
        if (await page.$('.error-boundary, [data-error-boundary]')) problems.push(`error boundary after "${info}" on ${lang}/${r}`);
        if (!page.url().includes(`#/${r}`)) await page.goto(`${BASE}#/${r}`, { waitUntil: 'networkidle0' }).then(() => pickWell(page));
      }
    }
  }
} finally { await cleanup(); server.kill(); }
console.log(`${clicks} buttons clicked across ${ROUTES.length} sections x 2 languages`);
if (problems.length) { console.log([...new Set(problems)].slice(0, 20).join('\n')); console.log(`\n${problems.length} problem(s)`); process.exit(1); }
console.log('Smoke test: no errors');
