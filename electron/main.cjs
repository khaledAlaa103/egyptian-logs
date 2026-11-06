'use strict';
// WellLog Pro – Electron main process.
// Security model: contextIsolation ON, nodeIntegration OFF, sandboxed renderer, strict CSP, the app is served
// from a private app:// scheme (no file:// access), navigation/new windows are blocked, every permission is
// denied, and the page can only reach the main process through the allow-listed IPC channels below.
const { app, BrowserWindow, Menu, protocol, session, ipcMain, dialog, shell, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('./lib.cjs');

const DIST = path.join(__dirname, '..', 'dist');
const IS_E2E = process.env.WELLLOG_E2E === '1';
const E2E_DIR = IS_E2E ? process.env.WELLLOG_E2E_DIR : null; // tests only: bypass native dialogs and write here
const START_URL = process.env.ELECTRON_START_URL || null; // development: Vite dev server

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;

// ---------------------------------------------------------------- window state
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadState() {
  try { return lib.clampWindowState(JSON.parse(fs.readFileSync(stateFile(), 'utf8')), screen.getAllDisplays().map((d) => d.workArea)); } catch { return lib.clampWindowState(null, []); }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch { /* not critical */ }
}

// ---------------------------------------------------------------- directories
const documentsRoot = () => path.join(app.getPath('documents'), 'WellLog Pro');
const backupsDir = () => (E2E_DIR ? path.join(E2E_DIR, 'Backups') : path.join(documentsRoot(), 'Backups'));

// ---------------------------------------------------------------- app:// protocol
function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'welllog') return new Response('Not found', { status: 404 });
      const file = lib.resolveInside(DIST, url.pathname);
      if (!file) return new Response('Forbidden', { status: 403 });
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'content-type': lib.mimeFor(file), 'content-security-policy': lib.CSP, 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------- IPC
function trusted(event) {
  const url = event.senderFrame?.url || event.sender?.getURL?.();
  return lib.isTrustedUrl(url);
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    if (!trusted(event)) throw new Error('Untrusted sender');
    return fn(payload, event);
  });
}

async function writeWithDialog(req, bytes) {
  const { defaultName, ext } = lib.validateSaveRequest({ defaultName: req.defaultName, data: bytes });
  if (E2E_DIR) { // automated tests only
    fs.mkdirSync(E2E_DIR, { recursive: true });
    const target = path.join(E2E_DIR, defaultName);
    fs.writeFileSync(target, bytes);
    return { ok: true, canceled: false, path: target };
  }
  const res = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), defaultName), filters: lib.filtersFor(ext) });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  // the user may rename; the chosen extension must still be allowed
  if (!lib.isAllowedExt(res.filePath)) throw new Error('File type not allowed');
  fs.writeFileSync(res.filePath, bytes);
  return { ok: true, canceled: false, path: res.filePath };
}

function registerIpc() {
  handle('app:info', () => ({
    name: app.getName(), version: app.getVersion(), electron: process.versions.electron, platform: process.platform,
    dataDir: app.getPath('userData'), backupsDir: backupsDir(),
  }));

  handle('file:save', async (req) => {
    const bytes = typeof req?.data === 'string' ? Buffer.from(req.data, 'utf8') : Buffer.from(req.data);
    return writeWithDialog(req, bytes);
  });

  handle('file:open', async (req) => {
    const exts = (Array.isArray(req?.extensions) ? req.extensions : ['json']).filter((e) => lib.ALLOWED_EXT.has(`.${String(e).toLowerCase()}`));
    if (!exts.length) throw new Error('File type not allowed');
    if (E2E_DIR && req?.e2eName) { // tests only
      const f = path.join(E2E_DIR, lib.sanitizeFileName(req.e2eName));
      return { ok: true, canceled: false, name: path.basename(f), data: new Uint8Array(fs.readFileSync(f)) };
    }
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Files', extensions: exts }] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    const file = res.filePaths[0];
    if (!lib.isAllowedExt(file)) throw new Error('File type not allowed');
    if (fs.statSync(file).size > lib.MAX_OPEN_BYTES) throw new Error('File too large');
    return { ok: true, canceled: false, name: path.basename(file), data: new Uint8Array(fs.readFileSync(file)) };
  });

  handle('pdf:print', async (req, event) => {
    const wc = event.sender;
    const bytes = await wc.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { marginType: 'default' } });
    return writeWithDialog({ defaultName: lib.sanitizeFileName(req?.defaultName, 'report.pdf').replace(/(\.pdf)?$/i, '.pdf') }, bytes);
  });

  handle('backup:write', async (req) => {
    if (typeof req?.json !== 'string' || !req.json.length) throw new Error('Invalid backup');
    if (Buffer.byteLength(req.json) > lib.MAX_SAVE_BYTES) throw new Error('File too large');
    JSON.parse(req.json); // must be valid JSON
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, lib.backupFileName());
    fs.writeFileSync(target, req.json, 'utf8');
    for (const n of lib.backupsToPrune(fs.readdirSync(dir), 20)) { try { fs.unlinkSync(path.join(dir, n)); } catch { /* in use */ } }
    return { ok: true, path: target };
  });

  handle('folder:reveal', async (req) => {
    const dir = req?.which === 'data' ? app.getPath('userData') : req?.which === 'backups' ? backupsDir() : null;
    if (!dir) throw new Error('Unknown folder');
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    return { ok: !err, error: err || null };
  });
}

// ---------------------------------------------------------------- window
function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    ...st, minWidth: 900, minHeight: 600, show: false, backgroundColor: '#0b1f3a', title: 'WellLog Pro', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, spellcheck: false, backgroundThrottling: !IS_E2E, devTools: !app.isPackaged || process.env.WELLLOG_DEVTOOLS === '1',
    },
  });
  if (st.maximized) win.maximize();
  if (!IS_E2E) win.once('ready-to-show', () => win.show()); // automated tests run the window hidden
  win.on('close', saveState);
  win.on('closed', () => { win = null; });

  // no pop-up windows, no navigation away from the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!lib.isTrustedUrl(url)) e.preventDefault(); });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  win.loadURL(START_URL || `${lib.APP_ORIGIN}/index.html`);
}

function buildMenu() {
  const template = [
    { label: 'WellLog Pro', submenu: [
      { label: 'Backups folder', click: () => shell.openPath(backupsDir()) },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'View', submenu: [
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ role: 'reload' }, { role: 'toggleDevTools' }]),
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  // deny every permission request (camera, geolocation, notifications, ...)
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerAppProtocol();
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
