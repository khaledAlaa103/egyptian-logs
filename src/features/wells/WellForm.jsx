import { usePrefs } from '../../app/PrefsContext.jsx';

const TYPES = ['water', 'oil', 'gas', 'geothermal', 'monitoring', 'exploration', 'other'];

// [key, input type, extra props]
const FIELDS = [
  ['wellId', 'text', { required: true }],
  ['name', 'text', { required: true }],
  ['country', 'text'], ['region', 'text'], ['location', 'text'],
  ['lat', 'number', { step: 'any' }], ['lon', 'number', { step: 'any' }],
  ['totalDepth', 'number', { step: 'any', unit: 'm' }],
  ['groundElevation', 'number', { step: 'any', unit: 'm' }],
  ['drillingDate', 'date'], ['loggingDate', 'date'],
  ['loggingCompany', 'text'], ['equipment', 'text'], ['operator', 'text'], ['formation', 'text'],
];

export default function WellForm({ form, setForm, errors, projects, onSubmit, onCancel }) {
  const { t } = usePrefs();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const err = (k) => errors[k] && <small className="err">{t(`err.${errors[k]}`)}</small>;

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="form-cols">
        <label>
          <span>{t('wells.project')} *</span>
          <select value={form.projectId} onChange={set('projectId')} aria-invalid={!!errors.projectId}>
            <option value="" disabled>—</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {err('projectId')}
        </label>
        <label>
          <span>{t('wells.wellType')}</span>
          <select value={form.wellType || ''} onChange={set('wellType')}>
            <option value="">—</option>
            {TYPES.map((x) => <option key={x} value={x}>{t(`wells.types.${x}`)}</option>)}
          </select>
        </label>
        {FIELDS.map(([key, type, o = {}]) => (
          <label key={key}>
            <span>{t(`wells.${key}`)}{o.required ? ' *' : ''}{o.unit ? ` (${o.unit})` : ''}</span>
            <input type={type} step={o.step} value={form[key] ?? ''} onChange={set(key)}
              aria-invalid={!!errors[key]} dir={type === 'number' || type === 'date' ? 'ltr' : undefined} />
            {err(key)}
          </label>
        ))}
        <label className="span-all">
          <span>{t('wells.notes')}</span>
          <textarea rows="3" value={form.notes ?? ''} onChange={set('notes')} />
        </label>
      </div>
      <div className="toolbar end">
        <button type="button" className="btn" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="submit" className="btn primary">{t('common.save')}</button>
      </div>
    </form>
  );
}
