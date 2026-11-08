import { isDesktop, saveWithDesktop } from '../desktop/bridge.js';

/** Save a file: native Save dialog in the desktop app, browser download otherwise. */
export function downloadFile(filename, content, mime = 'application/octet-stream') {
  if (isDesktop()) return saveWithDesktop(filename, content).catch(() => ({ ok: false }));
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function readFileBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

export const safeName = (s) => String(s || 'export').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
