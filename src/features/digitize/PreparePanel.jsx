import { usePrefs } from '../../app/PrefsContext.jsx';
import { workingSize } from '../../digitize/transform.js';

export default function PreparePanel({ image, processing, setProcessing, tool, setTool }) {
  const { t } = usePrefs();
  const rot = processing.rotation || 0;
  const ws = workingSize(image.width, image.height, processing);
  return (
    <div className="side-panel">
      <h3>{t('dig.prepare')}</h3>
      <p className="muted small">{t('dig.prepareHint')}</p>
      <div className="toolbar wrap">
        <button className="btn sm" onClick={() => setProcessing({ rotation: ((rot - 90) % 360), crop: null })} aria-label={t('dig.rotateLeft')}>⟲ 90°</button>
        <button className="btn sm" onClick={() => setProcessing({ rotation: ((rot + 90) % 360), crop: null })} aria-label={t('dig.rotateRight')}>⟳ 90°</button>
      </div>
      <label className="inline"><span>{t('dig.rotation')} (°)</span>
        <input type="number" step="0.1" min="-360" max="360" dir="ltr" value={Number(rot.toFixed(2))} aria-label={t('dig.rotation')}
          onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setProcessing({ rotation: n, crop: null }); }} /></label>
      <input type="range" min="-10" max="10" step="0.1" value={Math.max(-10, Math.min(10, rot - Math.round(rot / 90) * 90))} aria-label={t('dig.fineRotation')}
        onChange={(e) => setProcessing({ rotation: Math.round(rot / 90) * 90 + Number(e.target.value), crop: null })} />
      <p className="muted small">{t('dig.fineHint')}</p>
      <div className="toolbar wrap">
        <button className={`btn sm${tool === 'crop' ? ' primary' : ''}`} onClick={() => setTool('crop')}>{t('dig.cropTool')}</button>
        <button className={`btn sm${tool === 'pan' ? ' primary' : ''}`} onClick={() => setTool('pan')}>{t('dig.panTool')}</button>
        <button className="btn sm" disabled={!processing.crop} onClick={() => setProcessing({ rotation: rot, crop: null })}>{t('dig.clearCrop')}</button>
      </div>
      <p className="small">{t('dig.workingSize')}: <strong dir="ltr">{ws.w} × {ws.h} px</strong></p>
      <p className="notice bad small">{t('dig.resetWarning')}</p>
    </div>
  );
}
