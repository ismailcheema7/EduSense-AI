# config.py
from __future__ import annotations
import os
from pathlib import Path
from typing import List

# Helper: read CSV env vars like "http://a.com,http://b.com" → ["http://a.com","http://b.com"]
def _csv(name: str, default: str = "") -> List[str]:
    raw = os.getenv(name, default)
    return [x.strip() for x in raw.split(",") if x.strip()]

# --- Core ---
ENV: str = os.getenv("ENV", "development")  # development | staging | production

# --- Security / Auth ---
SECRET_KEY: str = os.getenv("SECRET_KEY", "change_me_in_production")
ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

# --- CORS (CSV) ---
CORS_ORIGINS: List[str] = _csv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

# --- Storage dirs ---
BASE_DIR = Path(os.getenv("BASE_DIR", ".")).resolve()
STATIC_DIR = Path(os.getenv("STATIC_DIR", BASE_DIR / "static")).resolve()
STATIC_UPLOADS_DIR = Path(os.getenv("STATIC_UPLOADS_DIR", STATIC_DIR / "uploads")).resolve()
STATIC_REPORTS_DIR = Path(os.getenv("STATIC_REPORTS_DIR", STATIC_DIR / "reports")).resolve()

# Ensure folders exist in dev; in prod you typically provision these during deploy
for p in (STATIC_DIR, STATIC_UPLOADS_DIR, STATIC_REPORTS_DIR):
    p.mkdir(parents=True, exist_ok=True)

# --- Database ---
# Local dev default = SQLite; Prod override with Postgres:
#   postgresql+psycopg2://<user>:<password>@<host>:5432/<db>
DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./edusense.db")
