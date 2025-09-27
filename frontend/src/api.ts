const API_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

export type Token = { access_token: string; token_type: string };
export type User = { id: number; email: string; created_at: string };
export type Classroom = {
  id: number;
  name: string;
  avg_interactivity: number;
  sessions_count: number;
  created_at: string;
};
export type SessionRow = {
  id: number;
  classroom_id: number;
  audio_url?: string | null;
  duration_sec: number;
  interactivity_score?: number | null;
  time_wasted_sec?: number | null;
  interactive_sec?: number | null;
  qna_sec?: number | null;
  teaching_sec?: number | null;
  report_json_url?: string | null;
  report_pdf_url?: string | null;
  created_at: string;
};

const storage = {
  get token() {
    return localStorage.getItem("edusense_token");
  },
  set token(v: string | null) {
    if (v) localStorage.setItem("edusense_token", v);
    else localStorage.removeItem("edusense_token");
  },
};

async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const token = storage.token;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

// auth
export async function register(email: string, password: string) {
  const data = await http<Token>(`/api/auth/register`, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  storage.token = data.access_token;
  return data;
}

export async function login(email: string, password: string) {
  const form = new URLSearchParams();
  form.set("username", email);
  form.set("password", password);
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as Token;
  storage.token = data.access_token;
  return data;
}
export async function me() {
  return http<User>(`/api/auth/me`);
}
export function logout() {
  storage.token = null;
}
export function getToken() {
  return storage.token;
}

// classes
export async function listClasses() {
  return http<Classroom[]>(`/api/classes`);
}
export async function createClass(name: string) {
  return http<Classroom>(`/api/classes`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}
export async function renameClass(id: number, name: string) {
  return http<Classroom>(`/api/classes/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}
export async function deleteClass(id: number) {
  return http(`/api/classes/${id}`, { method: "DELETE" });
}

// sessions
export async function listSessions(classId: number) {
  return http<SessionRow[]>(`/api/classes/${classId}/sessions`);
}
export async function createSession(classId: number, audio_url: string) {
  return http<SessionRow>(`/api/classes/${classId}/sessions`, {
    method: "POST",
    body: JSON.stringify({ audio_url }),
  });
}
export async function deleteSession(sessionId: number) {
  return http(`/api/sessions/${sessionId}`, { method: "DELETE" });
}
export async function analyzeSession(sessionId: number) {
  return http(`/api/sessions/${sessionId}/analyze`, { method: "POST" });
}

export async function uploadAudio(file: File) {
  const form = new FormData();
  form.append("file", file);
  const token = storage.token;
  const res = await fetch(`${API_URL}/api/uploads/audio`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    audio_url: string;
    filename: string;
    size_bytes: number;
  }>;
}
