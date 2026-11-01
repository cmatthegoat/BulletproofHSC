import { useEffect, useState } from "react";
import { api, Subject } from "./api";

interface Mistake {
  id: number;
  category: string;
  description: string;
  correction: string;
  severity: string;
  status: "open" | "reviewing" | "fixed";
  repeat_count: number;
  review_stage: number;
  next_review_at: string | null;
}

const STATUSES: Mistake["status"][] = ["open", "reviewing", "fixed"];

export function MistakesPanel({ subjects }: { subjects: Subject[] }) {
  const active = subjects.filter((s) => !s.archived);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = subjectId ?? active[0]?.id ?? null;

  async function load(id: number) {
    const r = await api<{ mistakes: Mistake[] }>(`/api/mistakes?subject_id=${id}`);
    setMistakes(r.mistakes);
  }

  useEffect(() => {
    if (selected === null) return;
    load(selected).catch((err) => setError(err instanceof Error ? err.message : "Could not load mistakes."));
  }, [selected]);

  async function act(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (selected !== null) await load(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  function setStatus(m: Mistake, status: Mistake["status"]) {
    act(() => api(`/api/mistakes/${m.id}/status`, { method: "PATCH", body: { status } }), "Could not change the status.");
  }

  function logReview(m: Mistake, result: "got_it" | "still_struggling") {
    act(() => api(`/api/mistakes/${m.id}/review`, { body: { result } }), "Could not log the review.");
  }

  return (
    <section className="card account" aria-labelledby="mistakes-review-heading">
      <h2 id="mistakes-review-heading">Mistake review</h2>
      {active.length === 0 ? (
        <p className="muted">Add a subject first, then mistakes from marking will appear here.</p>
      ) : (
        <>
          <label>
            Subject
            <select value={selected ?? ""} onChange={(e) => setSubjectId(Number(e.target.value))}>
              {active.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          {mistakes.length === 0 && <p className="muted">No mistakes recorded for this subject yet.</p>}
          <ul className="plain-list">
            {mistakes.map((m) => (
              <li key={m.id} className="card">
                <div className="row">
                  <strong>{m.category.replace(/_/g, " ")}</strong>
                  <span className="muted">{m.severity} severity · seen {m.repeat_count}×</span>
                </div>
                <p>{m.description}</p>
                {m.correction && <p className="muted">Fix: {m.correction}</p>}
                <div className="row">
                  <label>
                    Status
                    <select value={m.status} disabled={busy} onChange={(e) => setStatus(m, e.target.value as Mistake["status"])}>
                      {STATUSES.map((st) => (
                        <option key={st} value={st}>{st}</option>
                      ))}
                    </select>
                  </label>
                  {m.status !== "fixed" && (
                    <>
                      <button type="button" disabled={busy} onClick={() => logReview(m, "got_it")}>Got it</button>
                      <button type="button" className="danger-btn" disabled={busy} onClick={() => logReview(m, "still_struggling")}>Still struggling</button>
                    </>
                  )}
                </div>
                {m.next_review_at && m.status !== "fixed" && <span className="muted">Next review: {m.next_review_at}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
