@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

set "NPM_CMD=npm.cmd"
where "%NPM_CMD%" >nul 2>&1
if errorlevel 1 (
    if exist "%ProgramFiles%\nodejs\npm.cmd" (
        set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"
    ) else (
        echo [ERRO] npm.cmd nao encontrado no PATH nem em "%ProgramFiles%\nodejs".
        goto :end
    )
)

echo =======================================================
echo   Teste Local Completo (Frontend + Backend)
echo =======================================================
echo.

set "PS_CHECK=powershell -NoProfile -ExecutionPolicy Bypass -Command"

:: -----------------------------------------------------------
:: [0] Limpar processos antigos que travam as portas
:: -----------------------------------------------------------
echo [0/4] Liberando portas 8000 e 5173...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 8000,5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul
echo    Portas liberadas.
echo.

:: -----------------------------------------------------------
:: [1] Criar .env.development.local temporario
::     (tem prioridade MAXIMA sobre .env.local no modo dev)
:: -----------------------------------------------------------
echo [1/4] Configurando API para backend local...
(
echo # Gerado automaticamente por testar_tudo_local.bat
echo # Apague este arquivo para voltar a usar o Render.
echo VITE_API_URL=http://127.0.0.1:8000
) > "client\.env.development.local"
echo    client\.env.development.local criado.
echo.

:: -----------------------------------------------------------
:: [2] Subir o Backend
::     Preferir o Python ja existente da .venv para evitar falhas do uv
::     quando ha arquivos travados/permissoes no cache/site-packages.
:: -----------------------------------------------------------
echo [2/4] Iniciando Backend FastAPI (porta 8000)...
if exist "%~dp0.venv\Scripts\python.exe" (
    echo    Usando Python da .venv.
    set "CACHE__ENABLE_REDIS=false"
    start "Nesh API (Teste Local)" /D "%~dp0" "%~dp0.venv\Scripts\python.exe" Nesh.py
) else (
    echo    Python da .venv nao encontrado. Usando uv run.
    start "Nesh API (Teste Local)" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "$env:CACHE__ENABLE_REDIS='false'; Set-Location -LiteralPath '%~dp0'; uv run Nesh.py"
)

echo    Aguardando o backend responder (ate 30s)...
set "BACKEND_OK=0"
for /L %%i in (1,1,30) do (
    if "!BACKEND_OK!"=="0" (
        %PS_CHECK% "$r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/api/status' -TimeoutSec 2; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) { exit 0 } else { exit 1 }" >nul 2>&1
        if !errorlevel! equ 0 (
            set "BACKEND_OK=1"
            echo.
            echo    Backend respondeu em %%i segundos!
        ) else (
            <nul set /p="."
            timeout /t 1 /nobreak >nul
        )
    )
)
if "!BACKEND_OK!"=="0" (
    echo.
    echo [ERRO] Backend nao respondeu em 30s. Verifique a janela "Nesh API".
    echo        O frontend nao sera iniciado para evitar erros 502 do proxy.
    goto :end
)
echo.

:: -----------------------------------------------------------
:: [3] Subir o Frontend
:: -----------------------------------------------------------
echo [3/4] Iniciando Frontend React (porta 5173)...
start "Nesh Client (Teste Local)" /D "%~dp0client" "%ComSpec%" /k ""%NPM_CMD%" run dev -- --host 127.0.0.1"

echo    Aguardando o Vite abrir (ate 20s)...
set "VITE_OK=0"
for /L %%i in (1,1,20) do (
    if "!VITE_OK!"=="0" (
        %PS_CHECK% "$r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) { exit 0 } else { exit 1 }" >nul 2>&1
        if !errorlevel! equ 0 (
            set "VITE_OK=1"
            echo.
            echo    Vite pronto!
        ) else (
            <nul set /p="."
            timeout /t 1 /nobreak >nul
        )
    )
)
if "!VITE_OK!"=="0" (
    echo.
    echo [ERRO] Frontend nao respondeu em 20s. Verifique a janela "Nesh Client".
    goto :end
)
echo.

:: -----------------------------------------------------------
:: [4] Abrir o navegador
:: -----------------------------------------------------------
echo [4/4] Abrindo no navegador...
start "" "http://127.0.0.1:5173/"

echo.
echo =======================================================
echo   TUDO PRONTO!
echo.
echo   Backend:  http://localhost:8000/api/status
echo   Frontend: http://127.0.0.1:5173/
echo.
echo   DICA: Para voltar a usar o Render, delete o arquivo:
echo   client\.env.development.local
echo =======================================================
echo.
:end
pause
