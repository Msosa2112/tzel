@echo off
cd /d "%~dp0"
echo =================================================================
echo        TZEL - PIPELINE DE ADQUISICIÓN OSINT INMOBILIARIO
echo =================================================================
echo [TZEL STARTUP] Ejecutando pipeline en: %~dp0
echo [TZEL STARTUP] Hora de inicio: %date% %time%
echo -----------------------------------------------------------------

echo [TZEL STARTUP] Verificando servicio de Docker...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [TZEL STARTUP] Docker no esta respondiendo. Iniciando Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" --unattended
    echo [TZEL STARTUP] Esperando 15 segundos para que los contenedores se inicialicen...
    timeout /t 15 /nobreak >nul
) else (
    echo [TZEL STARTUP] Docker ya esta corriendo.
)

REM Verificar si Bun esta disponible para ejecucion ultrarrapida
set "BUN_EXE=%USERPROFILE%\.bun\bin\bun.exe"
if exist "%BUN_EXE%" (
    echo [TZEL STARTUP] Ejecutando con Bun 1.4 ^(Motor ultrarrapido en Rust^)...
    "%BUN_EXE%" run_pipeline.ts > pipeline_execution.log 2>&1
) else (
    echo [TZEL STARTUP] Ejecutando con ts-node...
    npx ts-node run_pipeline.ts > pipeline_execution.log 2>&1
)

echo -----------------------------------------------------------------
echo [TZEL STARTUP] Pipeline completado.
echo [TZEL STARTUP] Hora de finalizacion: %date% %time%
echo =================================================================
