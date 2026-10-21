/** A missing retained field is a hold, never fabricated authority. */
export function cleanupRequired<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null)
    throw Error("Retained cleanup field is missing.");
  return value;
}
