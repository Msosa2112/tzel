@echo off
title VINCULAR CUENTA DE FACEBOOK DE BARBA CONSTRUCTION
cd /d "c:\TRABAJO\TZEL\tzel"
echo =================================================================
echo   CONECTOR DE CUENTA DE FACEBOOK DE BARBA CONSTRUCTION
echo =================================================================
echo.
npx ts-node modules/construction/scrapers/login_barba_facebook.ts
pause
