import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db.js';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { translate } from '../../i18n/index.js';
import WellPicker from '../import/WellPicker.jsx';
import ReportDocument from '../../reports/ReportDocument.jsx';
import { gatherReportData } from '../../reports/gather.js';
import { buildReportModel, SECTION_IDS } from '../../reports/model.js';
import { logFigure, imageThumbs, scatterFigure } from '../../reports/figures.js';
import { elementToPdf } from '../../reports/pdf.js';
import { reportToWorkbook, curvesToCsv } from '../../reports/excel.js';
import { resultsToCsv } from '../../results/exportResults.js';
import { COL, COLUMNS } from '../../results/columns.js';
import { saveReport, listReports, deleteReport } from '../../db/reports.js';
import { downloadFile, safeName } from '../../io/download.js';

const optKey = (w) => `report:options:${w}`;
const defaults = (lang) => ({ lang, title: '', includeImages: true, runId: null, sections: {}, texts: {}, storePdf: false });

export default function ReportsPage() {
  const { t, lang: uiLang } = usePrefs();
  const [wellPk, setWellPk] = useState(null);
  const [opt, setOpt] = useState(null);
  const [data, setData] = useState(null);
  const [figures, setFigures] = useState({});
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [tick, setTick] = useState(0);
  const loaded = useRef(null);
  const docRef = useRef(null);

  const runs = useLiveQuery(() => (wellPk ? db.interpretations.where('wellId').equals(wellPk).toArray() : []), [wellPk], []);
  const saved = useLiveQuery(() => (wellPk ? listReports(wellPk) : []), [wellPk], []);

  // options per well (persisted)
  useEffect(() => {
    setOpt(null); setData(null); setFigures({}); setMsg(null); loaded.current = null;
    if (!wellPk) return undefined;
    let alive = true;
    db.preferences.get(optKey(wellPk)).then((r) => { if (alive) { loaded.current = r?.value || null; setOpt(r?.value || defaults(uiLang)); } });
    return () => { alive = false; };
  }, [wellPk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!wellPk || !opt || opt === loaded.current) return undefined;
    const h = setTimeout(() => db.preferences.put({ key: optKey(wellPk), value: opt }), 500);
    return () => clearTimeout(h);
  }, [opt, wellPk]);

  // gather data (re-run on option changes that affect data, and on refresh)
  useEffect(() => {
    if (!wellPk || !opt) return undefined;
    let alive = true;
    const h = setTimeout(() => gatherReportData(wellPk, { runId: opt.runId }).then((d) => { if (alive) setData(d); }), 250);
    return () => { alive = false; clearTimeout(h); };
  }, [wellPk, opt?.runId, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const tr = useMemo(() => (k) => translate(opt?.lang || uiLang, k), [opt?.lang, uiLang]);
  const model = useMemo(() => (data && opt ? buildReportModel(data, opt, tr) : null), [data, opt, tr]);

  // figures (canvas, browser only)
  useEffect(() => {
    if (!data || !opt) return undefined;
    let alive = true;
    (async () => {
      try {
        const f = {};
        f.log = await logFigure(data, opt.lang, { formations: tr('viewer.formations'), water: tr('viewer.water') });
        f.images = opt.includeImages === false ? [] : await imageThumbs(data.images);
        f.scatter = scatterFigure(data.pairs, data.calibration);
        if (alive) setFigures(f);
      } catch { if (alive) setFigures({}); }
    })();
    return () => { alive = false; };
  }, [data, opt?.lang, opt?.includeImages, tr]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setOpt((o) => ({ ...o, ...patch }));
  const setText = (k, v) => setOpt((o) => ({ ...o, texts: { ...o.texts, [k]: v } }));
  const toggle = (id, v) => setOpt((o) => ({ ...o, sections: { ...o.sections, [id]: v } }));
  const included = (id) => opt.sections[id] !== false;

  const fileBase = data ? safeName(`${data.well.wellId}_report`) : 'report';
  const makePdf = async () => elementToPdf(docRef.current, { title: model.title, footerText: data.well.wellId });

  const doPdf = async () => {
    setBusy('pdf'); setMsg(null);
    try {
      const { blob, pageCount } = await makePdf();
      downloadFile(`${fileBase}.pdf`, blob, 'application/pdf');
      setMsg({ ok: true, text: t('rep.ui.pdfDone').replace('{n}', pageCount) });
      if (opt.storePdf) await saveReport(wellPk, data.well.projectId, { id: opt.savedId, title: model.title, lang: opt.lang, options: opt, pdfBlob: blob, pageCount });
    } catch (e) { setMsg({ ok: false, text: t('rep.ui.pdfFail') }); }
    setBusy(null);
  };
  const doSave = async () => {
    const id = await saveReport(wellPk, data.well.projectId, { id: opt.savedId, title: model.title, lang: opt.lang, options: opt });
    set({ savedId: id }); setMsg({ ok: true, text: t('rep.ui.savedOk') });
  };
  const doXlsx = () => downloadFile(`${fileBase}.xlsx`, new Blob([reportToWorkbook(model, data, tr)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const doCsv = () => {
    const cols = (data.view.visible || COLUMNS.map((c) => c.id)).filter((c) => COL[c]);
    downloadFile(`${fileBase}_results.csv`, resultsToCsv({ rows: data.rows, cols, units: data.units, label: (c) => tr(`res.col.${c}`) }), 'text/csv;charset=utf-8');
  };
  const doCurves = () => downloadFile(`${safeName(data.well.wellId)}_curves.csv`, curvesToCsv(data), 'text/csv;charset=utf-8');

  const openSaved = (r) => { set({ ...r.options, savedId: r.id }); };

  return (
    <section className="page reports-page">
      <div className="page-head no-print"><h1>{t('nav.reports')}</h1></div>
      <p className="muted no-print">{t('rep.ui.intro')}</p>
      <div className="no-print"><WellPicker value={wellPk} onChange={setWellPk} /></div>
      {!wellPk && <div className="card empty"><p>{t('rep.ui.noWell')}</p></div>}

      {wellPk && opt && (
        <>
          <div className="rep-grid no-print">
            <div className="card">
              <div className="igrid sgrid">
                <label className="ifield"><span>{t('rep.ui.language')}</span>
                  <select value={opt.lang} aria-label={t('rep.ui.language')} onChange={(e) => set({ lang: e.target.value })}><option value="en">English</option><option value="ar">العربية</option></select></label>
                <label className="ifield"><span>{t('res.run')}</span>
                  <select value={opt.runId ?? ''} aria-label={t('res.run')} onChange={(e) => set({ runId: e.target.value === '' ? null : e.target.value === 'none' ? 'none' : Number(e.target.value) })}>
                    <option value="">{t('res.latestRun')}</option><option value="none">{t('res.noRun')}</option>{runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
                <label className="ifield wide"><span>{t('rep.ui.reportTitle')}</span><input value={opt.title} aria-label={t('rep.ui.reportTitle')} placeholder={tr('rep.defaultTitle')} onChange={(e) => set({ title: e.target.value })} /></label>
                <label className="ifield"><span>{t('rep.ui.preparedBy')}</span><input value={opt.texts.preparedBy || ''} aria-label={t('rep.ui.preparedBy')} onChange={(e) => setText('preparedBy', e.target.value)} /></label>
                <label className="ifield"><span>{t('rep.ui.reviewedBy')}</span><input value={opt.texts.reviewedBy || ''} aria-label={t('rep.ui.reviewedBy')} onChange={(e) => setText('reviewedBy', e.target.value)} /></label>
                <label className="ifield wide"><span>{t('rep.ui.company')}</span><input value={opt.texts.company || ''} aria-label={t('rep.ui.company')} onChange={(e) => setText('company', e.target.value)} /></label>
                <label className="ifield wide"><span>{t('rep.ui.conclusions')}</span><textarea rows="4" value={opt.texts.conclusions || ''} aria-label={t('rep.ui.conclusions')} onChange={(e) => setText('conclusions', e.target.value)} /></label>
                <label className="ifield wide"><span>{t('rep.ui.recommendations')}</span><textarea rows="4" value={opt.texts.recommendations || ''} aria-label={t('rep.ui.recommendations')} onChange={(e) => setText('recommendations', e.target.value)} /></label>
              </div>
            </div>
            <div className="card">
              <h3>{t('rep.ui.sections')}</h3>
              <div className="toolbar wrap"><button className="btn sm" onClick={() => set({ sections: {} })}>{t('rep.ui.selectAll')}</button>
                <button className="btn sm" onClick={() => set({ sections: Object.fromEntries(SECTION_IDS.map((s) => [s, s === 'cover'])) })}>{t('rep.ui.none')}</button></div>
              <div className="secs">
                {SECTION_IDS.map((id, i) => (
                  <label key={id} className="icheck"><input type="checkbox" checked={included(id)} aria-label={tr(`rep.s.${id}`)} onChange={(e) => toggle(id, e.target.checked)} /> {i + 1}. {tr(`rep.s.${id}`)}</label>
                ))}
              </div>
              <label className="icheck"><input type="checkbox" checked={opt.includeImages !== false} aria-label={t('rep.ui.includeImages')} onChange={(e) => set({ includeImages: e.target.checked })} /> {t('rep.ui.includeImages')}</label>
              <label className="icheck"><input type="checkbox" checked={!!opt.storePdf} aria-label={t('rep.ui.storePdf')} onChange={(e) => set({ storePdf: e.target.checked })} /> {t('rep.ui.storePdf')}</label>
            </div>
          </div>

          <div className="toolbar wrap no-print rep-actions">
            <button className="btn primary" disabled={!model} onClick={() => window.print()} title={t('rep.ui.printHint')}>{t('rep.ui.printPdf')}</button>
            <button className="btn primary" disabled={!model || busy} onClick={doPdf} title={t('rep.ui.pdfHint')}>{busy === 'pdf' ? t('rep.ui.generating') : t('rep.ui.downloadPdf')}</button>
            <button className="btn" disabled={!model} onClick={doXlsx}>{t('rep.ui.exportXlsx')}</button>
            <button className="btn" disabled={!model} onClick={doCsv}>{t('rep.ui.exportCsv')}</button>
            <button className="btn" disabled={!model || !data?.logRows.length} onClick={doCurves}>{t('rep.ui.exportCurves')}</button>
            <button className="btn" disabled={!model} onClick={doSave}>{t('rep.ui.saveReport')}</button>
            <button className="btn sm" onClick={() => setTick((x) => x + 1)}>⟳</button>
          </div>
          {msg && <div className={`notice ${msg.ok ? 'ok' : 'bad'} small no-print`} role="status">{msg.text}</div>}

          <h3 className="no-print">{t('rep.ui.preview')}</h3>
          <div className="rpreview">
            <div className="rpaper" ref={docRef}>{model ? <ReportDocument model={model} figures={figures} /> : <p className="muted pad">{t('rep.ui.generating')}</p>}</div>
          </div>

          <div className="card no-print" style={{ marginTop: '1rem' }}>
            <h3>{t('rep.ui.saved')}</h3>
            {saved.length === 0 ? <p className="muted">{t('rep.ui.noSaved')}</p> : (
              <ul className="img-list">
                {saved.map((r) => (
                  <li key={r.id}><span className="grow">{r.title} <span className="muted small" dir="ltr">({r.lang}{r.pageCount ? `, ${r.pageCount} ${t('rep.ui.pages')}` : ''}) {(r.updatedAt || '').slice(0, 16).replace('T', ' ')}</span></span>
                    <button className="btn sm" onClick={() => openSaved(r)}>{t('rep.ui.open')}</button>
                    {r.pdf && <button className="btn sm" onClick={() => downloadFile(`${safeName(r.title)}.pdf`, r.pdf, 'application/pdf')}>{t('rep.ui.download')} PDF</button>}
                    <button className="icon-x" aria-label={`${t('common.delete')} ${r.title}`} onClick={() => window.confirm(t('rep.ui.confirmDelete')) && deleteReport(r.id)}>×</button></li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
