@echo off
setlocal EnableDelayedExpansion
title EzDepth - Installer

echo ============================================================
echo  EzDepth for After Effects - Installer
echo ============================================================
echo.

set "SRC=%~dp0"
set "DEST=%APPDATA%\Adobe\CEP\extensions\EzDepth"

:: ------------------------------------------------------------
:: 1. Allow unsigned CEP extensions (PlayerDebugMode for CSXS 9-12)
:: ------------------------------------------------------------
echo [1/4] Enabling unsigned CEP extensions...
for %%V in (9 10 11 12) do (
    reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo       Done.
echo.

:: ------------------------------------------------------------
:: 2. Copy extension files to the CEP extensions folder
:: ------------------------------------------------------------
echo [2/4] Installing extension files...
if /I "%SRC:~0,-1%"=="%DEST%" (
    echo       Already running from the install location - skipping copy.
) else (
    robocopy "%SRC:~0,-1%" "%DEST%" /E /XD .git .venv __pycache__ /XF .gitignore >nul
    if !ERRORLEVEL! GEQ 8 (
        echo       ERROR: Could not copy files to %DEST%
        pause
        exit /b 1
    )
    echo       Installed to %DEST%
)
echo.

:: ------------------------------------------------------------
:: 3. Set up Python environment (self-contained venv)
:: ------------------------------------------------------------
echo [3/4] Setting up Python environment...
set "VENV=%DEST%\python\.venv"
set "VENV_PY=%VENV%\Scripts\python.exe"

if exist "%VENV_PY%" (
    echo       Existing venv found - updating packages...
    goto :install_deps
)

:: Prefer uv (can even download Python by itself), then system Python
where uv >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo       Using uv to create venv...
    uv venv --python 3.12 "%VENV%"
    if exist "%VENV_PY%" goto :install_deps
)

where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo       Using system Python to create venv...
    python -m venv "%VENV%"
    if exist "%VENV_PY%" goto :install_deps
)

echo.
echo       ERROR: No Python found. Install one of these first:
echo         winget install astral-sh.uv        (recommended - tiny, fast)
echo         winget install Python.Python.3.12
echo       ...then run install.bat again.
pause
exit /b 1

:install_deps
call :pip_install "%DEST%\python\requirements.txt"
if !ERRORLEVEL! NEQ 0 (
    echo       ERROR: Failed to install Python packages.
    pause
    exit /b 1
)
echo       Done.
echo.

:: ------------------------------------------------------------
:: 4. PyTorch - CUDA build if an NVIDIA GPU is present, else CPU build
:: ------------------------------------------------------------
echo [4/4] Installing PyTorch...
:: nvidia-smi ships in System32, but that is not always on PATH, so check
:: the file directly too. Sysnative is the un-redirected view of System32,
:: needed when a 32-bit host process launched this script - otherwise WOW64
:: sends us to SysWOW64 and we wrongly conclude there is no GPU.
set "HAS_NVIDIA="
where nvidia-smi >nul 2>&1
if !ERRORLEVEL! EQU 0 set "HAS_NVIDIA=1"
if exist "%SystemRoot%\System32\nvidia-smi.exe" set "HAS_NVIDIA=1"
if exist "%SystemRoot%\Sysnative\nvidia-smi.exe" set "HAS_NVIDIA=1"
if defined HAS_NVIDIA (
    echo       NVIDIA GPU detected - installing CUDA build ^(~3 GB^)...
    set "TORCH_REQ=requirements-gpu.txt"
) else (
    echo       No NVIDIA GPU detected - installing CPU build ^(slower inference^)...
    set "TORCH_REQ=requirements-cpu.txt"
)
call :pip_install "%DEST%\python\!TORCH_REQ!"
if !ERRORLEVEL! NEQ 0 (
    echo       ERROR: Failed to install PyTorch.
    pause
    exit /b 1
)
echo       Done.
echo.

echo ============================================================
echo  Installation complete!
echo ============================================================
echo.
echo  1. Restart After Effects
echo  2. Open Window ^> Extensions ^> EzDepth
echo  3. Click Generate Depth on any comp
echo.
echo  First click downloads the Depth Anything V2 model (~100 MB, once).
echo  Depth PNGs save to an "EzDepth" folder next to your .aep by default
echo  - change it any time with the Browse button in the panel.
echo.
pause
exit /b 0

:: ------------------------------------------------------------
:: pip_install <requirements-file>
:: Installs into the extension venv. Tries uv first (much faster), then
:: falls back to the venv's own pip if uv fails - on some Windows setups
:: uv's cache extraction dies with "Access is denied (os error 5)" when a
:: real-time AV scanner holds files open during its rename step, which is
:: easy to hit on the ~3 GB CUDA torch wheel.
:: ------------------------------------------------------------
:pip_install
set "REQ=%~1"
where uv >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    uv pip install --python "%VENV_PY%" -r "!REQ!"
    if !ERRORLEVEL! EQU 0 exit /b 0
    echo       uv could not install these packages - retrying with pip...
)
:: A uv-created venv has no pip, so bootstrap it before falling back.
"%VENV_PY%" -m pip --version >nul 2>&1
if !ERRORLEVEL! NEQ 0 "%VENV_PY%" -m ensurepip --upgrade >nul 2>&1
"%VENV_PY%" -m pip install -r "!REQ!"
exit /b !ERRORLEVEL!
