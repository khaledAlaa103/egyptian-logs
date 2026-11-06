import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db.js';
import { listFormations } from '../../db/intervals.js';
import { listInterpretations } from '../../db/interp.js';
import { buildRows } from '../../results/columns.js';

/** Shared loader for the Results and Formation-analysis pages. runId: selected interpretation (null = latest). */
export default function useResultsData(wellPk, runId, sources) {
  const well = useLiveQuery(() => (wellPk ? db.wells.get(wellPk) : undefined), [wellPk]);
  const formations = useLiveQuery(() => (wellPk ? listFormations(wellPk) : []), [wellPk], []);
  const logRows = useLiveQuery(() => (wellPk ? db.logMeasurements.where('wellId').equals(wellPk).toArray() : []), [wellPk], []);
  const runs = useLiveQuery(() => (wellPk ? listInterpretations(wellPk) : []), [wellPk], []);

  const curves = useMemo(() => Object.fromEntries(logRows.map((r) => [r.curveId, { depth: r.depth, values: r.values, unit: r.unit }])), [logRows]);
  const sortedRuns = useMemo(() => [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [runs]);
  const run = useMemo(() => sortedRuns.find((r) => r.id === runId) || (runId === 'none' ? null : sortedRuns[0] || null), [sortedRuns, runId]);
  const ctx = useMemo(() => ({ curves, run, sources: sources || {} }), [curves, run, sources]);
  const rows = useMemo(() => buildRows([...formations].sort((a, b) => a.top - b.top), ctx), [formations, ctx]);
  return { well, formations, curves, runs: sortedRuns, run, ctx, rows };
}
