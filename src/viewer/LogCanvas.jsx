import { useEffect, useRef, useState, useCallback } from 'react';
import { renderLog, LIGHT, DARK } from './renderLog.js';
import {
  layoutColumns, headerHeight, hitDivider, yToDepth, zoomWindow, panWindow, MIN_TRACK_W, clampWindow,
} from './geometry.js';
import { usePrefs } from '../app/PrefsContext.jsx';

/**
 * Interactive canvas: wheel / pinch zoom, drag pan, click to select depth, drag track dividers to
 * resize, keyboard (arrows pan, +/- zoom, Home fit). Pure drawing is delegated to renderLog().
 */
export default function LogCanvas({ model, extent, view, onView, cursor, onCursor, onResizeTrack, height = 560, canvasRef: extRef }) {
  const { theme, lang, t } = usePrefs();
  const wrapRef = useRef(null);
  const ownRef = useRef(null);
  const canvasRef = extRef || ownRef;
  const [width, setWidth] = useState(900);
  const [hover, setHover] = useState(null);
  const ptrs = useRef(new Map());
  const drag = useRef(null);

  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const palette = dark ? DARK : LIGHT;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth))) : null;
    setWidth(Math.max(320, el.clientWidth || 900));
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // Draw
  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext?.('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr); c.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderLog(ctx, width, height, { ...model, view, cursor, hover, palette, lang, labels: { formations: t('viewer.formations'), water: t('viewer.water') } });
  }, [model, view, cursor, hover, width, height, palette, lang, t, canvasRef]);

  const geo = useCallback(() => {
    const hh = headerHeight(model.layout.tracks);
    return { hh, cols: layoutColumns(model.layout.tracks, width), bodyH: height - hh };
  }, [model.layout.tracks, width, height]);

  const localXY = (e) => { const r = canvasRef.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const depthAt = (y) => { const g = geo(); return yToDepth(y, view, g.hh, g.bodyH); };

  const zoomAt = useCallback((anchor, factor) => {
    onView(zoomWindow(view, anchor, factor, extent[0], extent[1]));
  }, [view, extent, onView]);

  // Wheel zoom (non-passive so the page does not scroll)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const g = geo();
      const y = e.clientY - r.top;
      if (e.shiftKey) { onView(panWindow(view, ((e.deltaY > 0 ? 1 : -1) * (view.bottom - view.top)) * 0.1, extent[0], extent[1])); return; }
      zoomAt(yToDepth(Math.max(g.hh, y), view, g.hh, g.bodyH), e.deltaY < 0 ? 1.2 : 1 / 1.2);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [geo, view, extent, onView, zoomAt, canvasRef]);

  const onPointerDown = (e) => {
    const [x, y] = localXY(e);
    canvasRef.current.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x, y });
    const g = geo();
    if (ptrs.current.size === 2) { drag.current = { mode: 'pinch', startDist: pinchDist(), startView: view }; return; }
    const di = y < g.hh ? hitDivider(g.cols, x, 6) : -1;
    if (di >= 0) drag.current = { mode: 'resize', index: di, startX: x, startW: model.layout.tracks[di].width };
    else if (y >= g.hh) drag.current = { mode: 'pan', startY: y, startView: view, moved: false, startX: x };
    else drag.current = null;
  };
  const pinchDist = () => { const p = [...ptrs.current.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1; };

  const onPointerMove = (e) => {
    const [x, y] = localXY(e);
    const g = geo();
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x, y });
    const d = drag.current;
    if (!d) { setHover(y >= g.hh ? depthAt(y) : null); canvasRef.current.style.cursor = y < g.hh && hitDivider(g.cols, x, 6) >= 0 ? 'col-resize' : 'crosshair'; return; }
    if (d.mode === 'resize') onResizeTrack(d.index, Math.max(MIN_TRACK_W, Math.round(d.startW + (x - d.startX))));
    else if (d.mode === 'pinch' && ptrs.current.size === 2) {
      const f = pinchDist() / d.startDist;
      const mid = [...ptrs.current.values()].reduce((s, p) => s + p.y, 0) / 2;
      const anchor = yToDepth(mid, d.startView, g.hh, g.bodyH);
      onView(zoomWindow(d.startView, anchor, f, extent[0], extent[1]));
    } else if (d.mode === 'pan') {
      const dy = y - d.startY;
      if (Math.abs(dy) > 3 || Math.abs(x - d.startX) > 3) d.moved = true;
      const dDepth = -(dy / g.bodyH) * (d.startView.bottom - d.startView.top);
      if (d.moved) onView(panWindow(d.startView, dDepth, extent[0], extent[1]));
      setHover(depthAt(y));
    }
  };

  const onPointerUp = (e) => {
    const [, y] = localXY(e);
    const d = drag.current;
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2 && d?.mode === 'pinch') drag.current = null;
    else if (d && d.mode === 'pan' && !d.moved) { onCursor(depthAt(y)); drag.current = null; }
    else if (ptrs.current.size === 0) drag.current = null;
  };

  const onKeyDown = (e) => {
    const span = view.bottom - view.top;
    if (e.key === 'ArrowDown') { e.preventDefault(); onView(panWindow(view, span * 0.1, extent[0], extent[1])); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); onView(panWindow(view, -span * 0.1, extent[0], extent[1])); }
    else if (e.key === '+' || e.key === '=') zoomAt(cursor ?? (view.top + view.bottom) / 2, 1.25);
    else if (e.key === '-') zoomAt(cursor ?? (view.top + view.bottom) / 2, 0.8);
    else if (e.key === 'Home') onView(clampWindow(extent[0], extent[1], extent[0], extent[1]));
    else if (e.key === 'Escape') onCursor(null);
  };

  return (
    <div ref={wrapRef} className="logcanvas-wrap" tabIndex={0} onKeyDown={onKeyDown} role="group" aria-label={t('viewer.canvasLabel')} dir="ltr">
      <canvas ref={canvasRef} data-testid="log-canvas" style={{ width: '100%', height, touchAction: 'none', display: 'block' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp} onPointerLeave={() => !drag.current && setHover(null)} />
    </div>
  );
}
