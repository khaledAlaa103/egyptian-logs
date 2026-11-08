import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/app/App.jsx';
import { PrefsProvider } from '../src/app/PrefsContext.jsx';
import { db } from '../src/db/db.js';
import { createProject, createWell, exportProject } from '../src/db/repos.js';
import { saveCurves } from '../src/db/curves.js';
import { projectToWorkbook, parseProjectWorkbook, templateWorkbook } from '../src/io/projectExcel.js';
import { importProjectExcel } from '../src/db/projectExcelImport.js';
import { buildWorkbookBuffer, parseWorkbook } from '../src/io/tableParse.js';
import en from '../src/i18n/en.js';

async function seed() {
  const pid = await createProject({ name: 'Aquifer', client: 'C', description: 'D' });
  const wid = await createWell({ projectId: pid, wellId: 'W-1', name: 'Well 1', totalDepth: 100, wellType: 'water', lat: 30.1 });
  await saveCurves(wid, [
    { curveId: 'gr', unit: 'gAPI', points: [{ depth: 1, value: 50 }, { depth: 2, value: 60 }] },
    { curveId: 'res_deep', unit: 'ohm.m', points: [{ depth: 1, value: 10 }, { depth: 3, value: 12 }] },
  ], { source: 'manual' });
  await db.formations.add({ wellId: wid, top: 0, bottom: 40, name: 'Clay', lithology: 'clay', waterBearing: 'no' });
  return { pid, wid };
}

const book = (over = {}) => buildWorkbookBuffer({
  Project: [['Name', 'New P'], ['Client', 'X']],
  Wells: [['Well ID', 'Name', 'Total depth (m)'], ['B-1', 'Bore 1', 50]],
  Logs: [['Well ID', 'Depth (m)', 'GR (gAPI)'], ['B-1', 1, 40], ['B-1', 2, 'abc']],
  ...over,
});

describe('project Excel workbook', () => {
  beforeEach(async () => { await db.delete(); await db.open(); });

  it('round-trips export -> import as a new project with identical curves', async () => {
    const { pid } = await seed();
    const parsed = parseProjectWorkbook(projectToWorkbook(await exportProject(pid)));
    expect(parsed.project).toMatchObject({ name: 'Aquifer', client: 'C' });
    const r = await importProjectExcel(parsed);
    expect(r).toMatchObject({ wells: 1, curves: 2, formations: 1, renamed: [['W-1', 'W-1-imp2']] });
    const w = await db.wells.where('projectId').equals(r.projectId).first();
    expect(w).toMatchObject({ wellId: 'W-1-imp2', totalDepth: 100, lat: 30.1 });
    const gr = await db.logMeasurements.where('[wellId+curveId]').equals([w.id, 'gr']).first();
    expect(gr.depth).toEqual([1, 2]); expect(gr.values).toEqual([50, 60]); expect(gr.source).toBe('excel');
    const rd = await db.logMeasurements.where('[wellId+curveId]').equals([w.id, 'res_deep']).first();
    expect(rd.depth).toEqual([1, 3]); // blank cells are not invented
    expect(await db.formations.where('wellId').equals(w.id).count()).toBe(1);
  });

  it('reports invalid log cells instead of importing them', () => {
    const p = parseProjectWorkbook(book());
    expect(p.logs[0].curves[0].points.map((x) => x.value)).toEqual([40]);
    expect(p.warnings).toEqual([{ code: 'log_rows_skipped', wellId: 'B-1', n: 1 }]);
  });

  it('rejects missing sheets, names, unknown wells and missing units', () => {
    const err = (o) => { try { parseProjectWorkbook(book(o)); return null; } catch (e) { return e.message; } };
    expect(err({ Project: [['Name', '']] })).toBe('EXCEL_INVALID:no_project_name');
    expect(err({ Wells: [['Well ID', 'Name']] })).toBe('EXCEL_INVALID:no_wells');
    expect(err({ Logs: [['Well ID', 'Depth (m)', 'GR (gAPI)'], ['ZZ', 1, 4]] })).toBe('EXCEL_INVALID:log_unknown_well:zz');
    expect(err({ Logs: [['Well ID', 'Depth', 'GR (gAPI)'], ['B-1', 1, 4]] })).toMatch(/^EXCEL_INVALID:log_blocking:B-1:unit_missing/);
    expect(parseWorkbook(templateWorkbook()).sheetNames).toEqual(['Project', 'Wells', 'Logs', 'Formations']);
  });

  it('template headers are accepted by the importer once filled in', () => {
    const t = parseWorkbook(templateWorkbook()).sheets;
    const filled = buildWorkbookBuffer({
      Project: [['Name', 'T']], Wells: [t.Wells[0], ['A', 'a']], Logs: [t.Logs[0], ['A', 1, 50, 10, 2.3, -20]], Formations: t.Formations,
    });
    expect(parseProjectWorkbook(filled).logs[0].curves.map((c) => c.curveId).sort()).toEqual(['density', 'gr', 'res_deep', 'sp']);
  });

  it('Projects page imports an .xlsx file', async () => {
    const user = userEvent.setup();
    render(<PrefsProvider><MemoryRouter initialEntries={['/projects']}><App /></MemoryRouter></PrefsProvider>);
    const input = await screen.findByLabelText(en.projects.importExcel);
    await user.upload(input, new File([book()], 'p.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    expect(await screen.findByText(/New project created: 1 well\(s\), 1 curve\(s\), 0 formation\(s\)/)).toBeInTheDocument();
    expect(await screen.findByText('New P')).toBeInTheDocument();
  });
});
