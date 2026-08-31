@echo off
echo =================================================================
echo 🌐 ABRIENDO GOOGLE CHROME CON TU CUENTA REAL Y CONEXION AUTOMATICA 🌐
echo =================================================================
echo.
echo Cerrando Chrome para habilitar conexion sin bloqueos...
taskkill /F /IM chrome.exe /T 2>nul
timeout /t 2 /nobreak >nul
echo.
echo Iniciando tu Google Chrome oficial con tu cuenta de Google...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
echo.
echo =================================================================
echo ✅ ¡LISTO! Tu Chrome esta abierto con tu cuenta de Google activa.
echo Ahora ejecuta "scripts\login_skiptrace.bat" o "scripts\skiptrace_free.bat"
echo y el bot usara tu propio navegador sin ningun tipo de bloqueo.
echo =================================================================
pause
