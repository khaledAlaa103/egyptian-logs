import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db.js';
import {
  createProject, updateProject, setProjectArchived, deleteProject,
  duplicateProject, exportProject, importProject,
} from '../../db/repos.js';
import { validateProject } from '../wells/validate.js';
import { downloadFile, readFileText, readFileBuffer, safeName } from '../../io/download.js';
import { usePrefs } from '../../app/PrefsContext.jsx';
import Modal from '../../design/Modal.jsx';
import { projectToWorkbook, parseProjectWorkbook, templateWorkbook } from '../../io/projectExcel.js';
import { importProjectExcel } from '../../db/projectExcelImport.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const EMPTY = { name: '', client: '', description: '' };

export default function Projects() {
  const { t } = usePrefs();
  const [q, setQ] = useState('');
  const [show, setShow] = useState('active');
  const [form, setForm] = useState(null); // {id?, ...fields}
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const wells = useLiveQuery(() => db.wells.toArray(), []);
  if (!projects || !wells) return null;

  const count = (id) => wells.filter((w) => w.projectId === id).length;
  const list = projects
    .filter((p) => show === 'all' || p.status === show)
    .filter((p) => !q || [p.name, p.client, p.description].join(' ').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const save = async (e) => {
    e.preventDefault();
    const errs = validateProject(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (form.id) await updateProject(form.id, { name: form.name.trim(), client: form.client, description: form.description });
    else await createProject(form);
    setForm(null);
  };

  const remove = async (p) => {
    const n = count(p.id);
    if (window.confirm(t('projects.confirmDelete').replace('{name}', p.name).replace('{n}', n))) {
      await deleteProject(p.id);
    }
  };

  const doExport = async (p) => {
    const bundle = await exportProject(p.id);
    downloadFile(`${safeName(p.name)}.welllog.json`, JSON.stringify(bundle, null, 2), 'application/json');
  };

  const saveXlsx = (name, buf) => downloadFile(name, new Blob([buf], { type: XLSX_MIME }));
  const doExportExcel = async (p) => saveXlsx(`${safeName(p.name)}.xlsx`, projectToWorkbook(await exportProject(p.id)));
  const doTemplate = () => saveXlsx('welllog-project-template.xlsx', templateWorkbook());

  const excelError = (err) => {
    const [, code, ...rest] = String(err.message).split(':');
    const base = t(`projects.excelErr.${code}`);
    const extra = rest.filter(Boolean);
    return base.startsWith('projects.') ? t('err.invalidFile') : `${base}${extra.length ? ` — ${extra.join(' · ')}` : ''}`;
  };

  const doImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (/\.json$/i.test(file.name)) {
      try {
        await importProject(JSON.parse(await readFileText(file)));
        setMsg({ ok: true, text: t('projects.importDone') });
      } catch (err) {
        setMsg({ ok: false, text: err.message === 'NEWER_VERSION' ? t('err.newerVersion') : t('err.invalidFile') });
      }
      return;
    }
    try {
      const parsed = parseProjectWorkbook(await readFileBuffer(file));
      const r = await importProjectExcel(parsed, { sourceName: file.name });
      const skipped = parsed.warnings.reduce((s, w) => s + (w.n || 1), 0);
      const parts = [t('projects.excelDone').replace('{w}', r.wells).replace('{c}', r.curves).replace('{f}', r.formations)];
      if (r.renamed.length) parts.push(t('projects.excelRenamed').replace('{list}', r.renamed.map(([a, b]) => `${a} → ${b}`).join(', ')));
      if (skipped) parts.push(t('projects.excelSkipped').replace('{n}', skipped));
      setMsg({ ok: true, text: parts.join(' ') });
    } catch (err) {
      setMsg({ ok: false, text: String(err.message).startsWith('EXCEL_INVALID') ? excelError(err) : t('err.invalidFile') });
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <section className="page">
      <div className="page-head">
        <h1>{t('nav.projects')}</h1>
        <div className="toolbar">
          <button className="btn primary" onClick={() => { setErrors({}); setForm({ ...EMPTY }); }}>
            + {t('projects.new')}
          </button>
          <button className="btn" onClick={() => fileRef.current.click()}>{t('projects.importExcel')}</button>
          <button className="btn" onClick={doTemplate}>{t('projects.template')}</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.json" hidden onChange={doImport}
            aria-label={t('projects.importExcel')} />
        </div>
      </div>
      <p className="muted small">{t('projects.excelHint')}</p>

      {msg && <div className={`notice ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}

      <div className="toolbar filters">
        <input type="search" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)}
          aria-label={t('common.search')} />
        <select value={show} onChange={(e) => setShow(e.target.value)} aria-label={t('common.status')}>
          <option value="active">{t('common.active')}</option>
          <option value="archived">{t('common.archived')}</option>
          <option value="all">{t('common.all')}</option>
        </select>
      </div>

      {list.length === 0 ? (
        <div className="card empty"><p>{t('projects.empty')}</p></div>
      ) : (
        <div className="card-grid">
          {list.map((p) => (
            <article className="card project-card" key={p.id}>
              <h2>{p.name} {p.status === 'archived' && <span className="badge">{t('common.archived')}</span>}</h2>
              <p className="muted">{p.client || '—'}</p>
              <p>{p.description}</p>
              <p className="muted">{t('nav.wells')}: <strong>{count(p.id)}</strong></p>
              <div className="toolbar wrap">
                <button className="btn sm" onClick={() => { setErrors({}); setForm({ ...p }); }}>{t('common.edit')}</button>
                <button className="btn sm" onClick={() => duplicateProject(p.id)}>{t('common.duplicate')}</button>
                <button className="btn sm" onClick={() => setProjectArchived(p.id, p.status !== 'archived')}>
                  {p.status === 'archived' ? t('common.unarchive') : t('common.archive')}
                </button>
                <button className="btn sm" onClick={() => doExportExcel(p)}>{t('projects.exportExcel')}</button>
                <button className="btn sm" onClick={() => doExport(p)}>{t('projects.exportJson')}</button>
                <button className="btn sm danger" onClick={() => remove(p)}>{t('common.delete')}</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {form && (
        <Modal title={form.id ? t('projects.edit') : t('projects.new')} onClose={() => setForm(null)}>
          <form onSubmit={save} className="form-grid" noValidate>
            <label>
              <span>{t('projects.name')} *</span>
              <input value={form.name} onChange={set('name')} autoFocus aria-invalid={!!errors.name} />
              {errors.name && <small className="err">{t(`err.${errors.name}`)}</small>}
            </label>
            <label><span>{t('projects.client')}</span><input value={form.client} onChange={set('client')} /></label>
            <label><span>{t('projects.description')}</span>
              <textarea rows="3" value={form.description} onChange={set('description')} /></label>
            <div className="toolbar end">
              <button type="button" className="btn" onClick={() => setForm(null)}>{t('common.cancel')}</button>
              <button type="submit" className="btn primary">{t('common.save')}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
