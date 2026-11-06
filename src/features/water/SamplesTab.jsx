import { useState } from 'react';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { addSample, updateSample, deleteSample, validateSample } from '../../db/water.js';
import { classifySalinity } from '../../engine/water/water.js';

const EMPTY = { sampleId: '', depthTop: '', depthBottom: '', date: '', tds: '', ec: '', ecUnit: 'uS/cm', ecTemp: '', rw: '', rwTemp: '', source: '', notes: '' };
const f4 = (v) => (v == null ? '—' : Number(v.toPrecision(4)).toString());

function Field({ label, children, error, t }) {
  return <label className="ifield">{<span>{label}</span>}{children}{error && <small className="err">{t(`wq.err.${error}`)}</small>}</label>;
}

export default function SamplesTab({ w }) {
  const { t } = usePrefs();
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const er = validateSample(form);
    setErrors(er);
    if (Object.keys(er).length) return;
    if (editing) await updateSample(editing, form); else await addSample(w.well.id, form);
    setForm(EMPTY); setEditing(null);
  };
  const edit = (s) => {
    setEditing(s.id);
    setForm({ sampleId: s.sampleId, depthTop: s.depthTop ?? '', depthBottom: s.depthBottom ?? '', date: s.date || '', tds: s.tds ?? '', ec: s.ecEntered ?? '', ecUnit: s.ecUnit || 'uS/cm', ecTemp: s.ecTemp ?? '', rw: s.rw ?? '', rwTemp: s.rwTemp ?? '', source: s.source || '', notes: s.notes || '' });
    setErrors({});
  };

  return (
    <div>
      <div className="notice ok small">{t('wq.directNote')}</div>
      <form onSubmit={submit} noValidate className="card" style={{ marginTop: '.8rem' }}>
        <h3>{editing ? t('wq.editSample') : t('wq.newSample')}</h3>
        <div className="igrid sgrid">
          <Field t={t} label={`${t('wq.sampleId')} *`} error={errors.sampleId}><input value={form.sampleId} onChange={set('sampleId')} aria-label={t('wq.sampleId')} /></Field>
          <Field t={t} label={`${t('wq.depthTop')} (m) *`} error={errors.depthTop}><input dir="ltr" value={form.depthTop} onChange={set('depthTop')} aria-label={t('wq.depthTop')} /></Field>
          <Field t={t} label={`${t('wq.depthBottom')} (m)`} error={errors.depthBottom}><input dir="ltr" value={form.depthBottom} onChange={set('depthBottom')} aria-label={t('wq.depthBottom')} /></Field>
          <Field t={t} label={t('wq.date')}><input type="date" dir="ltr" value={form.date} onChange={set('date')} aria-label={t('wq.date')} /></Field>
          <Field t={t} label="TDS (mg/L)" error={errors.tds}><input dir="ltr" value={form.tds} onChange={set('tds')} aria-label="TDS" /></Field>
          <Field t={t} label="EC" error={errors.ec}>
            <div className="inline-pair"><input dir="ltr" value={form.ec} onChange={set('ec')} aria-label="EC" />
              <select value={form.ecUnit} onChange={set('ecUnit')} aria-label={t('wq.ecUnit')}><option value="uS/cm">µS/cm</option><option value="mS/cm">mS/cm</option><option value="mS/m">mS/m</option><option value="S/m">S/m</option></select></div></Field>
          <Field t={t} label={`${t('wq.ecTemp')} (°C)`} error={errors.ecTemp}><input dir="ltr" value={form.ecTemp} onChange={set('ecTemp')} aria-label={t('wq.ecTemp')} /></Field>
          <Field t={t} label="Rw (Ω·m)" error={errors.rw}><input dir="ltr" value={form.rw} onChange={set('rw')} aria-label="Rw" /></Field>
          <Field t={t} label={`${t('wq.rwTemp')} (°C)`} error={errors.rwTemp}><input dir="ltr" value={form.rwTemp} onChange={set('rwTemp')} aria-label={t('wq.rwTemp')} /></Field>
          <Field t={t} label={`${t('wq.source')} *`} error={errors.source}><input value={form.source} onChange={set('source')} aria-label={t('wq.source')} /></Field>
          <Field t={t} label={t('wq.notes')}><input value={form.notes} onChange={set('notes')} aria-label={t('wq.notes')} /></Field>
        </div>
        <p className="muted small">{t('wq.sampleHint')}</p>
        <div className="toolbar">
          <button type="submit" className="btn primary">{editing ? t('common.save') : `+ ${t('wq.addSample')}`}</button>
          {editing && <button type="button" className="btn" onClick={() => { setEditing(null); setForm(EMPTY); setErrors({}); }}>{t('common.cancel')}</button>}
        </div>
      </form>

      <h3>{t('wq.samples')}</h3>
      {w.samples.length === 0 ? <p className="muted">{t('wq.noSamples')}</p> : (
        <div className="table-wrap">
          <table className="data compact">
            <thead><tr><th>{t('wq.sampleId')}</th><th>{t('wq.depth')} (m)</th><th className="num">TDS (mg/L)</th><th className="num">EC25 (µS/cm)</th><th>{t('wq.class')}</th><th>{t('wq.source')}</th><th /></tr></thead>
            <tbody>
              {w.direct.map(({ s, r }) => (
                <tr key={s.id}>
                  <td><strong>{s.sampleId}</strong></td><td dir="ltr">{f4(s.depthTop)}{s.depthBottom != null ? `–${f4(s.depthBottom)}` : ''}</td>
                  <td className="num">{f4(s.tds)}</td><td className="num">{r.ec25 != null ? f4(r.ec25) : (r.ecIssue ? <span className="muted small">{t(`wq.issue.${r.ecIssue}`)}</span> : '—')}</td>
                  <td>{s.tds ? t(`wq.cls.${classifySalinity(s.tds)}`) : '—'}</td><td className="small">{s.source}</td>
                  <td className="row-actions"><button className="btn sm" onClick={() => edit(s)}>{t('common.edit')}</button>
                    <button className="icon-x" aria-label={`${t('common.delete')} ${s.sampleId}`} onClick={() => window.confirm(t('wq.confirmDelete')) && deleteSample(s.id)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
