// Screening of intervals as potential water-bearing zones, using cut-offs the USER defines.
// No cut-off has a default. The result is a suggestion: it is only written to a formation when
// the user applies it, and it is never "yes" (a water-bearing zone must be confirmed by a person,
// e.g. from a pumping test or a sample).

/**
 * stats: { vsh, phi, sw } interval means (or null). cutoffs: { vshMax, phiMin, swMin } (any may be undefined).
 * Criteria that cannot be evaluated (missing cut-off or missing data) are listed, not assumed.
 */
export function screenInterval(stats, cutoffs = {}) {
  const crit = [
    { id: 'vsh', value: stats.vsh, cutoff: cutoffs.vshMax, pass: (v, c) => v <= c },
    { id: 'phi', value: stats.phi, cutoff: cutoffs.phiMin, pass: (v, c) => v >= c },
    { id: 'sw', value: stats.sw, cutoff: cutoffs.swMin, pass: (v, c) => v >= c },
  ];
  const evaluable = crit.filter((c) => Number.isFinite(c.value) && Number.isFinite(c.cutoff));
  const failed = evaluable.filter((c) => !c.pass(c.value, c.cutoff)).map((c) => c.id);
  const passed = evaluable.filter((c) => c.pass(c.value, c.cutoff)).map((c) => c.id);
  const notEvaluated = crit.filter((c) => !evaluable.includes(c)).map((c) => c.id);
  let status = 'unknown';
  if (failed.length) status = 'no';
  else if (evaluable.length >= 2) status = 'probable';
  // confidence = completeness of evidence, nothing else
  const confidence = evaluable.length >= 3 ? 'high' : evaluable.length === 2 ? 'medium' : 'low';
  return { status, confidence, passed, failed, notEvaluated };
}
