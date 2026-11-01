import { Hono } from "hono";
import { AppError } from "../errors";
import { aiSettingsSchema, getAiSettingsView, saveAiSettings, deleteAiSettings } from "../ai-settings";
import type { Env, AppVariables } from "../env";

type Ctx = { Bindings: Env; Variables: AppVariables };
export const aiSettings = new Hono<Ctx>();

// Returns whether the user has a key saved, the model, and the last four characters of the key. Never the key.
aiSettings.get("/", async (c) => {
  return c.json(await getAiSettingsView(c.env, c.get("userId")));
});

aiSettings.put("/", async (c) => {
  const parsed = aiSettingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", parsed.error.issues[0].message);
  await saveAiSettings(c.env, c.get("userId"), parsed.data);
  return c.json(await getAiSettingsView(c.env, c.get("userId")));
});

aiSettings.delete("/", async (c) => {
  await deleteAiSettings(c.env, c.get("userId"));
  return c.json({ ok: true });
});
