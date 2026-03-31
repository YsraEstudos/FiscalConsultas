@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

set "ENABLE_REBUILD=0"
set "ENABLE_AUTH_DEBUG=0"

set "CHK_AUTH_ENV=PENDENTE"
set "CHK_UV=PENDENTE"
set "CHK_NODE=PENDENTE"
set "CHK_NPM=PENDENTE"
set "CHK_BACKEND_HEALTH=PENDENTE"
set "CHK_FRONTEND_PORT=PENDENTE"

set "FAIL_REASON="
set "FRONTEND_BOOT_CMD=npm run dev"
set "CHECKLIST_FILE=%TEMP%\nesh_startup_checklist.txt"
set "CHECKLIST_SHOWN=0"

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--rebuild" (
    set "ENABLE_REBUILD=1"
) else if /I "%~1"=="--auth-debug" (
    set "ENABLE_AUTH_DEBUG=1"
) else (
    echo [WARN] Argumento ignorado: %~1
)
shift
goto parse_args
:args_done

where uv >nul 2>&1
if errorlevel 1 (
    set "CHK_UV=FALHA"
    set "FAIL_REASON='uv' nao encontrado no PATH."
    goto fail
)
set "CHK_UV=OK"

where node >nul 2>&1
if errorlevel 1 (
    set "CHK_NODE=FALHA"
    set "FAIL_REASON='node' nao encontrado no PATH."
    goto fail
)
set "CHK_NODE=OK"

where npm >nul 2>&1
if errorlevel 1 (
    set "CHK_NPM=FALHA"
    set "FAIL_REASON='npm' nao encontrado no PATH."
    goto fail
)
set "CHK_NPM=OK"

echo.
echo [1/6] Validando variaveis obrigatorias de Auth...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\validate_auth_env.ps1"
if errorlevel 1 (
    set "CHK_AUTH_ENV=FALHA"
    set "FAIL_REASON=Configuracao de Auth incompleta em .env e client/.env.local."
    goto fail
)
set "CHK_AUTH_ENV=OK"

if "!ENABLE_AUTH_DEBUG!"=="1" (
    echo [INFO] Modo auth debug habilitado para o frontend: VITE_AUTH_DEBUG=true nesta sessao.
    set "FRONTEND_BOOT_CMD=set VITE_AUTH_DEBUG=true && npm run dev"
)

echo.
echo [2/6] Sincronizando ambiente Python com UV...
call uv sync
if errorlevel 1 (
    set "CHK_UV=FALHA"
    set "FAIL_REASON=Falha ao sincronizar dependencias com uv sync."
    goto fail
)

echo.
echo [3/6] Iniciando Backend Local (Opcional, com banco Neon)...
call :stop_listener_port 8000 backend
start "Nesh Backend Server" cmd /k "uv run Nesh.py"
set "CHK_BACKEND_HEALTH=OK"

echo.
echo [4/6] Verificando dependencias Frontend...
cd client
set "NEED_INSTALL=0"
if not exist "node_modules\" set "NEED_INSTALL=1"
if "!NEED_INSTALL!"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Test-Path 'package-lock.json')) { exit 1 }; if ((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item 'node_modules').LastWriteTime) { exit 1 } else { exit 0 }" && set "LOCKFILE_HAS_CHANGES=0" || set "LOCKFILE_HAS_CHANGES=1"
    if "!LOCKFILE_HAS_CHANGES!"=="1" set "NEED_INSTALL=1"
)
if "!NEED_INSTALL!"=="1" (
    echo [INFO] Instalando dependencias do frontend...
    call npm install
    if errorlevel 1 (
        cd ..
        set "CHK_NPM=FALHA"
        set "FAIL_REASON=Falha no npm install em client."
        goto fail
    )
) else (
    echo [INFO] node_modules atualizada. Pulando npm install.
)

echo.
echo [5/6] Iniciando Frontend com Hot Reload...
call :stop_listener_port 5173 frontend
start "Nesh Client (Dev)" cmd /k "cd /d "%~dp0client" && !FRONTEND_BOOT_CMD!"
cd ..

echo.
echo [6/6] Validando se o Frontend subiu...
call :wait_port_open 5173 50
if errorlevel 1 (
    set "CHK_FRONTEND_PORT=FALHA"
    set "FAIL_REASON=Frontend nao abriu a porta 5173."
    goto fail
)
set "CHK_FRONTEND_PORT=OK"

start "" "http://127.0.0.1:5173"

echo.
echo Sistema pronto para uso.
call :print_checklist
call :write_checklist_file "SUCESSO"
call :open_checklist_file
echo.
echo Links uteis:
echo - Frontend Local: http://127.0.0.1:5173
echo - Checklist: %CHECKLIST_FILE%
pause
exit /b 0

:fail
echo.
echo [ERRO] !FAIL_REASON!
call :print_checklist
call :write_checklist_file "FALHA"
call :open_checklist_file
call :offer_manual_actions
echo.
echo Corrija os itens [ ] e execute o script novamente.
echo Checklist salvo em: %CHECKLIST_FILE%
pause
exit /b 1

:wait_port_open
set "TARGET_PORT=%~1"
set /a MAX_ATTEMPTS=%~2
if "%MAX_ATTEMPTS%"=="" set /a MAX_ATTEMPTS=40

powershell -NoProfile -ExecutionPolicy Bypass -Command "=%TARGET_PORT%; =%MAX_ATTEMPTS%; =False; for(=0;  -lt ; ++){ try { =New-Object System.Net.Sockets.TcpClient; =.BeginConnect('127.0.0.1',,,); if(.AsyncWaitHandle.WaitOne(700,False) -and .Connected){ .EndConnect(); .Close(); =True; break } .Close() } catch {}; Start-Sleep -Milliseconds 700 }; if(){ exit 0 } else { exit 1 }"
if errorlevel 1 exit /b 1
exit /b 0

:stop_listener_port
set "TARGET_PORT=%~1"
set "TARGET_LABEL=%~2"
if "%TARGET_PORT%"=="" exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -Command "=%TARGET_PORT%; ='%TARGET_LABEL%';  = Get-NetTCPConnection -LocalPort  -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if () { Write-Host ('[INFO] Encerrando listener existente na porta ' +  + ' (' +  + ')...'); foreach ( in ) { try { Stop-Process -Id  -Force -ErrorAction Stop } catch {} } Start-Sleep -Milliseconds 600 }"
exit /b 0

:print_checklist
echo.
echo ================= CHECKLIST DE INICIALIZACAO =================
call :print_check_item "Auth env configurado" "!CHK_AUTH_ENV!" "Preencha .env e client/.env.local - Clerk."
call :print_check_item "UV disponivel e sincronizado" "!CHK_UV!" "Instale UV: pip install uv"
call :print_check_item "Node disponivel" "!CHK_NODE!" "Instale Node.js 18+."
call :print_check_item "NPM disponivel e dependencias ok" "!CHK_NPM!" "Verifique npm install em client/."
call :print_check_item "Backend local rodando (Opcional)" "!CHK_BACKEND_HEALTH!" "Backend iniciado para testes de api."
call :print_check_item "Frontend ativo na porta 5173" "!CHK_FRONTEND_PORT!" "Verifique a janela Nesh Client Dev."
echo =================================================================
exit /b 0

:print_check_item
set "ITEM_LABEL=%~1"
set "ITEM_STATUS=%~2"
set "ITEM_HINT=%~3"

if /I "%ITEM_STATUS%"=="OK" (
    echo [x] %ITEM_LABEL%
) else (
    echo [ ] %ITEM_LABEL% ^(%ITEM_STATUS%^)
    if not "%ITEM_HINT%"=="" echo     - %ITEM_HINT%
)
exit /b 0

:offer_manual_actions
if /I "!CHK_AUTH_ENV!"=="FALHA" call :offer_open_auth_files
exit /b 0

:offer_open_auth_files
echo.
choice /C SN /N /M "Abrir .env e client/.env.local agora? [S/N]: "
if errorlevel 2 exit /b 0
if not exist ".env" type nul > ".env"
if not exist "client\.env.local" type nul > "client\.env.local"
start "" notepad ".env"
start "" notepad "client\.env.local"
exit /b 0

:write_checklist_file
set "CHECKLIST_MODE=%~1"
(
echo =============================================================
echo NESH STARTUP CHECKLIST (CLOUD DB MODE)
echo =============================================================
echo Data: %date% %time%
echo Resultado: %CHECKLIST_MODE%
if /I "%CHECKLIST_MODE%"=="FALHA" echo Motivo: !FAIL_REASON!
echo.
echo [Auth]
echo - Auth env configurado: !CHK_AUTH_ENV!
echo.
echo [Runtime]
echo - UV disponivel e sincronizado: !CHK_UV!
echo - Node disponivel: !CHK_NODE!
echo - NPM disponivel e dependencias ok: !CHK_NPM!
echo - Backend local rodando (opcional): !CHK_BACKEND_HEALTH!
echo - Frontend ativo na porta 5173: !CHK_FRONTEND_PORT!
echo.
echo [Links]
echo - Frontend Local: http://127.0.0.1:5173
) > "%CHECKLIST_FILE%"
exit /b 0

:open_checklist_file
if /I "!CHECKLIST_SHOWN!"=="1" exit /b 0
set "CHECKLIST_SHOWN=1"
if exist "%SystemRoot%\System32\notepad.exe" (
    start "" "%SystemRoot%\System32\notepad.exe" "%CHECKLIST_FILE%"
) else (
    start "" notepad "%CHECKLIST_FILE%"
)
start "Nesh Startup Checklist" cmd /k "echo NESH STARTUP CHECKLIST ^&^& echo. ^&^& type \"%CHECKLIST_FILE%\" ^&^& echo. ^&^& echo Feche esta janela quando terminar."
exit /b 0
