import {
  closedFailure,
  runNativeNormalizationParent,
} from "./native-normalization-proof-parent.js";

// Private proof entry, never imported by API/Lambda composition. No test reporter.
process.stdout.on("error", () => {
  process.exitCode = 1;
});
function emit(value: unknown): void {
  const encoded = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(encoded) > 8192) {
    process.exitCode = 1;
    return;
  }
  process.stdout.write(encoded);
}
try {
  const result = await runNativeNormalizationParent();
  emit(result);
} catch (error) {
  process.exitCode = 1;
  emit(closedFailure(error));
}
