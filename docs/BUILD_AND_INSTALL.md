# WellLog Pro – build, install and run

## Run as a desktop app (Windows)
1. Install **WellLog-Pro-Setup-<version>.exe** (built into `release/`). The installer lets you choose the folder, creates a
   **Desktop shortcut** and a Start-menu shortcut, and shows the WellLog Pro icon. It does not need internet.
2. Start "WellLog Pro". Everything runs locally; your data stays in the app's profile folder
   (`%APPDATA%\WellLog Pro`) and is **kept when you uninstall**.
3. Make backups: Settings → *Data & backup* (any file location) or *Backup now to Documents*
   (`Documents\WellLog Pro\Backups`, the newest 20 are kept).

## Build the installer yourself
```bash
npm install
npm run icons            # only if you change public/icons/icon.svg
npm run electron:pack    # test, build the web app, produce release/WellLog-Pro-Setup-x.y.z.exe
```
The first build downloads the Electron runtime and the NSIS tools (internet needed once, at build time only).
`npm run electron:start` runs the desktop app from the source tree; `npm run electron:dir` produces the unpacked
app in `release/win-unpacked`.
The installer is **not code-signed** (no certificate configured): Windows SmartScreen may show an "unknown publisher"
warning. Sign it with your own certificate (`CSC_LINK`/`CSC_KEY_PASSWORD` for electron-builder) for distribution.

## Browser / Android (PWA)
Serve the `dist/` folder from any static host over HTTPS (or localhost), open it once in Chrome and choose *Install app*.
After that it works without internet. `start-app.bat` builds and opens it locally on Windows.

## Checks
| Command | What it proves |
|---|---|
| `npm test` | unit and UI tests |
| `npm run verify:pwa` | the build is a complete offline PWA |
| `npm run e2e:offline` | real Chrome: install, go offline (server stopped), everything still works |
| `npm run e2e:mobile` | phone layout at 375 px, English and Arabic |
| `npm run e2e:electron` | real Electron app: isolation, CSP, IPC validation, local data, exports, backup (set `E2E_EXE` to test the packaged exe) |

## Desktop security model
`contextIsolation` on, `nodeIntegration` off, sandboxed renderer, strict Content-Security-Policy, the app is served from a
private `app://` scheme (not `file://`), navigation and pop-ups are blocked, every permission request is denied, and the page
can only call six allow-listed, validated IPC functions (app info, save file, open file, print to PDF, write backup, reveal
folder). The page can never choose a path to write to; files are saved only through the native Save dialog or the app's own
backup folder, and only for the types json, csv, xlsx, pdf, png, txt.
