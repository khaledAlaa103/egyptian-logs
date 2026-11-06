import { CATEGORIES, CATEGORY_NAMES, ALL_BUILTIN, logName } from '../../registry/logRegistry.js';
import { usePrefs } from '../../app/PrefsContext.jsx';

/** <select> of curves grouped by category. extra: custom curve defs. skipImage hides the (non-numeric) image log. */
export default function CurveSelect({ value, onChange, custom = [], disabledIds = [], extraOptions = [], ...rest }) {
  const { t, lang } = usePrefs();
  const all = [...ALL_BUILTIN.filter((l) => l.kind === 'curve'), ...custom];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {extraOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      {CATEGORIES.map((cat) => {
        const items = all.filter((l) => (l.custom ? 'additional' : l.category) === cat);
        if (!items.length) return null;
        return (
          <optgroup key={cat} label={CATEGORY_NAMES[cat][lang]}>
            {items.map((l) => (
              <option key={l.id} value={l.id} disabled={disabledIds.includes(l.id)}>
                {l.abbr} — {logName(l, lang)}{disabledIds.includes(l.id) ? ` (${t('imp.locked')})` : ''}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
