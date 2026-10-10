@echo off
rem Startet den Homeoffice-Rechner lokal: http://127.0.0.1:8080/
rem Benoetigt PHP in php\php.exe (siehe ANLEITUNG.md) oder im PATH.
rem Beenden: das Fenster "Homeoffice-Rechner Server" schliessen.
cd /d "%~dp0"
set HOR_CONFIG=%~dp0config.php
set PHP=php\php.exe
if not exist %PHP% set PHP=php
start "Homeoffice-Rechner Server" %PHP% -S 127.0.0.1:8080 -t ..\webapp
timeout /t 2 /nobreak >nul
if exist data\lokal.sqlite (
    start "" "http://127.0.0.1:8080/"
) else (
    start "" "http://127.0.0.1:8080/setup.php?key=lokal-einrichtung-123456"
)
