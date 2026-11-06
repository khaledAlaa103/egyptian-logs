import { useEffect, useMemo, useState } from 'react';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { parseCsvText, parseWorkbook, parseDelimited } from '../../io/tableParse.js';
import { readFileText } from '../../io/download.js';
import {
  DEFAULT_NULLS, buildPreview, detectHeaderRow, guessMapping,
} from '../../io/importEngine.js';
import { getLog, acceptedUnitsOf, logName } from '../../registry/logRegistry.js';
import { unitLabel } from '../../engine/units/units.js';
import { saveCurves } from '../../db/curves.js';
import CurveSelect from './CurveSelect.jsx';

const DEPTH_UNITS = ['m', 'ft', 'cm'];
const fmt = (n) => (n == null ? '—' : Number(n.toPrecision(7)).toString());

function issueText(t, i, custom, lang) {
  const def = i.curveId ? getLog(i.curveId, custom) : null;
  const name = def ? def.abbr : '';
  return t(`imp.issue.${i.code}`)
    .replace('{row}', i.row ?? '').replace('{curve}', name).replace('{value}', i.value ?? '')
    .replace('{first}', i.firstRow ?? '').replace('{header}', i.header ?? '');
}

/** kind: 'csv' | 'excel'. well: well record (id, totalDepth). custom: custom curve defs. */
export default function TableImportWizard({ kind, well, custom }) {
  const { t, lang } = usePrefs();
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState(null);
  const [sheets, setSheets] = useState(null); // {sheetNames, sheets}
  const [sheet, setSheet] = useState('');
  const [delimiter, setDelimiter] = useState('');
  const [text, setText] = useState('');
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState({});
  const [decimal, setDecimal] = useState('auto');
  const [nullText, setNullText] = useState(DEFAULT_NULLS.filter(Boolean).join(', '));
  const [mode, setMode] = useState('replace');
  const [done, setDone] = useState(null);

  const reset = () => { setRows(null); setSheets(null); setError(null); setDone(null); setFile(null); };
  useEffect(reset, [kind]);

  const applyRows = (r) => {
    setRows(r);
    const h = detectHeaderRow(r);
    setHeaderRow(h);
    setMapping(guessMapping(r[h] || [], custom));
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    reset();
    setFile(f);
    try {
      if (kind === 'csv') {
        const txt = await readFileText(f);
        setText(txt);
        const p = parseCsvText(txt);
        setDelimiter(p.delimiter);
        applyRows(p.rows);
      } else {
        const wb = parseWorkbook(await f.arrayBuffer());
        if (!wb.sheetNames.length) throw new Error('empty');
        setSheets(wb);
        setSheet(wb.sheetNames[0]);
        applyRows(wb.sheets[wb.sheetNames[0]]);
      }
    } catch {
      setError(t('err.invalidFile'));
    }
  };

  const changeDelimiter = (d) => {
    setDelimiter(d);
    applyRows(parseDelimited(text, d));
  };
  const changeSheet = (s) => { setSheet(s); applyRows(sheets.sheets[s]); };
  const changeHeader = (h) => { setHeaderRow(h); setMapping(guessMapping(rows[h] || [], custom)); };

  const nullValues = useMemo(() => [...nullText.split(',').map((s) => s.trim()), ''], [nullText]);
  const preview = useMemo(
    () => (rows ? buildPreview(rows, headerRow, mapping, { nullValues, decimal, totalDepth: well?.totalDepth ?? null, custom }) : null),
    [rows, headerRow, mapping, nullValues, decimal, well, custom]
  );

  const setMap = (col, patch) => setMapping((m) => ({ ...m, [col]: { ...m[col], ...patch } }));
  const headers = rows ? rows[headerRow] || [] : [];
  const sample = (c) => rows.slice(headerRow + 1, headerRow + 4).map((r) => r[c]).filter((x) => x !== '' && x != null).join(' · ');

  const canSave = preview && !preview.blocking.length && preview.curves.length > 0 && !!well;

  const save = async () => {
    await saveCurves(well.id, preview.curves, {
      mode, source: kind,
      meta: { fileName: file?.name, sheet: kind === 'excel' ? sheet : undefined, delimiter: kind === 'csv' ? delimiter : undefined,
        nullValues, decimal, errors: preview.summary.errors, warnings: preview.summary.warnings },
    });
    const n = preview.curves.length;
    reset();
    setDone(n);
  };

  return (
    <div className="wizard">
      {done != null && <div className="notice ok" role="status">{t('imp.saved').replace('{n}', done)}</div>}
      {error && <div className="notice bad" role="alert">{error}</div>}

      <label className="file-drop">
        <span className="btn primary">{t(kind === 'csv' ? 'imp.chooseCsv' : 'imp.chooseExcel')}</span>
        <input type="file" hidden aria-label={t(kind === 'csv' ? 'imp.chooseCsv' : 'imp.chooseExcel')}
          accept={kind === 'csv' ? '.csv,.tsv,.txt,text/csv' : '.xlsx,.xls'} onChange={onFile} />
        <span className="muted">{file ? file.name : t('imp.noFile')}</span>
      </label>

      {rows && (
        <>
          <div className="opts">
            {kind === 'excel' && sheets.sheetNames.length > 0 && (
              <label><span>{t('imp.sheet')}</span>
                <select value={sheet} onChange={(e) => changeSheet(e.target.value)}>
                  {sheets.sheetNames.map((s) => <option key={s}>{s}</option>)}
                </select></label>
            )}
            {kind === 'csv' && (
              <label><span>{t('imp.delimiter')}</span>
                <select value={delimiter} onChange={(e) => changeDelimiter(e.target.value)}>
                  <option value=",">, ({t('imp.comma')})</option>
                  <option value=";">; ({t('imp.semicolon')})</option>
                  <option value={'\t'}>{t('imp.tab')}</option>
                  <option value="|">|</option>
                </select></label>
            )}
            <label><span>{t('imp.headerRow')}</span>
              <input type="number" min="1" max={Math.max(1, rows.length - 1)} value={headerRow + 1}
                onChange={(e) => changeHeader(Math.max(0, Math.min(rows.length - 2, Number(e.target.value) - 1 || 0)))} /></label>
            <label><span>{t('imp.decimal')}</span>
              <select value={decimal} onChange={(e) => setDecimal(e.target.value)}>
                <option value="auto">{t('imp.auto')}</option>
                <option value=".">1234.5</option>
                <option value=",">1234,5</option>
              </select></label>
            <label className="wide"><span>{t('imp.nullValues')}</span>
              <input value={nullText} onChange={(e) => setNullText(e.target.value)} dir="ltr" /></label>
          </div>

          <h2>{t('imp.mapping')}</h2>
          <div className="table-wrap">
            <table className="data mapping">
              <thead><tr><th>{t('imp.column')}</th><th>{t('imp.sample')}</th><th>{t('imp.role')}</th><th>{t('imp.unit')}</th></tr></thead>
              <tbody>
                {headers.map((h, c) => {
                  const m = mapping[c] || { role: 'ignore', unit: null };
                  const def = m.role !== 'depth' && m.role !== 'ignore' ? getLog(m.role, custom) : null;
                  const units = m.role === 'depth' ? DEPTH_UNITS : def ? acceptedUnitsOf(def) : [];
                  const miss = preview?.blocking.some((b) => b.col === c);
                  return (
                    <tr key={c}>
                      <td data-label={t('imp.column')}><strong>{String(h) || `#${c + 1}`}</strong></td>
                      <td data-label={t('imp.sample')} className="muted" dir="ltr">{sample(c)}</td>
                      <td data-label={t('imp.role')}>
                        <CurveSelect value={m.role} custom={custom} aria-label={`${t('imp.role')} ${h}`}
                          onChange={(v) => setMap(c, { role: v, unit: v === 'depth' || v === 'ignore' ? m.unit : (acceptedUnitsOf(getLog(v, custom)).includes(m.unit) ? m.unit : null) })}
                          extraOptions={[{ value: 'ignore', label: `— ${t('imp.ignore')} —` }, { value: 'depth', label: t('imp.depthCol') }]} />
                      </td>
                      <td data-label={t('imp.unit')}>
                        <select value={m.unit || ''} disabled={!units.length} aria-invalid={miss} aria-label={`${t('imp.unit')} ${h}`}
                          onChange={(e) => setMap(c, { unit: e.target.value || null })}>
                          <option value="">— {t('imp.selectUnit')} —</option>
                          {units.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview && (
            <>
              <h2>{t('imp.preview')}</h2>
              {preview.blocking.length > 0 && (
                <div className="notice bad" role="alert">
                  <strong>{t('imp.fixFirst')}</strong>
                  <ul>{preview.blocking.map((b, i) => <li key={i}>{issueText(t, { ...b, code: `blocking_${b.code}` }, custom, lang)}</li>)}</ul>
                </div>
              )}
              {!preview.blocking.length && (
                <p className="muted">
                  {t('imp.summary').replace('{read}', preview.summary.rowsRead).replace('{used}', preview.summary.rowsUsed)
                    .replace('{e}', preview.summary.errors).replace('{w}', preview.summary.warnings)}
                </p>
              )}
              {preview.curves.length > 0 && (
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>{t('imp.curve')}</th><th>{t('imp.unitStored')}</th><th className="num">{t('imp.points')}</th>
                      <th className="num">{t('imp.min')}</th><th className="num">{t('imp.max')}</th>
                      <th className="num">{t('imp.missing')}</th><th className="num">{t('imp.invalid')}</th></tr></thead>
                    <tbody>
                      {preview.curves.map((c) => {
                        const d = getLog(c.curveId, custom);
                        return (
                          <tr key={c.curveId}>
                            <td data-label={t('imp.curve')}><strong>{d.abbr}</strong> {logName(d, lang)}</td>
                            <td data-label={t('imp.unitStored')}>{unitLabel(c.unit)}</td>
                            <td className="num" data-label={t('imp.points')}>{c.stats.n}</td>
                            <td className="num" data-label={t('imp.min')}>{fmt(c.stats.min)}</td>
                            <td className="num" data-label={t('imp.max')}>{fmt(c.stats.max)}</td>
                            <td className="num" data-label={t('imp.missing')}>{c.stats.missing}</td>
                            <td className="num" data-label={t('imp.invalid')}>{c.stats.invalid}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {preview.issues.length > 0 && (
                <details className="issues" open={preview.summary.errors > 0}>
                  <summary>{t('imp.issues')} ({preview.issues.length})</summary>
                  <ul>
                    {preview.issues.slice(0, 100).map((i, k) => (
                      <li key={k} className={i.severity}>{i.severity === 'error' ? '✖' : '⚠'} {issueText(t, i, custom, lang)}</li>
                    ))}
                    {preview.issues.length > 100 && <li className="muted">… +{preview.issues.length - 100}</li>}
                  </ul>
                </details>
              )}
              <div className="toolbar wrap save-bar">
                <label className="inline"><span>{t('imp.ifExists')}</span>
                  <select value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="replace">{t('imp.replace')}</option>
                    <option value="merge">{t('imp.merge')}</option>
                  </select></label>
                <button className="btn primary" disabled={!canSave} onClick={save}>{t('imp.confirmSave')}</button>
                {preview.summary.errors > 0 && canSave && <span className="muted">{t('imp.errorsExcluded')}</span>}
                {!well && <span className="err">{t('imp.selectWell')}</span>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
