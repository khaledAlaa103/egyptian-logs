'use strict';
// Preload script (sandboxed, contextIsolation on). It exposes a tiny, frozen, allow-listed API to the page.
// The page never receives Node.js, `require`, `ipcRenderer` or file paths it could write to.
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('desktop', Object.freeze({
  isDesktop: true,
  getInfo: () => call('app:info'),
  /** Native "Save as" dialog; data: string | Uint8Array. Returns { ok, canceled, path }. */
  saveFile: (req) => call('file:save', req),
  /** Native "Open" dialog; returns { ok, canceled, name, data } with the file content (no path is exposed). */
  openFile: (req) => call('file:open', req),
  /** Vector PDF of the current page through the print engine (print stylesheet applies). */
  printPdf: (req) => call('pdf:print', req),
  /** Write a backup JSON into the app's own Documents folder (the folder is chosen by the main process). */
  writeBackup: (req) => call('backup:write', req),
  reveal: (which) => call('folder:reveal', { which }),
}));
