// Synthetic evaluation input. The caller supplies the storage implementation.
// No tenant identity, persistence technology, or ownership policy is specified.
export async function handle(
  input: { key: string; value: unknown },
  store: { put(key: string, value: unknown): Promise<void> },
): Promise<{ accepted: true }> {
  await store.put(input.key, input.value);
  return { accepted: true };
}
