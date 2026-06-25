@echo off
echo Starte Alfonz-Helper...
echo.

REM Falls von einem vorherigen Start noch ein Prozess auf Port 7861 laeuft,
REM wird er hier automatisch beendet (sonst kommt "EADDRINUSE").
for /f "tokens=5" %%P in ('netstat -aon ^| findstr ":7861" ^| findstr "LISTENING"') do (
    echo Beende alten Prozess auf Port 7861 ^(PID %%P^)...
    taskkill /F /PID %%P >nul 2>&1
)

if not exist node_modules (
    echo Erste Ausfuehrung erkannt - installiere Abhaengigkeiten...
    call npm install
    echo.
)

echo Tipp: Vergiss nicht, vorher "ollama serve" in einem eigenen Fenster zu starten!
echo.
node server.js

pause
