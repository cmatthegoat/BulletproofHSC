import { z } from "zod";

export const COURSE_TYPES = ["Preliminary", "HSC"] as const;

export const HSC_PRESET_SUBJECTS = [
  "Mathematics Advanced",
  "Mathematics Extension 1",
  "English Advanced",
  "English Standard",
  "Biology",
  "Chemistry",
  "Physics",
  "Modern History",
  "Ancient History",
  "Economics",
  "Business Studies",
  "Legal Studies",
  "PDHPE",
  "Software Engineering",
  "Investigating Science",
] as const;

const colorField = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a valid colour.");

// Fields are defined without defaults so partial updates never overwrite stored values.
const subjectFields = {
  name: z.string().trim().min(1, "Give the subject a name.").max(80),
  color: colorField,
  course_type: z.enum(COURSE_TYPES),
  notes: z.string().max(5000),
};

export const subjectCreateSchema = z.object({
  name: subjectFields.name,
  color: subjectFields.color.default("#4f46e5"),
  course_type: subjectFields.course_type.default("HSC"),
  notes: subjectFields.notes.default(""),
});

export const subjectUpdateSchema = z
  .object({ ...subjectFields, archived: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

const syllabusFields = {
  code: z.string().trim().max(40),
  module: z.string().trim().max(120),
  topic: z.string().trim().max(120),
  description: z.string().trim().min(1, "Add the dot point text.").max(2000),
};

export const syllabusCreateSchema = z.object({
  subject_id: z.number().int().positive(),
  code: syllabusFields.code.default(""),
  module: syllabusFields.module.default(""),
  topic: syllabusFields.topic.default(""),
  description: syllabusFields.description,
});

export const syllabusUpdateSchema = z
  .object(syllabusFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

// One reviewed syllabus point, as shown to the user before saving.
export const syllabusPointSchema = z.object({
  code: syllabusFields.code.default(""),
  module: syllabusFields.module.default(""),
  topic: syllabusFields.topic.default(""),
  description: syllabusFields.description,
});

export const syllabusBulkSchema = z.object({
  subject_id: z.number().int().positive(),
  points: z.array(syllabusPointSchema).min(1, "Nothing to save.").max(500),
});

export const syllabusParseRequestSchema = z.object({
  text: z.string().trim().min(20, "Paste a longer syllabus extract.").max(60000, "That text is too long (60,000 characters max)."),
});

// Strict shape expected from the AI parser. Only this structure is ever shown or saved.
export const parsedSyllabusSchema = z.object({
  points: z.array(syllabusPointSchema).min(1).max(500),
});

export type SubjectCreate = z.infer<typeof subjectCreateSchema>;
export type SubjectUpdate = z.infer<typeof subjectUpdateSchema>;
export type SyllabusCreate = z.infer<typeof syllabusCreateSchema>;
export type SyllabusUpdate = z.infer<typeof syllabusUpdateSchema>;
export type ParsedSyllabus = z.infer<typeof parsedSyllabusSchema>;
