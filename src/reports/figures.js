// Report figures drawn on canvases (browser only). Each returns a PNG/JPEG data URL.
import { renderLog, LIGHT } from '../viewer/renderLog.js';
import { defaultLayout } from '../viewer/defaults.js';
import { medianSpacing } from '../viewer/geometry.js';
import { loadLayout } from '../db/intervals.js';
import { predictTds } from '../engine/water/water.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/** Log display of the well's curves with formations and markers (uses the saved viewer layout when present). */
export async function logFigure(data, lang, labels = {}) {
  const ids = data.logRows.map((r) => r.curveId);
  if (!ids.length) return null;
  const layout = (await loadLayout(data.well.id)) || defaultLayout(data.logRows.map((r) => ({ curveId: r.curveId, values: r.values })), data.custom, {});
  const d = {};
  data.logRows.forEach((r) => { d[r.curveId] = { depth: r.depth, values: r.values, unit: r.unit, medianDz: medianSpacing(r.depth) }; });
  let lo = Infinity, hi = -Infinity;
  data.logRows.forEach((r) => { lo = Math.min(lo, r.depth[0]); hi = Math.max(hi, r.depth[r.depth.length - 1]); });
  data.formations.forEach((f) => { lo = Math.min(lo, f.top); hi = Math.max(hi, f.bottom); });
  const W = 1000, H = 1150, scale = 1.6;
  const c = mk(W * scale, H * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  renderLog(ctx, W, H, { layout, data: d, formations: data.formations, markers: data.markers, view: { top: lo, bottom: hi > lo ? hi : lo + 1 }, cursor: null, hover: null, custom: data.custom, palette: LIGHT, lang, labels });
  return c.toDataURL('image/png');
}

async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
}

/** Thumbnails (≤ 900 px wide) of the original well-log images (PDF pages use their rendered page). */
export async function imageThumbs(images, max = 6) {
  const out = [];
  for (const im of images.slice(0, max)) {
    try {
      const img = await blobToImage(im.renderBlob || im.blob);
      const s = Math.min(1, 900 / img.naturalWidth);
      const c = mk(Math.round(img.naturalWidth * s), Math.round(img.naturalHeight * s));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      out.push({ name: im.name, dataUrl: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height });
    } catch { /* unreadable image: skipped */ }
  }
  return out;
}

/** EC25 vs TDS scatter with the fitted relation. */
export function scatterFigure(pairs, cal) {
  if (!pairs?.length) return null;
  const W = 640, H = 400, pad = 56, s = 2;
  const c = mk(W * s, H * s); const ctx = c.getContext('2d'); ctx.scale(s, s);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const xs = pairs.map((p) => p.ec25), ys = pairs.map((p) => p.tds);
  const x1 = Math.max(...xs) * 1.1;
  const fit = cal?.ok ? predictTds(cal, x1).value : 0;
  const y1 = Math.max(...ys, fit || 0) * 1.1;
  const sx = (x) => pad + (x / x1) * (W - pad - 16), sy = (y) => H - pad - (y / y1) * (H - pad - 16);
  ctx.strokeStyle = '#8aa0b8'; ctx.strokeRect(pad, 16, W - pad - 16, H - pad - 16);
  ctx.fillStyle = '#0f2238'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
  [0, 0.25, 0.5, 0.75, 1].forEach((k) => {
    ctx.fillText(String(Math.round(x1 * k)), sx(x1 * k), H - pad + 16);
    ctx.textAlign = 'right'; ctx.fillText(String(Math.round(y1 * k)), pad - 6, sy(y1 * k) + 4); ctx.textAlign = 'center';
    ctx.strokeStyle = '#eaf0f6'; ctx.beginPath(); ctx.moveTo(pad, sy(y1 * k)); ctx.lineTo(W - 16, sy(y1 * k)); ctx.stroke();
  });
  ctx.fillText('EC25 (µS/cm)', W / 2, H - 10); ctx.save(); ctx.translate(14, H / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('TDS (mg/L)', 0, 0); ctx.restore();
  if (cal?.ok) {
    ctx.strokeStyle = '#0891b2'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 60; i++) { const x = Math.max((x1 * i) / 60, 1); const y = predictTds(cal, x).value; if (y == null) continue; (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(x), sy(y)); }
    ctx.stroke();
  }
  ctx.fillStyle = '#dc2626';
  pairs.forEach((p) => { ctx.beginPath(); ctx.arc(sx(p.ec25), sy(p.tds), 4, 0, Math.PI * 2); ctx.fill(); });
  return c.toDataURL('image/png');
}
