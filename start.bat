@echo off
REM ============================================================
REM AI Resume Screener — Start Server (Windows)
REM Run setup.bat first if you haven't already.
REM ============================================================

REM Always work relative to the directory this script lives in
cd /d "%~dp0"

IF NOT EXIST "venv\Scripts\activate.bat" (
    echo ERROR: Virtual environment not found.
    echo Please run setup.bat first.
    pause & exit /b 1
)

echo Activating virtual environment...
call venv\Scripts\activate.bat

echo Starting AI Resume Screener API on http://localhost:8000
echo Press Ctrl+C to stop.
echo.

cd server
uvicorn app.main:app --reload --port 8000
