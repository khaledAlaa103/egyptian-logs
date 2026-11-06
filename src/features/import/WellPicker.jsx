import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db.js';
import { usePrefs } from '../../app/PrefsContext.jsx';

/** Selects the target well. value: well primary key (number) or null. */
export default function WellPicker({ value, onChange }) {
  const { t } = usePrefs();
  const wells = useLiveQuery(() => db.wells.filter((w) => w.status !== 'archived').toArray(), []);
  if (!wells) return null;
  if (wells.length === 0) return <div className="notice bad">{t('imp.noWells')}</div>;
  return (
    <label className="well-picker">
      <span>{t('imp.targetWell')}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">— {t('imp.selectWell')} —</option>
        {wells.sort((a, b) => a.wellId.localeCompare(b.wellId)).map((w) => (
          <option key={w.id} value={w.id}>{w.wellId} — {w.name}</option>
        ))}
      </select>
    </label>
  );
}
