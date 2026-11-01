import { describe, it, expect } from "vitest";
import { parseSyllabusReply, buildSyllabusMessages } from "../src/worker/syllabus-parser";

const good = { points: [{ code: "MA-F1.1", module: "Functions", topic: "Domain", description: "Find domains of functions" }] };

describe("syllabus AI reply parser", () => {
  it("accepts a clean JSON object", () => {
    expect(parseSyllabusReply(JSON.stringify(good))).toEqual(good);
  });

  it("accepts JSON wrapped in prose or markdown fences", () => {
    expect(parseSyllabusReply("Here you go:\n```json\n" + JSON.stringify(good) + "\n```")).toEqual(good);
  });

  it("returns null for malformed JSON", () => {
    expect(parseSyllabusReply('{"points":[{"code":"A",')).toBeNull();
    expect(parseSyllabusReply("no json at all")).toBeNull();
    expect(parseSyllabusReply("")).toBeNull();
  });

  it("returns null when the shape violates the schema", () => {
    expect(parseSyllabusReply('{"points":[]}')).toBeNull(); // empty list rejected
    expect(parseSyllabusReply('{"points":[{"code":"A"}]}')).toBeNull(); // description missing
    expect(parseSyllabusReply('{"items":[]}')).toBeNull(); // wrong key
  });

  it("fills optional text fields with empty strings", () => {
    const parsed = parseSyllabusReply('{"points":[{"description":"Explain limits"}]}');
    expect(parsed).toEqual({ points: [{ code: "", module: "", topic: "", description: "Explain limits" }] });
  });

  it("adds a stricter instruction on the retry", () => {
    const first = buildSyllabusMessages("some text here for parsing", false);
    const retry = buildSyllabusMessages("some text here for parsing", true);
    expect(retry[0].content.length).toBeGreaterThan(first[0].content.length);
    expect(retry[0].content).toContain("not valid JSON");
  });
});
