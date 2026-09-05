@echo off
cd /d "%~dp0"
echo =================================================================
echo        TZEL - PIPELINE MANUAL REAL ESTATE (FORECLOSURES)
echo =================================================================
echo [REGLAS]
echo  - CERO BatchData (No consume saldo de API)
echo  - Casas <= $350,000 USD solamente
echo  - CERO dano fisico / infracciones de codigo
echo  - Foco: Subastas Judiciales, Pre-Foreclosures y Tax Sales
echo -----------------------------------------------------------------

set "BUN_EXE=%USERPROFILE%\.bun\bin\bun.exe"
if exist "%BUN_EXE%" (
    echo [EJECUCION] Corriendo con Bun ultrarrapido...
    "%BUN_EXE%" scripts/run_real_estate_pipeline_manual.ts
) else (
    echo [EJECUCION] Corriendo con ts-node...
    npx ts-node scripts/run_real_estate_pipeline_manual.ts
)

echo.
echo =================================================================
echo Pipeline finalizado.
echo =================================================================
pause
