@echo off
chcp 65001 >nul
rem Open WHA Workforce in training mode (sample data only, nothing is saved to the live site)
cd /d "%~dp0"
echo Starting the app in training mode... please wait about 20 seconds
start "WHA training server - close this window to stop" cmd /k npx next dev -p 3005
timeout /t 15 /nobreak >nul
start "" "http://localhost:3005/pull/workload?preview=supervisor&pullreset=1"
