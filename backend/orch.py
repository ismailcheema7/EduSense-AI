from __future__ import annotations

import os, io, json, math, re
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict, List, Dict, Any, Optional, Iterable

# LangGraph
from langgraph.graph import StateGraph, END

# ASR
from faster_whisper import WhisperModel

# Gemini
import google.generativeai as genai

from dotenv import load_dotenv
load_dotenv()


WHISPER_MODEL = os.getenv("WHISPER_MODEL", "tiny")   # "tiny"/"base"/"small"/"medium"
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")  # int8 is fast on CPU
ASR_LANG = os.getenv("ASR_LANG", "ur")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")  # good + free tier

# Window size for classification (seconds)
WINDOW_SEC = int(os.getenv("ANALYSIS_WINDOW_SEC", "90"))

URDU_ROMAN_MAP = {
    "ا": "a", "آ": "aa", "ب": "b", "پ": "p", "ت": "t", "ٹ": "t", "ث": "s",
    "ج": "j", "چ": "ch", "ح": "h", "خ": "kh", "د": "d", "ڈ": "d", "ذ": "z",
    "ر": "r", "ڑ": "r", "ز": "z", "ژ": "zh", "س": "s", "ش": "sh", "ص": "s",
    "ض": "z", "ط": "t", "ظ": "z", "ع": "’", "غ": "gh", "ف": "f", "ق": "q",
    "ک": "k", "گ": "g", "ل": "l", "م": "m", "ن": "n", "ں": "n", "و": "w",
    "ہ": "h", "ھ": "h", "ء": "’", "ی": "y", "ے": "e", "َ": "a", "ِ": "i",
    "ُ": "u", "ً": "an", "ٍ": "in", "ٌ": "un", "ّ": "", "ْ": ""
}
COMMON_REPL = [
    (" میں ", " mein "), (" نہیں ", " nahi "), (" ہے ", " hai "), (" ہوں ", " hoon "),
    (" تھے ", " thay "), (" تھا ", " tha "), (" تھی ", " thi "), (" ہوگا ", " hoga "),
    (" ہوگی ", " hogi "), (" کیوں ", " kyun "), (" کیا ", " kya "), (" تم ", " tum "),
    (" ہم ", " hum "), (" ہیں ", " hain "),
]

def urdu_to_roman(s: str) -> str:
    t = f" {s} "
    for src, dst in COMMON_REPL:
        t = t.replace(src, dst)
    out = [URDU_ROMAN_MAP.get(ch, ch) for ch in t]
    roman = "".join(out)
    roman = " ".join(roman.split())
    roman = roman.replace("khh", "kh").replace("ghh", "gh").replace("shh", "sh")
    return roman

def seconds(x: float) -> int:
    return max(0, int(round(x)))

def fmt_hhmmss(sec: int) -> str:
    h = sec // 3600
    m = (sec % 3600) // 60
    s = sec % 60
    return f"{h:02d}:{m:02d}:{s:02d}"

def chunk_windows(segments: List[Dict[str, Any]], window_sec: int) -> List[Dict[str, Any]]:
    """
    Group whisper segments into ~window_sec buckets.
    Each window: {start, end, text_roman, text_urdu}
    """
    windows: List[Dict[str, Any]] = []
    if not segments:
        return windows

    current = {"start": segments[0]["start"], "end": segments[0]["end"], "text_urdu": []}
    for seg in segments:
        # grow window
        if (seg["end"] - current["start"]) <= window_sec:
            current["end"] = seg["end"]
            current["text_urdu"].append(seg["text"])
        else:
            text_urdu = " ".join(current["text_urdu"]).strip()
            text_roman = urdu_to_roman(text_urdu)
            windows.append({
                "start": seconds(current["start"]),
                "end": seconds(current["end"]),
                "text_urdu": text_urdu,
                "text_roman": text_roman,
            })
            # start a new one with the current segment
            current = {"start": seg["start"], "end": seg["end"], "text_urdu": [seg["text"]]}

    # flush last
    if current["text_urdu"]:
        text_urdu = " ".join(current["text_urdu"]).strip()
        text_roman = urdu_to_roman(text_urdu)
        windows.append({
            "start": seconds(current["start"]),
            "end": seconds(current["end"]),
            "text_urdu": text_urdu,
            "text_roman": text_roman,
        })
    return windows

def classify_batch_with_gemini(model, items: List[Dict[str, Any]]) -> List[str]:
    """
    Ask Gemini to label each window as one of:
    - LECTURE      (teacher monologue/explanation)
    - QNA          (student questions and teacher answers)
    - INTERACTIVE  (discussion, prompts, activities beyond pure QnA)
    - OFF_TOPIC    (non-class matters, admin, waiting, joking, silence)
    Returns list of labels aligned to items.
    """
    # build compact prompt (Roman Urdu content) to keep tokens low
    payload = []
    for i, w in enumerate(items):
        excerpt = w["text_roman"]
        # clamp excerpt to ~700 chars per window to keep tokens sane
        if len(excerpt) > 700:
            excerpt = excerpt[:700] + " ..."
        payload.append({
            "i": i,
            "start": fmt_hhmmss(w["start"]),
            "end": fmt_hhmmss(w["end"]),
            "text_roman": excerpt
        })

    sys = (
        "You label classroom audio windows. Use one label per item: "
        "LECTURE, QNA, INTERACTIVE, or OFF_TOPIC. "
        "Return ONLY a compact JSON list of labels (strings) where index 0 corresponds to item 0, etc. "
        "Do not add commentary."
    )
    user = (
        "Items:\n" + json.dumps(payload, ensure_ascii=False)
        + "\n\nReturn JSON like: [\"LECTURE\",\"QNA\", ...]"
    )

    resp = model.generate_content([sys, user])
    text = (resp.text or "").strip()
    # try parse as a JSON list
    try:
        data = json.loads(text)
        if isinstance(data, list) and all(isinstance(x, str) for x in data):
            return data
    except Exception:
        # try to extract a list
        m = re.search(r"\[.*\]", text, re.S)
        if m:
            try:
                data = json.loads(m.group(0))
                if isinstance(data, list) and all(isinstance(x, str) for x in data):
                    return data
            except Exception:
                pass

    # fallback: all lecture (shouldn't happen often)
    return ["LECTURE"] * len(items)

class AnalysisState(TypedDict, total=False):
    audio_path: str
    # ASR
    text_urdu: str
    text_roman: str
    segments: List[Dict[str, Any]]       # [{start,end,text}]
    duration_sec: int

    # Windows + labels
    windows: List[Dict[str, Any]]        # [{start,end,text_urdu,text_roman,label}]
    # Metrics
    metrics: Dict[str, Any]              # teaching_sec, qna_sec, interactive_sec, time_wasted_sec, duration_sec
    scores: Dict[str, Any]               # interactivity_score
    # Topics + expl + summary
    topics: List[str]
    topic_explanations: Dict[str, str]   # english, roman
    summary: Dict[str, str]              # english, roman

def node_transcribe(state: AnalysisState) -> AnalysisState:
    audio_path = state["audio_path"]
    model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)
    segments, info = model.transcribe(
        audio_path,
        language=ASR_LANG,
        vad_filter=True,
        beam_size=1,
        condition_on_previous_text=True,
    )

    segs, full = [], []
    for s in segments:
        txt = (s.text or "").strip()
        segs.append({"start": float(s.start), "end": float(s.end), "text": txt})
        full.append(txt)

    text_urdu = " ".join(full).strip()
    text_roman = urdu_to_roman(text_urdu)
    duration = getattr(info, "duration", 0.0) if info else (segs[-1]["end"] if segs else 0.0)

    out = dict(state)
    out.update({
        "segments": segs,
        "text_urdu": text_urdu,
        "text_roman": text_roman,
        "duration_sec": seconds(duration),
    })
    return out

def node_window(state: AnalysisState) -> AnalysisState:
    segs = state.get("segments", [])
    windows = chunk_windows(segs, WINDOW_SEC)
    out = dict(state)
    out["windows"] = windows
    return out

def node_classify(state: AnalysisState) -> AnalysisState:
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not set")

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    windows = state.get("windows", [])
    labeled: List[Dict[str, Any]] = []

    BATCH = 8  # keep prompts small; tune as needed
    for i in range(0, len(windows), BATCH):
        batch = windows[i:i+BATCH]
        labels = classify_batch_with_gemini(model, batch)
        for w, lbl in zip(batch, labels):
            ww = dict(w)
            ww["label"] = lbl.strip().upper()
            labeled.append(ww)

    out = dict(state)
    out["windows"] = labeled
    return out

def node_metrics(state: AnalysisState) -> AnalysisState:
    windows = state.get("windows", [])
    totals = {"LECTURE": 0, "QNA": 0, "INTERACTIVE": 0, "OFF_TOPIC": 0}
    for w in windows:
        dur = max(0, int(w["end"] - w["start"]))
        label = (w.get("label") or "LECTURE").upper()
        if label not in totals:
            label = "LECTURE"
        totals[label] += dur

    duration_sec = state.get("duration_sec") or sum(max(0, int(w["end"] - w["start"])) for w in windows)

    teaching_sec     = totals["LECTURE"]
    qna_sec          = totals["QNA"]
    interactive_sec  = totals["INTERACTIVE"]
    time_wasted_sec  = totals["OFF_TOPIC"]

    # interactivity = time where students are involved (QNA + INTERACTIVE)
    interactivity_ratio = (qna_sec + interactive_sec) / duration_sec if duration_sec > 0 else 0.0
    interactivity_score = round(100.0 * interactivity_ratio, 2)

    out = dict(state)
    out["metrics"] = {
        "duration_sec": duration_sec,
        "teaching_sec": teaching_sec,
        "qna_sec": qna_sec,
        "interactive_sec": interactive_sec,
        "time_wasted_sec": time_wasted_sec,
    }
    out["scores"] = {"interactivity_score": interactivity_score}
    return out

def node_topics_and_summary(state: AnalysisState) -> AnalysisState:
    if not GEMINI_API_KEY:
        # graceful fallback; keep pipeline alive
        out = dict(state)
        out["topics"] = []
        out["topic_explanations"] = {"english": "", "roman": ""}
        out["summary"] = {"english": "", "roman": ""}
        return out

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    # Use a trimmed Roman Urdu transcript (Gemini free tier friendly)
    text = state.get("text_roman", "")
    if len(text) > 16000:
        text = text[:16000] + " ..."

    sys = (
        "You analyze a classroom transcript (Roman Urdu). "
        "1) List 3-6 main topics (short titles only). "
        "2) Give two short explanations: (a) English, (b) Roman Urdu. "
        "3) Provide a brief class summary in both English and Roman Urdu. "
        "Return strict JSON with keys: topics[list], topic_explanations{english,roman}, summary{english,roman}."
    )
    user = text

    resp = model.generate_content([sys, user])
    t = (resp.text or "").strip()

    topics: List[str] = []
    topic_expl = {"english": "", "roman": ""}
    summary = {"english": "", "roman": ""}

    # parse JSON
    try:
        data = json.loads(t)
    except Exception:
        m = re.search(r"\{.*\}", t, re.S)
        data = json.loads(m.group(0)) if m else {}

    if isinstance(data, dict):
        if isinstance(data.get("topics"), list):
            topics = [str(x)[:80] for x in data["topics"][:8]]
        te = data.get("topic_explanations") or {}
        topic_expl = {
            "english": str(te.get("english", ""))[:2000],
            "roman": str(te.get("roman", ""))[:2000],
        }
        sm = data.get("summary") or {}
        summary = {
            "english": str(sm.get("english", ""))[:2000],
            "roman": str(sm.get("roman", ""))[:2000],
        }

    out = dict(state)
    out["topics"] = topics
    out["topic_explanations"] = topic_expl
    out["summary"] = summary
    return out

def build_graph():
    g = StateGraph(AnalysisState)
    g.add_node("transcribe", node_transcribe)
    g.add_node("window", node_window)
    g.add_node("classify", node_classify)
    g.add_node("metrics", node_metrics)
    g.add_node("topics", node_topics_and_summary)

    g.set_entry_point("transcribe")
    g.add_edge("transcribe", "window")
    g.add_edge("window", "classify")
    g.add_edge("classify", "metrics")
    g.add_edge("metrics", "topics")
    g.add_edge("topics", END)
    return g.compile()

# ---------- Public API ----------
def run_analysis(audio_abs_path: str) -> Dict[str, Any]:
    """
    Main entrypoint used by server.py
    Returns a dict with:
      - duration_sec
      - metrics{teaching_sec,qna_sec,interactive_sec,time_wasted_sec,duration_sec}
      - scores{interactivity_score}
      - topics[], topic_explanations{english,roman}, summary{english,roman}
      - segments[] (raw whisper)
      - windows[] (labeled)
      - text_urdu, text_roman
    """
    if not Path(audio_abs_path).exists():
        raise FileNotFoundError(audio_abs_path)

    graph = build_graph()
    final: AnalysisState = graph.invoke({"audio_path": audio_abs_path})
    return dict(final)