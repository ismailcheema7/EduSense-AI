import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, EmptyState, Input, Label } from "../ui";
import {
  Classroom,
  createClass,
  listClasses,
  renameClass,
  deleteClass,
  humanizeError,
} from "../api";
import { useToast } from "../ui";

export default function Dashboard() {
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function refresh() {
    const data = await listClasses();
    setClasses(data);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function createNew(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await createClass(name.trim());
      setName("");
      toast.push({ title: "Class created", kind: "success" });
      await refresh();
    } catch (e: any) {
      toast.push({ title: humanizeError(e), kind: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label>New class name</Label>
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., 10th Grade Physics"
            />
            <Button onClick={createNew} loading={loading} disabled={!name.trim()}>
              Add
            </Button>

          </div>
        </div>
      </div>

      {classes.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No classes yet"
            hint="Create your first classroom and start uploading sessions."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">{c.name}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {c.sessions_count} sessions · Avg interactivity {c.avg_interactivity.toFixed(2)}
                  </p>
                </div>
                <Link to={`/classes/${c.id}`} className="text-brand-700 hover:underline">
                  Open
                </Link>
              </div>

              <div className="mt-4 flex gap-2">
                <InlineRename
                  current={c.name}
                  onSave={(n) => renameClass(c.id, n).then(refresh)}
                />
                <Button
                  variant="danger"
                  onClick={async () => {
                    await deleteClass(c.id);
                    toast.push({ title: "Deleted", kind: "success" });
                    await refresh();
                  }}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function InlineRename({ current, onSave }: { current: string; onSave: (n: string) => Promise<any> }) {
  const [v, setV] = useState(current);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex gap-2">
      <Input value={v} onChange={(e) => setV(e.target.value)} />
      <Button
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave(v);
          } finally {
            setBusy(false);
          }
        }}
      >
        Rename
      </Button>
    </div>
  );
}
