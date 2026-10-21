import {
  runtimeExportCapabilitiesV1Schema,
  type RuntimeExportCapabilitiesV1,
} from "@cloudmarkup/api-contract";

export type ExportCapabilitiesLoader = (
  signal: AbortSignal,
) => Promise<RuntimeExportCapabilitiesV1>;
const MAXIMUM_CONFIG_BYTES = 1_024;

export function createExportCapabilitiesLoader(
  fetchImplementation: typeof fetch = fetch,
): ExportCapabilitiesLoader {
  return async (signal) => {
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
    const response = await fetchImplementation(
      "/api/runtime-config?view=exports",
      {
        cache: "no-store",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        headers: { accept: "application/json" },
        signal: boundedSignal,
      },
    );
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
      throw new Error("Export availability could not be checked.");
    }
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      (!/^\d+$/u.test(declaredLength) ||
        Number(declaredLength) > MAXIMUM_CONFIG_BYTES)
    ) {
      await response.body.cancel();
      throw new Error("Export availability response is too large.");
    }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(MAXIMUM_CONFIG_BYTES);
    let length = 0;
    try {
      let next = await reader.read();
      while (!next.done) {
        if (length + next.value.byteLength > MAXIMUM_CONFIG_BYTES) {
          await reader.cancel();
          throw new Error("Export availability response is too large.");
        }
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
    return runtimeExportCapabilitiesV1Schema.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, length),
        ),
      ),
    );
  };
}
