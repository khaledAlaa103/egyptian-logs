// Pure report model: turns gathered data into the 18 report sections (blocks of text, tables, lists,
// figures). No DOM, no database. All wording comes from `tr` (i18n) so the same model renders in
// Arabic (RTL) or English (LTR). Statuses are carried per cell so measured / corrected / calculated /
// estimated / manual values are always distinguishable.
import { COL, COLUMNS, columnAvailable, formatCell } from '../results/columns.js';
import { unitLabel } from '../engine/units/units.js';
import { getLog, logName } from '../registry/logRegistry.js';
import { METHOD_INFO } from '../engine/methodsInfo.js';
import { WATER_INFO } from '../engine/water/waterInfo.js';
import { screenInterval } from '../results/screening.js';

export const SECTION_IDS = [
  'cover', 'project', 'well', 'equipment', 'inputs', 'images', 'digitized', 'formations', 'resistivity', 'rw',
  'quality_tds', 'aquifer', 'tables', 'equations', 'assumptions', 'uncertainty', 'conclusions', 'recommendations',
];
export const STATUS_CODE = { measured: 'M', corrected: 'C', calculated: 'K', estimated: 'E', user: 'U' };

const sig = (v, d = 4) => (v == null || !Number.isFinite(v) ? '—' : String(Number(v.toPrecision(d))));
const cell = (t, s) => (s && STATUS_CODE[s] ? { t, s } : t);

export function buildReportModel(data, options = {}, tr) {
  const { well, project, rows, run, curves, units, estimates } = data;
  const lang = options.lang || 'en';
  const texts = options.texts || {};
  const has = (id) => options.sections?.[id] !== false;
  const U = (g) => units[g];
  const disp = (col, cellObj) => {
    const c = COL[col];
    return formatCell(col, cellObj.v, c.group ? U(c.group) : null) || '—';
  };
  const head = (col) => `${tr(`res.col.${col}`)}${COL[col].group ? ` (${unitLabel(U(COL[col].group))})` : ''}`;
  const valCell = (row, col) => { const c = row.cells[col]; return cell(c.v == null ? '—' : disp(col, c), c.v == null ? null : c.status); };
  const kv = (rowsKV) => ({ type: 'kv', rows: rowsKV.filter(([, v]) => v !== undefined && v !== null && v !== '') });
  const dash = (v) => (v === undefined || v === null || v === '' ? '—' : String(v));
  const section = (id, blocks) => ({ id, title: tr(`rep.s.${id}`), blocks });
  const noData = (key) => ({ type: 'notice', kind: 'warn', text: tr(key) });

  const sections = [];

  // 1 ----- cover
  sections.push(section('cover', [
    { type: 'cover', title: options.title || tr('rep.defaultTitle'), subtitle: `${well.wellId} — ${well.name}`,
      project: project?.name || '', date: (data.now || '').slice(0, 10), preparedBy: texts.preparedBy || '', company: texts.company || '', reviewedBy: texts.reviewedBy || '' },
    { type: 'legend', items: Object.entries(STATUS_CODE).map(([s, c]) => ({ code: c, label: tr(`res.status.${s}`) })), title: tr('rep.legendTitle'), note: tr('rep.legendNote') },
  ]));

  // 2 ----- project
  sections.push(section('project', project ? [kv([
    [tr('projects.name'), project.name], [tr('projects.client'), project.client], [tr('projects.description'), project.description],
    [tr('rep.created'), (project.createdAt || '').slice(0, 10)], [tr('rep.wellsInProject'), String(data.projectWells ?? 1)],
  ])] : [noData('rep.noProject')]));

  // 3 ----- well
  sections.push(section('well', [kv([
    [tr('wells.wellId'), well.wellId], [tr('wells.name'), well.name], [tr('wells.country'), well.country], [tr('wells.region'), well.region], [tr('wells.location'), well.location],
    [tr('rep.coordinates'), well.lat != null && well.lon != null ? `${sig(well.lat, 7)}, ${sig(well.lon, 7)}` : ''],
    [tr('wells.wellType'), well.wellType ? tr(`wells.types.${well.wellType}`) : ''], [`${tr('wells.totalDepth')} (m)`, well.totalDepth == null ? '' : sig(well.totalDepth, 6)],
    [`${tr('wells.groundElevation')} (m)`, well.groundElevation == null ? '' : sig(well.groundElevation, 6)],
    [tr('wells.drillingDate'), well.drillingDate], [tr('wells.loggingDate'), well.loggingDate], [tr('wells.formation'), well.formation], [tr('wells.notes'), well.notes],
  ])]));

  // 4 ----- equipment
  const curveNames = data.logRows.map((r) => getLog(r.curveId, data.custom)?.abbr || r.curveId);
  sections.push(section('equipment', [kv([
    [tr('wells.loggingCompany'), well.loggingCompany], [tr('wells.equipment'), well.equipment], [tr('wells.operator'), well.operator], [tr('wells.loggingDate'), well.loggingDate],
    [tr('rep.logsRun'), curveNames.join(', ')],
  ]), ...(!well.loggingCompany && !well.equipment ? [noData('rep.noEquipment')] : [])]));

  // 5 ----- input data summary
  const srcLabel = (s) => tr(`imp.sources.${s}`);
  const inputsTable = {
    type: 'table', head: [tr('imp.curve'), tr('rep.abbr'), tr('imp.unitStored'), tr('imp.points'), `${tr('imp.depthRange')} (m)`, tr('imp.source'), tr('rep.fileOrHeader')],
    rows: data.logRows.map((r) => {
      const def = getLog(r.curveId, data.custom);
      return [def ? logName(def, lang) : r.curveId, def?.abbr || r.curveId, unitLabel(r.unit), String(r.depth.length), `${sig(r.depth[0], 6)} – ${sig(r.depth[r.depth.length - 1], 6)}`, srcLabel(r.source), dash(r.meta?.fileName || r.meta?.imageName || r.header)];
    }),
  };
  sections.push(section('inputs', [
    kv([[tr('rep.curvesCount'), String(data.logRows.length)], [tr('rep.formationsCount'), String(data.formations.length)], [tr('rep.samplesCount'), String(data.samples.length)],
      [tr('rep.runUsed'), run ? run.name : tr('res.noRun')]]),
    data.logRows.length ? inputsTable : noData('viewer.noCurves'),
  ]));

  // 6 ----- original images
  sections.push(section('images', data.images.length
    ? [{ type: 'table', head: [tr('dig.steps.image'), 'px', tr('rep.type'), tr('rep.pdfPage')], rows: data.images.map((im) => [im.name, `${im.width} × ${im.height}`, im.mime, im.page ? `${im.page}/${im.pageCount}` : '—']) },
      ...(options.includeImages === false ? [{ type: 'notice', kind: 'info', text: tr('rep.imagesOmitted') }] : [{ type: 'figure', fig: 'images', caption: tr('rep.figImages') }])]
    : [noData('rep.noImages')]));

  // 7 ----- digitised curves
  const digRows = data.digitized.map((d) => {
    const def = getLog(d.curveId, data.custom);
    const manual = d.points.filter((p) => p.method === 'manual').length, auto = d.points.length - manual;
    return [def?.abbr || d.curveId, dash(d.imageName), String(d.points.length), `${manual} / ${auto}`, d.calibration?.depth ? `${sig(Math.abs(d.calibration.depth.b), 3)} m/px` : '—',
      d.quality?.depthResidualPx != null ? `${sig(d.quality.depthResidualPx, 3)} px` : '—', d.calibration?.scale ? tr(d.calibration.scale === 'log' ? 'imp.logarithmic' : 'imp.linear') : '—', d.resample ? `${d.resample.step} m` : tr('rep.noResample')];
  });
  sections.push(section('digitized', [
    ...(digRows.length ? [{ type: 'table', head: [tr('imp.curve'), tr('rep.image'), tr('imp.points'), tr('rep.manualAuto'), tr('dig.resolution'), tr('dig.residual'), tr('imp.scale'), tr('dig.resample')], rows: digRows },
      { type: 'p', text: tr('rep.digNote') }] : [{ type: 'notice', kind: 'info', text: tr('rep.noDigitized') }]),
    ...(data.logRows.length ? [{ type: 'figure', fig: 'log', caption: tr('rep.figLog') }] : []),
  ]));

  // 8 ----- depth and formation analysis
  const th = (r) => r.cells.thickness.v;
  sections.push(section('formations', rows.length ? [
    { type: 'table', head: ['#', tr('res.col.name'), head('top'), head('bottom'), head('thickness'), tr('res.col.lithology'), head('gr'), tr('res.col.waterBearing')],
      rows: rows.map((r) => [String(r.cells.number.v), dash(r.cells.name.v), valCell(r, 'top'), valCell(r, 'bottom'), valCell(r, 'thickness'), dash(r.cells.lithology.v), valCell(r, 'gr'), tr(`viewer.water_${r.cells.waterBearing.v}`)]) },
    kv([[tr('rep.totalThickness'), `${sig(rows.reduce((s, r) => s + th(r), 0), 5)} m`]]),
  ] : [noData('viewer.noFormations')]));

  // 9 ----- resistivity interpretation
  const rcfg = run?.config?.resistivity;
  sections.push(section('resistivity', [
    { type: 'notice', kind: 'info', text: tr('rep.apparentNote') },
    ...(run ? [kv([[tr('interp.rtMethodLabel'), rcfg?.method ? tr(`interp.rtMethod.${rcfg.method}`) : tr('rep.notDeclared')],
      [tr('interp.rtCurve'), rcfg?.rtCurve ? (getLog(rcfg.rtCurve, data.custom)?.abbr || rcfg.rtCurve) : ''], [tr('interp.rxoCurve'), rcfg?.rxoCurve ? (getLog(rcfg.rxoCurve, data.custom)?.abbr || rcfg.rxoCurve) : ''],
      ['J', rcfg?.J != null ? String(rcfg.J) : ''], ['K', rcfg?.factor != null ? String(rcfg.factor) : ''], [tr('interp.factorSource'), rcfg?.factorSource]])] : [noData('rep.noRun')]),
    ...(rows.length ? [{ type: 'table', head: ['#', tr('res.col.name'), head('rs'), head('rd'), head('rc'), head('rt')], rows: rows.map((r) => [String(r.cells.number.v), dash(r.cells.name.v), valCell(r, 'rs'), valCell(r, 'rd'), valCell(r, 'rc'), valCell(r, 'rt')]) }] : []),
  ]));

  // 10 ---- water resistivity analysis
  const rwcfg = run?.config?.rw;
  sections.push(section('rw', [
    { type: 'notice', kind: 'info', text: tr('rep.rwNote') },
    ...(run && rwcfg?.method ? [kv([[tr('interp.method'), tr(`interp.rwMethod.${rwcfg.method}`)], [tr('interp.rwSource'), rwcfg.source], [tr('interp.rwRefTemp'), rwcfg.refTemp != null ? `${rwcfg.refTemp} °C` : ''],
      [tr('wq.rwUncertainty'), data.waterSettings?.rwUncertaintyPct != null ? `${data.waterSettings.rwUncertaintyPct} %` : tr('rep.notQuantified')]])] : [noData('rep.noRw')]),
    ...(rows.length && run ? [{ type: 'table', head: ['#', tr('res.col.name'), head('rw'), `${tr('interp.series.temp')}`], rows: estimates.map((e) => [String(e.row.cells.number.v), dash(e.row.cells.name.v), valCell(e.row, 'rw'), e.tC != null ? sig(e.tC, 4) : '—']) }] : []),
  ]));

  // 11 ---- water quality and TDS
  const cal = data.calibration, nm = data.normalization;
  const wqBlocks = [{ type: 'notice', kind: 'info', text: tr('wq.principles') }];
  if (data.samples.length) {
    wqBlocks.push({ type: 'table', caption: tr('rep.directResults'), head: [tr('wq.sampleId'), `${tr('wq.depth')} (m)`, 'TDS (mg/L)', 'EC25 (µS/cm)', tr('wq.class'), tr('wq.source')],
      rows: (data.directResults || []).map((x) => [x.sampleId, `${sig(x.depthTop, 5)}${x.depthBottom != null ? `–${sig(x.depthBottom, 5)}` : ''}`, cell(x.tds != null ? sig(x.tds, 4) : '—', x.tds != null ? 'measured' : null), x.ec25 != null ? sig(x.ec25, 4) : '—', x.class ? tr(`wq.cls.${x.class}`) : '—', dash(x.source)]) });
  } else wqBlocks.push(noData('wq.noSamples'));
  wqBlocks.push(kv([
    [tr('wq.normMethod'), nm.method ? tr(`wq.norm.${nm.method}`) : tr('rep.notDeclared')], [tr('wq.alpha'), nm.method === 'alpha' ? String(nm.alpha) : ''],
    [tr('wq.calMode'), data.waterSettings?.calibration?.mode ? tr(`wq.mode.${data.waterSettings.calibration.mode}`) : tr('rep.notDeclared')],
    [tr('wq.model'), cal?.ok ? tr(`wq.models.${cal.model}`) : ''],
    [tr('wq.calSource'), cal?.ok ? (cal.source === 'manual' ? cal.sourceText : `${tr('wq.mode.local')} (n=${cal.n})`) : ''],
    [tr('wq.relRmse'), cal?.ok && cal.relRmse != null ? `${sig(cal.relRmse * 100, 3)} %` : ''],
    [tr('wq.validRange'), cal?.ok && cal.range ? `EC25 ${sig(cal.range[0], 4)} – ${sig(cal.range[1], 4)} µS/cm` : ''],
    [tr('wq.trace.tref'), '25 °C'],
  ]));
  if (!cal?.ok) wqBlocks.push(noData('wq.notReady'));
  if (data.pairs?.length) wqBlocks.push({ type: 'figure', fig: 'scatter', caption: tr('rep.figScatter') });
  wqBlocks.push(rows.length ? {
    type: 'table', caption: tr('rep.tdsByInterval'),
    head: ['#', tr('res.col.name'), 'Rw (Ω·m)', 'T (°C)', 'EC25 (µS/cm)', `${tr('wq.tdsEst')} (mg/L)`, '± %', `${tr('wq.tdsDirect')}`, 'Δ %', tr('wq.class'), tr('rep.basis')],
    rows: estimates.map((e) => {
      const applied = e.f.waterQuality;
      return [String(e.row.cells.number.v), dash(e.row.cells.name.v), e.rw != null ? cell(sig(e.rw, 4), e.rwStatus) : '—', e.tC != null ? sig(e.tC, 4) : '—', e.est ? sig(e.est.ec25, 4) : '—',
        e.est ? cell(sig(e.est.tds, 4), 'estimated') : '—', e.est ? (e.est.uncertainty.relPct != null ? sig(e.est.uncertainty.relPct, 2) : tr('wq.nq')) : '—',
        e.directTds != null ? cell(sig(e.directTds, 4), 'measured') : '—', e.diffPct != null ? sig(e.diffPct, 3) : '—',
        e.est?.class ? tr(`wq.cls.${e.est.class}`) : (e.reason ? tr(`wq.reason.${e.reason}`) : '—'),
        applied ? (applied.basis === 'direct' ? tr('wq.direct') : tr('wq.indirect')) : (e.est ? tr('wq.indirect') : '—')];
    }) } : noData('viewer.noFormations'));
  sections.push(section('quality_tds', wqBlocks));

  // 12 ---- aquifer / water-bearing zones
  const wb = rows.filter((r) => ['yes', 'probable'].includes(r.cells.waterBearing.v));
  const cut = data.cutoffs || {};
  const hasCut = ['vshMax', 'phiMin', 'swMin'].some((k) => cut[k] != null);
  sections.push(section('aquifer', [
    kv([[tr('dashboard.waterZones'), String(wb.length)], [tr('fa.waterThickness'), `${sig(wb.reduce((s, r) => s + th(r), 0), 5)} m`]]),
    ...(rows.length ? [{ type: 'table', head: ['#', tr('res.col.name'), head('top'), head('bottom'), head('thickness'), tr('res.col.waterBearing'), tr('res.col.aquiferClass'), tr('res.col.confidence'), head('vsh'), head('phi'), head('sw'), head('tds')],
      rows: rows.map((r) => [String(r.cells.number.v), dash(r.cells.name.v), valCell(r, 'top'), valCell(r, 'bottom'), valCell(r, 'thickness'), tr(`viewer.water_${r.cells.waterBearing.v}`), tr(`res.opt.aquiferClass.${r.cells.aquiferClass.v}`),
        r.cells.confidence.v ? tr(`res.opt.confidence.${r.cells.confidence.v}`) : '—', valCell(r, 'vsh'), valCell(r, 'phi'), valCell(r, 'sw'), valCell(r, 'tds')]) }] : [noData('viewer.noFormations')]),
    { type: 'p', text: tr('rep.statusNote') },
    ...(hasCut ? [{ type: 'p', text: `${tr('fa.screening')}: Vsh ≤ ${cut.vshMax ?? '—'}; φ ≥ ${cut.phiMin ?? '—'}; Sw ≥ ${cut.swMin ?? '—'}.` },
      { type: 'table', head: ['#', tr('res.col.name'), tr('fa.suggested'), tr('res.col.confidence'), tr('fa.criteria')],
        rows: rows.map((r) => { const s = screenInterval({ vsh: r.cells.vsh.v, phi: r.cells.phi.v, sw: r.cells.sw.v }, cut); return [String(r.cells.number.v), dash(r.cells.name.v), tr(`viewer.water_${s.status}`), tr(`res.opt.confidence.${s.confidence}`), [...s.passed.map((p) => `✓${p}`), ...s.failed.map((p) => `✗${p}`), ...s.notEvaluated.map((p) => `–${p}`)].join(' ')]; }) }] : []),
  ]));

  // 13 ---- interpretation tables (full)
  const cols = (data.view.visible || COLUMNS.map((c) => c.id)).filter((c) => COL[c] && (c !== 'tds' ? columnAvailable(c, { curves, run }) : true) && !['number', 'name', 'notes', 'interpretation'].includes(c));
  sections.push(section('tables', rows.length ? [
    { type: 'table', dense: true, head: ['#', tr('res.col.name'), ...cols.map(head)], rows: rows.map((r) => [String(r.cells.number.v), dash(r.cells.name.v), ...cols.map((c) => (COL[c].type === 'enum' ? (r.cells[c].v === '' ? '—' : (c === 'waterBearing' ? tr(`viewer.water_${r.cells[c].v}`) : tr(`res.opt.${c}.${r.cells[c].v}`))) : COL[c].type === 'text' ? dash(r.cells[c].v) : valCell(r, c)))]) },
    { type: 'p', text: tr('rep.tableNote') },
    ...rows.filter((r) => r.cells.interpretation.v || r.cells.notes.v).map((r) => ({ type: 'p', text: `#${r.cells.number.v} ${r.cells.name.v || ''}: ${[r.cells.interpretation.v, r.cells.notes.v].filter(Boolean).join(' — ')}` })),
  ] : [noData('viewer.noFormations')]));

  // 14 ---- scientific equations
  const methodIds = new Set([...(run?.methods || [])]);
  const waterIds = new Set();
  if (estimates.some((e) => e.est)) estimates.forEach((e) => e.est?.trace.methods.forEach((m) => waterIds.add(m)));
  if (estimates.some((e) => e.est?.class)) waterIds.add('class_winslow');
  const methodBlocks = [...methodIds].map((id) => METHOD_INFO[id] && { id, info: METHOD_INFO[id] }).filter(Boolean)
    .concat([...waterIds].map((id) => WATER_INFO[id] && { id, info: WATER_INFO[id] }).filter(Boolean));
  sections.push(section('equations', methodBlocks.length
    ? [{ type: 'methods', items: methodBlocks.map(({ id, info }) => ({ id, name: info.name[lang], equation: info.equation, source: info.source, validity: info.validity[lang] })) }]
    : [noData('rep.noMethods')]));

  // 15 ---- assumptions
  const cfg = run?.config || {};
  const P = (k, v, unit) => (v === undefined || v === null || v === '' ? null : [k, `${v}${unit ? ' ' + unit : ''}`]);
  const params = [
    P(tr('interp.sec.temp'), cfg.temperature?.method ? tr(`interp.tempMethod.${cfg.temperature.method}`) : null),
    P(tr('interp.tFormation'), cfg.temperature?.value, '°C'), P(tr('interp.tSurface'), cfg.temperature?.surface, '°C'), P(tr('interp.gradient'), cfg.temperature?.gradient, '°C/100 m'), P(tr('interp.source'), cfg.temperature?.source),
    P(tr('interp.vshModelLabel'), cfg.vshale?.model ? tr(`interp.vshModel.${cfg.vshale.model}`) : null), P('GR clean', cfg.vshale?.grClean, 'gAPI'), P('GR shale', cfg.vshale?.grShale, 'gAPI'),
    P(tr('interp.sec.phi'), cfg.porosity?.method ? tr(`interp.phiMethod.${cfg.porosity.method}`) : null), P('ρma', cfg.porosity?.rhoMa, 'g/cm³'), P('ρf', cfg.porosity?.rhoFl, 'g/cm³'), P('Δtma', cfg.porosity?.dtMa, 'µs/ft'), P('Δtf', cfg.porosity?.dtFl, 'µs/ft'),
    P(tr('interp.swModelLabel'), cfg.saturation?.model ? tr(`interp.swModel.${cfg.saturation.model}`) : null), P('a', cfg.saturation?.a), P('m', cfg.saturation?.m), P('n', cfg.saturation?.n), P('Rsh', cfg.saturation?.rsh, 'Ω·m'), P(tr('interp.vshLimit'), cfg.saturation?.vshLimit),
  ].filter(Boolean);
  const assumeSet = new Set();
  [...methodIds].forEach((id) => (METHOD_INFO[id]?.assumptions[lang] || []).forEach((a) => assumeSet.add(a)));
  [...waterIds].forEach((id) => (WATER_INFO[id]?.assumptions[lang] || []).forEach((a) => assumeSet.add(a)));
  sections.push(section('assumptions', [
    { type: 'p', text: tr('rep.assumeIntro') },
    params.length ? { type: 'table', head: [tr('rep.parameter'), tr('rep.value')], rows: params } : noData('rep.noRun'),
    ...(assumeSet.size ? [{ type: 'p', text: tr('rep.assumptionsList') }, { type: 'list', items: [...assumeSet] }] : []),
  ]));

  // 16 ---- data quality and uncertainty
  const warnText = (w) => tr(`fa.warn.${w.code}`).replace('{from}', sig(w.params.from)).replace('{to}', sig(w.params.to)).replace('{td}', w.params.td).replace('{thickness}', sig(w.params.thickness))
    .replace('{dz}', sig(w.params.dz)).replace('{vsh}', sig(w.params.vsh)).replace('{limit}', w.params.limit).replace('{share}', w.params.share != null ? Math.round(w.params.share * 100) : '').replace('{col}', w.params.col ? tr(`res.col.${w.params.col}`) : '');
  const fr = (id) => rows.find((r) => r.id === id);
  const diagLines = Object.entries(run?.diagnostics || {}).filter(([, d]) => d.missing > 0).map(([p, d]) => `${tr(`interp.series.${p === 'f' ? 'f' : p}`)}: ${d.computed}/${d.computed + d.missing} — ${Object.entries(d.reasons).slice(0, 3).map(([k, c]) => `${tr(`interp.reason.${k}`)} (${c})`).join('; ')}`);
  const unc = estimates.filter((e) => e.est).map((e) => `#${e.row.cells.number.v}: ${e.est.uncertainty.relPct != null ? `± ${sig(e.est.uncertainty.relPct, 2)} %` : tr('rep.notQuantified')}${e.est.flags.length ? ` (${e.est.flags.map((f) => tr(`wq.flag.${f}`)).join(', ')})` : ''}`);
  sections.push(section('uncertainty', [
    data.warnings.length ? { type: 'list', items: data.warnings.map((w) => `${w.severity === 'warning' ? '⚠ ' : 'ℹ '}${w.fid && fr(w.fid) ? `#${fr(w.fid).cells.number.v} ` : ''}${warnText(w)}`) } : { type: 'notice', kind: 'info', text: tr('fa.noWarnings') },
    ...((run?.notes || []).map((n) => ({ type: 'notice', kind: 'warn', text: tr(`interp.note.${n}`) }))),
    ...(diagLines.length ? [{ type: 'p', text: tr('rep.diagTitle') }, { type: 'list', items: diagLines }] : []),
    ...(run?.flagCounts && Object.keys(run.flagCounts).length ? [{ type: 'p', text: `${tr('interp.flags')}: ${Object.entries(run.flagCounts).map(([k, c]) => `${tr(`interp.flag.${k}`)} (${c})`).join(' · ')}` }] : []),
    ...(unc.length ? [{ type: 'p', text: tr('rep.tdsUncertainty') }, { type: 'list', items: unc }] : []),
    { type: 'p', text: tr('rep.uncertaintyNote') },
  ]));

  // 17 ---- conclusions (facts from the data + the author's own text)
  const facts = [];
  facts.push(tr('rep.fact.curves').replace('{n}', data.logRows.length).replace('{list}', curveNames.join(', ')));
  if (rows.length) facts.push(tr('rep.fact.intervals').replace('{n}', rows.length).replace('{top}', sig(rows[0].formation.top, 5)).replace('{bottom}', sig(rows[rows.length - 1].formation.bottom, 5)));
  if (wb.length) facts.push(tr('rep.fact.water').replace('{n}', wb.length).replace('{t}', sig(wb.reduce((s, r) => s + th(r), 0), 4)).replace('{names}', wb.map((r) => r.cells.name.v || `#${r.cells.number.v}`).join(', ')));
  else if (rows.length) facts.push(tr('rep.fact.noWater'));
  const tdsVals = rows.map((r) => r.cells.tds).filter((c) => c.v != null);
  if (tdsVals.length) facts.push(tr('rep.fact.tds').replace('{min}', sig(Math.min(...tdsVals.map((c) => c.v)), 4)).replace('{max}', sig(Math.max(...tdsVals.map((c) => c.v)), 4)).replace('{n}', tdsVals.length));
  if (data.warnings.filter((w) => w.severity === 'warning').length) facts.push(tr('rep.fact.warnings').replace('{n}', data.warnings.filter((w) => w.severity === 'warning').length));
  sections.push(section('conclusions', [
    { type: 'p', text: tr('rep.factsIntro') }, { type: 'list', items: facts },
    texts.conclusions ? { type: 'author', title: tr('rep.authorText'), text: texts.conclusions } : { type: 'notice', kind: 'info', text: tr('rep.noAuthorText') },
  ]));

  // 18 ---- recommendations
  const sug = [];
  if (!data.samples.length) sug.push(tr('rep.sug.samples'));
  if (data.samples.length && !(cal?.ok)) sug.push(tr('rep.sug.calibration'));
  if (rcfg?.method === 'direct') sug.push(tr('rep.sug.rt'));
  if (data.warnings.some((w) => w.code === 'water_but_clayey')) sug.push(tr('rep.sug.clayey'));
  if (wb.length) sug.push(tr('rep.sug.pumping'));
  if (data.warnings.some((w) => w.code === 'thin_interval')) sug.push(tr('rep.sug.thin'));
  sections.push(section('recommendations', [
    texts.recommendations ? { type: 'author', title: tr('rep.authorText'), text: texts.recommendations } : { type: 'notice', kind: 'info', text: tr('rep.noAuthorText') },
    ...(sug.length ? [{ type: 'p', text: tr('rep.suggestionsIntro') }, { type: 'list', items: sug }] : []),
  ]));

  const kept = sections.filter((s) => has(s.id));
  return { lang, dir: lang === 'ar' ? 'rtl' : 'ltr', title: options.title || tr('rep.defaultTitle'), sections: kept, wellId: well.wellId, generatedAt: data.now };
}

