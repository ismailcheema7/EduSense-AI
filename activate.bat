@echo off
cd /d "%~dp0"

cd backend
start "" /min cmd /k "..\.venv\Scripts\activate && uvicorn server:app --reload --host 127.0.0.1 --port 8000"
cd ..

cd frontend
start "" /min cmd /k "npm run dev"
cd ..

start "" http://localhost:5173
