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

rem First run only: unpack the git history that came with the files.
rem The bundle is deleted once this has worked, so it's safe to re-run.
if exist rmtrack.bundle (
  echo Setting up git ...
  where git >nul 2>nul || goto :nogit
  rem drives formatted exFAT/FAT32 don't record file owners, which git refuses by default
  set "HERE=%CD:\=/%"
  git config --global --get-all safe.directory | findstr /x /c:"!HERE!" >nul || git config --global --add safe.directory "!HERE!"
  if not exist .git\HEAD git init -q -b main
  git fetch -q --update-head-ok rmtrack.bundle main:main || goto :gitfail
  git symbolic-ref HEAD refs/heads/main
  git reset -q
  git checkout -q -- .github 2>nul
  git config user.name "abhy-kumar"
  git config user.email "abhiks177@gmail.com"
  git remote get-url origin >nul 2>nul || git remote add origin https://github.com/abhy-kumar/rmtrack.git
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
echo git isn't installed. The app still works; get git from https://git-scm.com to push.
pause
exit /b 0

:gitfail
echo git couldn't unpack the history. Run setup.bat again; if it keeps failing, send me the message above.
pause
exit /b 1

:fail
echo Something went wrong. Is Python 3.11+ installed and on PATH?
pause
exit /b 1
