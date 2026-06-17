@echo off
cd /d "%~dp0"
echo =================================================================
echo        TZEL - PIPELINE DE ADQUISICIÓN OSINT INMOBILIARIO
echo =================================================================
echo [TZEL STARTUP] Ejecutando pipeline en: %~dp0
echo [TZEL STARTUP] Hora de inicio: %date% %time%
echo -----------------------------------------------------------------

npx ts-node run_pipeline.ts > pipeline_execution.log 2>&1

echo -----------------------------------------------------------------
echo [TZEL STARTUP] Pipeline completado.
echo [TZEL STARTUP] Hora de finalizacion: %date% %time%
echo =================================================================
