import { z } from "zod";

const explicitTimestamp = z.iso.datetime({ offset: true });
const dataApiUtcTimestamp =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/u;

/** Only for known timestamptz columns. The Data API database session is UTC.
 * Arbitrary strings and JSON content must never pass through this parser. */
export function parseDatabaseTimestamp(value: unknown): string | undefined {
  const raw =
    value instanceof Date && Number.isFinite(value.getTime())
      ? value.toISOString()
      : value;
  const normalized =
    typeof raw === "string" && dataApiUtcTimestamp.test(raw)
      ? raw.replace(" ", "T") + "Z"
      : raw;
  const parsed = explicitTimestamp.safeParse(normalized);
  return parsed.success ? new Date(parsed.data).toISOString() : undefined;
}
