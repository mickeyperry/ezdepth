@echo off
title EzDepth - Uninstaller

set "DEST=%APPDATA%\Adobe\CEP\extensions\EzDepth"

if exist "%DEST%" (
    rmdir /S /Q "%DEST%"
    echo Removed: %DEST%
) else (
    echo Nothing installed at: %DEST%
)
pause
