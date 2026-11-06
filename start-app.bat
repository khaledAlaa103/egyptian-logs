@echo off
rem WellLog Pro - build and open the app in your default browser (works offline once built).
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Building...
call npm run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
echo Starting WellLog Pro at http://localhost:4173 ... close this window to stop.
call npx vite preview --port 4173 --open
