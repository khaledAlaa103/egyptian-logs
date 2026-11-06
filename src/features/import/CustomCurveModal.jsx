import { useState } from 'react';
import Modal from '../../design/Modal.jsx';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { addCustomCurve } from '../../db/curves.js';

export default function CustomCurveModal({ onClose }) {
  const { t } = usePrefs();
  const [f, setF] = useState({ abbr: '', name: '', unit: '', scale: 'linear', min: '', max: '' });
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!f.abbr.trim() || !f.name.trim() || !f.unit.trim()) { setErr(t('err.required')); return; }
    const num = (v) => (v === '' ? null : Number(v));
    if ((f.min !== '' && !Number.isFinite(Number(f.min))) || (f.max !== '' && !Number.isFinite(Number(f.max)))) { setErr(t('err.number')); return; }
    try {
      await addCustomCurve({ ...f, min: num(f.min), max: num(f.max) });
      onClose();
    } catch (x) {
      setErr(x.message === 'DUPLICATE' ? t('err.duplicate') : t('err.required'));
    }
  };

  return (
    <Modal title={t('imp.customCurve')} onClose={onClose}>
      <form onSubmit={submit} className="form-grid" noValidate>
        <label><span>{t('imp.abbr')} *</span><input value={f.abbr} onChange={set('abbr')} autoFocus /></label>
        <label><span>{t('imp.curveName')} *</span><input value={f.name} onChange={set('name')} /></label>
        <label><span>{t('imp.unit')} *</span><input value={f.unit} onChange={set('unit')} /></label>
        <label><span>{t('imp.scale')}</span>
          <select value={f.scale} onChange={set('scale')}>
            <option value="linear">{t('imp.linear')}</option><option value="log">{t('imp.logarithmic')}</option>
          </select></label>
        <label><span>{t('imp.min')}</span><input dir="ltr" value={f.min} onChange={set('min')} /></label>
        <label><span>{t('imp.max')}</span><input dir="ltr" value={f.max} onChange={set('max')} /></label>
        {err && <div className="notice bad">{err}</div>}
        <div className="toolbar end">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn primary">{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}
