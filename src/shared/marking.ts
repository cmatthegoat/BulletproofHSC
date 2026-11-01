import { z } from "zod";

export const MISTAKE_CATEGORIES = [
  "content_gap", "technique", "command_term", "careless", "time_management",
  "terminology", "evidence", "structure", "other",
] as const;
export const SEVERITIES = ["low", "medium", "high"] as const;

export const questionCreateSchema = z.object({
  subject_id: z.number().int().positive(),
  syllabus_point_id: z.number().int().positive().nullable().default(null),
  source: z.string().trim().max(200).default(""),
  question_text: z.string().trim().min(1, "Enter the question.").max(5000),
  total_marks: z.number().int("Marks must be a whole number.").min(1, "Marks must be at least 1.").max(200),
  marking_criteria: z.string().max(10000).default(""),
  student_answer: z.string().max(10000).default(""),
});

export const questionUpdateSchema = z
  .object({
    syllabus_point_id: z.number().int().positive().nullable(),
    source: z.string().trim().max(200),
    question_text: z.string().trim().min(1, "Enter the question.").max(5000),
    total_marks: z.number().int().min(1).max(200),
    marking_criteria: z.string().max(10000),
    student_answer: z.string().max(10000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

// Strict shape the AI must return. marks_total and percentage are checked server-side,
// never trusted from the model.
export const criterionSchema = z.object({
  criterion: z.string().max(300),
  awarded: z.number().finite(),
  available: z.number().finite(),
  comment: z.string().max(2000).default(""),
});

export const mistakeSchema = z.object({
  category: z.enum(MISTAKE_CATEGORIES),
  description: z.string().min(1).max(2000),
  correction: z.string().max(2000).default(""),
  severity: z.enum(SEVERITIES),
});

export const markingReplySchema = z.object({
  marks_awarded: z.number().finite(),
  marks_total: z.number().finite(),
  percentage: z.number().finite(),
  criteria_breakdown: z.array(criterionSchema).max(50).default([]),
  mistakes: z.array(mistakeSchema).max(50).default([]),
  model_answer_outline: z.string().max(5000).default(""),
  next_steps: z.array(z.string().max(500)).max(20).default([]),
});

export type QuestionCreate = z.infer<typeof questionCreateSchema>;
export type QuestionUpdate = z.infer<typeof questionUpdateSchema>;
export type MarkingReply = z.infer<typeof markingReplySchema>;
export type Mistake = z.infer<typeof mistakeSchema>;

// The validated, server-checked result that is stored and shown to the user.
export interface MarkResult {
  marks_awarded: number;
  marks_total: number;
  percentage: number;
  criteria_breakdown: { criterion: string; awarded: number; available: number; comment: string }[];
  mistakes: Mistake[];
  model_answer_outline: string;
  next_steps: string[];
}
