import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const lib = require('../electron/lib.cjs');

describe('file names and save requests (renderer input is never trusted)', () => {
  it('sanitises names: no paths, no forbidden characters, Arabic kept, never empty', () => {
    expect(lib.sanitizeFileName('../../Windows/system32/evil.json')).toBe('evil.json');
    expect(lib.sanitizeFileName('C:\\Users\\x\\a:b*c?.csv')).toBe('a_b_c_.csv');
    expect(lib.sanitizeFileName('تقرير البئر 1.pdf')).toBe('تقرير البئر 1.pdf');
    expect(lib.sanitizeFileName('   ')).toBe('file');
    expect(lib.sanitizeFileName('...hidden.json')).toBe('hidden.json');
    expect(lib.sanitizeFileName('a'.repeat(300) + '.csv').length).toBeLessThanOrEqual(120);
    expect(lib.sanitizeFileName(undefined, 'x')).toBe('x');
  });
  it('allows only data/report file types', () => {
    for (const n of ['a.json', 'a.CSV', 'a.xlsx', 'a.pdf', 'a.png', 'a.txt']) expect(lib.isAllowedExt(n), n).toBe(true);
    for (const n of ['a.exe', 'a.bat', 'a.js', 'a.html', 'a.lnk', 'a', 'a.json.exe']) expect(lib.isAllowedExt(n), n).toBe(false);
  });
  it('validates save requests', () => {
    expect(lib.validateSaveRequest({ defaultName: 'r.pdf', data: new Uint8Array(10) })).toMatchObject({ defaultName: 'r.pdf', ext: '.pdf', size: 10 });
    expect(lib.validateSaveRequest({ defaultName: 'x.csv', data: 'héllo' }).size).toBe(6);
    expect(() => lib.validateSaveRequest(null)).toThrow();
    expect(() => lib.validateSaveRequest({ defaultName: 'run.exe', data: 'x' })).toThrow(/not allowed/);
    expect(() => lib.validateSaveRequest({ defaultName: 'a.json', data: 42 })).toThrow(/Invalid data/);
    expect(() => lib.validateSaveRequest({ defaultName: 'a.json', data: { byteLength: lib.MAX_SAVE_BYTES + 1 } })).toThrow(/too large/);
    expect(lib.filtersFor('.xlsx')[0]).toEqual({ name: 'Excel', extensions: ['xlsx'] });
  });
});

describe('app:// protocol and trust', () => {
  const dist = resolve('/app/dist');
  it('serves only files inside dist (path traversal is refused)', () => {
    expect(lib.resolveInside(dist, '/')).toBe(resolve(dist, 'index.html'));
    expect(lib.resolveInside(dist, '/assets/x.js')).toBe(resolve(dist, 'assets/x.js'));
    expect(lib.resolveInside(dist, '/../secret.txt')).toBeNull();
    expect(lib.resolveInside(dist, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(lib.resolveInside(dist, '/assets/../../secret')).toBeNull();
  });
  it('mime types for the assets the app uses', () => {
    expect(lib.mimeFor('a.mjs')).toMatch(/javascript/); expect(lib.mimeFor('a.js')).toMatch(/javascript/); expect(lib.mimeFor('a.css')).toMatch(/css/);
    expect(lib.mimeFor('a.png')).toBe('image/png'); expect(lib.mimeFor('a.webmanifest')).toMatch(/manifest/); expect(lib.mimeFor('a.xyz')).toBe('application/octet-stream');
  });
  it('only the app’s own origin may call the IPC channels', () => {
    expect(lib.isTrustedUrl('app://welllog/index.html')).toBe(true);
    expect(lib.isTrustedUrl('app://welllog/')).toBe(true);
    for (const u of ['https://evil.example/', 'file:///C:/x.html', 'app://other/index.html', 'app://welllog.evil.com/', undefined, null, 5]) expect(lib.isTrustedUrl(u), String(u)).toBe(false);
  });
  it('CSP blocks remote code, plugins and framing', () => {
    expect(lib.CSP).toMatch(/default-src 'self'/); expect(lib.CSP).toMatch(/object-src 'none'/); expect(lib.CSP).toMatch(/frame-ancestors 'none'/);
    expect(lib.CSP).not.toMatch(/'unsafe-eval'/); expect(lib.CSP).not.toMatch(/script-src[^;]*unsafe-inline/); expect(lib.CSP).not.toMatch(/https?:\/\//);
  });
});

describe('backups and window state', () => {
  it('backup names sort chronologically; only the newest N are kept; foreign files are never deleted', () => {
    expect(lib.backupFileName(new Date(2026, 10, 6, 9, 5, 7))).toBe('welllog-backup-20261106-090507.json');
    const names = ['welllog-backup-20260101-000000.json', 'welllog-backup-20260103-000000.json', 'welllog-backup-20260102-000000.json', 'notes.txt', 'welllog-backup-bad.json'];
    expect(lib.backupsToPrune(names, 2)).toEqual(['welllog-backup-20260101-000000.json']);
    expect(lib.backupsToPrune(names, 5)).toEqual([]);
  });
  it('restores window bounds only when visible on a current display', () => {
    const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
    expect(lib.clampWindowState({ x: 100, y: 80, width: 1200, height: 800, maximized: true }, displays)).toEqual({ x: 100, y: 80, width: 1200, height: 800, maximized: true });
    expect(lib.clampWindowState({ x: 5000, y: 80, width: 1200, height: 800 }, displays)).toEqual({ width: 1200, height: 800, maximized: false }); // monitor unplugged
    expect(lib.clampWindowState({ width: 100, height: 100 }, displays)).toEqual({ width: 900, height: 600, maximized: false });
    expect(lib.clampWindowState(null, displays)).toEqual({ width: 1366, height: 860 });
    expect(lib.clampWindowState({ width: 'x', height: 5 }, displays)).toEqual({ width: 1366, height: 860 });
  });
});

describe('Electron configuration is secure and complete', () => {
  const main = readFileSync(resolve(process.cwd(), 'electron/main.cjs'), 'utf8');
  const preload = readFileSync(resolve(process.cwd(), 'electron/preload.cjs'), 'utf8');
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

  it('window uses contextIsolation on, nodeIntegration off, sandbox on, webSecurity on', () => {
    expect(main).toMatch(/contextIsolation:\s*true/); expect(main).toMatch(/nodeIntegration:\s*false/); expect(main).toMatch(/sandbox:\s*true/); expect(main).toMatch(/webSecurity:\s*true/);
    expect(main).not.toMatch(/nodeIntegration:\s*true/); expect(main).not.toMatch(/contextIsolation:\s*false/); expect(main).not.toMatch(/enableRemoteModule/);
    expect(main).toMatch(/setWindowOpenHandler/); expect(main).toMatch(/will-navigate/); expect(main).toMatch(/setPermissionRequestHandler/);
  });
  it('every IPC handler checks the sender and the preload exposes only fixed channels', () => {
    expect(main).toMatch(/Untrusted sender/);
    const channels = [...main.matchAll(/(?<![.\w])handle\('([a-z]+:[a-z]+)'/g)].map((m) => m[1]).sort(); // ipc handlers only (not protocol.handle)
    expect(channels).toEqual(['app:info', 'backup:write', 'file:open', 'file:save', 'folder:reveal', 'pdf:print']);
    const used = [...preload.matchAll(/call\('([a-z:]+)'/g)].map((m) => m[1]).sort();
    expect(used).toEqual(channels);
    expect(preload).not.toMatch(/exposeInMainWorld\('[^']+',\s*ipcRenderer/); expect(preload).toMatch(/Object\.freeze/);
    expect(main).not.toMatch(/ipcMain\.on\(/); // only invoke/handle, with validation
  });
  it('the page can never choose a path to write to', () => {
    expect(main).toMatch(/dialog\.showSaveDialog/); expect(main).not.toMatch(/req\.path|req\?\.path|payload\.path/);
  });
  it('packaging: Windows NSIS installer with desktop shortcut, custom icon, data kept on uninstall', () => {
    expect(pkg.main).toBe('electron/main.cjs');
    expect(pkg.build.win.target[0].target).toBe('nsis'); expect(pkg.build.win.icon).toBe('build/icon.ico');
    expect(pkg.build.nsis).toMatchObject({ createDesktopShortcut: 'always', createStartMenuShortcut: true, deleteAppDataOnUninstall: false, allowToChangeInstallationDirectory: true, oneClick: false });
    expect(pkg.build.files).toEqual(expect.arrayContaining(['dist/**/*', 'electron/**/*']));
    expect(pkg.build.productName).toBe('WellLog Pro');
  });
});
