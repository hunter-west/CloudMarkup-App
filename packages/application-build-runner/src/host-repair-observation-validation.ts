import type { z } from "zod";
import type {
  ApplicationBuildStepSummaryV1,
  ApplicationBuildTestSummaryV1,
  ApplicationBuildDiagnosticV1,
  ApplicationBuildFindingV1,
} from "./contracts.js";
import { canonicalJson, sha256Digest } from "./security.js";
export const HOST_REPAIR_SEED_STEPS = [
  ["install", "pnpm"],
  ["lint", "eslint"],
  ["typecheck", "tsc"],
  ["unit-tests", "vitest"],
  ["contract-tests", "vitest"],
  ["dependency-scan", "trivy"],
  ["secret-scan", "trivy"],
  ["compile", "tsc"],
  ["production-prune", "pnpm"],
] as const;

interface ArtifactBytes {
  readonly bytesBase64: string;
  readonly sizeBytes: number;
  readonly checksum: string;
}
interface Observation {
  readonly reportDigest: string;
  readonly state: string;
  readonly bindings: unknown;
  readonly artifacts: readonly {
    readonly path: string;
    readonly bindings: unknown;
    readonly mediaType: string;
    readonly checksum: string;
  }[];
  readonly steps: readonly ApplicationBuildStepSummaryV1[];
  readonly tests: readonly ApplicationBuildTestSummaryV1[];
  readonly cleanup: string;
  readonly diagnostics: readonly ApplicationBuildDiagnosticV1[];
  readonly findings: readonly ApplicationBuildFindingV1[];
  readonly reproducibility:
    | { readonly state: "not-established" }
    | {
        readonly state: "verified";
        readonly firstArchiveChecksum: string;
        readonly secondArchiveChecksum: string;
      };
}
export function validateHostRepairArtifact(
  value: ArtifactBytes,
  context: z.RefinementCtx,
) {
  const bytes = Buffer.from(value.bytesBase64, "base64");
  if (
    bytes.toString("base64") !== value.bytesBase64 ||
    bytes.byteLength !== value.sizeBytes ||
    sha256Digest(bytes) !== value.checksum
  ) {
    context.addIssue({
      code: "custom",
      message: "Host artifact bytes, size and checksum must match.",
    });
  }
}
export function validateHostRepairObservation(
  value: Observation,
  context: z.RefinementCtx,
) {
  const reject = () => {
    context.addIssue({
      code: "custom",
      message:
        "The exact host observation and terminal commitments are required.",
    });
  };
  const { reportDigest, ...body } = value;
  if (sha256Digest(canonicalJson(body)) !== reportDigest) reject();
  if (
    new Set(
      value.artifacts.map((file) => file.path.normalize("NFC").toLowerCase()),
    ).size !== value.artifacts.length
  )
    reject();
  if (new Set(value.tests.map((test) => test.kind)).size !== value.tests.length)
    reject();
  let stopped = false;
  for (const [index, step] of value.steps.entries()) {
    const expected = HOST_REPAIR_SEED_STEPS[index];
    if (
      step.step !== expected?.[0] ||
      step.executable !== expected[1] ||
      (stopped && step.state !== "skipped")
    )
      reject();
    if (step.state !== "passed") stopped = true;
  }
  for (const artifact of value.artifacts) {
    if (canonicalJson(artifact.bindings) !== canonicalJson(value.bindings))
      reject();
  }
  if (value.state === "passed") {
    if (
      value.cleanup !== "verified" ||
      stopped ||
      value.steps.length !== 9 ||
      value.tests.length !== 2 ||
      value.artifacts.length !== 3
    )
      reject();
    const archive = value.artifacts.filter(
      (file) => file.mediaType === "application/zip",
    );
    if (
      value.reproducibility.state !== "verified" ||
      archive.length !== 1 ||
      value.reproducibility.firstArchiveChecksum !== archive[0]?.checksum ||
      value.reproducibility.secondArchiveChecksum !== archive[0].checksum
    )
      reject();
    if (
      value.tests.some(
        (test) =>
          test.state !== "passed" ||
          test.passed < 1 ||
          test.failed !== 0 ||
          test.skipped !== 0,
      )
    )
      reject();
    if (
      value.diagnostics.some((item) => item.severity === "error") ||
      value.findings.some(
        (item) =>
          ["critical", "high", "unknown"].includes(item.severity) ||
          item.source === "secret",
      )
    )
      reject();
  } else if (value.artifacts.length !== 0) reject();
}

export function validateHostRepairManifest(
  value: {
    readonly manifestDigest: string;
    readonly files: readonly { readonly path: string }[];
    readonly archive: { readonly entrypoint: string };
  },
  context: z.RefinementCtx,
) {
  const { manifestDigest, ...body } = value;

  const paths = body.files.map((file) => file.path);
  if (
    manifestDigest !== sha256Digest(canonicalJson(body)) ||
    new Set(paths.map((path) => path.normalize("NFC").toLowerCase())).size !==
      paths.length ||
    !paths.some((path) => path === body.archive.entrypoint) ||
    paths.some((path, index) => index > 0 && path <= (paths[index - 1] ?? ""))
  ) {
    context.addIssue({
      code: "custom",
      message:
        "The exact sorted host artifact inventory and digest are required.",
    });
  }
}
