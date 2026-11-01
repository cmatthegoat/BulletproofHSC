// Study FC reward rules, shared by the Worker (to store each session) and the client (to preview).
export const ACTIVITIES = ["study", "homework", "past_paper", "exam_question"] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const ACTIVITY_MULTIPLIER: Record<Activity, number> = {
  study: 1,
  homework: 1,
  past_paper: 1.5,
  exam_question: 1.25,
};

// Marks scale the reward from 0.8x at 0% to 1.45x at 100%. Without marks the grade is neutral (1x).
export function gradeMultiplier(marksAwarded: number | null, marksTotal: number | null): number {
  if (marksAwarded === null || marksTotal === null || marksTotal <= 0) return 1;
  const pct = Math.min(1, Math.max(0, marksAwarded / marksTotal));
  return 0.8 + pct * 0.65;
}

// Club cash = minutes × activity multiplier × grade multiplier.
export function clubCashFor(input: {
  minutes: number;
  activity: Activity;
  marks_awarded: number | null;
  marks_total: number | null;
}): number {
  const raw = input.minutes * ACTIVITY_MULTIPLIER[input.activity] * gradeMultiplier(input.marks_awarded, input.marks_total);
  return Math.round(raw * 100) / 100;
}

// Every 90 minutes of study unlocks one fixture.
export const MINUTES_PER_FIXTURE = 90;
