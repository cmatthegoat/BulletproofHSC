// Spaced-repetition schedule in days, indexed by review stage. Stage 0 is due right away.
export const REVIEW_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];

export function nextStage(stage: number, result: "got_it" | "still_struggling"): number {
  if (result === "still_struggling") return 0;
  return Math.min(stage + 1, REVIEW_INTERVAL_DAYS.length - 1);
}

export function nextReviewAt(stage: number, from: Date = new Date()): string {
  const days = REVIEW_INTERVAL_DAYS[stage] ?? REVIEW_INTERVAL_DAYS[REVIEW_INTERVAL_DAYS.length - 1];
  const due = new Date(from.getTime() + days * 86400000);
  return due.toISOString().slice(0, 19).replace("T", " ");
}

// Normalises a mistake description so the same mistake matches across attempts.
export function normaliseDescription(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
