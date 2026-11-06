import { useEffect, useState } from 'react';

/** Number field that keeps what the user types; reports undefined when empty, ignores invalid text. */
export function NumField({ label, value, onChange, unit, help, step = 'any', min }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => { if (Number(text) !== value && !(text === '' && value == null)) setText(value == null ? '' : String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="ifield">
      <span>{label}{unit ? <em> ({unit})</em> : null}</span>
      <input dir="ltr" inputMode="decimal" value={text} aria-label={label} step={step} min={min}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (v.trim() === '') onChange(undefined);
          else if (Number.isFinite(Number(v.replace(',', '.')))) onChange(Number(v.replace(',', '.')));
        }} />
      {help && <small className="muted">{help}</small>}
    </label>
  );
}

export function SelectField({ label, value, onChange, options, help }) {
  return (
    <label className="ifield">
      <span>{label}</span>
      <select value={value ?? ''} aria-label={label} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">—</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <small className="muted">{help}</small>}
    </label>
  );
}

export function TextField({ label, value, onChange, help, required }) {
  return (
    <label className="ifield wide">
      <span>{label}{required ? ' *' : ''}</span>
      <input value={value ?? ''} aria-label={label} onChange={(e) => onChange(e.target.value)} />
      {help && <small className="muted">{help}</small>}
    </label>
  );
}

export function Check({ label, checked, onChange }) {
  return (
    <label className="icheck"><input type="checkbox" checked={!!checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
  );
}

export function Section({ title, children, open = true, note }) {
  return (
    <details className="isection" open={open}>
      <summary>{title}</summary>
      {note && <p className="muted small">{note}</p>}
      <div className="igrid">{children}</div>
    </details>
  );
}
