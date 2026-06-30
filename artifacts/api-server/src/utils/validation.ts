import { ZodError } from "zod/v4";

type ZodIssueLike = ZodError["issues"][number];

export type FieldMessage = string | ((issue: ZodIssueLike) => string);

export interface FormatZodErrorOptions {
  /**
   * Map of field path (dot-joined, e.g. "name" or "address.city") to a
   * human-readable message (or a function that builds one from the issue).
   */
  fields?: Record<string, FieldMessage>;
  /**
   * Preferred order for choosing the single primary message to surface. The
   * first field in this list that has an issue wins. Fields not listed are
   * considered after, in issue order.
   */
  order?: string[];
  /** Fallback when no field-specific message matches. */
  fallback?: string;
}

const DEFAULT_FALLBACK =
  "Some of the information provided is invalid. Please review your input and try again.";

/**
 * Reusable formatter that turns raw Zod issues into a single, human-readable,
 * actionable validation message. Never exposes raw Zod text (e.g. "Required",
 * "Invalid input") or the raw issues array to the client.
 *
 * Pass a `fields` map of friendly messages keyed by field path; optionally pass
 * `order` to control which field's message is surfaced first when several fail.
 */
export function formatZodError(
  err: ZodError,
  options: FormatZodErrorOptions = {},
): string {
  const { fields = {}, order, fallback = DEFAULT_FALLBACK } = options;
  const issues = err.issues ?? [];
  if (issues.length === 0) return fallback;

  const messageFor = (issue: ZodIssueLike): string | null => {
    const path = issue.path.join(".");
    const mapped = fields[path];
    if (mapped === undefined) return null;
    return typeof mapped === "function" ? mapped(issue) : mapped;
  };

  if (order && order.length > 0) {
    for (const field of order) {
      const issue = issues.find((i) => i.path.join(".") === field);
      if (issue) {
        const msg = messageFor(issue);
        if (msg) return msg;
      }
    }
  }

  for (const issue of issues) {
    const msg = messageFor(issue);
    if (msg) return msg;
  }

  return fallback;
}
