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
where uv >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    uv pip install --python "%VENV_PY%" -r "%DEST%\python\requirements.txt"
) else (
    "%VENV_PY%" -m pip install --upgrade pip >nul
    "%VENV_PY%" -m pip install -r "%DEST%\python\requirements.txt"
)
if %ERRORLEVEL% NEQ 0 (
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
where nvidia-smi >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo       NVIDIA GPU detected - installing CUDA build ^(~3 GB^)...
    set "TORCH_REQ=requirements-gpu.txt"
) else (
    echo       No NVIDIA GPU detected - installing CPU build ^(slower inference^)...
    set "TORCH_REQ=requirements-cpu.txt"
)
where uv >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    uv pip install --python "%VENV_PY%" -r "%DEST%\python\!TORCH_REQ!"
) else (
    "%VENV_PY%" -m pip install -r "%DEST%\python\!TORCH_REQ!"
)
if %ERRORLEVEL% NEQ 0 (
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
