@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

echo =======================================================
echo   Teste Local - Frontend + Backend
echo =======================================================
echo.

:: -----------------------------------------------------------
:: [0] Liberar portas 8000 e 5173
:: -----------------------------------------------------------
echo [0/3] Liberando portas 8000 e 5173...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 8000,5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul
echo    Portas liberadas.
echo.

:: -----------------------------------------------------------
:: [1] Configurar API local
:: -----------------------------------------------------------
echo [1/3] Configurando API para backend local...
(
echo VITE_API_URL=http://127.0.0.1:8000
) > "client\.env.development.local"
echo    OK.
echo.

:: -----------------------------------------------------------
:: [2] Subir Backend Python
:: -----------------------------------------------------------
echo [2/3] Iniciando Backend FastAPI (porta 8000)...
if exist "%~dp0.venv\Scripts\python.exe" (
    start "Nesh Backend" /D "%~dp0" cmd /k "set CACHE__ENABLE_REDIS=false& .venv\Scripts\python.exe Nesh.py"
) else (
    start "Nesh Backend" /D "%~dp0" cmd /k "set CACHE__ENABLE_REDIS=false& uv run Nesh.py"
)
echo    Backend iniciado. Aguarde alguns segundos para ele subir.
echo.

:: -----------------------------------------------------------
:: [3] Subir Frontend usando o script padrao do client
:: -----------------------------------------------------------
echo [3/3] Iniciando Frontend Vite (porta 5173)...
start "Nesh Frontend" /D "%~dp0client" cmd /k "npm run dev"
echo    Frontend iniciado.
echo.

:: -----------------------------------------------------------
:: Aguardar Vite subir e abrir navegador
:: -----------------------------------------------------------
echo Aguardando Vite ficar pronto (ate 30s)...
set "VITE_OK=0"
for /L %%i in (1,1,30) do (
    if "!VITE_OK!"=="0" (
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$r = try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 1; $r.StatusCode } catch { 0 }; exit $(if ($r -ge 200 -and $r -lt 400) { 0 } else { 1 })" >nul 2>&1
        if !errorlevel! equ 0 (
            set "VITE_OK=1"
        ) else (
            timeout /t 1 /nobreak >nul
        )
    )
)

echo.
echo =======================================================
echo   PRONTO!
echo   Backend:  http://127.0.0.1:8000/api/status
echo   Frontend: http://127.0.0.1:5173/
echo =======================================================
echo.

if "!VITE_OK!"=="1" (
    start "" "http://127.0.0.1:5173/"
) else (
    echo.
    echo [ERRO] O frontend nao respondeu na porta 5173.
    echo        Verifique a janela "Nesh Frontend" e os logs acima.
)
pause
