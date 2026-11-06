// Draws a complete well log (header, depth axis, tracks, curves, formations, markers, cursor) on a
// 2D canvas context. Used for the screen, PNG export and print. Pure w.r.t. React.
import {
  DEPTH_COL_W, layoutColumns, headerHeight, depthTicks, logTicks, linearTicks, xFrac, decimate,
  depthToY, fmtNum, medianSpacing,
} from './geometry.js';
import { getLog } from '../registry/logRegistry.js';
import { unitLabel } from '../engine/units/units.js';

export const LIGHT = { bg: '#ffffff', fg: '#0f2238', muted: '#5b6e84', grid: '#d5dfea', gridMinor: '#eaf0f6', axisBg: '#f3f6fa', border: '#8aa0b8' };
export const DARK = { bg: '#0e2038', fg: '#e4edf8', muted: '#8da4c0', grid: '#2a4468', gridMinor: '#183154', axisBg: '#0b1a2e', border: '#4a6a94' };

const WATER = { yes: 'rgba(6,182,212,0.22)', probable: 'rgba(6,182,212,0.10)' };
const FORM_TINT = ['rgba(148,163,184,0.10)', 'rgba(148,163,184,0.20)'];
const FM_FONT = '11px "Segoe UI", "Noto Sans Arabic", sans-serif';

/** Effective scale/min/max for a curve inside a track (curve overrides track). */
export function curveScale(track, c) {
  return { scale: c.scale ?? track.scale, min: c.min ?? track.min, max: c.max ?? track.max };
}

/**
 * model: { layout, data: {curveId: {depth, values, unit, medianDz}}, formations, markers,
 *          view:{top,bottom}, cursor: depth|null, hover: depth|null, custom, lang, depthUnitFactor, palette }
 */
export function renderLog(ctx, width, height, model) {
  const { layout, data, formations = [], markers = [], view, cursor, hover, custom = [], palette = LIGHT, lang = 'en' } = model;
  const tracks = layout.tracks;
  const headerH = headerHeight(tracks);
  const cols = layoutColumns(tracks, width);
  const bodyTop = headerH, bodyH = Math.max(10, height - headerH);
  const dFac = layout.depthUnit === 'ft' ? 1 / 0.3048 : 1; // display only; data stay in metres
  const y = (d) => depthToY(d, view, bodyTop, bodyH);

  ctx.save();
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'middle';

  // ---------- Depth axis ----------
  ctx.fillStyle = palette.axisBg;
  ctx.fillRect(0, 0, DEPTH_COL_W, height);
  const tk = depthTicks(view.top * dFac, view.bottom * dFac, Math.max(4, Math.floor(bodyH / 60)));
  ctx.font = FM_FONT;
  ctx.textAlign = 'right';
  ctx.fillStyle = palette.fg;
  ctx.fillText(layout.depthUnit === 'ft' ? 'DEPTH (ft)' : 'DEPTH (m)', DEPTH_COL_W - 6, 12);
  ctx.strokeStyle = palette.border;
  for (const dd of tk.major) {
    const yy = y(dd / dFac);
    if (yy < bodyTop || yy > height) continue;
    ctx.beginPath(); ctx.moveTo(DEPTH_COL_W - 10, yy); ctx.lineTo(DEPTH_COL_W, yy); ctx.stroke();
    ctx.fillText(fmtNum(dd), DEPTH_COL_W - 13, yy);
  }

  // ---------- Tracks ----------
  tracks.forEach((track, i) => {
    const col = cols.tracks[i];
    const vis = track.curves.filter((c) => c.visible !== false && data[c.curveId]);

    // header
    ctx.save();
    ctx.beginPath(); ctx.rect(col.x, 0, col.w, headerH); ctx.clip();
    ctx.fillStyle = palette.axisBg; ctx.fillRect(col.x, 0, col.w, headerH);
    ctx.fillStyle = palette.fg; ctx.font = `600 12px ${FM_FONT.split('px ')[1]}`; ctx.textAlign = 'center';
    ctx.fillText(track.title || '', col.x + col.w / 2, 13);
    vis.forEach((c, k) => {
      const def = getLog(c.curveId, custom);
      const s = curveScale(track, c);
      const yy = 30 + k * 30;
      ctx.strokeStyle = c.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(col.x + 6, yy + 6); ctx.lineTo(col.x + col.w - 6, yy + 6); ctx.stroke();
      ctx.font = FM_FONT; ctx.fillStyle = c.color; ctx.textAlign = 'center';
      const unit = def ? unitLabel(data[c.curveId].unit) : '';
      ctx.fillText(`${def ? def.abbr : c.curveId} (${unit})`, col.x + col.w / 2, yy - 4);
      ctx.fillStyle = palette.muted; ctx.textAlign = 'left';
      ctx.fillText(fmtNum(s.min), col.x + 4, yy + 16);
      ctx.textAlign = 'right';
      ctx.fillText(fmtNum(s.max), col.x + col.w - 4, yy + 16);
      if (s.scale === 'log') { ctx.textAlign = 'center'; ctx.fillText('log', col.x + col.w / 2, yy + 16); }
    });
    ctx.restore();

    // body
    ctx.save();
    ctx.beginPath(); ctx.rect(col.x, bodyTop, col.w, bodyH); ctx.clip();
    // formation tint + water highlight (full width of every track: cross-track sync)
    formations.forEach((f, k) => {
      const y0 = y(f.top), y1 = y(f.bottom);
      if (y1 < bodyTop || y0 > height) return;
      ctx.fillStyle = FORM_TINT[k % 2]; ctx.fillRect(col.x, y0, col.w, y1 - y0);
      if (WATER[f.waterBearing]) { ctx.fillStyle = WATER[f.waterBearing]; ctx.fillRect(col.x, y0, col.w, y1 - y0); }
    });
    // grid, driven by the first visible curve's scale
    const ref = vis[0] ? curveScale(track, vis[0]) : { scale: track.scale, min: track.min, max: track.max };
    const gx = (v) => { const f = xFrac(v, ref.scale, ref.min, ref.max); return f == null ? null : col.x + f * col.w; };
    ctx.lineWidth = 1;
    if (ref.scale === 'log') {
      const lt = logTicks(Math.min(ref.min, ref.max), Math.max(ref.min, ref.max));
      ctx.strokeStyle = palette.gridMinor;
      lt.minor.forEach((v) => { const x = gx(v); if (x != null) { ctx.beginPath(); ctx.moveTo(x, bodyTop); ctx.lineTo(x, height); ctx.stroke(); } });
      ctx.strokeStyle = palette.grid;
      lt.major.forEach((v) => { const x = gx(v); if (x != null) { ctx.beginPath(); ctx.moveTo(x, bodyTop); ctx.lineTo(x, height); ctx.stroke(); } });
    } else {
      ctx.strokeStyle = palette.grid;
      linearTicks(ref.min, ref.max, 5).forEach((v) => { const x = gx(v); if (x != null) { ctx.beginPath(); ctx.moveTo(x, bodyTop); ctx.lineTo(x, height); ctx.stroke(); } });
    }
    // horizontal depth grid
    ctx.strokeStyle = palette.gridMinor;
    tk.minor.forEach((dd) => { const yy = y(dd / dFac); ctx.beginPath(); ctx.moveTo(col.x, yy); ctx.lineTo(col.x + col.w, yy); ctx.stroke(); });
    ctx.strokeStyle = palette.grid;
    tk.major.forEach((dd) => { const yy = y(dd / dFac); ctx.beginPath(); ctx.moveTo(col.x, yy); ctx.lineTo(col.x + col.w, yy); ctx.stroke(); });

    // curves
    for (const c of vis) {
      const cd = data[c.curveId];
      const s = curveScale(track, c);
      const pts = decimate(cd.depth, cd.values, view.top, view.bottom, Math.ceil(bodyH));
      const gap = 5 * (cd.medianDz ?? medianSpacing(cd.depth));
      ctx.strokeStyle = c.color; ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
      ctx.beginPath();
      let pen = false, prevD = null;
      for (const [d, v] of pts) {
        const f = xFrac(v, s.scale, s.min, s.max);
        if (f == null || (prevD != null && d - prevD > Math.max(gap, ((view.bottom - view.top) / bodyH) * 3))) pen = false;
        if (f != null) {
          const px = col.x + Math.max(-2, Math.min(3, f)) * col.w, py = y(d);
          if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          pen = true;
        }
        prevD = d;
      }
      ctx.stroke();
    }
    ctx.restore();

    // border
    ctx.strokeStyle = palette.border; ctx.lineWidth = 1;
    ctx.strokeRect(col.x + 0.5, 0.5, col.w, height - 1);
    ctx.beginPath(); ctx.moveTo(col.x, bodyTop); ctx.lineTo(col.x + col.w, bodyTop); ctx.stroke();
  });

  // ---------- Formation column ----------
  const fc = cols.formation;
  if (fc) {
    ctx.save();
    ctx.beginPath(); ctx.rect(fc.x, 0, fc.w, height); ctx.clip();
    ctx.fillStyle = palette.axisBg; ctx.fillRect(fc.x, 0, fc.w, headerH);
    ctx.fillStyle = palette.fg; ctx.font = `600 12px ${FM_FONT.split('px ')[1]}`; ctx.textAlign = 'center';
    ctx.fillText(model.labels?.formations || 'Formations', fc.x + fc.w / 2, 13);
    ctx.font = FM_FONT;
    formations.forEach((f, k) => {
      const y0 = Math.max(bodyTop, y(f.top)), y1 = Math.min(height, y(f.bottom));
      if (y1 <= y0) return;
      ctx.fillStyle = FORM_TINT[k % 2]; ctx.fillRect(fc.x, y0, fc.w, y1 - y0);
      if (WATER[f.waterBearing]) { ctx.fillStyle = WATER[f.waterBearing]; ctx.fillRect(fc.x, y0, fc.w, y1 - y0); }
      ctx.strokeStyle = palette.border; ctx.beginPath(); ctx.moveTo(fc.x, y0); ctx.lineTo(fc.x + fc.w, y0); ctx.stroke();
      ctx.fillStyle = palette.fg; ctx.textAlign = 'left';
      if (y1 - y0 > 14) ctx.fillText(f.name || '', fc.x + 6, (y0 + y1) / 2 - (f.waterBearing === 'yes' && y1 - y0 > 30 ? 6 : 0));
      if (f.waterBearing === 'yes' && y1 - y0 > 30) { ctx.fillStyle = '#0891b2'; ctx.fillText(`● ${model.labels?.water || 'water'}`, fc.x + 6, (y0 + y1) / 2 + 8); }
    });
    ctx.restore();
    ctx.strokeStyle = palette.border; ctx.strokeRect(fc.x + 0.5, 0.5, fc.w - 1, height - 1);
  }

  // ---------- Formation boundaries & markers across all tracks ----------
  const tracksW = cols.tracks.length ? cols.tracks[cols.tracks.length - 1].x + cols.tracks[cols.tracks.length - 1].w : DEPTH_COL_W;
  ctx.save();
  ctx.beginPath(); ctx.rect(DEPTH_COL_W, bodyTop, width - DEPTH_COL_W, bodyH); ctx.clip();
  ctx.setLineDash([6, 3]); ctx.lineWidth = 1; ctx.strokeStyle = palette.border;
  for (const f of formations) for (const dd of [f.top, f.bottom]) {
    const yy = y(dd);
    if (yy >= bodyTop && yy <= height) { ctx.beginPath(); ctx.moveTo(DEPTH_COL_W, yy); ctx.lineTo(tracksW, yy); ctx.stroke(); }
  }
  ctx.setLineDash([]);
  ctx.font = FM_FONT; ctx.textAlign = 'left';
  for (const m of markers) {
    const yy = y(m.depth);
    if (yy < bodyTop || yy > height) continue;
    ctx.strokeStyle = '#d97706'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(DEPTH_COL_W, yy); ctx.lineTo(tracksW, yy); ctx.stroke();
    if (m.label) {
      const w = ctx.measureText(m.label).width + 8;
      ctx.fillStyle = '#d97706'; ctx.fillRect(DEPTH_COL_W + 2, yy - 15, w, 14);
      ctx.fillStyle = '#ffffff'; ctx.fillText(m.label, DEPTH_COL_W + 6, yy - 8);
    }
  }
  // hover guide + selected cursor
  if (hover != null && hover >= view.top && hover <= view.bottom) {
    ctx.strokeStyle = palette.muted; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    const yy = y(hover); ctx.beginPath(); ctx.moveTo(DEPTH_COL_W, yy); ctx.lineTo(tracksW, yy); ctx.stroke(); ctx.setLineDash([]);
  }
  if (cursor != null && cursor >= view.top && cursor <= view.bottom) {
    ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 1.5;
    const yy = y(cursor); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(tracksW, yy); ctx.stroke();
    ctx.fillStyle = '#e11d48'; ctx.font = `600 11px ${FM_FONT.split('px ')[1]}`; ctx.textAlign = 'right';
    ctx.fillText(fmtNum(cursor * dFac), DEPTH_COL_W - 3, yy - 8);
  }
  ctx.restore();
  ctx.restore();
  return { headerH, cols, bodyTop, bodyH };
}
