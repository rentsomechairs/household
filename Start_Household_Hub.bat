@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 run_server.py
    goto :end
)

where python >nul 2>nul
if %errorlevel%==0 (
    python run_server.py
    goto :end
)

echo.
echo Python 3 was not found on this computer.
echo Install Python 3, then run this file again.
echo During installation, enable "Add Python to PATH".
echo.
pause

:end
endlocal
