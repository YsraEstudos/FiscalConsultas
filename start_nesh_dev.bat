@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

set "ENABLE_AUTH_DEBUG=0"
set "RUN_BACKEND=1"
set "CHECKLIST_FILE=%TEMP%\nesh_dev_startup.txt"
set "CHECKLIST_SHOWN=0"
set "FAIL_REASON="
set "BACKEND_UV_SYNC_MODE=no-sync"
set "BACKEND_BOOT_CMD=uv run --no-sync Nesh.py"

set "CHK_NODE=PENDENTE"
set "CHK_NPM=PENDENTE"
set "CHK_UV=PENDENTE"
set "CHK_BACKEND_ENV=PENDENTE"
set "CHK_BACKEND_PORT=PENDENTE"
set "CHK_BACKEND_HEALTH=PENDENTE"
set "CHK_FRONTEND_ENV=PENDENTE"
set "CHK_FRONTEND_DEPS=PENDENTE"
set "CHK_FRONTEND_BUILD=PENDENTE"
set "CHK_FRONTEND_PORT=PENDENTE"

set "FRONTEND_MODE=preview"
set "FRONTEND_PORT=4173"
set "FRONTEND_WAIT_ATTEMPTS=90"
set "FRONTEND_BOOT_CMD=npm run build && npm run preview -- --host 0.0.0.0 --port 4173 --strictPort"
set "FRONTEND_WINDOW_TITLE=Nesh Client (Preview)"
set "FRONTEND_LOCAL_URL=http://127.0.0.1:4173"
set "FRONTEND_PUBLIC_URL="

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--auth-debug" (
    set "ENABLE_AUTH_DEBUG=1"
) else if /I "%~1"=="--frontend-only" (
    set "RUN_BACKEND=0"
) else if /I "%~1"=="--backend-sync" (
    set "BACKEND_UV_SYNC_MODE=sync"
    set "BACKEND_BOOT_CMD=uv run Nesh.py"
) else if /I "%~1"=="--public-preview" (
    set "FRONTEND_MODE=preview"
    set "FRONTEND_PORT=4173"
    set "FRONTEND_WAIT_ATTEMPTS=90"
    set "FRONTEND_BOOT_CMD=npm run build && npm run preview -- --host 0.0.0.0 --port 4173 --strictPort"
    set "FRONTEND_WINDOW_TITLE=Nesh Client (Preview)"
    set "FRONTEND_LOCAL_URL=http://127.0.0.1:4173"
) else if /I "%~1"=="--dev-hmr" (
    set "FRONTEND_MODE=dev"
    set "FRONTEND_PORT=5173"
    set "FRONTEND_WAIT_ATTEMPTS=50"
    set "FRONTEND_BOOT_CMD=npm run dev"
    set "FRONTEND_WINDOW_TITLE=Nesh Client (Dev)"
    set "FRONTEND_LOCAL_URL=http://127.0.0.1:5173"
) else (
    echo [WARN] Argumento ignorado: %~1
)
shift
goto parse_args
:args_done

if /I "!FRONTEND_MODE!"=="preview" (
    set "CHK_FRONTEND_BUILD=PENDENTE"
) else (
    set "CHK_FRONTEND_BUILD=IGNORADO"
)

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

if "!RUN_BACKEND!"=="1" (
    where uv >nul 2>&1
    if errorlevel 1 (
        set "CHK_UV=FALHA"
        set "FAIL_REASON='uv' nao encontrado no PATH."
        goto fail
    )
    set "CHK_UV=OK"
) else (
    set "CHK_UV=IGNORADO"
    set "CHK_BACKEND_ENV=IGNORADO"
    set "CHK_BACKEND_PORT=IGNORADO"
    set "CHK_BACKEND_HEALTH=IGNORADO"
)

echo.
echo [1/7] Validando configuracao minima do frontend...
call :validate_frontend_env
if errorlevel 1 (
    set "CHK_FRONTEND_ENV=FALHA"
    set "FAIL_REASON=Configuracao minima ausente em client/.env.local."
    goto fail
)
set "CHK_FRONTEND_ENV=OK"

if "!RUN_BACKEND!"=="1" (
    echo.
    echo [2/7] Validando configuracao minima do backend...
    call :validate_backend_env
    if errorlevel 1 (
        set "CHK_BACKEND_ENV=FALHA"
        set "FAIL_REASON=Configuracao minima invalida no .env do backend."
        goto fail
    )
    set "CHK_BACKEND_ENV=OK"
)

if "!ENABLE_AUTH_DEBUG!"=="1" (
    if /I "!FRONTEND_MODE!"=="preview" (
        echo [INFO] --auth-debug ignorado no modo preview de producao.
    ) else (
        echo [INFO] Modo auth debug habilitado para o frontend: VITE_AUTH_DEBUG=true nesta sessao.
        set "FRONTEND_BOOT_CMD=set VITE_AUTH_DEBUG=true && npm run dev"
    )
)

if "!RUN_BACKEND!"=="1" (
    echo.
    echo [3/7] Iniciando backend local...
    if /I "!BACKEND_UV_SYNC_MODE!"=="no-sync" echo [INFO] Backend iniciado com uv --no-sync para evitar erro de permissao no .venv.
    call :stop_listener_port 8000 backend
    start "Nesh API (Dev)" cmd /k "cd /d ""%~dp0"" && !BACKEND_BOOT_CMD!"

    echo.
    echo [4/7] Aguardando a API abrir na porta 8000...
    call :wait_port_open 8000 70
    if errorlevel 1 (
        set "CHK_BACKEND_PORT=FALHA"
        set "FAIL_REASON=Backend nao abriu a porta 8000. Se houver erro de permissao no .venv, rode com padrao (no-sync) ou feche processos que travam .venv."
        goto fail
    )
    set "CHK_BACKEND_PORT=OK"

    echo.
    echo [5/7] Validando healthcheck do backend...
    call :wait_http_ok "http://127.0.0.1:8000/api/status" 40
    if errorlevel 1 (
        set "CHK_BACKEND_HEALTH=FALHA"
        set "FAIL_REASON=Backend nao respondeu ao healthcheck /api/status."
        goto fail
    )
    set "CHK_BACKEND_HEALTH=OK"
)

echo.
echo [6/7] Verificando dependencias do frontend...
cd /d "%~dp0client"
call :ensure_frontend_dependencies
if errorlevel 1 (
    cd /d "%~dp0"
    set "CHK_FRONTEND_DEPS=FALHA"
    set "FAIL_REASON=Falha ao preparar dependencias do frontend."
    goto fail
)
set "CHK_FRONTEND_DEPS=OK"

echo.
if /I "!FRONTEND_MODE!"=="preview" (
    echo [7/7] Iniciando frontend em modo PREVIEW (build de producao)...
) else (
    echo [7/7] Iniciando frontend com Hot Reload...
)
call :stop_listener_port !FRONTEND_PORT! frontend
start "!FRONTEND_WINDOW_TITLE!" cmd /k "cd /d ""%~dp0client"" && !FRONTEND_BOOT_CMD!"
cd /d "%~dp0"

echo.
echo [7/7] Aguardando o frontend abrir na porta !FRONTEND_PORT!...
call :wait_port_open !FRONTEND_PORT! !FRONTEND_WAIT_ATTEMPTS!
if errorlevel 1 (
    if /I "!FRONTEND_MODE!"=="preview" set "CHK_FRONTEND_BUILD=FALHA"
    set "CHK_FRONTEND_PORT=FALHA"
    set "FAIL_REASON=Frontend nao abriu a porta !FRONTEND_PORT!."
    goto fail
)
if /I "!FRONTEND_MODE!"=="preview" set "CHK_FRONTEND_BUILD=OK"
set "CHK_FRONTEND_PORT=OK"

call :resolve_lan_frontend_url !FRONTEND_PORT!
if defined FRONTEND_PUBLIC_URL (
    start "" "!FRONTEND_PUBLIC_URL!"
) else (
    start "" "!FRONTEND_LOCAL_URL!"
)

echo.
echo Ambiente de desenvolvimento pronto.
call :print_checklist
call :write_checklist_file "SUCESSO"
call :open_checklist_file
echo.
if "!RUN_BACKEND!"=="1" echo Backend Local:  http://127.0.0.1:8000/api/status
echo Frontend Local: !FRONTEND_LOCAL_URL!
if defined FRONTEND_PUBLIC_URL echo Frontend Publico ^(rede local^): !FRONTEND_PUBLIC_URL!
if /I "!FRONTEND_MODE!"=="preview" (
    echo Frontend em modo PREVIEW de producao.
) else (
    echo Frontend em modo DEV com Hot Reload.
)
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

:validate_backend_env
if not exist ".env" exit /b 0

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$vars = @{}; Get-Content -LiteralPath '.env' | ForEach-Object { if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*)$') { $vars[$matches[1]] = $matches[2].Trim() } }; $engine = $vars['DATABASE__ENGINE']; if ($engine -and $engine.ToLowerInvariant() -eq 'postgresql' -and (-not $vars.ContainsKey('DATABASE__POSTGRES_URL') -or [string]::IsNullOrWhiteSpace($vars['DATABASE__POSTGRES_URL']))) { exit 1 }; exit 0"
if errorlevel 1 exit /b 1
exit /b 0

:validate_frontend_env
if not exist "client\.env.local" exit /b 1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$vars = @{}; Get-Content -LiteralPath 'client/.env.local' | ForEach-Object { if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*)$') { $vars[$matches[1]] = $matches[2].Trim() } }; if (-not $vars.ContainsKey('VITE_CLERK_PUBLISHABLE_KEY') -or [string]::IsNullOrWhiteSpace($vars['VITE_CLERK_PUBLISHABLE_KEY'])) { exit 1 }; exit 0"
if errorlevel 1 exit /b 1
exit /b 0

:ensure_frontend_dependencies
set "NEED_INSTALL=0"
if not exist "node_modules\" set "NEED_INSTALL=1"
if "!NEED_INSTALL!"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Test-Path 'package-lock.json')) { exit 1 }; if ((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item 'node_modules').LastWriteTime) { exit 1 } else { exit 0 }" && set "LOCKFILE_HAS_CHANGES=0" || set "LOCKFILE_HAS_CHANGES=1"
    if "!LOCKFILE_HAS_CHANGES!"=="1" set "NEED_INSTALL=1"
)

if "!NEED_INSTALL!"=="1" (
    echo [INFO] Instalando dependencias do frontend...
    call npm install
    if errorlevel 1 exit /b 1
) else (
    echo [INFO] node_modules atualizada. Pulando npm install.
)

exit /b 0

:wait_port_open
set "TARGET_PORT=%~1"
set /a MAX_ATTEMPTS=%~2
if "%MAX_ATTEMPTS%"=="" set /a MAX_ATTEMPTS=40

powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=%TARGET_PORT%; $attempts=%MAX_ATTEMPTS%; $ok=$false; for($i=0; $i -lt $attempts; $i++){ try { $client=New-Object System.Net.Sockets.TcpClient; $async=$client.BeginConnect('127.0.0.1',$port,$null,$null); if($async.AsyncWaitHandle.WaitOne(700,$false) -and $client.Connected){ $client.EndConnect($async); $client.Close(); $ok=$true; break } $client.Close() } catch {}; Start-Sleep -Milliseconds 700 }; if($ok){ exit 0 } else { exit 1 }"
if errorlevel 1 exit /b 1
exit /b 0

:wait_http_ok
set "TARGET_URL=%~1"
set /a MAX_ATTEMPTS=%~2
if "%MAX_ATTEMPTS%"=="" set /a MAX_ATTEMPTS=20

powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='%TARGET_URL%'; $attempts=%MAX_ATTEMPTS%; for($i=0; $i -lt $attempts; $i++){ try { $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { exit 0 } } catch {}; Start-Sleep -Milliseconds 750 }; exit 1"
if errorlevel 1 exit /b 1
exit /b 0

:stop_listener_port
set "TARGET_PORT=%~1"
set "TARGET_LABEL=%~2"
if "%TARGET_PORT%"=="" exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=%TARGET_PORT%; $label='%TARGET_LABEL%'; $processIds = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($processIds) { Write-Host ('[INFO] Encerrando listener existente na porta ' + $port + ' (' + $label + ')...'); foreach ($processId in $processIds) { try { Stop-Process -Id $processId -Force -ErrorAction Stop } catch {} } Start-Sleep -Milliseconds 600 }"
exit /b 0

:resolve_lan_frontend_url
set "TARGET_PORT=%~1"
set "FRONTEND_PUBLIC_URL="
if "%TARGET_PORT%"=="" exit /b 0
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254*' -and $_.InterfaceAlias -notmatch 'Loopback|vEthernet|VirtualBox|VMware|Hyper-V|WSL|Tailscale|ZeroTier' } | Select-Object -First 1 -ExpandProperty IPAddress; if ($ip) { Write-Output $ip }"`) do (
    set "FRONTEND_PUBLIC_URL=http://%%I:%TARGET_PORT%"
)
exit /b 0

:print_checklist
echo.
echo =================== CHECKLIST DEV ===================
call :print_check_item "Node disponivel" "!CHK_NODE!" "Instale Node.js 22+."
call :print_check_item "NPM disponivel" "!CHK_NPM!" "Verifique a instalacao do npm."
call :print_check_item "uv disponivel" "!CHK_UV!" "Instale uv para rodar o backend Python."
call :print_check_item ".env do backend valido" "!CHK_BACKEND_ENV!" "Se usar PostgreSQL, defina DATABASE__POSTGRES_URL."
call :print_check_item "Backend ativo na porta 8000" "!CHK_BACKEND_PORT!" "Verifique a janela Nesh API (Dev)."
call :print_check_item "Healthcheck /api/status ok" "!CHK_BACKEND_HEALTH!" "Confirme logs do backend local."
call :print_check_item "client/.env.local configurado" "!CHK_FRONTEND_ENV!" "Defina pelo menos VITE_CLERK_PUBLISHABLE_KEY."
call :print_check_item "Dependencias frontend prontas" "!CHK_FRONTEND_DEPS!" "Execute npm install em client/."
call :print_check_item "Build de frontend (preview)" "!CHK_FRONTEND_BUILD!" "Use --dev-hmr para voltar ao modo hot reload."
call :print_check_item "Frontend ativo na porta !FRONTEND_PORT!" "!CHK_FRONTEND_PORT!" "Verifique a janela !FRONTEND_WINDOW_TITLE!."
echo =====================================================
exit /b 0

:print_check_item
set "ITEM_LABEL=%~1"
set "ITEM_STATUS=%~2"
set "ITEM_HINT=%~3"

if /I "%ITEM_STATUS%"=="OK" (
    echo [x] %ITEM_LABEL%
) else if /I "%ITEM_STATUS%"=="IGNORADO" (
    echo [-] %ITEM_LABEL% ^(%ITEM_STATUS%^)
) else (
    echo [ ] %ITEM_LABEL% ^(%ITEM_STATUS%^)
    if not "%ITEM_HINT%"=="" echo     - %ITEM_HINT%
)
exit /b 0

:offer_manual_actions
if /I "!CHK_BACKEND_ENV!"=="FALHA" call :offer_open_backend_env
if /I "!CHK_FRONTEND_ENV!"=="FALHA" call :offer_open_frontend_env
exit /b 0

:offer_open_backend_env
echo.
choice /C SN /N /M "Abrir .env do backend agora? [S/N]: "
if errorlevel 2 exit /b 0
if not exist ".env" type nul > ".env"
start "" notepad ".env"
exit /b 0

:offer_open_frontend_env
echo.
choice /C SN /N /M "Abrir client/.env.local agora? [S/N]: "
if errorlevel 2 exit /b 0
if not exist "client\.env.local" type nul > "client\.env.local"
start "" notepad "client\.env.local"
exit /b 0

:write_checklist_file
set "CHECKLIST_MODE=%~1"
(
echo =============================================================
echo NESH DEV STARTUP CHECKLIST
echo =============================================================
echo Data: %date% %time%
echo Resultado: %CHECKLIST_MODE%
if /I "%CHECKLIST_MODE%"=="FALHA" echo Motivo: !FAIL_REASON!
echo.
echo [Runtime]
echo - Node disponivel: !CHK_NODE!
echo - NPM disponivel: !CHK_NPM!
echo - uv disponivel: !CHK_UV!
echo - .env do backend valido: !CHK_BACKEND_ENV!
echo - Backend ativo na porta 8000: !CHK_BACKEND_PORT!
echo - Healthcheck /api/status ok: !CHK_BACKEND_HEALTH!
echo - client/.env.local configurado: !CHK_FRONTEND_ENV!
echo - Dependencias frontend prontas: !CHK_FRONTEND_DEPS!
echo - Build de frontend (preview): !CHK_FRONTEND_BUILD!
echo - Frontend ativo na porta !FRONTEND_PORT!: !CHK_FRONTEND_PORT!
echo.
echo [Links]
echo - Backend Local:  http://127.0.0.1:8000/api/status
echo - Frontend Local: !FRONTEND_LOCAL_URL!
if defined FRONTEND_PUBLIC_URL echo - Frontend Publico (rede local): !FRONTEND_PUBLIC_URL!
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
exit /b 0
