# server.py
# --------------------------------------------------------------------------------------
# EduSense — single-file FastAPI backend (Windows-friendly)
# Everything lives here by your request. Read the comments: I explain each concept inline.
# --------------------------------------------------------------------------------------

from __future__ import annotations

# ---- Standard library imports ----
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, List

# ---- Third-party imports (install via pip) ----
# fastapi: web framework; uvicorn runs it; sqlmodel: ORM+Pydantic; jose/passlib for auth
from fastapi import FastAPI, HTTPException, Depends, status, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles

from sqlmodel import SQLModel, Field, Session, create_engine, select
from sqlalchemy import Column, String

import jwt
from jwt import PyJWTError

from passlib.context import CryptContext

# Optional but helpful: generate a tiny PDF for reports
# If you don't want PDFs yet, you can comment reportlab parts and the pdf generation call.
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


# ==============================
# Configuration (keep in code)
# ==============================
# In a multi-file app this would live in config.py + .env. Here we keep it simple.

# SQLite DB in current folder. "check_same_thread=False" is set later for FastAPI reload
from config import (
    ENV, SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES,
    CORS_ORIGINS, STATIC_DIR, STATIC_UPLOADS_DIR, STATIC_REPORTS_DIR, DATABASE_URL
)


# ==============================
# DB Models (tables)
# ==============================
# SQLModel classes with table=True become SQL tables.
# Pydantic validation comes for free from SQLModel/Pydantic base.

class User(SQLModel, table=True):
    __tablename__ = "users"  # avoid reserved word "user" in Postgres
    id: Optional[int] = Field(default=None, primary_key=True)
    # real UNIQUE index at the DB level:
    email: str = Field(
        sa_column=Column("email", String, unique=True, index=True, nullable=False)
    )
    hashed_password: str = Field(sa_column=Column("hashed_password", String, nullable=False))
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Classroom(SQLModel, table=True):
    __tablename__ = "classrooms"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id")  # NOTE: points to "users.id"
    name: str = Field(sa_column=Column("name", String, nullable=False))
    avg_interactivity: float = 0.0
    sessions_count: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)

class SessionRow(SQLModel, table=True):
    __tablename__ = "sessions"
    id: Optional[int] = Field(default=None, primary_key=True)
    classroom_id: int = Field(foreign_key="classrooms.id")
    audio_url: Optional[str] = Field(default=None)   # TEXT in Postgres by default via String
    duration_sec: int = 0

    # analysis outputs
    interactivity_score: Optional[float] = None
    time_wasted_sec: Optional[int] = None
    interactive_sec: Optional[int] = None
    qna_sec: Optional[int] = None
    teaching_sec: Optional[int] = None

    report_json_url: Optional[str] = None
    report_pdf_url: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
# ==============================
# API Schemas (request/response)
# ==============================
# These are Pydantic/SQLModel models used to shape inputs/outputs. We don't expose
# sensitive fields (like hashed_password) in responses.

# ---- Auth ----
class UserCreate(SQLModel):
    email: str
    password: str


class UserRead(SQLModel):
    id: int
    email: str
    created_at: datetime


class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"


# ---- Classes ----
class ClassroomCreate(SQLModel):
    name: str


class ClassroomUpdate(SQLModel):
    name: Optional[str] = None


# We can reuse the DB model for response if fields match; here we define a clean shape
class ClassroomRead(SQLModel):
    id: int
    name: str
    avg_interactivity: float
    sessions_count: int
    created_at: datetime


# ---- Sessions ----
class SessionCreate(SQLModel):
    audio_url: str  # first upload at /api/uploads/audio, then pass the returned url here


class SessionRead(SQLModel):
    id: int
    classroom_id: int
    audio_url: Optional[str]
    duration_sec: int
    interactivity_score: Optional[float]
    time_wasted_sec: Optional[int]
    interactive_sec: Optional[int]
    qna_sec: Optional[int]
    teaching_sec: Optional[int]
    report_json_url: Optional[str]
    report_pdf_url: Optional[str]
    created_at: datetime


# ==============================
# Database engine + Session dependency
# ==============================
# A single global engine; Session(...) is created per-request via a dependency.

# prerequisites:
#   pip install psycopg2-binary

from sqlmodel import create_engine
engine = create_engine(
    DATABASE_URL,
    echo=False,          # set True for SQL logs
    pool_pre_ping=True,  # helps recycle dropped connections
    connect_args={}      # only needed for SQLite
)

# on startup:
SQLModel.metadata.create_all(engine)


def init_db():
    """Create all tables if they don't exist."""
    SQLModel.metadata.create_all(engine)


def get_db():
    """FastAPI dependency that yields a DB session and closes it after the request."""
    with Session(engine) as session:
        yield session


# ==============================
# Security: password hashing + JWT
# ==============================
pwd_context = CryptContext(schemes=["bcrypt_sha256"], deprecated="auto")

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/auth/login"  # where the client obtains tokens (OAuth2PasswordRequestForm)
)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# Algorithm constant

def create_access_token(*, user_id: int, expires_minutes: int = ACCESS_TOKEN_EXPIRE_MINUTES) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=expires_minutes)
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return token

def decode_access_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        return int(sub) if sub is not None else None
    except PyJWTError:
        return None



# Dependency to get the current user object from Authorization: Bearer <token>
def get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> User:
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


# ==============================
# FastAPI app + middleware
# ==============================
app = FastAPI(title="EduSense API", version="1.0")

# Allow the dev frontends to call the API from the browser (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files for uploaded audio and generated reports
# After this, any file under ./static is accessible at /static/<filename>
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.on_event("startup")
def on_startup():
    # Create tables on boot. In production you'd run migrations instead.
    init_db()


# ==============================
# Health
# ==============================
@app.get("/healthz")
def healthz():
    return {"ok": True, "ts": datetime.utcnow().isoformat()}


# ==============================
# Auth endpoints
# ==============================
@app.post("/api/auth/register", response_model=Token)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    # Ensure unique email
    existing = db.exec(select(User).where(User.email == payload.email)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(email=payload.email, hashed_password=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user_id=user.id)
    return Token(access_token=token)


@app.post("/api/auth/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # OAuth2PasswordRequestForm sends fields as form-data: username, password
    user = db.exec(select(User).where(User.email == form.username)).first()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    token = create_access_token(user_id=user.id)
    return Token(access_token=token)


@app.get("/api/auth/me", response_model=UserRead)
def me(current: User = Depends(get_current_user)):
    # FastAPI serializes the object according to UserRead fields
    return UserRead(id=current.id, email=current.email, created_at=current.created_at)


# ==============================
# Classroom endpoints
# ==============================
MAX_CLASSES_PER_USER = 4


@app.get("/api/classes", response_model=List[ClassroomRead])
def list_classes(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    rows = db.exec(
        select(Classroom).where(Classroom.user_id == current.id).order_by(Classroom.created_at.desc())
    ).all()
    # Map DB rows to clean response shape (or use response_model=List[Classroom] directly if you prefer)
    return [
        ClassroomRead(
            id=r.id,
            name=r.name,
            avg_interactivity=r.avg_interactivity,
            sessions_count=r.sessions_count,
            created_at=r.created_at,
        )
        for r in rows
    ]


@app.post("/api/classes", response_model=ClassroomRead)
def create_class(payload: ClassroomCreate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    # Enforce per-user class cap
    existing = db.exec(select(Classroom).where(Classroom.user_id == current.id)).all()
    if len(existing) >= MAX_CLASSES_PER_USER:
        raise HTTPException(status_code=400, detail="Class limit is 4.")

    row = Classroom(user_id=current.id, name=payload.name)
    db.add(row)
    db.commit()
    db.refresh(row)
    return ClassroomRead(
        id=row.id,
        name=row.name,
        avg_interactivity=row.avg_interactivity,
        sessions_count=row.sessions_count,
        created_at=row.created_at,
    )


@app.get("/api/classes/{class_id}", response_model=ClassroomRead)
def get_class(class_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    row = db.get(Classroom, class_id)
    if not row or row.user_id != current.id:
        raise HTTPException(404, "Class not found")
    return ClassroomRead(
        id=row.id,
        name=row.name,
        avg_interactivity=row.avg_interactivity,
        sessions_count=row.sessions_count,
        created_at=row.created_at,
    )


@app.patch("/api/classes/{class_id}", response_model=ClassroomRead)
def update_class(
    class_id: int, payload: ClassroomUpdate, db: Session = Depends(get_db), current: User = Depends(get_current_user)
):
    row = db.get(Classroom, class_id)
    if not row or row.user_id != current.id:
        raise HTTPException(404, "Class not found")
    if payload.name is not None:
        row.name = payload.name
    db.add(row)
    db.commit()
    db.refresh(row)
    return ClassroomRead(
        id=row.id,
        name=row.name,
        avg_interactivity=row.avg_interactivity,
        sessions_count=row.sessions_count,
        created_at=row.created_at,
    )

@app.delete("/api/classes/{class_id}")
def delete_class(class_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    row = db.get(Classroom, class_id)
    if not row or row.user_id != current.id:
        raise HTTPException(404, "Class not found")

    # delete sessions first
    sessions = db.exec(select(SessionRow).where(SessionRow.classroom_id == row.id)).all()
    for s in sessions:
        db.delete(s)

    db.delete(row)
    db.commit()
    return {"ok": True}


# ==============================
# Session endpoints
# ==============================
@app.get("/api/classes/{class_id}/sessions", response_model=List[SessionRead])
def list_sessions(class_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    cls = db.get(Classroom, class_id)
    if not cls or cls.user_id != current.id:
        raise HTTPException(404, "Class not found")
    rows = db.exec(
        select(SessionRow).where(SessionRow.classroom_id == class_id).order_by(SessionRow.created_at.desc())
    ).all()
    return [SessionRead(**row.model_dump()) for row in rows]


@app.post("/api/classes/{class_id}/sessions", response_model=SessionRead)
def create_session(
    class_id: int, payload: SessionCreate, db: Session = Depends(get_db), current: User = Depends(get_current_user)
):
    cls = db.get(Classroom, class_id)
    if not cls or cls.user_id != current.id:
        raise HTTPException(404, "Class not found")

    if not payload.audio_url:
        raise HTTPException(400, "audio_url is required; upload the file first at /api/uploads/audio")

    row = SessionRow(classroom_id=class_id, audio_url=payload.audio_url)
    db.add(row)

    # bump counters
    cls.sessions_count += 1
    db.add(cls)

    db.commit()
    db.refresh(row)
    return SessionRead(**row.model_dump())


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    session_row = db.get(SessionRow, session_id)
    if not session_row:
        raise HTTPException(404, "Session not found")

    classroom = db.get(Classroom, session_row.classroom_id)
    if not classroom or classroom.user_id != current.id:
        raise HTTPException(404, "Class not found or not yours")

    # delete and recompute stats
    db.delete(session_row)
    db.commit()

    # recompute class counters and average (only analyzed sessions count toward avg)
    remaining = db.exec(select(SessionRow).where(SessionRow.classroom_id == classroom.id)).all()
    classroom.sessions_count = len(remaining)
    scores = [r.interactivity_score for r in remaining if r.interactivity_score is not None]
    classroom.avg_interactivity = round(sum(scores) / len(scores), 2) if scores else 0.0
    db.add(classroom)
    db.commit()

    return {"ok": True}


# ==============================
# Upload endpoint (audio)
# ==============================
ALLOWED_EXTS = {"wav", "mp3", "m4a", "aac", "ogg"}


@app.post("/api/uploads/audio")
async def upload_audio(file: UploadFile = File(...), current: User = Depends(get_current_user)):
    # Validate extension (lightweight; you can also inspect MIME type via file.content_type)
    filename = file.filename or "audio.bin"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported extension: .{ext}")

    # Resolve unique file path under ./static/uploads
    safe_name = filename.replace(" ", "_")
    target = STATIC_UPLOADS_DIR / safe_name
    counter = 1
    while target.exists():
        target = STATIC_UPLOADS_DIR / f"{Path(safe_name).stem}_{counter}{Path(safe_name).suffix}"
        counter += 1

    # Stream to disk in 1MB chunks (doesn't load the entire file in RAM)
    with target.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)

    # Return a URL the frontend can later pass to /sessions create
    return {
        "audio_url": f"/static/uploads/{target.name}",
        "filename": target.name,
        "size_bytes": target.stat().st_size,
    }


# ==============================
# Analyze stub
# ==============================
# This simulates analysis: it writes a JSON file and a small PDF with a pie-like summary.
# Replace this with your real pipeline later.

def _write_pdf_report(pdf_path: Path, title: str, stats: dict[str, int | float]) -> None:
    """Create a minimal PDF using reportlab with key stats."""
    c = canvas.Canvas(str(pdf_path), pagesize=A4)
    width, height = A4

    # Title
    c.setFont("Helvetica-Bold", 18)
    c.drawString(72, height - 72, title)

    # Body text
    c.setFont("Helvetica", 12)
    y = height - 110
    for k, v in stats.items():
        c.drawString(72, y, f"{k.replace('_', ' ').title()}: {v}")
        y -= 20

    # Simple legend area (not a real pie chart—kept minimal for the stub)
    c.setFont("Helvetica-Oblique", 10)
    c.drawString(72, y - 10, "Note: Replace this stub with a real chart later.")
    c.showPage()
    c.save()


@app.post("/api/sessions/{session_id}/analyze")
def analyze_session(session_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    session_row = db.get(SessionRow, session_id)
    if not session_row:
        raise HTTPException(404, "Session not found")

    classroom = db.get(Classroom, session_row.classroom_id)
    if not classroom or classroom.user_id != current.id:
        raise HTTPException(404, "Class not found or not yours")

    # ---- Fake analysis numbers (deterministic-ish) ----
    # For demo: derive a pseudo score from the id so it "varies"
    base = (session_row.id or 1) % 10
    interactivity_score = round(55 + base * 3.1, 2)  # e.g., 55..85
    duration_sec = 45 * 60 + base * 15  # ~45min class ± a bit
    time_wasted_sec = 5 * 60 + base * 10
    qna_sec = 8 * 60 + base * 12
    interactive_sec = 12 * 60 + base * 14
    teaching_sec = max(duration_sec - (time_wasted_sec + qna_sec + interactive_sec), 0)

    # ---- Persist to DB row ----
    session_row.duration_sec = duration_sec
    session_row.interactivity_score = interactivity_score
    session_row.time_wasted_sec = time_wasted_sec
    session_row.qna_sec = qna_sec
    session_row.interactive_sec = interactive_sec
    session_row.teaching_sec = teaching_sec

    # ---- Emit artifacts under /static/reports ----
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    json_name = f"session_{session_row.id}_{timestamp}.json"
    pdf_name = f"session_{session_row.id}_{timestamp}.pdf"
    json_path = STATIC_REPORTS_DIR / json_name
    pdf_path = STATIC_REPORTS_DIR / pdf_name

    # Write JSON (no external deps)
    import json

    report_dict = {
        "session_id": session_row.id,
        "classroom_id": classroom.id,
        "generated_at": datetime.utcnow().isoformat(),
        "interactivity_score": interactivity_score,
        "duration_sec": duration_sec,
        "breakdown": {
            "time_wasted_sec": time_wasted_sec,
            "interactive_sec": interactive_sec,
            "qna_sec": qna_sec,
            "teaching_sec": teaching_sec,
        },
    }
    json_path.write_text(json.dumps(report_dict, indent=2))

    # Write simple PDF (using reportlab)
    _write_pdf_report(
        pdf_path,
        title=f"EduSense Session Report #{session_row.id}",
        stats={
            "interactivity_score": interactivity_score,
            "duration_sec": duration_sec,
            "time_wasted_sec": time_wasted_sec,
            "interactive_sec": interactive_sec,
            "qna_sec": qna_sec,
            "teaching_sec": teaching_sec,
        },
    )

    # Save URLs on the row
    session_row.report_json_url = f"/static/reports/{json_name}"
    session_row.report_pdf_url = f"/static/reports/{pdf_name}"

    db.add(session_row)

    # Recompute classroom average (only analyzed sessions contribute)
    # Recompute classroom average (only analyzed sessions contribute)
    scores = db.exec(
        select(SessionRow.interactivity_score).where(
            (SessionRow.classroom_id == classroom.id)
            & (SessionRow.interactivity_score.is_not(None))
        )
    ).all()  # ← no .scalars() here

    classroom.avg_interactivity = round(sum(scores) / len(scores), 2) if scores else 0.0
    db.add(classroom)
    db.commit()


    return {
        "status": "ok",
        "session_id": session_row.id,
        "report_json_url": session_row.report_json_url,
        "report_pdf_url": session_row.report_pdf_url,
    }


# ==============================
# HOW TO RUN (for your convenience)
# ==============================
# 1) Create & activate venv (Windows):
#    python -m venv .venv
#    .\.venv\Scripts\Activate.ps1   (PowerShell)   OR   .\.venv\Scripts\activate.bat (cmd)
#
# 2) Install requirements:
#    pip install fastapi uvicorn[standard] sqlmodel python-jose[cryptography] passlib[bcrypt] python-multipart reportlab
#
# 3) Start dev server (auto-reload):
#    uvicorn server:app --reload
#
# 4) Open the docs:
#    http://127.0.0.1:8000/docs
#
# Notes:
# - Use the /api/auth/register endpoint to create a user and receive a token immediately.
# - Then add "Authorization: Bearer <token>" in the Swagger UI Authorize button.
# - Upload audio at /api/uploads/audio, then create a session with the returned audio_url.
# - Call /api/sessions/{id}/analyze to generate JSON+PDF under /static/reports.
