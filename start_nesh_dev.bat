@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================
echo   INICIANDO MODO DE DESENVOLVIMENTO
echo   As altera??es aparecem em tempo real!
echo ==========================================

echo.
echo [0/4] Limpando processos antigos...

REM Finaliza processos anteriores (Por Título de Janela)
taskkill /F /FI "WINDOWTITLE eq Nesh Backend Server" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq Nesh Client (Dev)" >nul 2>&1
taskkill /F /IM "node.exe" >nul 2>&1

REM Finaliza processos anteriores nas portas (Redundância)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do (
    echo    - Finalizando Frontend na porta 5173 (PID: %%a)
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    echo    - Finalizando Backend na porta 8000 (PID: %%a)
    taskkill /PID %%a /F >nul 2>&1
)

REM Detectar Python
set "PYTHON_CMD=python"
if exist "%~dp0.venv\Scripts\python.exe" set "PYTHON_CMD=%~dp0.venv\Scripts\python.exe"

REM Atualiza Dependencias
echo.
echo [1/4] Verificando dependencias Python...
"%PYTHON_CMD%" -m pip install -r requirements.txt >nul 2>&1

REM Rebuild opcional
if /I "%~1"=="--rebuild" (
    echo.
    echo [1.5/4] Recriando bancos de dados...
    "%PYTHON_CMD%" scripts\rebuild_index.py
    "%PYTHON_CMD%" scripts\setup_tipi_database.py
)

REM Inicia Backend
echo [2/4] Iniciando Backend...
start "Nesh Backend Server" cmd /k ""%PYTHON_CMD%" Nesh.py"

REM Inicia Frontend
echo.
echo [3/4] Verificando dependencias Frontend...
cd client
call npm install >nul 2>&1

echo [4/4] Iniciando Frontend com Hot Reload...
start "Nesh Client (Dev)" cmd /k "npm run dev"

echo.
echo Aguardando servidores subirem...
timeout /t 8 >nul

REM Abre o navegador (Usando IP explicito para evitar erro de IPv6)
start "" "http://127.0.0.1:5173"

echo.
echo Configure as janelas e bom trabalho!
pause
