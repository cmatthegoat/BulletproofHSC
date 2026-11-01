import { FormEvent, useState } from "react";
import { api, Subject } from "./api";
import { ACTIVITIES, Activity, MINUTES_PER_FIXTURE, clubCashFor } from "../shared/rewards";

export interface StudySession {
  id: number;
  subject_id: number | null;
  title: string;
  activity: Activity;
  minutes: number;
  marks_awarded: number | null;
  marks_total: number | null;
  club_cash: number;
  logged_at: string;
}

const ACTIVITY_LABEL: Record<Activity, string> = {
  study: "Study",
  homework: "Homework",
  past_paper: "Past paper",
  exam_question: "Exam-style question",
};

export function SessionsPanel({
  subjects,
  sessions,
  onChanged,
}: {
  subjects: Subject[];
  sessions: StudySession[];
  onChanged: () => Promise<void>;
}) {
  const [subjectId, setSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [activity, setActivity] = useState<Activity>("study");
  const [minutes, setMinutes] = useState("30");
  const [marksAwarded, setMarksAwarded] = useState("");
  const [marksTotal, setMarksTotal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mins = Number(minutes);
  const awarded = marksAwarded === "" ? null : Number(marksAwarded);
  const total = marksTotal === "" ? null : Number(marksTotal);
  const preview =
    Number.isInteger(mins) && mins > 0
      ? clubCashFor({ minutes: mins, activity, marks_awarded: awarded, marks_total: total })
      : 0;

  async function log(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/sessions", {
        body: {
          subject_id: subjectId ? Number(subjectId) : null,
          title: title.trim(),
          activity,
          minutes: mins,
          marks_awarded: awarded,
          marks_total: total,
        },
      });
      setTitle("");
      setMarksAwarded("");
      setMarksTotal("");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log the session.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: StudySession) {
    if (!window.confirm("Delete this study session? Its club cash will be removed.")) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/sessions/${s.id}`, { method: "DELETE" });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the session.");
    } finally {
      setBusy(false);
    }
  }

  const subjectName = (id: number | null) => subjects.find((s) => s.id === id)?.name ?? "No subject";

  return (
    <section className="card account" aria-labelledby="sessions-heading">
      <h2 id="sessions-heading">Study log</h2>
      <p className="muted">
        Every session earns club cash. Every {MINUTES_PER_FIXTURE} minutes unlocks a fixture. Past papers pay 1.5×, exam-style
        questions 1.25×, and marks scale the reward from 0.8× to 1.45×.
      </p>
      <form onSubmit={log} className="row">
        <label>
          Subject
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">No subject</option>
            {subjects.filter((s) => !s.archived).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label>
          Activity
          <select value={activity} onChange={(e) => setActivity(e.target.value as Activity)}>
            {ACTIVITIES.map((a) => (
              <option key={a} value={a}>{ACTIVITY_LABEL[a]}</option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chapter 4 questions" />
        </label>
        <label>
          Minutes
          <input type="number" min={1} max={1440} required value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
        <label>
          Marks awarded
          <input type="number" min={0} value={marksAwarded} onChange={(e) => setMarksAwarded(e.target.value)} />
        </label>
        <label>
          Marks total
          <input type="number" min={1} value={marksTotal} onChange={(e) => setMarksTotal(e.target.value)} />
        </label>
        <button type="submit" disabled={busy || !mins}>Log session · +{preview} club cash</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {sessions.length === 0 ? (
        <p className="empty">No sessions logged yet.</p>
      ) : (
        <ul className="plain-list">
          {sessions.map((s) => (
            <li key={s.id} className="row">
              <strong>{s.title || ACTIVITY_LABEL[s.activity]}</strong>
              <span className="muted">
                {subjectName(s.subject_id)} · {s.minutes} min · +{s.club_cash} club cash · {s.logged_at}
              </span>
              <button type="button" className="danger-btn" disabled={busy} onClick={() => remove(s)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
