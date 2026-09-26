export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

/** Keys whose values never appear in audit logs. The change is still recorded, the value is not. */
const DEFAULT_REDACT = new Set([
  "email",
  "phone",
  "password",
  "token",
  "qrToken",
  "secret",
  "stripeSecret",
  "ip",
]);
export const REDACTED = "[redacted]";

function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "toHexString" in value && typeof value.toHexString === "function") {
    return (value as { toHexString(): string }).toHexString();
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
    && !("toHexString" in value);
}

const IGNORE = new Set(["_id", "__v", "updatedAt", "createdAt"]);

/**
 * Field-level diff between two plain objects (use doc.toObject()).
 * Arrays are compared as whole values. Sensitive keys are redacted.
 */
export function diffForAudit(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  redactKeys: ReadonlySet<string> = DEFAULT_REDACT,
  prefix = "",
): FieldChange[] {
  const changes: FieldChange[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  for (const key of keys) {
    if (!prefix && IGNORE.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const b = normalise(before?.[key]);
    const a = normalise(after?.[key]);

    if (isPlainObject(b) || isPlainObject(a)) {
      changes.push(
        ...diffForAudit(
          isPlainObject(b) ? b : undefined,
          isPlainObject(a) ? a : undefined,
          redactKeys,
          path,
        ),
      );
      continue;
    }

    if (JSON.stringify(b) === JSON.stringify(a)) continue;

    const redact = redactKeys.has(key);
    changes.push({
      path,
      before: redact && b !== undefined ? REDACTED : b ?? null,
      after: redact && a !== undefined ? REDACTED : a ?? null,
    });
  }
  return changes;
}
