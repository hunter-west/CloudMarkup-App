import {
  applicationBuildResultV1Schema,
  type ApplicationBuildResultV1,
} from "@cloudmarkup/application-build-runner";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";

import {
  solutionExportSupplementalFileV1Schema,
  type SolutionExportSupplementalFileV1,
} from "./contracts.js";
import {
  canonicalSemanticDigest,
  encodeUtf8,
  sha256Digest,
} from "./security.js";

/** Convert a verified application-build result into data-only export files. */
export function applicationBuildSupplementalFiles(
  raw: ApplicationBuildResultV1,
): readonly SolutionExportSupplementalFileV1[] {
  const result = applicationBuildResultV1Schema.parse(raw);
  const { reportDigest, ...projection } = result;
  if (sha256Digest(serializeCanonicalJson(projection)) !== reportDigest) {
    throw new TypeError("Application build report digest does not match.");
  }
  if (result.state !== "passed") {
    throw new TypeError(
      "Only a passing application build may contribute deployable export files.",
    );
  }
  const actor = result.evidence.provenance.actor;
  if (actor.kind !== "deterministic-tool" || actor.tool.digest === undefined) {
    throw new TypeError(
      "Application build Evidence requires an exact deterministic builder pin.",
    );
  }
  const references = [
    { id: result.coverage.workloadId, kind: "workload" as const },
    { id: result.evidence.id, kind: "evidence" as const },
  ];
  const files = result.artifacts.map((artifact) =>
    solutionExportSupplementalFileV1Schema.parse({
      checksum: artifact.checksum,
      content: { encoding: "base64", value: artifact.bytesBase64 },
      kind: "regular-file",
      mediaType: artifact.mediaType,
      ownership: "generated-build-artifact",
      path: artifact.path,
      provenance: {
        producer: actor.tool,
        solutionRevisionId: result.evidence.solutionRevisionId,
        sourceReferences: references,
      },
      semanticChecksum: artifact.checksum,
    }),
  );
  const evidenceText = serializeCanonicalJson(result.evidence);
  const evidenceBytes = encodeUtf8(evidenceText);
  const artifactPath = result.artifacts.find(
    ({ mediaType }) => mediaType === "application/zip",
  )?.path;
  if (artifactPath === undefined) {
    throw new TypeError("Passing build result is missing its Lambda ZIP.");
  }
  const evidencePath = artifactPath
    .replace("application/artifacts/", "application/evidence/")
    .replace(/\/function\.zip$/u, "/application-build-evidence.json");
  files.push(
    solutionExportSupplementalFileV1Schema.parse({
      checksum: sha256Digest(evidenceBytes),
      content: { encoding: "utf8", value: evidenceText },
      kind: "regular-file",
      mediaType: "application/json",
      ownership: "evidence-artifact",
      path: evidencePath,
      provenance: {
        producer: actor.tool,
        solutionRevisionId: result.evidence.solutionRevisionId,
        sourceReferences: references,
      },
      semanticChecksum: canonicalSemanticDigest(
        "application/json",
        evidenceBytes,
      ),
    }),
  );
  return files;
}
