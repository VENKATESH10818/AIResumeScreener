@echo off
cd /d "%~dp0"

IF NOT EXIST "frontend\node_modules\" (
    echo Installing frontend dependencies...
    cd frontend
    npm install
    cd ..
)

echo Starting React frontend on http://localhost:5173
cd frontend
npm run dev
