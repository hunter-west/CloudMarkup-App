import { createHash } from "node:crypto";
import { RepositoryError } from "./persistence.js";

export interface ListPosition {
  readonly id: string;
  readonly value: string;
}

export interface RevisionListSelection {
  readonly after?: ListPosition;
  readonly direction: "ASC" | "DESC";
  readonly extraRow?: boolean;
}

function invalid(): never {
  throw new RepositoryError(
    "invalid-input",
    "The list cursor is invalid for this request.",
  );
}

export function listBinding(parts: readonly (string | null)[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function assertListPosition(
  position: ListPosition,
  timestamp = false,
): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(position.id) ||
    position.value.length === 0 ||
    position.value.length > 120 ||
    (timestamp &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(position.value) ||
        !Number.isFinite(Date.parse(position.value))))
  )
    invalid();
}

/** A bounded continuation, not authority. Raw length framing preserves names
 * without JSON escaping expansion; every page still requires current access. */
export function encodeListCursor(
  binding: string,
  position: ListPosition,
): string {
  assertListPosition(position);
  return `1:${binding}:${String(position.id.length)}:${position.id}${position.value}`;
}

export function decodeListCursor(
  cursor: string | undefined,
  binding: string,
  timestamp = false,
): ListPosition | undefined {
  if (cursor === undefined) return undefined;
  const prefix = `1:${binding}:`;
  if (cursor.length > 512 || !cursor.startsWith(prefix)) return invalid();
  const tail = cursor.slice(prefix.length);
  const separator = tail.indexOf(":");
  const lengthText = tail.slice(0, separator);
  const length = Number(lengthText);
  if (!/^[1-9][0-9]{0,2}$/u.test(lengthText) || length > 128) return invalid();
  const body = tail.slice(separator + 1);
  const position = { id: body.slice(0, length), value: body.slice(length) };
  assertListPosition(position, timestamp);
  return position;
}

export function revisionListDirection(
  sort: string | undefined,
): "ASC" | "DESC" {
  if (sort !== undefined && sort !== "createdAt" && sort !== "-createdAt")
    return invalid();
  return sort === "createdAt" ? "ASC" : "DESC";
}
