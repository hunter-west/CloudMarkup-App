import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  serializeCanonicalJson,
  sha256DigestSchema,
  solutionRevisionIdSchema,
} from "@cloudmarkup/schemas";
import {
  SOLUTION_EXPORT_MANIFEST_PATH,
  canonicalSemanticDigest,
  decodeUtf8,
  sha256Digest,
  solutionExportManifestV1Schema,
} from "@cloudmarkup/solution-export";
import { z } from "zod";

import {
  continuousConformanceInputDocumentV1Schema,
  type ContinuousConformanceInputScopeV1,
  type ContinuousConformanceInputSourceV1,
} from "../application/continuous-conformance-composition.js";

export const LOCAL_CONFORMANCE_INPUT_PATH =
  "cloudmarkup/conformance/input.json" as const;

const exactRevisionSchema = z
  .object({ digest: sha256DigestSchema, id: solutionRevisionIdSchema })
  .strict();
const compositionRevisionBindingsSchema = z
  .object({
    evaluatedSolutionRevision: exactRevisionSchema,
    layers: z
      .array(
        z
          .object({
            availability: z.enum(["available", "unavailable"]),
            boundSolutionRevision: exactRevisionSchema.optional(),
          })
          .loose(),
      )
      .length(6),
  })
  .loose();

function sameRevision(
  left: { readonly digest: string; readonly id: string },
  right: { readonly digest: string; readonly id: string },
): boolean {
  return left.id === right.id && left.digest === right.digest;
}

export function downgradeSelfAttestedEvaluation(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }
  const sanitized: Record<string, unknown> = { ...input };
  delete sanitized["currentSolutionRevision"];
  delete sanitized["evaluatedAt"];
  delete sanitized["evaluator"];
  delete sanitized["stalenessPolicy"];
  if (!Array.isArray(sanitized["layers"])) return sanitized;
  const layers = sanitized["layers"] as readonly unknown[];
  sanitized["layers"] = layers.map((layer): unknown => {
    if (typeof layer !== "object" || layer === null || Array.isArray(layer)) {
      return layer;
    }
    const identity = layer as Record<string, unknown>;
    return {
      availability: "unavailable",
      completeness: "unknown",
      declaredFreshness: "current",
      evidenceIds: [],
      ...(identity["layer"] === "planned" ||
      identity["layer"] === "deployed" ||
      identity["layer"] === "current-drift"
        ? { environmentId: identity["environmentId"] }
        : {}),
      evidenceType: identity["evidenceType"],
      facts: [],
      integrity: "unknown",
      layer: identity["layer"],
      sources: [],
    };
  });
  return sanitized;
}
function assertInside(root: string, target: string): void {
  const path = relative(root, target);
  if (
    path === "" ||
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path)
  ) {
    throw new Error("The local conformance path escapes its repository root.");
  }
}

async function readRegularFile(
  root: string,
  path: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  const target = resolve(root, ...path.split("/"));
  assertInside(root, target);
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("A local conformance source is not a regular file.");
  }
  const canonicalTarget = await realpath(target);
  assertInside(root, canonicalTarget);
  const bytes = await readFile(canonicalTarget);
  if (bytes.byteLength > maximumBytes) {
    throw new Error("A local conformance source exceeds its byte limit.");
  }
  return bytes;
}

/** One explicitly configured local repository belongs to exactly one tenant. */
export class VerifiedManifestDeclaredLocalConformanceInputSource implements ContinuousConformanceInputSourceV1 {
  readonly #organizationId: string;
  readonly #root: string;

  constructor(options: {
    readonly organizationId: string;
    readonly root: string;
  }) {
    this.#organizationId = options.organizationId;
    this.#root = options.root;
  }

  async get(input: ContinuousConformanceInputScopeV1): Promise<unknown> {
    if (input.organizationId !== this.#organizationId) return null;
    const root = await realpath(resolve(this.#root));
    const manifestBytes = await readRegularFile(
      root,
      SOLUTION_EXPORT_MANIFEST_PATH,
      8 * 1024 * 1024,
    );
    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(decodeUtf8(manifestBytes)) as unknown;
    } catch {
      throw new Error("The local Solution Export manifest is invalid.");
    }
    const manifest = solutionExportManifestV1Schema.parse(manifestJson);
    if (decodeUtf8(manifestBytes) !== serializeCanonicalJson(manifest)) {
      throw new Error(
        "The local Solution Export manifest is not canonical JSON.",
      );
    }
    if (manifest.solutionRevision.id !== input.solutionRevisionId) return null;
    const entry = manifest.files.find(
      ({ path }) => path === LOCAL_CONFORMANCE_INPUT_PATH,
    );
    if (entry === undefined) return null;
    if (
      entry.mediaType !== "application/json" ||
      entry.ownership !== "evidence-artifact"
    ) {
      throw new Error(
        "The local conformance input is not declared as JSON Evidence.",
      );
    }
    const bytes = await readRegularFile(
      root,
      LOCAL_CONFORMANCE_INPUT_PATH,
      32 * 1024 * 1024,
    );
    if (
      bytes.byteLength !== entry.sizeBytes ||
      sha256Digest(bytes) !== entry.checksum ||
      canonicalSemanticDigest(entry.mediaType, bytes) !== entry.semanticChecksum
    ) {
      throw new Error(
        "The local conformance input does not match its manifest declaration.",
      );
    }
    let untrusted: unknown;
    try {
      untrusted = JSON.parse(decodeUtf8(bytes)) as unknown;
    } catch {
      throw new Error("The local conformance input is invalid JSON.");
    }
    const document =
      continuousConformanceInputDocumentV1Schema.parse(untrusted);
    const bindings = compositionRevisionBindingsSchema.parse(
      document.evaluation,
    );
    if (
      !sameRevision(
        bindings.evaluatedSolutionRevision,
        manifest.solutionRevision,
      ) ||
      bindings.layers.some(
        (layer) =>
          layer.availability === "available" &&
          (layer.boundSolutionRevision === undefined ||
            !sameRevision(
              layer.boundSolutionRevision,
              manifest.solutionRevision,
            )),
      )
    ) {
      throw new Error(
        "The local conformance input does not exactly bind the manifest Solution Revision.",
      );
    }
    if (decodeUtf8(bytes) !== serializeCanonicalJson(document)) {
      throw new Error("The local conformance input is not canonical JSON.");
    }
    // A repository manifest proves exact bytes, not the authenticity of cloud
    // plan, deployment, or drift Evidence. Local filesystem composition stays
    // fail-closed until an independently authorized ingestion adapter admits
    // source records for those layers.
    return {
      ...document,
      evaluation: downgradeSelfAttestedEvaluation(document.evaluation),
    };
  }
}
