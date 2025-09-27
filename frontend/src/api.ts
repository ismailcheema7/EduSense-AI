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
    throw await buildApiError(res);
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
  if (!res.ok) throw await buildApiError(res);
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
  if (!res.ok) throw await buildApiError(res);
  return res.json() as Promise<{
    upload_id: string;
    audio_url: string;   // 👈 add this
  }>;
}


// ----- Error handling helpers -----
export class ApiError extends Error {
  status: number;
  code?: string | number;
  raw?: any;
  constructor(message: string, status: number, code?: string | number, raw?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

// Build a structured ApiError from a Response
async function buildApiError(res: Response) {
  const status = res.status;
  let text = "";
  let payload: any = null;
  try {
    text = await res.text();
    try { payload = JSON.parse(text); } catch { /* not json */ }
  } catch { /* noop */ }

  // Try common error shapes
  let msg: string | undefined;
  let code: string | number | undefined;

  if (payload) {
    if (typeof payload.detail === "string") {
      msg = payload.detail;
    } else if (Array.isArray(payload.detail) && payload.detail.length && payload.detail[0].msg) {
      msg = payload.detail.map((d: any) => d.msg).join(", ");
      code = payload.detail[0].type;
    } else if (payload.error) {
      msg = typeof payload.error === "string" ? payload.error : JSON.stringify(payload.error);
      code = payload.code ?? payload.error_code ?? payload.reason;
    } else if (payload.message) {
      msg = payload.message;
      code = payload.code ?? payload.error_code;
    }
  }

  if (!msg) {
    // Fallback to first 200 chars
    const trimmed = (text || `HTTP ${status}`).replace(/\s+/g, " ").trim();
    msg = trimmed.slice(0, 200) || `HTTP ${status}`;
  }

  return new ApiError(msg, status, code, payload ?? text);
}

// Map technical errors to friendly, tiny popups
export function humanizeError(e: any): string {
  const err = e instanceof ApiError ? e : (e?.name === "ApiError" ? e : undefined);
  const status = err?.status ?? 0;
  const msg = String(e?.message || e || "Something went wrong");
  const m = msg.toLowerCase();

  // Auth
  if (status === 401 || m.includes("invalid credentials") || (m.includes("incorrect") && m.includes("password"))) {
    return "Incorrect email or password.";
  }
  if (status === 403) return "You don't have permission to do that.";

  // Conflict / limits
  if (status === 409 || m.includes("limit") || m.includes("already exists")) {
    if (m.includes("class") && (m.includes("limit") || m.includes("max"))) {
      return "You've reached the class limit (4).";
    }
    if (m.includes("email") && (m.includes("exists") || m.includes("taken") || m.includes("registered"))) {
      return "This email is already registered.";
    }
    return "That action conflicts with an existing item.";
  }

  // Validation
  if (status === 400 || status === 422 || m.includes("validation")) {
    return "Please check the input and try again.";
  }

  // Not found
  if (status === 404) return "We couldn't find that. It may have been deleted.";

  // Backend unavailable
  if (status >= 500) return "Server is having a moment. Please try again.";

  // Network-ish
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("timeout")) {
    return "Network error. Check your connection and try again.";
  }

  // Specific hints
  if (m.includes("class") && m.includes("limit")) return "You've reached the class limit (4).";

  // Default: concise, capitalized
  const concise = msg.replace(/^error[:\s]*/i, "").trim();
  return concise ? (concise.charAt(0).toUpperCase() + concise.slice(1)) : "Something went wrong.";
}
