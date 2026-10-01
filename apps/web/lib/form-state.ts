import { ZodError } from "zod";

/**
 * What a form's server action returns (1 Oct 2026). `fields` maps a form field's `name` to its error message, so
 * the form can highlight that field and show the message under it; `error` is the summary shown above the button.
 */
export type FormState = { ok?: string; error?: string; fields?: Record<string, string> } | null;

/**
 * Zod issues → field errors. `rename` maps a Zod path (e.g. "venue.name") to the form field's name ("venueName").
 * The summary is the first message.
 */
export function zodFailure(e: ZodError, rename: Record<string, string> = {}): FormState {
  const fields: Record<string, string> = {};
  for (const issue of e.issues) {
    const path = issue.path.map(String).join(".");
    const name = rename[path] ?? rename[String(issue.path[0] ?? "")] ?? String(issue.path[0] ?? "");
    if (name && !fields[name]) fields[name] = issue.message;
  }
  return { error: e.issues[0]?.message ?? "Check the highlighted fields.", fields };
}

/** One field is wrong (e.g. "That email already has an account"). */
export const fieldFailure = (field: string, message: string): FormState => ({ error: message, fields: { [field]: message } });
