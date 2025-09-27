import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Card, EmptyState } from "../ui";
import {
  analyzeSession,
  createSession,
  deleteSession,
  listSessions,
  uploadAudio,
  SessionRow,
} from "../api";
import { useToast } from "../ui";

export default function ClassDetail() {
  const { id } = useParams();
  const classId = Number(id);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const toast = useToast();

  async function refresh() {
    const data = await listSessions(classId);
    setSessions(data);
  }
  useEffect(() => {
    refresh();
  }, [classId]);

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const { audio_url } = await uploadAudio(selectedFile);
      setCreating(true);
      const s = await createSession(classId, audio_url);
      toast.push({ title: "Session created", kind: "success" });
      setSelectedFile(null);
      await refresh();
      await doAnalyze(s.id);
    } catch (e: any) {
      toast.push({ title: e.message || "Upload failed", kind: "error" });
    } finally {
      setUploading(false);
      setCreating(false);
    }
  }

  async function doAnalyze(sessionId: number) {
    try {
      await analyzeSession(sessionId);
      toast.push({ title: "Analysis complete", kind: "success" });
      await refresh();
    } catch (e: any) {
      toast.push({ title: e.message || "Analysis failed", kind: "error" });
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
          {sessions.map((s) => (
            <Card key={s.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm text-slate-500">Session #{s.id}</div>
                  <div className="text-lg font-semibold text-slate-800">
                    {s.interactivity_score != null ? `Score ${s.interactivity_score}` : "Not analyzed"}
                  </div>
                  {s.duration_sec > 0 && (
                    <div className="text-sm text-slate-600 mt-1">
                      Duration {Math.round(s.duration_sec / 60)} min
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => doAnalyze(s.id)}>
                    Analyze
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

              {s.report_pdf_url && (
                <div className="mt-4 flex items-center justify-between rounded-xl2 bg-brand-50 p-3 text-sm">
                  <div className="text-slate-700">Report ready</div>
                  <div className="flex gap-3">
                    {s.report_json_url && (
                      <a className="text-brand-700 hover:underline" href={s.report_json_url} target="_blank">
                        JSON
                      </a>
                    )}
                    <a className="text-brand-700 hover:underline" href={s.report_pdf_url} target="_blank">
                      PDF
                    </a>
                  </div>
                </div>
              )}

              {s.audio_url && <audio className="mt-4 w-full" controls src={s.audio_url}></audio>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
