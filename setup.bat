@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

where py >nul 2>nul && (set "PY=py -3") || (set "PY=python")

if not exist .venv\Scripts\python.exe (
  echo Creating virtualenv in .venv ...
  %PY% -m venv .venv || goto :fail
)

echo Installing packages ...
.venv\Scripts\python.exe -m pip install --upgrade pip -q
.venv\Scripts\python.exe -m pip install -r requirements.txt -q || goto :fail

rem First run only: unpack the git history that came with the files
if not exist .git if exist rmtrack.bundle (
  echo Setting up git ...
  git init -q -b main || goto :nogit
  git fetch -q --update-head-ok rmtrack.bundle main:main || goto :nogit
  git reset -q
  git config user.name "abhy-kumar"
  git config user.email "abhiks177@gmail.com"
  git remote add origin https://github.com/abhy-kumar/rmtrack.git
  del rmtrack.bundle
  echo.
  set /p PUSH=Push to github.com/abhy-kumar/rmtrack now? [y/N] 
  if /i "!PUSH!"=="y" git push -u origin main
)

echo.
echo All set. Double-click run.bat to start it.
pause
exit /b 0

:nogit
echo git isn't installed or failed. The app still works; get git from https://git-scm.com to push.
pause
exit /b 0

:fail
echo Something went wrong. Is Python 3.11+ installed and on PATH?
pause
exit /b 1
