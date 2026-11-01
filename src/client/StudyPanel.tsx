import { FormEvent, useState } from "react";
import { api, Subject } from "./api";

export function SubjectsPanel({
  subjects,
  onChanged,
}: {
  subjects: Subject[];
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [courseType, setCourseType] = useState<"HSC" | "Preliminary">("HSC");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    run(async () => {
      await api("/api/subjects", { body: { name: name.trim(), course_type: courseType } });
      setName("");
    }, "Could not add the subject.");
  }

  function rename(s: Subject) {
    const next = window.prompt("New name for this subject", s.name);
    if (!next || !next.trim() || next.trim() === s.name) return;
    run(() => api(`/api/subjects/${s.id}`, { method: "PATCH", body: { name: next.trim() } }), "Could not rename the subject.");
  }

  function setArchived(s: Subject, archived: boolean) {
    run(() => api(`/api/subjects/${s.id}`, { method: "PATCH", body: { archived } }), "Could not update the subject.");
  }

  function remove(s: Subject) {
    if (!window.confirm(`Delete "${s.name}" and all its questions and mistakes? This cannot be undone.`)) return;
    run(() => api(`/api/subjects/${s.id}`, { method: "DELETE" }), "Could not delete the subject.");
  }

  const active = subjects.filter((s) => !s.archived);
  const archived = subjects.filter((s) => s.archived);

  return (
    <section className="card account" aria-labelledby="subjects-manage-heading">
      <h2 id="subjects-manage-heading">Manage subjects</h2>
      <form className="row" onSubmit={add}>
        <label>
          Subject name
          <input type="text" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Biology" />
        </label>
        <label>
          Course
          <select value={courseType} onChange={(e) => setCourseType(e.target.value as "HSC" | "Preliminary")}>
            <option value="HSC">HSC</option>
            <option value="Preliminary">Preliminary</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !name.trim()}>Add subject</button>
      </form>
      {active.length > 0 && (
        <ul className="plain-list">
          {active.map((s) => (
            <li key={s.id} className="row">
              <span>{s.name}</span>
              <button type="button" className="link" disabled={busy} onClick={() => rename(s)}>Rename</button>
              <button type="button" className="link" disabled={busy} onClick={() => setArchived(s, true)}>Archive</button>
              <button type="button" className="link danger-text" disabled={busy} onClick={() => remove(s)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <details>
          <summary>Archived ({archived.length})</summary>
          <ul className="plain-list">
            {archived.map((s) => (
              <li key={s.id} className="row">
                <span className="muted">{s.name}</span>
                <button type="button" className="link" disabled={busy} onClick={() => setArchived(s, false)}>Restore</button>
                <button type="button" className="link danger-text" disabled={busy} onClick={() => remove(s)}>Delete</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
