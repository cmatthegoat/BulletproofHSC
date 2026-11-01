import { FormEvent, useEffect, useState } from "react";
import { api, Subject } from "./api";

interface Question {
  id: number;
  subject_id: number;
  question_text: string;
  total_marks: number;
  source: string;
  student_answer?: string;
  marking_criteria?: string;
}

interface MarkResult {
  marks_awarded: number;
  marks_total: number;
  percentage: number;
  criteria_breakdown: { criterion: string; awarded: number; available: number; comment: string }[];
  mistakes: { category: string; description: string; correction: string; severity: string }[];
  model_answer_outline: string;
  next_steps: string[];
}

export function QuestionsPanel({ subjects }: { subjects: Subject[] }) {
  const active = subjects.filter((s) => !s.archived);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = subjectId ?? active[0]?.id ?? null;

  async function loadQuestions(id: number) {
    const r = await api<{ questions: Question[] }>(`/api/questions?subject_id=${id}`);
    setQuestions(r.questions);
  }

  useEffect(() => {
    if (selected === null) return;
    loadQuestions(selected).catch((err) => setError(err instanceof Error ? err.message : "Could not load questions."));
  }, [selected]);

  async function refresh() {
    if (selected !== null) await loadQuestions(selected);
  }

  return (
    <section className="card account" aria-labelledby="questions-heading">
      <h2 id="questions-heading">Questions</h2>
      {active.length === 0 ? (
        <p className="muted">Add a subject first, then you can add questions to it.</p>
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
          {selected !== null && (
            <NewQuestionForm subjectId={selected} busy={busy} setBusy={setBusy} setError={setError} onSaved={refresh} />
          )}
          {questions.length === 0 && <p className="muted">No questions yet for this subject.</p>}
          <ul className="plain-list">
            {questions.map((q) => (
              <QuestionItem key={q.id} question={q} setError={setError} onChanged={refresh} />
            ))}
          </ul>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function NewQuestionForm({
  subjectId,
  busy,
  setBusy,
  setError,
  onSaved,
}: {
  subjectId: number;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [totalMarks, setTotalMarks] = useState(10);
  const [criteria, setCriteria] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/questions", {
        body: { subject_id: subjectId, question_text: text.trim(), total_marks: totalMarks, marking_criteria: criteria, student_answer: "" },
      });
      setText("");
      setCriteria("");
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the question.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Question
        <textarea required maxLength={5000} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label>
        Total marks
        <input type="number" min={1} max={200} required value={totalMarks} onChange={(e) => setTotalMarks(Number(e.target.value))} />
      </label>
      <label>
        Marking criteria (optional)
        <textarea maxLength={10000} rows={2} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
      </label>
      <button type="submit" disabled={busy || !text.trim()}>Add question</button>
    </form>
  );
}

function QuestionItem({
  question,
  setError,
  onChanged,
}: {
  question: Question;
  setError: (e: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState(question.student_answer ?? "");
  const [result, setResult] = useState<MarkResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadDetail() {
    const r = await api<{ question: Question }>(`/api/questions/${question.id}`);
    setAnswer(r.question.student_answer ?? "");
  }

  async function toggle() {
    if (!open) await loadDetail().catch((err) => setError(err instanceof Error ? err.message : "Could not load the question."));
    setOpen(!open);
  }

  async function saveAnswer() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/questions/${question.id}`, { method: "PATCH", body: { student_answer: answer } });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the answer.");
    } finally {
      setBusy(false);
    }
  }

  async function mark() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/questions/${question.id}`, { method: "PATCH", body: { student_answer: answer } });
      const r = await api<{ result: MarkResult }>(`/api/questions/${question.id}/mark`, { body: {} });
      setResult(r.result);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark the answer.");
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!window.confirm("Delete this question and its marking history?")) return;
    setBusy(true);
    api(`/api/questions/${question.id}`, { method: "DELETE" })
      .then(() => onChanged())
      .catch((err) => setError(err instanceof Error ? err.message : "Could not delete the question."))
      .finally(() => setBusy(false));
  }

  return (
    <li className="card">
      <div className="row">
        <strong>{question.question_text}</strong>
        <span className="muted">{question.total_marks} marks</span>
        <button type="button" className="link" onClick={toggle}>{open ? "Close" : "Answer and mark"}</button>
        <button type="button" className="link danger-text" disabled={busy} onClick={remove}>Delete</button>
      </div>
      {open && (
        <>
          <label>
            Your answer
            <textarea maxLength={10000} rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </label>
          <div className="row">
            <button type="button" disabled={busy} onClick={saveAnswer}>Save answer</button>
            <button type="button" disabled={busy || !answer.trim()} onClick={mark}>Mark with AI</button>
          </div>
          {result && (
            <div>
              <p>
                <strong>{result.marks_awarded} / {result.marks_total}</strong> ({result.percentage}%)
              </p>
              {result.model_answer_outline && <p className="muted">{result.model_answer_outline}</p>}
              {result.next_steps.length > 0 && (
                <ul>
                  {result.next_steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}
