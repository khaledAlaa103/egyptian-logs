/* global axe */
// Accessibility audit with axe-core in a real browser: every section, English/Arabic, light/dark.
//   npm run build && npm run e2e:a11y     (fails on serious/critical violations)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, sleep, startPreview, launch, seedInPage, ROUTES, pickWell } from './lib/e2e-common.mjs';

const PORT = Number(process.env.E2E_PORT || 4182), BASE = `http://localhost:${PORT}/`;
const axeSrc = readFileSync(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
const server = await startPreview(PORT);
const { browser, cleanup } = await launch();
const found = new Map(); // rule id -> { impact, help, nodes, pages }
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');
  await page.evaluate(seedInPage);
  for (const [lang, theme] of [['en', 'light'], ['ar', 'light'], ['en', 'dark']]) {
    await page.evaluate((l, t) => localStorage.setItem('welllog.prefs.v1', JSON.stringify({ lang: l, theme: t, sidebarCollapsed: false })), lang, theme);
    for (const r of ROUTES) {
      await page.goto(`${BASE}#/${r}`, { waitUntil: 'networkidle0' });
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('h1');
      await pickWell(page);
      await sleep(500);
      await page.evaluate(axeSrc);
      const res = await page.evaluate(async () => {
        const out = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, resultTypes: ['violations'] });
        return out.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
      });
      for (const v of res) {
        const e = found.get(v.id) || { impact: v.impact, help: v.help, pages: new Set(), nodes: new Set() };
        e.pages.add(`${lang}-${theme}-${r || 'dashboard'}`); v.nodes.forEach((n) => e.nodes.add(n)); found.set(v.id, e);
      }
    }
  }
} finally { await cleanup(); server.kill(); }
const rank = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const list = [...found.entries()].sort((a, b) => rank[a[1].impact] - rank[b[1].impact]);
for (const [id, e] of list) console.log(`${e.impact.toUpperCase().padEnd(9)} ${id}: ${e.help} - ${e.pages.size} page(s); e.g. ${[...e.nodes].slice(0, 2).join(' | ')}`);
const blocking = list.filter(([, e]) => e.impact === 'critical' || e.impact === 'serious');
console.log(`\n${list.length} rule(s) violated, ${blocking.length} serious/critical`);
process.exit(blocking.length ? 1 : 0);
