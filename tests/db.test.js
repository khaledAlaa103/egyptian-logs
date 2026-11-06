import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db.js';
import {
  createProject, createWell, deleteProject, deleteWell, duplicateWell, duplicateProject,
  exportProject, importProject, exportBackup, restoreBackup, setWellArchived,
} from '../src/db/repos.js';
import { getWorkspaceStats } from '../src/db/stats.js';
import { validateWell, normalizeWell } from '../src/features/wells/validate.js';
import { encodeRow, decodeRow } from '../src/db/serialize.js';
import { toCsv } from '../src/io/csvWriter.js';

async function seed() {
  const pid = await createProject({ name: 'P1' });
  const wid = await createWell({ projectId: pid, wellId: 'W-1', name: 'Well One', totalDepth: 120 });
  await db.logMeasurements.add({ wellId: wid, curveId: 'GR', depth: [1, 2], values: [10, 20] });
  await db.formations.add({ wellId: wid, top: 10, bottom: 20, waterBearing: 'yes' });
  await db.logImages.add({ wellId: wid, name: 'img', blob: new Blob(['abc'], { type: 'text/plain' }) });
  return { pid, wid };
}

describe('well validation', () => {
  const ok = { projectId: 1, wellId: 'A', name: 'n' };
  it('accepts a minimal valid well', () => expect(validateWell(ok)).toEqual({}));
  it('requires id, name and project', () => {
    expect(validateWell({})).toEqual({ projectId: 'required', wellId: 'required', name: 'required' });
  });
  it('rejects duplicate well id case-insensitively', () => {
    expect(validateWell(ok, ['a']).wellId).toBe('duplicate');
  });
  it('validates coordinates, depth and date order', () => {
    const e = validateWell({ ...ok, lat: '95', lon: 'x', totalDepth: '-5', drillingDate: '2024-02-01', loggingDate: '2024-01-01' });
    expect(e).toMatchObject({ lat: 'range', lon: 'number', totalDepth: 'range', loggingDate: 'dateOrder' });
  });
  it('normalises numbers incl. decimal comma', () => {
    expect(normalizeWell({ wellId: ' A ', name: 'n', totalDepth: '12,5', lat: '' }))
      .toMatchObject({ wellId: 'A', totalDepth: 12.5, lat: null });
  });
});

describe('repositories', () => {
  beforeEach(async () => { await db.delete(); await db.open(); });

  it('duplicates a well with all its data and a unique id', async () => {
    const { wid } = await seed();
    const nid = await duplicateWell(wid);
    expect((await db.wells.get(nid)).wellId).toBe('W-1-copy');
    expect(await db.logMeasurements.where('wellId').equals(nid).count()).toBe(1);
    expect(await db.formations.where('wellId').equals(nid).count()).toBe(1);
    const nid2 = await duplicateWell(wid);
    expect((await db.wells.get(nid2)).wellId).toBe('W-1-copy2');
  });

  it('deleting a well removes its children only', async () => {
    const { wid } = await seed();
    const nid = await duplicateWell(wid);
    await deleteWell(wid);
    expect(await db.wells.get(wid)).toBeUndefined();
    expect(await db.logMeasurements.where('wellId').equals(wid).count()).toBe(0);
    expect(await db.logMeasurements.where('wellId').equals(nid).count()).toBe(1);
  });

  it('deleting a project cascades', async () => {
    const { pid } = await seed();
    await deleteProject(pid);
    expect(await db.wells.count()).toBe(0);
    expect(await db.formations.count()).toBe(0);
    expect(await db.logImages.count()).toBe(0);
  });

  it('duplicates a project with its wells', async () => {
    const { pid } = await seed();
    const np = await duplicateProject(pid);
    expect((await db.projects.get(np)).name).toBe('P1 (copy)');
    expect(await db.wells.where('projectId').equals(np).count()).toBe(1);
    expect(await db.wells.count()).toBe(2);
  });

  it('project JSON round-trips as a new project without id clashes', async () => {
    const { pid } = await seed();
    const bundle = JSON.parse(JSON.stringify(await exportProject(pid)));
    const np = await importProject(bundle);
    expect(np).not.toBe(pid);
    const [w] = await db.wells.where('projectId').equals(np).toArray();
    expect(w.wellId).toBe('W-1-imp2');
    expect(await db.logImages.where('wellId').equals(w.id).count()).toBe(1);
    expect((await db.logMeasurements.where('wellId').equals(w.id).first()).values).toEqual([10, 20]);
  });

  it('rejects invalid / newer project files', async () => {
    await expect(importProject({ format: 'x' })).rejects.toThrow('INVALID_FORMAT');
    await expect(importProject({ format: 'welllog-project', schemaVersion: 99, project: {}, wells: [] }))
      .rejects.toThrow('NEWER_VERSION');
  });

  it('full backup restores exactly and replaces current data', async () => {
    await seed();
    const backup = JSON.parse(JSON.stringify(await exportBackup()));
    await createProject({ name: 'Extra' });
    await restoreBackup(backup);
    expect(await db.projects.count()).toBe(1);
    expect(await db.wells.count()).toBe(1);
    expect(await db.logMeasurements.count()).toBe(1);
  });

  it('invalid backup leaves data untouched', async () => {
    await seed();
    await expect(restoreBackup({ format: 'nope' })).rejects.toThrow('INVALID_FORMAT');
    expect(await db.wells.count()).toBe(1);
  });

  it('stats reflect real data and warnings; archived wells excluded', async () => {
    const { pid, wid } = await seed();
    await createWell({ projectId: pid, wellId: 'W-2', name: 'No data' });
    let s = await getWorkspaceStats();
    expect(s).toMatchObject({ projects: 1, wells: 2, curves: 1, formations: 1, waterZones: 1 });
    expect(s.warnings.map((x) => x.key).sort()).toEqual(['noCoords', 'noDepth', 'noLogs']);
    await setWellArchived(wid, true);
    s = await getWorkspaceStats();
    expect(s).toMatchObject({ wells: 1, curves: 0, formations: 0 });
  });
});

describe('csv writer', () => {
  it('escapes quotes and commas and adds BOM', () => {
    const csv = toCsv([{ a: 'x,"y"', b: 1 }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]);
    expect(csv).toBe('﻿A,B\r\n"x,""y""",1');
  });
});

describe('blob serialisation', () => {
  // NOTE: fake-indexeddb cannot store jsdom Blobs (real browsers/Electron can), so this is tested directly.
  it('encodes Blob to data URL and restores it', async () => {
    const enc = await encodeRow({ name: 'a', blob: new Blob(['abc'], { type: 'text/plain' }) });
    expect(enc.blob.__blob).toMatch(/^data:text\/plain;base64,/);
    const dec = decodeRow(JSON.parse(JSON.stringify(enc)));
    expect(dec.blob).toBeInstanceOf(Blob);
    expect(dec.blob.size).toBe(3);
    expect(dec.blob.type).toBe('text/plain');
  });
});
