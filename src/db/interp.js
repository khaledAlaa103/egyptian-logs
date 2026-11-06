import { db as defaultDb } from './db.js';

const now = () => new Date().toISOString();
const cfgKey = (wellId) => `interp:config:${wellId}`;

export async function loadConfig(wellId, db = defaultDb) {
  return (await db.preferences.get(cfgKey(wellId)))?.value || null;
}
export const saveConfig = (wellId, config, db = defaultDb) => db.preferences.put({ key: cfgKey(wellId), value: config });

/** Persist a finished run (inputs + outputs + methods) so reports can reproduce it. */
export function saveInterpretation(wellId, { name, config, result }, db = defaultDb) {
  return db.interpretations.add({
    wellId, name: name || '', config, createdAt: now(),
    depth: result.depth, series: result.series, flags: result.flags, summary: result.summary,
    diagnostics: result.diagnostics, methods: result.methods, flagCounts: result.flagCounts,
  });
}
export const listInterpretations = (wellId, db = defaultDb) => db.interpretations.where('wellId').equals(wellId).toArray();
export const deleteInterpretation = (id, db = defaultDb) => db.interpretations.delete(id);
