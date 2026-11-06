import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db.js';
import { createWell, updateWell, setWellArchived, deleteWell, duplicateWell, exportWell } from '../../db/repos.js';
import { validateWell, normalizeWell } from './validate.js';
import { toCsv } from '../../io/csvWriter.js';
import { downloadFile, safeName } from '../../io/download.js';
import { usePrefs } from '../../app/PrefsContext.jsx';
import Modal from '../../design/Modal.jsx';
import WellForm from './WellForm.jsx';

export const WELL_TYPES = ['water', 'oil', 'gas', 'geothermal', 'monitoring', 'exploration', 'other'];

const CSV_COLUMNS = [
  'wellId', 'name', 'country', 'region', 'location', 'lat', 'lon', 'wellType', 'totalDepth',
  'groundElevation', 'drillingDate', 'loggingDate', 'loggingCompany', 'equipment', 'operator',
  'formation', 'notes', 'status',
];

export default function Wells() {
  const { t } = usePrefs();
  const [q, setQ] = useState('');
  const [fProject, setFProject] = useState('');
  const [fType, setFType] = useState('');
  const [fCountry, setFCountry] = useState('');
  const [fStatus, setFStatus] = useState('active');
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});

  const wells = useLiveQuery(() => db.wells.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);

  const countries = useMemo(
    () => [...new Set((wells || []).map((w) => w.country).filter(Boolean))].sort(),
    [wells]
  );
  if (!wells || !projects) return null;

  const pName = (id) => projects.find((p) => p.id === id)?.name || '—';
  const activeProjects = projects.filter((p) => p.status !== 'archived');

  const list = wells
    .filter((w) => fStatus === 'all' || w.status === fStatus)
    .filter((w) => !fProject || w.projectId === Number(fProject))
    .filter((w) => !fType || w.wellType === fType)
    .filter((w) => !fCountry || w.country === fCountry)
    .filter((w) => !q || [w.wellId, w.name, w.country, w.region, w.location, w.operator, w.formation, w.loggingCompany]
      .join(' ').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.wellId.localeCompare(b.wellId));

  const openNew = () => {
    setErrors({});
    setForm({ projectId: fProject || (activeProjects[0]?.id ?? ''), wellId: '', name: '', wellType: 'water' });
  };

  const save = async (e) => {
    e.preventDefault();
    const others = wells.filter((w) => w.id !== form.id).map((w) => w.wellId);
    const errs = validateWell(form, others);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const data = { ...normalizeWell(form), projectId: Number(form.projectId) };
    if (form.id) { const { id, ...rest } = data; await updateWell(id, rest); } // eslint-disable-line no-unused-vars
    else await createWell(data);
    setForm(null);
  };

  const remove = async (w) => {
    if (window.confirm(t('wells.confirmDelete').replace('{name}', `${w.wellId} — ${w.name}`))) await deleteWell(w.id);
  };

  const exportCsv = () => {
    const cols = CSV_COLUMNS.map((k) => ({ key: k, label: k }));
    downloadFile('wells.csv', toCsv(list, cols), 'text/csv;charset=utf-8');
  };

  const exportJson = async (w) => {
    downloadFile(`${safeName(w.wellId)}.welllog.json`, JSON.stringify(await exportWell(w.id), null, 2), 'application/json');
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>{t('nav.wells')}</h1>
        <div className="toolbar">
          <button className="btn primary" onClick={openNew} disabled={activeProjects.length === 0}>+ {t('wells.new')}</button>
          <button className="btn" onClick={exportCsv} disabled={list.length === 0}>{t('wells.exportCsv')}</button>
        </div>
      </div>
      {activeProjects.length === 0 && <div className="notice bad">{t('wells.needProject')}</div>}

      <div className="toolbar filters">
        <input type="search" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)}
          aria-label={t('common.search')} />
        <select value={fProject} onChange={(e) => setFProject(e.target.value)} aria-label={t('wells.project')}>
          <option value="">{t('wells.project')}: {t('common.all')}</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={fType} onChange={(e) => setFType(e.target.value)} aria-label={t('wells.wellType')}>
          <option value="">{t('wells.wellType')}: {t('common.all')}</option>
          {WELL_TYPES.map((x) => <option key={x} value={x}>{t(`wells.types.${x}`)}</option>)}
        </select>
        <select value={fCountry} onChange={(e) => setFCountry(e.target.value)} aria-label={t('wells.country')}>
          <option value="">{t('wells.country')}: {t('common.all')}</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label={t('common.status')}>
          <option value="active">{t('common.active')}</option>
          <option value="archived">{t('common.archived')}</option>
          <option value="all">{t('common.all')}</option>
        </select>
      </div>

      {list.length === 0 ? (
        <div className="card empty"><p>{t('wells.empty')}</p></div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('wells.wellId')}</th><th>{t('wells.name')}</th><th>{t('wells.project')}</th>
                <th>{t('wells.country')}</th><th>{t('wells.wellType')}</th>
                <th className="num">{t('wells.totalDepth')}</th><th>{t('wells.loggingDate')}</th><th />
              </tr>
            </thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.id} className={w.status === 'archived' ? 'is-archived' : ''}>
                  <td data-label={t('wells.wellId')}><strong>{w.wellId}</strong></td>
                  <td data-label={t('wells.name')}>{w.name}</td>
                  <td data-label={t('wells.project')}>{pName(w.projectId)}</td>
                  <td data-label={t('wells.country')}>{w.country || '—'}</td>
                  <td data-label={t('wells.wellType')}>{w.wellType ? t(`wells.types.${w.wellType}`) : '—'}</td>
                  <td className="num" data-label={t('wells.totalDepth')}>{w.totalDepth ?? '—'}</td>
                  <td data-label={t('wells.loggingDate')}>{w.loggingDate || '—'}</td>
                  <td className="row-actions">
                    <button className="btn sm" onClick={() => { setErrors({}); setForm({ ...w }); }}>{t('common.edit')}</button>
                    <button className="btn sm" onClick={() => duplicateWell(w.id)}>{t('common.duplicate')}</button>
                    <button className="btn sm" onClick={() => setWellArchived(w.id, w.status !== 'archived')}>
                      {w.status === 'archived' ? t('common.unarchive') : t('common.archive')}
                    </button>
                    <button className="btn sm" onClick={() => exportJson(w)}>JSON</button>
                    <button className="btn sm danger" onClick={() => remove(w)}>{t('common.delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal wide title={form.id ? t('wells.edit') : t('wells.new')} onClose={() => setForm(null)}>
          <WellForm form={form} setForm={setForm} errors={errors} projects={activeProjects.length ? activeProjects : projects}
            onSubmit={save} onCancel={() => setForm(null)} />
        </Modal>
      )}
    </section>
  );
}
