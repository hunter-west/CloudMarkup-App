import { createHash } from "node:crypto";
import {
  solutionExportArtifactV1Schema,
  type SolutionExportArtifactFileV1,
  type SolutionExportArtifactV1,
} from "@cloudmarkup/api-contract";
import {
  serializeCanonicalJson,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { ApplicationError } from "./errors.js";
import type { StoredSolutionExportArtifact } from "./solution-exports.js";

const FILE_PREVIEW_BYTES = 256 * 1_024;

export function notFound(): ApplicationError {
  return new ApplicationError(
    "not_found",
    "The requested resource is unavailable.",
  );
}

export function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
export function canonicalDigest(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256")
    .update(serializeCanonicalJson(value))
    .digest("hex")}` as Sha256Digest;
}
export function byteDigest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function publicId(prefix: string, fingerprint: string): string {
  return `${prefix}_${fingerprint.slice("sha256:".length, 38)}`;
}

export function expiredAvailability(
  availability: SolutionExportArtifactV1["downloadAvailability"],
  now: Date,
): SolutionExportArtifactV1["downloadAvailability"] {
  if (
    availability.state === "available" &&
    Date.parse(availability.expiresAt) <= now.getTime()
  ) {
    return { expiredAt: availability.expiresAt, state: "expired" };
  }
  return availability;
}

export function artifactAt(
  record: StoredSolutionExportArtifact,
  now: Date,
): SolutionExportArtifactV1 {
  return solutionExportArtifactV1Schema.parse({
    ...record.artifact,
    downloadAvailability: expiredAvailability(
      record.artifact.downloadAvailability,
      now,
    ),
  });
}

export function fileSnapshot(file: SolutionExportArtifactFileV1) {
  const { id: _id, previewAvailable: _previewAvailable, ...snapshot } = file;
  void _id;
  void _previewAvailable;
  return snapshot;
}

export function previewUtf8(bytes: Uint8Array): {
  content: string;
  truncated: boolean;
} {
  const truncated = bytes.byteLength > FILE_PREVIEW_BYTES;
  const candidate = truncated ? bytes.slice(0, FILE_PREVIEW_BYTES) : bytes;
  for (let trim = 0; trim <= 4; trim += 1) {
    try {
      return {
        content: new TextDecoder("utf-8", { fatal: true }).decode(
          candidate.slice(0, candidate.byteLength - trim),
        ),
        truncated,
      };
    } catch {
      // A bounded trim can remove a partial final UTF-8 code point.
    }
  }
  throw new ApplicationError(
    "internal_error",
    "The service could not complete the request.",
  );
}
