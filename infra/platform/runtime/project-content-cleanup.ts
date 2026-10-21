import { handler as cleanup } from "@cloudmarkup/api/project-cleanup";

/** Log only a bounded outcome so pending erasure has an operational signal. */
export async function handler(event: unknown) {
  const result = await cleanup(event);
  if (result.enabled && result.pending > 0) {
    console.warn(
      JSON.stringify({ component: "project-cleanup", outcome: "pending" }),
    );
  }
  return result;
}
