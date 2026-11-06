import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { db } from '../../db/db.js';
import { listImages, getImage, addImage, saveSession, deleteImage, validateImageFile } from '../../db/images.js';
import { loadImage, readSourceFile, renderPdfPage } from '../../digitize/imageSource.js';
import { rotatedSize, workingSize, drawWorking } from '../../digitize/transform.js';
import { newSession, uid, trackCalibrationOf } from '../../digitize/pipeline.js';
import { extractCurve, detectHorizontalLines, pixelColor, snapTo } from '../../digitize/extract.js';
import ImageStage from './ImageStage.jsx';
import PreparePanel from './PreparePanel.jsx';
import CalibratePanel from './CalibratePanel.jsx';
import DigitizePanel from './DigitizePanel.jsx';
import ExportPanel from './ExportPanel.jsx';

const clone = (o) => JSON.parse(JSON.stringify(o));
const STEPS = ['image', 'prepare', 'calibrate', 'digitize', 'export'];
const STEP_TOOL = { image: 'pan', prepare: 'crop', calibrate: 'depthCal', digitize: 'pan', export: 'pan' };
const MAX_PIXELS = 120e6;

export default function DigitizePage({ well, custom }) {
  const { t } = usePrefs();
  const images = useLiveQuery(() => listImages(well.id), [well.id], []);
  const [image, setImage] = useState(null);
  const [orig, setOrig] = useState(null);
  const [session, setSession] = useState(null);
  const [step, setStep] = useState('image');
  const [tool, setTool] = useState('pan');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState(null);
  const [activeCurveId, setActiveCurveId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [lines, setLines] = useState([]);
  const [linesInfo, setLinesInfo] = useState(null);
  const [autoInfo, setAutoInfo] = useState(null);
  const loaded = useRef(null);

  // ---- open an image ----
  const open = useCallback(async (id) => {
    setError(null); setBusy(true);
    try {
      const rec = await getImage(id);
      const { img, url } = await loadImage(rec.renderBlob || rec.blob);
      setOrig((o) => { if (o) URL.revokeObjectURL(o.url); return { img, url }; });
      setImage(rec);
      const s = rec.session || newSession();
      loaded.current = s;
      setSession(s);
      setActiveTrackId(s.tracks[0]?.id || null); setActiveCurveId(s.curves[0]?.id || null);
      setSelected(null); setLines([]); setLinesInfo(null); setAutoInfo(null);
      setStep('prepare'); setTool('crop');
    } catch { setError(t('dig.err.decode')); }
    setBusy(false);
  }, [t]);

  useEffect(() => () => orig && URL.revokeObjectURL(orig.url), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setImage(null); setOrig(null); setSession(null); setStep('image'); }, [well.id]);

  // ---- autosave session ----
  useEffect(() => {
    if (!image || !session || session === loaded.current) return undefined;
    const h = setTimeout(() => saveSession(image.id, session), 600);
    return () => clearTimeout(h);
  }, [session, image]);

  const upd = useCallback((fn) => setSession((cur) => { const n = clone(cur); fn(n); return n; }), []);

  // ---- canvases (rotated and prepared) ----
  const canvases = useMemo(() => {
    if (!orig || !image || !session) return null;
    try {
      const p = session.processing;
      const W = image.width, H = image.height;
      const rs = rotatedSize(W, H, p.rotation || 0);
      if (rs.w * rs.h > MAX_PIXELS) return { error: 'big' };
      const rot = document.createElement('canvas'); rot.width = rs.w; rot.height = rs.h;
      const rctx = rot.getContext('2d');
      if (!rctx) return { error: 'canvas' };
      drawWorking(rctx, orig.img, W, H, { rotation: p.rotation, crop: null });
      if (!p.crop) return { rotated: rot, working: rot };
      const ws = workingSize(W, H, p);
      const wk = document.createElement('canvas'); wk.width = ws.w; wk.height = ws.h;
      drawWorking(wk.getContext('2d'), orig.img, W, H, p);
      return { rotated: rot, working: wk };
    } catch { return { error: 'canvas' }; }
  }, [orig, image, session?.processing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- upload ----
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const bad = validateImageFile(f);
    if (bad) { setError(t(`dig.err.${bad}`)); return; }
    setError(null); setBusy(true);
    try {
      const src = await readSourceFile(f, 1);
      const id = await addImage(well.id, { name: f.name, mime: src.mime, blob: src.blob, renderBlob: src.renderBlob, width: src.width, height: src.height, page: src.page, pageCount: src.pageCount });
      await open(id);
    } catch { setError(t('dig.err.decode')); setBusy(false); }
  };

  const changePage = async (n) => {
    if (!image || !(image.pageCount > 1)) return;
    if (!window.confirm(t('dig.confirmPage'))) return;
    setBusy(true);
    try {
      const r = await renderPdfPage(image.blob, n);
      await db.logImages.update(image.id, { renderBlob: r.blob, width: r.width, height: r.height, page: r.page, session: newSession() });
      await open(image.id);
    } catch { setError(t('dig.err.decode')); }
    setBusy(false);
  };

  // ---- processing (rotate / crop) resets calibration because pixel coordinates change ----
  const hasWork = session && (session.depthCal.points.length || session.tracks.some((x) => x.points.length) || session.curves.some((c) => c.points.length));
  const setProcessing = (p) => {
    if (hasWork && !window.confirm(t('dig.confirmReset'))) return;
    upd((s) => {
      s.processing = { rotation: p.rotation, crop: p.crop ? { x: Math.round(p.crop.x), y: Math.round(p.crop.y), w: Math.round(p.crop.w), h: Math.round(p.crop.h) } : null };
      s.depthCal.points = []; s.tracks.forEach((x) => { x.points = []; }); s.curves.forEach((c) => { c.points = []; c.roi = null; });
    });
    setLines([]); setLinesInfo(null); setSelected(null); setAutoInfo(null);
  };

  // ---- step / tool ----
  const goStep = (s) => { setStep(s); setTool(s === 'digitize' && activeCurveId ? 'point' : STEP_TOOL[s]); };

  // ---- stage callbacks ----
  const onDepthPoint = (py) => {
    const y = lines.length ? snapTo(py, lines, 8) : py;
    upd((s) => { s.depthCal.points.push({ id: uid('d'), py: y, depth: '' }); });
  };
  const onTrackPoint = (px) => {
    const id = activeTrackId || session.tracks[0]?.id;
    if (!id) return;
    upd((s) => { s.tracks.find((x) => x.id === id).points.push({ id: uid('p'), px, value: '' }); });
  };
  const onAddPoint = (px, py) => {
    if (!activeCurveId) return;
    const pid = uid('q');
    upd((s) => { s.curves.find((c) => c.id === activeCurveId).points.push({ id: pid, px, py, method: 'manual' }); });
    setSelected({ curveId: activeCurveId, pointId: pid });
  };
  const onMovePoint = (curveId, pointId, px, py) => upd((s) => {
    const p = s.curves.find((c) => c.id === curveId)?.points.find((q) => q.id === pointId);
    if (p) { p.px = px; p.py = py; if (p.method === 'auto') p.method = 'auto-edited'; }
  });
  const onSelect = (curveId, pointId) => { setSelected({ curveId, pointId }); setActiveCurveId(curveId); };
  const deleteSelected = useCallback(() => {
    if (!selected) return;
    upd((s) => { const c = s.curves.find((x) => x.id === selected.curveId); if (c) c.points = c.points.filter((p) => p.id !== selected.pointId); });
    setSelected(null);
  }, [selected, upd]);

  useEffect(() => {
    const onKey = (e) => {
      if (step !== 'digitize' || !selected) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); deleteSelected(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, selected, deleteSelected]);

  // ---- colour pick, ROI, auto extraction ----
  const wctx = () => canvases?.working?.getContext('2d', { willReadFrequently: true });
  const onPick = (x, y) => {
    const ctx = wctx(); if (!ctx || !activeCurveId) return;
    const px = Math.max(1, Math.min(canvases.working.width - 2, Math.round(x))), py = Math.max(1, Math.min(canvases.working.height - 2, Math.round(y)));
    const d = ctx.getImageData(px - 1, py - 1, 3, 3).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < 36; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    upd((s) => { s.curves.find((c) => c.id === activeCurveId).extract.color = [Math.round(r / 9), Math.round(g / 9), Math.round(b / 9)]; });
    setTool('point');
  };
  const onRoi = (rect) => { if (!activeCurveId) return; upd((s) => { s.curves.find((c) => c.id === activeCurveId).roi = rect; }); setTool('point'); };

  const activeCurve = session?.curves.find((c) => c.id === activeCurveId);
  const defaultRoi = () => {
    const tr = session.tracks.find((x) => x.id === activeCurve.trackId);
    const cal = tr ? trackCalibrationOf(tr) : null;
    const W = canvases.working.width, H = canvases.working.height;
    if (cal?.ok) { const span = cal.pxRange[1] - cal.pxRange[0]; return { x0: cal.pxRange[0] - 0.08 * span, x1: cal.pxRange[1] + 0.08 * span, y0: 0, y1: H }; }
    return { x0: 0, x1: W, y0: 0, y1: H };
  };
  const runAuto = () => {
    const ctx = wctx(); if (!ctx || !activeCurve?.extract.color) return;
    const w = canvases.working;
    const img = ctx.getImageData(0, 0, w.width, w.height);
    const res = extractCurve(img, { color: activeCurve.extract.color, tolerance: activeCurve.extract.tolerance, stepY: activeCurve.extract.stepY, roi: activeCurve.roi || defaultRoi() });
    const keep = activeCurve.points.filter((p) => p.method !== 'auto' && p.method !== 'auto-edited');
    if (keep.length && !window.confirm(t('dig.confirmAuto'))) return;
    upd((s) => { s.curves.find((c) => c.id === activeCurveId).points = res.points.map((p) => ({ id: uid('a'), px: p.px, py: p.py, method: 'auto' })); });
    setAutoInfo({ points: res.points.length, coverage: res.stats.coverage, reliable: res.stats.reliable, reasons: res.stats.reasons });
    setSelected(null);
  };
  const detectLines = () => {
    const ctx = wctx(); if (!ctx) return;
    const w = canvases.working;
    const img = ctx.getImageData(0, 0, w.width, w.height);
    const r = detectHorizontalLines(img, { x0: Math.floor(w.width * 0.05), x1: Math.floor(w.width * 0.95), darkThreshold: 200, minFrac: 0.5 });
    setLines(r.lines);
    setLinesInfo(t('dig.linesFound').replace('{n}', r.lines.length).replace('{s}', r.spacing ? r.spacing.toFixed(1) : '—'));
  };

  const removeImage = async (id) => {
    if (!window.confirm(t('dig.confirmDeleteImage'))) return;
    await deleteImage(id);
    if (image?.id === id) { setImage(null); setOrig(null); setSession(null); setStep('image'); }
  };

  const imageSize = image ? { W: image.width, H: image.height } : null;
  const source = canvases && !canvases.error ? (step === 'prepare' ? canvases.rotated : canvases.working) : null;
  const showOverlay = step !== 'prepare';

  return (
    <div className="digitize">
      <div className="tabs step-tabs" role="tablist">
        {STEPS.map((s, i) => (
          <button key={s} role="tab" aria-selected={step === s} disabled={s !== 'image' && !image}
            className={`tab${step === s ? ' active' : ''}`} onClick={() => goStep(s)}>{i + 1}. {t(`dig.steps.${s}`)}</button>
        ))}
      </div>
      {error && <div className="notice bad" role="alert">{error}</div>}
      {canvases?.error && <div className="notice bad" role="alert">{t(`dig.err.${canvases.error}`)}</div>}

      <div className="dig-grid">
        <div className="dig-stage">
          {source ? (
            <ImageStage key={step === 'prepare' ? 'p' : 'w'} source={source} tool={tool} label={t('dig.stageLabel')}
              depthPoints={showOverlay ? session.depthCal.points : []}
              tracks={showOverlay ? session.tracks : []}
              curves={step === 'digitize' || step === 'export' ? session.curves : []}
              activeCurveId={activeCurveId} selectedId={selected?.pointId}
              lines={step === 'calibrate' ? lines : []}
              roi={step === 'digitize' ? (activeCurve?.roi || null) : null}
              crop={step === 'prepare' ? session.processing.crop : null}
              onDepthPoint={onDepthPoint} onTrackPoint={onTrackPoint} onAddPoint={onAddPoint} onMovePoint={onMovePoint}
              onSelect={onSelect} onPick={onPick} onRoi={onRoi}
              onCrop={(r) => setProcessing({ rotation: session.processing.rotation, crop: r })} />
          ) : (
            <div className="card empty"><p>{busy ? t('dig.loading') : t('dig.noImage')}</p></div>
          )}
        </div>

        <aside className="dig-side">
          {step === 'image' && (
            <div className="side-panel">
              <h3>{t('dig.uploadTitle')}</h3>
              <label className="file-drop">
                <span className="btn primary">{t('dig.chooseFile')}</span>
                <input type="file" hidden accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" aria-label={t('dig.chooseFile')} onChange={onFile} />
              </label>
              <p className="muted small">{t('dig.uploadHint')}</p>
              <h3>{t('dig.savedImages')}</h3>
              {images.length === 0 && <p className="muted small">{t('dig.noSaved')}</p>}
              <ul className="img-list">
                {images.map((im) => (
                  <li key={im.id}>
                    <span className="grow">{im.name} <span className="muted small" dir="ltr">({im.width}×{im.height})</span></span>
                    <button className="btn sm" onClick={() => open(im.id)}>{t('dig.open')}</button>
                    <button className="icon-x" aria-label={`${t('common.delete')} ${im.name}`} onClick={() => removeImage(im.id)}>×</button>
                  </li>
                ))}
              </ul>
              {image?.pageCount > 1 && (
                <label className="inline"><span>{t('dig.pdfPage')} ({image.page}/{image.pageCount})</span>
                  <input type="number" min="1" max={image.pageCount} defaultValue={image.page} dir="ltr" aria-label={t('dig.pdfPage')}
                    onBlur={(e) => Number(e.target.value) !== image.page && changePage(Number(e.target.value))} /></label>
              )}
            </div>
          )}
          {image && session && step === 'prepare' && <PreparePanel image={image} processing={session.processing} setProcessing={setProcessing} tool={tool} setTool={setTool} />}
          {image && session && step === 'calibrate' && (
            <CalibratePanel session={session} upd={upd} tool={tool} setTool={setTool} activeTrackId={activeTrackId} setActiveTrackId={setActiveTrackId}
              custom={custom} onDetectLines={detectLines} linesInfo={linesInfo} />
          )}
          {image && session && step === 'digitize' && (
            <DigitizePanel session={session} upd={upd} tool={tool} setTool={setTool} activeCurveId={activeCurveId} setActiveCurveId={setActiveCurveId}
              selected={selected} onDeleteSelected={deleteSelected} custom={custom} imageSize={imageSize} onAuto={runAuto} autoInfo={autoInfo}
              hasRoi={!!activeCurve?.roi} onClearRoi={() => upd((s) => { s.curves.find((c) => c.id === activeCurveId).roi = null; })} />
          )}
          {image && session && step === 'export' && <ExportPanel image={image} session={session} upd={upd} imageSize={imageSize} custom={custom} />}
        </aside>
      </div>
    </div>
  );
}
