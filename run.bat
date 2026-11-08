@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe call setup.bat
start "" http://127.0.0.1:8000
.venv\Scripts\python.exe serve.py %*
