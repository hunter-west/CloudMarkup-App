import { versionedToolReferenceV1Schema } from "@cloudmarkup/schemas";

export const ARCHITECTURE_CLI_CONFORMANCE_EVALUATOR_V1 =
  versionedToolReferenceV1Schema.parse({
    id: "cloudmarkup.continuous-conformance",
    version: "1.0.0",
  });

/**
 * A repository manifest proves bytes, not cloud Evidence authenticity. The
 * shipped local CLI therefore preserves only layer identity and reports every
 * preprojected local layer as unavailable. Trusted CI/API ingestion adapters
 * can use the production composer with admitted source records instead.
 */
export function downgradeManifestConformanceEvaluationV1(
  input: unknown,
): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }
  const sanitized: Record<string, unknown> = { ...input };
  delete sanitized["currentSolutionRevision"];
  delete sanitized["evaluatedAt"];
  delete sanitized["evaluator"];
  delete sanitized["stalenessPolicy"];
  if (!Array.isArray(sanitized["layers"])) return sanitized;
  sanitized["layers"] = sanitized["layers"].map((layer: unknown) => {
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
