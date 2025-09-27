import React, { useEffect, useState } from "react";
import { Button, Card, EmptyState } from "../ui";
import {
  analyzeSession,
  createSession,
  deleteSession,
  listSessions,
  uploadAudio,
  SessionRow,
  humanizeError
} from "../api";
import { useToast } from "../ui";
import { toBackend } from "../api";

// Shape of the JSON report we write on the backend
type ReportJSON = {
  session_id: number;
  metrics: {
    duration_sec: number;
    teaching_sec: number;
    qna_sec: number;
    interactive_sec: number;
    time_wasted_sec: number;
  };
  scores: { interactivity_score: number };
  topics?: string[];
  topic_explanations?: { english?: string; roman?: string };
  summary?: { english?: string; roman?: string };
};

export default function ClassDetail() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);
  const [reports, setReports] = useState<Record<number, ReportJSON | undefined>>({});
  const [loadingReports, setLoadingReports] = useState<Record<number, boolean>>({});
  const toast = useToast();

  async function refresh() {
    const data = await listSessions(Number(location.pathname.split("/").pop()));
    setSessions(data);
    // opportunistically fetch reports for analyzed sessions
    data.forEach((s) => {
      if (s.report_json_url && !reports[s.id]) fetchReport(s.id, s.report_json_url);
    });
  }
  useEffect(() => {
    refresh();
  }, []);

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const { audio_url } = await uploadAudio(selectedFile);
      setCreating(true);
      const classId = Number(location.pathname.split("/").pop());
      const s = await createSession(classId, audio_url);
      toast.push({ title: "Session created", kind: "success" });
      setSelectedFile(null);
      await refresh();
      await doAnalyze(s.id);
    } catch (e: any) {
      toast.push({ title: humanizeError(e), kind: "error" });
    } finally {
      setUploading(false);
      setCreating(false);
    }
  }

  async function doAnalyze(sessionId: number) {
    setAnalyzingId(sessionId);
    try {
      const res = await analyzeSession(sessionId); // { report_json_url, report_pdf_url }
      if (res?.report_json_url) {
        await fetchReport(sessionId, res.report_json_url);
      }
      await refresh();
          // ← now returns URLs
      toast.push({ title: "Analysis complete", kind: "success" });

      // Auto-load the JSON report immediately (no extra click)
      if (res?.report_json_url) {
        await fetchReport(sessionId, res.report_json_url);
      }

      // Then refresh the session list so the card shows URLs/score
      await refresh();
    } catch (e: any) {
      toast.push({ title: humanizeError(e), kind: "error" });
    } finally {
      setAnalyzingId(null);
    }
  }


  async function fetchReport(sessionId: number, url: string) {
    try {
      setLoadingReports((m) => ({ ...m, [sessionId]: true }));
      const res = await fetch(toBackend(url));
      if (!res.ok) return;
      const json = (await res.json()) as ReportJSON;
      setReports((r) => ({ ...r, [sessionId]: json }));
    } finally {
      setLoadingReports((m) => ({ ...m, [sessionId]: false }));
    }
  }

  async function downloadFile(url: string, filename: string) {
    try {
      const res = await fetch(toBackend(url));   // <— AND HERE
      if (!res.ok) throw new Error("Failed to fetch file");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      toast.push({ title: humanizeError(e), kind: "error" });
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-slate-700">Upload audio</label>
            <input
              type="file"
              accept=".wav,.mp3,.m4a,.aac,.ogg"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-xl2 border border-dashed border-brand-300 bg-brand-50 px-4 py-8 text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-white hover:border-brand-400"
            />
          </div>
          <Button onClick={handleUpload} loading={uploading || creating} className="sm:w-40">
            Create session
          </Button>
        </div>
      </Card>

      {sessions.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No sessions yet"
            hint="Upload an audio file to create a session. We will generate a report and a score after analysis."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {sessions.map((s) => {
            const r = reports[s.id];
            const busy = analyzingId === s.id;
            const analyzed = s.interactivity_score != null;

            return (
              <Card key={s.id} className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm text-slate-500">Session #{s.id}</div>
                    <div className="text-lg font-semibold text-slate-800">
                      {analyzed ? `Score ${s.interactivity_score}` : "Not analyzed"}
                    </div>
                    {s.duration_sec > 0 && (
                      <div className="mt-1 text-sm text-slate-600">
                        Duration {Math.round(s.duration_sec / 60)} min
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => doAnalyze(s.id)} loading={busy}>
                      {busy ? "Analyzing…" : "Analyze"}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={async () => {
                        await deleteSession(s.id);
                        toast.push({ title: "Deleted", kind: "success" });
                        await refresh();
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {/* Report actions */}
                {(s.report_json_url || s.report_pdf_url) && (
                  <div className="mt-4 flex items-center justify-between rounded-xl2 bg-brand-50 p-3 text-sm">
                    <div className="text-slate-700">Report ready</div>
                    <div className="flex gap-3">
                      {s.report_json_url && (
                        <button
                          className="text-brand-700 hover:underline"
                          onClick={() => fetchReport(s.id, s.report_json_url!)}
                          title="Load details below"
                          disabled={!!loadingReports[s.id]}
                        >
                          {loadingReports[s.id] ? "Loading…" : "Load details"}
                        </button>
                      )}
                      {s.report_pdf_url && (
                        <button
                          className="text-brand-700 hover:underline"
                          onClick={() => downloadFile(s.report_pdf_url!, `session_${s.id}.pdf`)}
                          title="Download PDF"
                        >
                          Download PDF
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Inline details once JSON is loaded */}
                {r && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl2 border border-slate-200 p-3">
                      <div className="mb-2 text-sm font-medium text-slate-700">Metrics</div>
                      <Pie
                        values={[
                          { label: "Teaching", value: r.metrics.teaching_sec },
                          { label: "Interactive", value: r.metrics.interactive_sec },
                          { label: "Q&A", value: r.metrics.qna_sec },
                          { label: "Wasted", value: r.metrics.time_wasted_sec },
                        ]}
                      />
                      <ul className="mt-3 text-sm text-slate-700">
                        <li>Interactivity score: <b>{r.scores.interactivity_score}</b></li>
                        <li>Teaching: <b>{fmtMin(r.metrics.teaching_sec)}</b></li>
                        <li>Interactive: <b>{fmtMin(r.metrics.interactive_sec)}</b></li>
                        <li>Q&A: <b>{fmtMin(r.metrics.qna_sec)}</b></li>
                        <li>Wasted: <b>{fmtMin(r.metrics.time_wasted_sec)}</b></li>
                        <li>Total: <b>{fmtMin(r.metrics.duration_sec)}</b></li>
                      </ul>
                    </div>

                    <div className="rounded-xl2 border border-slate-200 p-3 space-y-2">
                      <div className="text-sm font-medium text-slate-700">Summary</div>
                      {r.summary?.english && (
                        <p className="text-sm text-slate-700"><b>English: </b>{r.summary.english}</p>
                      )}
                      {r.summary?.roman && (
                        <p className="text-sm text-slate-700"><b>Roman: </b>{r.summary.roman}</p>
                      )}
                      {r.topics && r.topics.length > 0 && (
                        <p className="text-sm text-slate-700">
                          <b>Topics: </b>{r.topics.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {s.audio_url && <audio className="mt-4 w-full" controls src={s.audio_url}></audio>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------- helpers (local to this file) -------
function fmtMin(sec: number) {
  const m = Math.round(sec / 60);
  return `${m} min`;
}

// Minimal, dependency-free SVG pie
function Pie({ values }: { values: { label: string; value: number }[] }) {
  const total = Math.max(1, values.reduce((a, b) => a + (b.value || 0), 0));
  let acc = 0;
  const cx = 60, cy = 60, r = 54, stroke = 0;

  function arc(d: number) {
    const a = (d / total) * Math.PI * 2;
    const x = cx + r * Math.cos(a - Math.PI / 2);
    const y = cy + r * Math.sin(a - Math.PI / 2);
    return { a, x, y };
  }

  return (
    <div className="flex gap-3">
      <svg width="120" height="120" viewBox="0 0 120 120">
        {values.map((v, i) => {
          const start = arc(acc);
          acc += v.value || 0;
          const end = arc(acc);
          const large = (acc - (acc - (v.value || 0))) / total > 0.5 ? 1 : 0;
          const d = `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y} Z`;
          return <path key={i} d={d} strokeWidth={stroke} className={`fill-[color-mix(in_oklab,theme(colors.brand.500) ${20 + i*15}%,white)]`} />;
        })}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(0,0,0,0.06)" />
      </svg>
      <ul className="text-sm text-slate-700">
        {values.map((v, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full bg-[color-mix(in_oklab,theme(colors.brand.500) ${20 + i*15}%,white)]`} />
            {v.label} — {Math.round((100 * (v.value || 0)) / total)}%
          </li>
        ))}
      </ul>
    </div>
  );
}
