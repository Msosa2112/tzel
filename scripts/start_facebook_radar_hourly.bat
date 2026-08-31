@echo off
title TZEL Facebook Construction Radar (Hourly)
echo ========================================================
echo   TZEL - Radar Horario de Facebook (Goteras, Canaletas, Techos)
echo   Frecuencia: Cada 1 Hora con Alertas Directas a Telegram
echo ========================================================
cd /d "%~dp0\.."
npx ts-node modules/construction/schedulers/facebook_hourly_daemon.ts
pause
