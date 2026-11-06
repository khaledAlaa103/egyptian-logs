import { useEffect, useRef, useState, useCallback } from 'react';

const HIT = 9; // px (screen) hit radius for points
const TRACK_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2'];

/**
 * Zoomable/pannable image canvas with calibration + digitisation overlays.
 * All callbacks receive IMAGE (working-canvas) pixel coordinates.
 */
export default function ImageStage({
  source, tool, depthPoints = [], tracks = [], curves = [], activeCurveId, selectedId, lines = [], roi, crop,
  onDepthPoint, onTrackPoint, onAddPoint, onMovePoint, onSelect, onPick, onRoi, onCrop, height = 520, label,
}) {
  const ref = useRef(null);
  const wrap = useRef(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ w: 800 });
  const [live, setLive] = useState(null); // live rectangle while dragging
  const gesture = useRef(null);
  const ptrs = useRef(new Map());

  const fit = useCallback(() => {
    if (!source) return;
    const s = Math.min(size.w / source.width, height / source.height, 1);
    setView({ s, x: (size.w - source.width * s) / 2, y: 4 });
  }, [source, size.w, height]);

  useEffect(() => { fit(); }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const upd = () => setSize({ w: Math.max(300, el.clientWidth) });
    upd();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(upd) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const toImg = (sx, sy) => ({ x: (sx - view.x) / view.s, y: (sy - view.y) / view.s });
  const toScr = (ix, iy) => ({ x: ix * view.s + view.x, y: iy * view.s + view.y });

  // ---------- drawing ----------
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext?.('2d');
    if (!ctx || !source) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr); c.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1f2937'; ctx.fillRect(0, 0, size.w, height);
    ctx.imageSmoothingEnabled = view.s < 3;
    ctx.drawImage(source, view.x, view.y, source.width * view.s, source.height * view.s);

    const W = size.w;
    ctx.font = '600 11px "Segoe UI", sans-serif';
    ctx.lineWidth = 1;

    // detected gridlines (guides)
    ctx.strokeStyle = 'rgba(250,204,21,0.55)'; ctx.setLineDash([2, 3]);
    for (const ly of lines) { const y = toScr(0, ly).y; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.setLineDash([]);

    // depth calibration lines
    depthPoints.forEach((p) => {
      const y = toScr(0, p.py).y;
      ctx.strokeStyle = '#f59e0b'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillStyle = '#f59e0b'; ctx.fillText(`D ${p.depth === '' || p.depth == null ? '?' : p.depth}`, 4, y - 3);
    });
    // track calibration lines
    tracks.forEach((t, ti) => {
      const col = TRACK_COLORS[ti % TRACK_COLORS.length];
      t.points.forEach((p) => {
        const x = toScr(p.px, 0).x;
        ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        ctx.fillStyle = col; ctx.fillText(`${t.name || ti + 1}: ${p.value === '' || p.value == null ? '?' : p.value}`, x + 3, 12 + ti * 12);
      });
    });
    // ROI
    if (roi) { const a = toScr(roi.x0, roi.y0), b = toScr(roi.x1, roi.y1); ctx.strokeStyle = '#22d3ee'; ctx.setLineDash([6, 3]); ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]); }
    // crop (dim outside)
    const cr = live && tool === 'crop' ? live : crop;
    if (cr) {
      const a = toScr(cr.x, cr.y), b = toScr(cr.x + cr.w, cr.y + cr.h);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, a.y); ctx.fillRect(0, b.y, W, height - b.y); ctx.fillRect(0, a.y, a.x, b.y - a.y); ctx.fillRect(b.x, a.y, W - b.x, b.y - a.y);
      ctx.strokeStyle = '#fff'; ctx.setLineDash([5, 3]); ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]);
    }
    if (live && tool === 'roi') { const a = toScr(live.x, live.y), b = toScr(live.x + live.w, live.y + live.h); ctx.strokeStyle = '#22d3ee'; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); }
    // digitised points
    curves.forEach((cv) => {
      const sorted = cv.points.slice().sort((a, b) => a.py - b.py);
      if (sorted.length > 1) { ctx.strokeStyle = cv.color; ctx.globalAlpha = 0.6; ctx.beginPath(); sorted.forEach((p, i) => { const s = toScr(p.px, p.py); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }); ctx.stroke(); ctx.globalAlpha = 1; }
      cv.points.forEach((p) => {
        const s = toScr(p.px, p.py);
        ctx.fillStyle = cv.color; ctx.strokeStyle = '#fff';
        ctx.beginPath(); ctx.arc(s.x, s.y, cv.id === activeCurveId ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (p.id === selectedId) { ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
      });
    });
  }, [source, view, size, height, depthPoints, tracks, curves, activeCurveId, selectedId, lines, roi, crop, live, tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- interaction ----------
  const local = (e) => { const r = ref.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  useEffect(() => {
    const c = ref.current;
    if (!c) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView((v) => {
        const f = e.deltaY < 0 ? 1.2 : 1 / 1.2;
        const s = Math.min(40, Math.max(0.05, v.s * f));
        return { s, x: mx - ((mx - v.x) / v.s) * s, y: my - ((my - v.y) / v.s) * s };
      });
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [source]);

  const hitPoint = (sx, sy) => {
    for (const cv of curves) for (const p of cv.points) { const s = toScr(p.px, p.py); if (Math.hypot(s.x - sx, s.y - sy) <= HIT) return { curve: cv, point: p }; }
    return null;
  };

  const down = (e) => {
    if (!source) return;
    const m = local(e);
    ref.current.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, m);
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      gesture.current = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, v0: view, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    const hit = tool === 'point' ? hitPoint(m.x, m.y) : null;
    if (hit) { onSelect?.(hit.curve.id, hit.point.id); gesture.current = { type: 'drag', curve: hit.curve, point: hit.point, moved: false }; return; }
    if (tool === 'pan' || e.button === 1) gesture.current = { type: 'pan', start: m, v0: view };
    else if (tool === 'roi' || tool === 'crop') gesture.current = { type: 'rect', start: toImg(m.x, m.y), moved: false };
    else gesture.current = { type: 'click', start: m, moved: false };
  };

  const move = (e) => {
    const g = gesture.current;
    if (!g) return;
    const m = local(e);
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, m);
    if (g.type === 'pinch' && ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      const f = (Math.hypot(a.x - b.x, a.y - b.y) || 1) / g.d0;
      const s = Math.min(40, Math.max(0.05, g.v0.s * f));
      setView({ s, x: g.mid.x - ((g.mid.x - g.v0.x) / g.v0.s) * s, y: g.mid.y - ((g.mid.y - g.v0.y) / g.v0.s) * s });
    } else if (g.type === 'pan') setView({ ...g.v0, x: g.v0.x + (m.x - g.start.x), y: g.v0.y + (m.y - g.start.y) });
    else if (g.type === 'drag') { g.moved = true; const p = toImg(m.x, m.y); onMovePoint?.(g.curve.id, g.point.id, p.x, p.y); }
    else if (g.type === 'rect') {
      const p = toImg(m.x, m.y);
      if (Math.abs(p.x - g.start.x) + Math.abs(p.y - g.start.y) > 3) g.moved = true;
      setLive({ x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), w: Math.abs(p.x - g.start.x), h: Math.abs(p.y - g.start.y) });
    } else if (g.type === 'click' && Math.hypot(m.x - g.start.x, m.y - g.start.y) > 4) g.moved = true;
  };

  const up = (e) => {
    const g = gesture.current;
    ptrs.current.delete(e.pointerId);
    if (!g) return;
    if (g.type === 'pinch') { if (ptrs.current.size < 2) gesture.current = null; return; }
    const m = local(e);
    if (g.type === 'click' && !g.moved) {
      const p = toImg(m.x, m.y);
      if (source && (p.x < 0 || p.y < 0 || p.x > source.width || p.y > source.height)) { gesture.current = null; return; }
      if (tool === 'depthCal') onDepthPoint?.(p.y);
      else if (tool === 'trackCal') onTrackPoint?.(p.x);
      else if (tool === 'point') onAddPoint?.(p.x, p.y);
      else if (tool === 'pick') onPick?.(p.x, p.y);
    } else if (g.type === 'rect' && g.moved && live) {
      if (tool === 'roi') onRoi?.({ x0: live.x, y0: live.y, x1: live.x + live.w, y1: live.y + live.h });
      else if (tool === 'crop') onCrop?.(live);
    }
    setLive(null);
    gesture.current = null;
  };

  const zoom = (f) => setView((v) => { const s = Math.min(40, Math.max(0.05, v.s * f)); const cx = size.w / 2, cy = height / 2; return { s, x: cx - ((cx - v.x) / v.s) * s, y: cy - ((cy - v.y) / v.s) * s }; });

  return (
    <div ref={wrap} className="stage-wrap" dir="ltr">
      <canvas ref={ref} data-testid="stage-canvas" aria-label={label} style={{ width: '100%', height, display: 'block', touchAction: 'none', cursor: tool === 'pan' ? 'grab' : 'crosshair' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <div className="stage-zoom">
        <button className="btn sm" onClick={() => zoom(1.4)} aria-label="Zoom in">＋</button>
        <button className="btn sm" onClick={() => zoom(1 / 1.4)} aria-label="Zoom out">－</button>
        <button className="btn sm" onClick={fit} aria-label="Fit">⤢</button>
        <span className="stage-pct">{Math.round(view.s * 100)}%</span>
      </div>
    </div>
  );
}
