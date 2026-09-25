@echo off
REM ============================================================
REM AI Resume Screener — Windows Local Setup Script
REM Run this once. Double-click or run from any directory.
REM ============================================================

REM Always work relative to the directory this script lives in
cd /d "%~dp0"

echo.
echo === AI Resume Screener Setup ===
echo Working directory: %CD%
echo.

REM 1. Check Python
python --version >nul 2>&1
IF ERRORLEVEL 1 (
    echo ERROR: Python not found. Install Python 3.11+ from https://python.org
    pause & exit /b 1
)
for /f "tokens=*" %%i in ('python --version') do echo [OK] %%i found

REM 2. Create virtual environment
IF NOT EXIST "venv\" (
    echo Creating virtual environment...
    python -m venv venv
    IF ERRORLEVEL 1 (
        echo ERROR: Failed to create virtual environment.
        pause & exit /b 1
    )
) ELSE (
    echo [OK] Virtual environment already exists
)

REM 3. Activate and upgrade pip
echo Activating virtual environment...
call venv\Scripts\activate.bat

echo Upgrading pip...
python -m pip install --upgrade pip --quiet

REM 4. Install dependencies
echo Installing Python dependencies from requirements.txt...
pip install -r requirements.txt
IF ERRORLEVEL 1 (
    echo.
    echo ERROR: pip install failed.
    echo Make sure you have internet access and Python 3.11+ installed.
    pause & exit /b 1
)
echo [OK] Python packages installed

REM 5. Download spaCy model
echo.
echo Downloading spaCy English model (en_core_web_sm)...
python -m spacy download en_core_web_sm
IF ERRORLEVEL 1 (
    echo ERROR: spaCy model download failed.
    pause & exit /b 1
)
echo [OK] spaCy model ready

REM 6. Create storage directories
IF NOT EXIST "server\storage\resumes\" (
    mkdir server\storage\resumes
    echo [OK] Created server\storage\resumes
)
IF NOT EXIST "server\storage\faiss_index\" (
    mkdir server\storage\faiss_index
    echo [OK] Created server\storage\faiss_index
)

REM 7. Copy .env if not present
IF NOT EXIST ".env" (
    copy .env.example .env >nul
    echo [OK] .env created from .env.example
) ELSE (
    echo [OK] .env already exists
)

echo.
echo ============================================================
echo  Setup complete!
echo.
echo  To start the server, run:
echo    start.bat
echo.
echo  Or manually:
echo    venv\Scripts\activate
echo    cd server
echo    uvicorn app.main:app --reload --port 8000
echo.
echo  Then open: http://localhost:8000/docs
echo ============================================================
echo.
pause
