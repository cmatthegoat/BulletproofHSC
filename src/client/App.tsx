import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, Subject, StatsResponse, User } from "./api";
import { SubjectsPanel } from "./StudyPanel";
import { QuestionsPanel } from "./QuestionsPanel";
import { MistakesPanel } from "./MistakesPanel";
import { SessionsPanel, StudySession } from "./SessionsPanel";
import { ClubPanel } from "./ClubPanel";
import { Landing } from "./Landing";

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    api<{ user: User }>("/api/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <p className="status" role="status">Loading…</p>;
  if (user === null) {
    return showAuth ? <AuthForm onAuthed={setUser} /> : <Landing onSignIn={() => setShowAuth(true)} />;
  }
  return <Dashboard user={user} onSignedOut={() => setUser(null)} />;
}

function AuthForm({ onAuthed }: { onAuthed: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>(`/api/auth/${mode}`, { body: { email, password } });
      onAuthed(r.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="narrow">
      <h1>Mistake Journal</h1>
      <form className="card" onSubmit={submit}>
        <h2>{mode === "login" ? "Log in" : "Create account"}</h2>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}</button>
        <button type="button" className="link" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
        </button>
      </form>
    </main>
  );
}

function Dashboard({ user, onSignedOut }: { user: User; onSignedOut: () => void }) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [s, st, ss] = await Promise.all([
      api<{ subjects: Subject[] }>("/api/subjects"),
      api<StatsResponse>("/api/stats"),
      api<{ sessions: StudySession[] }>("/api/sessions"),
    ]);
    setSubjects(s.subjects);
    setStats(st);
    setSessions(ss.sessions);
  }

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : "Could not load your data."));
  }, []);

  async function logout() {
    await api("/api/auth/logout", { body: {} }).catch(() => undefined);
    onSignedOut();
  }

  return (
    <main>
      <header className="topbar">
        <h1>Mistake Journal</h1>
        <div>
          <span className="muted">{user.email ?? `User ${user.id}`}</span>
          <button className="link" onClick={logout}>Log out</button>
        </div>
      </header>

      {error && <p className="error" role="alert">{error}</p>}
      {!subjects && !error && <p className="status" role="status">Loading your subjects…</p>}

      {subjects && subjects.length === 0 && (
        <p className="empty">No subjects yet. Add one in Manage subjects below to start tracking.</p>
      )}

      {subjects && subjects.length > 0 && (
        <section aria-labelledby="subjects-heading">
          <h2 id="subjects-heading">Subjects</h2>
          <ul className="grid">
            {subjects.filter((s) => !s.archived).map((s) => {
              const st = stats?.by_subject.find((b) => b.subject_id === s.id);
              return (
                <li key={s.id} className="card" style={{ borderLeftColor: s.color }}>
                  <strong>{s.name}</strong>
                  <span className="muted">{s.course_type}</span>
                  <span>
                    {st && st.attempts > 0 ? `${st.average_percentage ?? 0}% average over ${st.attempts} attempt${st.attempts === 1 ? "" : "s"}` : "No attempts yet"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {stats && stats.open_mistakes_by_category.length > 0 && (
        <section aria-labelledby="mistakes-heading">
          <h2 id="mistakes-heading">Open mistakes</h2>
          <ul className="grid">
            {stats.open_mistakes_by_category.map((m) => (
              <li key={m.category} className="card">
                <strong>{m.category.replace(/_/g, " ")}</strong>
                <span>{m.count} open · {m.repeats} repeats</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats && <ClubPanel club={stats.club} />}

      <SubjectsPanel subjects={subjects ?? []} onChanged={reload} />
      <SessionsPanel subjects={subjects ?? []} sessions={sessions} onChanged={reload} />
      <QuestionsPanel subjects={subjects ?? []} />
      <MistakesPanel subjects={subjects ?? []} />

      <AiSettingsPanel />
      <AccountPanel onDeleted={onSignedOut} />
    </main>
  );
}

interface AiSettingsView {
  configured: boolean;
  key_hint: string;
  model: string;
}

function AiSettingsPanel() {
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<AiSettingsView>("/api/ai-settings")
      .then((v) => {
        setView(v);
        setModel(v.model);
      })
      .catch(() => setError("Could not load your AI settings."));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body: { api_key?: string; model: string } = { model };
      if (apiKey.trim()) body.api_key = apiKey.trim();
      const v = await api<AiSettingsView>("/api/ai-settings", { method: "PUT", body });
      setView(v);
      setModel(v.model);
      setApiKey("");
      setMessage("Saved. AI marking and syllabus parsing will use your key.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your settings.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove your OpenRouter key? AI features will stop until you add one again.")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api("/api/ai-settings", { method: "DELETE" });
      setView({ configured: false, key_hint: "", model: "" });
      setModel("");
      setMessage("Your key has been removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove your key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card account" aria-labelledby="ai-heading">
      <h2 id="ai-heading">AI settings</h2>
      <p className="muted">
        Use your own OpenRouter key. It is stored encrypted and only used for your marking and syllabus parsing. Get a key at openrouter.ai.
      </p>
      {view?.configured && <p>Key saved (ends in …{view.key_hint}).</p>}
      <form onSubmit={save}>
        <label>
          OpenRouter API key
          <input
            type="password"
            autoComplete="off"
            placeholder={view?.configured ? "Leave blank to keep your saved key" : "sk-or-…"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <label>
          Model
          <input
            type="text"
            required
            placeholder="openai/gpt-4o-mini"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <div className="row">
          <button type="submit" disabled={busy || !view || (!view.configured && !apiKey.trim())}>Save AI settings</button>
          {view?.configured && (
            <button type="button" className="danger-btn" disabled={busy} onClick={remove}>Remove key</button>
          )}
        </div>
      </form>
      {message && <p role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function AccountPanel({ onDeleted }: { onDeleted: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function exportBackup() {
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/account/export", { credentials: "same-origin" });
      if (!res.ok) throw new ApiError(res.status, "error", "Could not export your data.");
      const blob = new Blob([await res.text()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "study-backup.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export your data.");
    }
  }

  async function importBackup(file: File) {
    setError(null);
    setMessage(null);
    try {
      const body = JSON.parse(await file.text());
      const r = await api<{ imported: { subjects: number; questions: number } }>("/api/account/import", { body });
      setMessage(`Imported ${r.imported.subjects} subjects and ${r.imported.questions} questions.`);
    } catch (err) {
      setError(err instanceof SyntaxError ? "That file is not valid JSON." : err instanceof Error ? err.message : "Import failed.");
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm("Delete your account and all of its data? This cannot be undone.")) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/account", { method: "DELETE", body: { password } });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card account" aria-labelledby="account-heading">
      <h2 id="account-heading">Your data</h2>
      <div className="row">
        <button onClick={exportBackup}>Download backup</button>
        <label className="file">
          Import backup
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importBackup(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {message && <p role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <form onSubmit={deleteAccount} className="danger">
        <h3>Delete account</h3>
        <label>
          Enter your password to confirm
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" className="danger-btn" disabled={busy || !password}>Delete my account</button>
      </form>
    </section>
  );
}
