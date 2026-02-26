@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

set "ENABLE_REBUILD=0"
set "ENABLE_AUTH_DEBUG=0"

set "CHK_DOCKER_CLI=PENDENTE"
set "CHK_DOCKER_ENGINE=PENDENTE"
set "CHK_DOCKER_STACK=PENDENTE"
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

where docker >nul 2>&1
if errorlevel 1 (
    set "CHK_DOCKER_CLI=FALHA"
    set "FAIL_REASON=Docker CLI nao encontrado no PATH."
    goto fail
)
set "CHK_DOCKER_CLI=OK"

docker info >nul 2>&1
if errorlevel 1 (
    set "CHK_DOCKER_ENGINE=FALHA"
    set "FAIL_REASON=Docker Desktop nao esta ativo."
    goto fail
)
set "CHK_DOCKER_ENGINE=OK"

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
echo [2/8] Validando variaveis obrigatorias de Auth...
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
echo [3/8] Subindo infraestrutura Docker (docker compose up -d)...
docker compose up -d
if errorlevel 1 (
    set "CHK_DOCKER_STACK=FALHA"
    set "FAIL_REASON=Falha ao executar docker compose up -d."
    goto fail
)

call :wait_compose_service db 30
if errorlevel 1 (
    set "CHK_DOCKER_STACK=FALHA"
    set "FAIL_REASON=Servico Docker 'db' nao esta pronto."
    goto fail
)

call :wait_compose_service redis 30
if errorlevel 1 (
    set "CHK_DOCKER_STACK=FALHA"
    set "FAIL_REASON=Servico Docker 'redis' nao esta pronto."
    goto fail
)

call :wait_compose_service pgadmin 30
if errorlevel 1 (
    set "CHK_DOCKER_STACK=FALHA"
    set "FAIL_REASON=Servico Docker 'pgadmin' nao esta pronto."
    goto fail
)
set "CHK_DOCKER_STACK=OK"

echo.
echo [4/8] Sincronizando ambiente Python com UV...
call uv sync
if errorlevel 1 (
    set "CHK_UV=FALHA"
    set "FAIL_REASON=Falha ao sincronizar dependencias com uv sync."
    goto fail
)

if "!ENABLE_REBUILD!"=="1" (
    echo.
    echo [4.5/8] Recriando bancos de dados...
    call uv run scripts\rebuild_index.py
    if errorlevel 1 (
        set "FAIL_REASON=Falha no rebuild_index.py."
        goto fail
    )
    call uv run scripts\setup_tipi_database.py
    if errorlevel 1 (
        set "FAIL_REASON=Falha no setup_tipi_database.py."
        goto fail
    )
)

echo.
echo [5/8] Iniciando Backend...
start "Nesh Backend Server" cmd /k "uv run Nesh.py"

echo.
echo [6/8] Verificando dependencias Frontend...
cd client
set "NEED_INSTALL=0"
if not exist "node_modules\" set "NEED_INSTALL=1"
if "!NEED_INSTALL!"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "if ((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item 'node_modules').LastWriteTime) { exit 1 } else { exit 0 }" && set "LOCKFILE_HAS_CHANGES=0" || set "LOCKFILE_HAS_CHANGES=1"
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
echo [7/8] Iniciando Frontend com Hot Reload...
start "Nesh Client (Dev)" cmd /k "cd /d "%~dp0client" && !FRONTEND_BOOT_CMD!"
cd ..

echo.
echo [8/8] Validando se os servicos subiram...
call :wait_http_ready "http://127.0.0.1:8000/api/status" 35
if errorlevel 1 (
    set "CHK_BACKEND_HEALTH=FALHA"
    set "FAIL_REASON=Backend nao respondeu em /api/status."
    goto fail
)
set "CHK_BACKEND_HEALTH=OK"

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
echo - Frontend: http://127.0.0.1:5173
echo - Backend health: http://127.0.0.1:8000/api/status
echo - pgAdmin: http://127.0.0.1:8080
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

:wait_compose_service
set "SERVICE_NAME=%~1"
set /a MAX_ATTEMPTS=%~2
if "%MAX_ATTEMPTS%"=="" set /a MAX_ATTEMPTS=30
set /a ATTEMPT=0

:wait_compose_service_loop
set /a ATTEMPT+=1
set "SVC_READY=0"
for /f "tokens=1,2" %%A in ('docker compose ps --format "{{.Service}} {{.Health}}" 2^>nul') do (
    if /I "%%A"=="!SERVICE_NAME!" (
        if /I "%%B"=="healthy" set "SVC_READY=1"
        if /I "%%B"=="" set "SVC_READY=1"
    )
)
if "!SVC_READY!"=="1" exit /b 0
if !ATTEMPT! GEQ !MAX_ATTEMPTS! exit /b 1
timeout /t 2 >nul
goto wait_compose_service_loop

:wait_http_ready
set "TARGET_URL=%~1"
set /a MAX_ATTEMPTS=%~2
if "%MAX_ATTEMPTS%"=="" set /a MAX_ATTEMPTS=30

powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='%TARGET_URL%'; $max=%MAX_ATTEMPTS%; $ok=$false; for($i=0; $i -lt $max; $i++){ try { $resp=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2; if($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500){ $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 900 }; if($ok){ exit 0 } else { exit 1 }"
if errorlevel 1 exit /b 1
exit /b 0

:wait_port_open
set "TARGET_PORT=%~1"
set /a MAX_ATTEMPTS=%~2
if "%MAX_ATTEMPTS%"=="" set /a MAX_ATTEMPTS=40

powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=%TARGET_PORT%; $max=%MAX_ATTEMPTS%; $ok=$false; for($i=0; $i -lt $max; $i++){ try { $client=New-Object System.Net.Sockets.TcpClient; $iar=$client.BeginConnect('127.0.0.1',$port,$null,$null); if($iar.AsyncWaitHandle.WaitOne(700,$false) -and $client.Connected){ $client.EndConnect($iar); $client.Close(); $ok=$true; break } $client.Close() } catch {}; Start-Sleep -Milliseconds 700 }; if($ok){ exit 0 } else { exit 1 }"
if errorlevel 1 exit /b 1
exit /b 0

:print_checklist
echo.
echo ================= CHECKLIST DE INICIALIZACAO =================
call :print_check_item "Docker CLI disponivel" "!CHK_DOCKER_CLI!" "Instale o Docker Desktop."
call :print_check_item "Docker Desktop ativo" "!CHK_DOCKER_ENGINE!" "Abra o Docker Desktop e aguarde o engine iniciar."
call :print_check_item "Stack Docker db/redis/pgadmin ativa" "!CHK_DOCKER_STACK!" "Rode: docker compose up -d"
call :print_check_item "Auth env configurado" "!CHK_AUTH_ENV!" "Preencha .env e client/.env.local - Clerk."
call :print_check_item "UV disponivel e sincronizado" "!CHK_UV!" "Instale UV: pip install uv"
call :print_check_item "Node disponivel" "!CHK_NODE!" "Instale Node.js 18+."
call :print_check_item "NPM disponivel e dependencias ok" "!CHK_NPM!" "Verifique npm install em client/."
call :print_check_item "Backend respondendo em /api/status" "!CHK_BACKEND_HEALTH!" "Verifique a janela Nesh Backend Server."
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
if /I "!CHK_DOCKER_ENGINE!"=="FALHA" call :offer_open_docker_desktop
if /I "!CHK_AUTH_ENV!"=="FALHA" call :offer_open_auth_files
if /I not "!CHK_DOCKER_STACK!"=="OK" (
    echo.
    echo [DICA] Para diagnostico rapido da stack Docker:
    echo        docker compose ps
    echo        docker compose logs -f db redis pgadmin
)
exit /b 0

:offer_open_docker_desktop
echo.
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
    choice /C SN /N /M "Abrir Docker Desktop agora? [S/N]: "
    if errorlevel 2 exit /b 0
    start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
) else (
    echo [DICA] Nao encontrei Docker Desktop.exe no caminho padrao.
    echo       Abra manualmente o Docker Desktop.
)
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
echo NESH STARTUP CHECKLIST
echo =============================================================
echo Data: %date% %time%
echo Resultado: %CHECKLIST_MODE%
if /I "%CHECKLIST_MODE%"=="FALHA" echo Motivo: !FAIL_REASON!
echo.
echo [Docker]
echo - Docker CLI disponivel: !CHK_DOCKER_CLI!
echo - Docker Desktop ativo: !CHK_DOCKER_ENGINE!
echo - Stack db/redis/pgadmin ativa: !CHK_DOCKER_STACK!
echo.
echo [Auth]
echo - Auth env configurado: !CHK_AUTH_ENV!
echo.
echo [Runtime]
echo - UV disponivel e sincronizado: !CHK_UV!
echo - Node disponivel: !CHK_NODE!
echo - NPM disponivel e dependencias ok: !CHK_NPM!
echo - Backend respondendo em /api/status: !CHK_BACKEND_HEALTH!
echo - Frontend ativo na porta 5173: !CHK_FRONTEND_PORT!
echo.
echo [Links]
echo - Frontend: http://127.0.0.1:5173
echo - Backend health: http://127.0.0.1:8000/api/status
echo - pgAdmin: http://127.0.0.1:8080
echo.
echo [Dicas]
echo - docker compose ps
echo - docker compose logs -f db redis pgadmin
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
start "Nesh Startup Checklist" cmd /k "echo NESH STARTUP CHECKLIST && echo. && type \"%CHECKLIST_FILE%\" && echo. && echo Feche esta janela quando terminar."
exit /b 0
