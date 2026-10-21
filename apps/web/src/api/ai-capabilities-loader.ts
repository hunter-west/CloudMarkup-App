import {
  runtimeAiCapabilitiesV1Schema,
  UNAVAILABLE_RUNTIME_AI_CAPABILITIES_V1,
  type RuntimeAiCapabilitiesV1,
} from "@cloudmarkup/api-contract";

export type AiCapabilitiesLoader = (
  signal: AbortSignal,
) => Promise<RuntimeAiCapabilitiesV1>;

export function createAiCapabilitiesLoader(
  fetchImplementation: typeof fetch = fetch,
): AiCapabilitiesLoader {
  return async (signal) => {
    const response = await fetchImplementation("/api/runtime-config?view=ai", {
      cache: "no-store",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    });
    // Older API releases have no AI view. They cannot admit the new context.
    // Never probe support by submitting a paid request or silently downgrade it.
    if (!response.redirected && [400, 404].includes(response.status)) {
      await response.body?.cancel();
      return UNAVAILABLE_RUNTIME_AI_CAPABILITIES_V1;
    }
    if (
      response.status !== 200 ||
      response.redirected ||
      response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json" ||
      response.body === null
    ) {
      await response.body?.cancel();
      throw new Error("AI availability could not be checked.");
    }
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > 1_024)
    ) {
      await response.body.cancel();
      throw new Error("AI availability response is too large.");
    }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(1_024);
    let length = 0;
    try {
      let next = await reader.read();
      while (!next.done) {
        if (length + next.value.byteLength > bytes.length)
          throw new Error("AI availability response is too large.");
        bytes.set(next.value, length);
        length += next.value.byteLength;
        next = await reader.read();
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    return runtimeAiCapabilitiesV1Schema.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, length),
        ),
      ),
    );
  };
}
