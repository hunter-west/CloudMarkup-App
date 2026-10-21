// Closed diagnostic metadata only; never retain exception text, arguments,
// stdout, source paths or tool output from the real proof.
const stages = new Set([
  "bootstrap",
  "host-admission",
  "source-admission",
  "base-image-build",
  "base-image-identity",
  "helper-preparation",
  "helper-image-build",
  "helper-image-identity",
  "tool-pins",
  "locked-inputs",
  "dependency-acquisition",
  "builder-bindings",
  "candidate-generation",
  "request-admission",
  "child-execution",
  "observation-admission",
  "source-readback",
  "retention",
  "child-bootstrap",
  "child-host-admission",
  "child-input-admission",
  "resource-before",
  "build-1",
  "build-2",
  "reproducibility",
  "resource-after",
  "cleanup-admission",
  "observation-output",
]);
const operations = new Set(["open", "execute", "collect", "dispose"]);
const workspaceStages = new Set([
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
]);
const helperStages = new Set([
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
]);
const steps = new Set([
  "install",
  "lint",
  "typecheck",
  "unit-tests",
  "contract-tests",
  "dependency-scan",
  "secret-scan",
  "compile",
  "production-prune",
]);
const states = new Set([
  "passed",
  "failed",
  "blocked",
  "error",
  "cancelled",
  "timeout",
  "output-limit",
  "unavailable",
]);
const reasons = new Set([
  "failed",
  "timeout",
  "output-limit",
  "unavailable",
  "command-exit",
  "command-signal",
]);
const imageBuildFailures = new Set([
  "registry-access-denied",
  "manifest-resolution",
  "platform-unavailable",
  "disk-capacity",
  "dockerfile-invalid",
  "source-copy",
  "daemon-unavailable",
  "network",
  "unclassified",
]);
const imageBuildStages = new Set(["base-image-build", "helper-image-build"]);
const prefix = "memory-proof-failure:";
function checked(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return;
  if (!stages.has(value.stage) || !reasons.has(value.reason)) return;
  const keys = Object.keys(value);
  if (
    keys.some(
      (key) =>
        ![
          "stage",
          "reason",
          "operation",
          "step",
          "state",
          "imageBuildFailure",
          "exitStatus",
          "workspaceStage",
          "helperStage",
        ].includes(key),
    )
  )
    return;
  for (const [key, allowed] of [
    ["operation", operations],
    ["step", steps],
    ["state", states],
  ])
    if (Object.hasOwn(value, key) && !allowed.has(value[key])) return;
  if (
    Object.hasOwn(value, "workspaceStage") &&
    (value.operation !== "open" ||
      !["build-1", "build-2"].includes(value.stage) ||
      !workspaceStages.has(value.workspaceStage))
  )
    return;
  if (
    Object.hasOwn(value, "helperStage") &&
    (!["probe", "seed"].includes(value.workspaceStage) ||
      !helperStages.has(value.helperStage))
  )
    return;
  if (
    Object.hasOwn(value, "imageBuildFailure") &&
    (!imageBuildStages.has(value.stage) ||
      !imageBuildFailures.has(value.imageBuildFailure))
  )
    return;
  if (
    Object.hasOwn(value, "exitStatus") &&
    (!Object.hasOwn(value, "imageBuildFailure") ||
      value.reason !== "command-exit" ||
      !Number.isInteger(value.exitStatus) ||
      value.exitStatus < 1 ||
      value.exitStatus > 255)
  )
    return;
  return Object.fromEntries(
    [
      "stage",
      "reason",
      "operation",
      "step",
      "state",
      "imageBuildFailure",
      "exitStatus",
      "workspaceStage",
      "helperStage",
    ]
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, value[key]]),
  );
}
export function readMemoryProofFailure(text) {
  if (
    typeof text !== "string" ||
    text.length > 1024 ||
    !text.startsWith(prefix)
  )
    return;
  try {
    return checked(JSON.parse(text.slice(prefix.length)));
  } catch {
    return;
  }
}
class MemoryProofFailure extends Error {
  constructor(value) {
    super("Native memory proof command failed.");
    this.diagnostic = value;
  }
}
// This classification is diagnostic only. It runs solely for trusted image
// preparation before candidate generation; no captured text crosses the boundary.
export function classifyMemoryImageBuildFailure(stderr) {
  if (typeof stderr !== "string" || stderr.length > 8 * 1024 * 1024)
    return "unclassified";
  for (const [category, pattern] of [
    ["disk-capacity", /no space left on device|disk quota exceeded/iu],
    [
      "registry-access-denied",
      /pull access denied|insufficient_scope|requested access to the resource is denied/iu,
    ],
    ["platform-unavailable", /no match for platform|no matching manifest/iu],
    [
      "dockerfile-invalid",
      /dockerfile parse error|unknown instruction|unknown flag:|failed to parse dockerfile/iu,
    ],
    [
      "source-copy",
      /failed to calculate checksum|failed to compute cache key|failed to copy/iu,
    ],
    [
      "daemon-unavailable",
      /cannot connect to the docker daemon|is the docker daemon running/iu,
    ],
    [
      "network",
      /i\/o timeout|network is unreachable|no such host|connection refused|tls handshake timeout/iu,
    ],
    [
      "manifest-resolution",
      /failed to resolve source metadata|failed to resolve reference|manifest unknown|manifest not found/iu,
    ],
  ])
    if (pattern.test(stderr)) return category;
  return "unclassified";
}
export function memoryProofCommandFailure(error, proof, imageBuild = false) {
  const child = proof ? readMemoryProofFailure(error?.stderr) : undefined;
  if (
    child !== undefined &&
    !Object.hasOwn(child, "imageBuildFailure") &&
    !Object.hasOwn(child, "exitStatus")
  )
    return new MemoryProofFailure(child);
  const reason =
    error?.code === "ETIMEDOUT"
      ? "timeout"
      : error?.code === "ENOBUFS"
        ? "output-limit"
        : error?.code === "ENOENT"
          ? "unavailable"
          : Number.isInteger(error?.status)
            ? "command-exit"
            : error?.signal
              ? "command-signal"
              : "failed";
  const failure = new MemoryProofFailure({
    stage: "bootstrap",
    reason,
    ...(imageBuild && !proof
      ? {
          imageBuildFailure: classifyMemoryImageBuildFailure(error?.stderr),
          ...(reason === "command-exit" &&
          Number.isInteger(error?.status) &&
          error.status >= 1 &&
          error.status <= 255
            ? { exitStatus: error.status }
            : {}),
        }
      : {}),
  });
  failure.commandOnly = true;
  return failure;
}
export function createMemoryProofCheckpoint(initial = "bootstrap") {
  let current = { stage: initial, reason: "failed" };
  let captured;
  if (checked(current) === undefined)
    throw new TypeError("Unknown proof stage.");
  return {
    enter(stage) {
      const next = checked({ stage, reason: "failed" });
      if (next === undefined) throw new TypeError("Unknown proof stage.");
      current = next;
    },
    capture(operation, step, workspaceFailure) {
      if (
        workspaceFailure !== undefined &&
        (workspaceFailure === null ||
          typeof workspaceFailure !== "object" ||
          Object.keys(workspaceFailure).some(
            (key) => !["workspaceStage", "helperStage"].includes(key),
          ))
      )
        throw new TypeError("Unknown workspace failure metadata.");
      const next = checked({
        ...current,
        operation,
        ...(step === undefined ? {} : { step }),
        ...workspaceFailure,
      });
      if (next === undefined) throw new TypeError("Unknown proof operation.");
      captured ??= next;
    },
    result(state, step) {
      if (step !== undefined && !steps.has(step))
        throw new TypeError("Unknown proof step.");
      if (!states.has(state)) throw new TypeError("Unknown proof state.");
      current = { ...current, state, ...(step === undefined ? {} : { step }) };
    },
    failure(error) {
      if (error instanceof MemoryProofFailure && !error.commandOnly)
        return error;
      const reason =
        error instanceof MemoryProofFailure
          ? error.diagnostic.reason
          : "failed";
      const imageDetails =
        error instanceof MemoryProofFailure &&
        error.commandOnly &&
        Object.hasOwn(error.diagnostic, "imageBuildFailure")
          ? {
              imageBuildFailure: error.diagnostic.imageBuildFailure,
              ...(Object.hasOwn(error.diagnostic, "exitStatus")
                ? { exitStatus: error.diagnostic.exitStatus }
                : {}),
            }
          : {};
      return new MemoryProofFailure({
        ...(captured ?? current),
        reason,
        ...imageDetails,
      });
    },
  };
}
export function encodeMemoryProofFailure(error) {
  const value =
    error instanceof MemoryProofFailure ? checked(error.diagnostic) : undefined;
  return (
    prefix +
    JSON.stringify(value ?? { stage: "bootstrap", reason: "failed" }) +
    "\n"
  );
}
