// Closed diagnostic metadata only. These codes never authorize execution.
export const memoryWorkspaceOpenStages = [
  "engine",
  "image",
  "workspace-volume",
  "cache-volume",
  "holder-create",
  "holder-start",
  "probe",
  "seed",
  "seed-authority",
  "cleanup",
] as const;
export const memoryWorkspaceHelperStages = [
  "input",
  "identity",
  "kernel",
  "swap",
  "core",
  "workspace-mount",
  "cache-mount",
  "temporary-mount",
  "root-ownership",
  "helper-path",
  "helper-file",
  "operation",
  "output",
] as const;
export type MemoryWorkspaceOpenStage =
  (typeof memoryWorkspaceOpenStages)[number];
export type MemoryWorkspaceHelperStage =
  (typeof memoryWorkspaceHelperStages)[number];
export interface MemoryApplicationBuildFailure {
  readonly workspaceStage?: MemoryWorkspaceOpenStage;
  readonly helperStage?: MemoryWorkspaceHelperStage;
}
const failures = new WeakMap<object, Readonly<MemoryApplicationBuildFailure>>();
const prefix = "memory-workspace-failure:";
export function parseMemoryWorkspaceHelperFailure(
  text: string,
): MemoryWorkspaceHelperStage | undefined {
  for (const stage of memoryWorkspaceHelperStages)
    if (text === prefix + stage + "\n") return stage;
  return undefined;
}
export function encodeMemoryWorkspaceHelperFailure(
  stage: MemoryWorkspaceHelperStage,
): string {
  return prefix + stage + "\n";
}
/** Keep the existing exception and cleanup behavior; never retain its payload. */
export function recordMemoryApplicationBuildFailure(
  error: unknown,
  diagnostic: MemoryApplicationBuildFailure,
): void {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  )
    return;
  failures.set(error, Object.freeze({ ...failures.get(error), ...diagnostic }));
}
/** Only locally recorded metadata is exposed, never an error's own properties. */
export function readMemoryApplicationBuildFailure(
  error: unknown,
): Readonly<MemoryApplicationBuildFailure> | undefined {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  )
    return undefined;
  return failures.get(error);
}
