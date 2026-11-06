'use strict';
// Pure helpers for the Electron main process (no Electron imports) so they can be unit-tested.
const path = require('node:path');

const ALLOWED_EXT = new Set(['.json', '.csv', '.xlsx', '.pdf', '.png', '.txt']);
const MAX_SAVE_BYTES = 500 * 1024 * 1024;
const MAX_OPEN_BYTES = 200 * 1024 * 1024;
const APP_ORIGIN = 'app://welllog';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};
const mimeFor = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

/** Content-Security-Policy applied to every page the app serves. */
const CSP = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self' data:", "connect-src 'self' blob: data:", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

/** Remove path separators and characters Windows forbids; keep Arabic and other letters. Never empty. */
function sanitizeFileName(name, fallback = 'file') {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must be removed
  const base = path.basename(String(name || '')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  const cleaned = base.slice(0, 120);
  return cleaned || fallback;
}

const extOf = (name) => path.extname(String(name || '')).toLowerCase();
const isAllowedExt = (name) => ALLOWED_EXT.has(extOf(name));

/** Validate and normalise a save request coming from the renderer. Throws on anything suspicious. */
function validateSaveRequest(req) {
  if (!req || typeof req !== 'object') throw new Error('Invalid request');
  const defaultName = sanitizeFileName(req.defaultName, 'export');
  if (!isAllowedExt(defaultName)) throw new Error(`File type not allowed: ${extOf(defaultName) || '(none)'}`);
  const d = req.data;
  const size = typeof d === 'string' ? Buffer.byteLength(d) : d && typeof d.byteLength === 'number' ? d.byteLength : -1;
  if (size < 0) throw new Error('Invalid data');
  if (size > MAX_SAVE_BYTES) throw new Error('File too large');
  return { defaultName, ext: extOf(defaultName), size };
}

/** File-dialog filters for an extension. */
function filtersFor(ext) {
  const names = { '.json': 'JSON', '.csv': 'CSV', '.xlsx': 'Excel', '.pdf': 'PDF', '.png': 'PNG', '.txt': 'Text' };
  return [{ name: names[ext] || 'File', extensions: [ext.slice(1)] }, { name: 'All files', extensions: ['*'] }];
}

/** Only pages of the app itself may use the IPC channels. */
const isTrustedUrl = (url) => typeof url === 'string' && (url === `${APP_ORIGIN}/` || url.startsWith(`${APP_ORIGIN}/`) || (!!process.env.ELECTRON_START_URL && url.startsWith(process.env.ELECTRON_START_URL)));

/** Resolve a request path inside distDir; returns null if it would escape it. */
function resolveInside(distDir, urlPath) {
  let p = decodeURIComponent(urlPath || '/');
  if (p === '/' || p === '') p = '/index.html';
  const full = path.normalize(path.join(distDir, p));
  const root = path.normalize(distDir + path.sep);
  return full.startsWith(root) ? full : null;
}

const pad = (n) => String(n).padStart(2, '0');
function backupFileName(date = new Date()) {
  return `welllog-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`;
}
/** Names to delete so that at most `keep` backups remain (oldest first by name). */
function backupsToPrune(names, keep = 20) {
  const mine = names.filter((n) => /^welllog-backup-\d{8}-\d{6}\.json$/.test(n)).sort();
  return mine.slice(0, Math.max(0, mine.length - keep));
}

/** Keep a saved window rectangle only if it is (mostly) visible on a current display. */
function clampWindowState(state, displays, fallback = { width: 1366, height: 860 }) {
  const ok = (v) => Number.isFinite(v);
  if (!state || !ok(state.width) || !ok(state.height)) return { ...fallback };
  const width = Math.max(900, Math.min(state.width, 10000)), height = Math.max(600, Math.min(state.height, 10000));
  if (ok(state.x) && ok(state.y)) {
    const visible = displays.some((d) => state.x + 100 < d.x + d.width && state.x + width - 100 > d.x && state.y + 50 < d.y + d.height && state.y > d.y - 50);
    if (visible) return { x: state.x, y: state.y, width, height, maximized: !!state.maximized };
  }
  return { width, height, maximized: !!state.maximized };
}

module.exports = {
  ALLOWED_EXT, MAX_SAVE_BYTES, MAX_OPEN_BYTES, APP_ORIGIN, CSP, mimeFor, sanitizeFileName, isAllowedExt, extOf, validateSaveRequest, filtersFor,
  isTrustedUrl, resolveInside, backupFileName, backupsToPrune, clampWindowState,
};
