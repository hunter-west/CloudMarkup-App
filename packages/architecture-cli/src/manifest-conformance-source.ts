import { composeConformanceReportV1 } from "@cloudmarkup/domain";
import {
  defaultConformanceStalenessPolicyV1,
  serializeCanonicalJson,
  sha256DigestSchema,
  solutionRevisionIdSchema,
} from "@cloudmarkup/schemas";
import { decodeUtf8 } from "@cloudmarkup/solution-export";
import { z } from "zod";

import type { ArchitectureCliConformancePortV1 } from "./conformance.js";
import { loadArchitectureRepository } from "./repository.js";
import {
  ARCHITECTURE_CLI_CONFORMANCE_EVALUATOR_V1,
  downgradeManifestConformanceEvaluationV1,
} from "./manifest-conformance-sanitizer.js";

export const ARCHITECTURE_CLI_CONFORMANCE_INPUT_PATH =
  "cloudmarkup/conformance/input.json" as const;

const manifestConformanceInputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evaluation: z.unknown(),
    kind: z.literal("cloudmarkup.continuous-conformance-input"),
  })
  .strict();

function parseCanonicalInput(
  bytes: Uint8Array,
): z.output<typeof manifestConformanceInputV1Schema> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeUtf8(bytes)) as unknown;
  } catch {
    throw new Error("The manifest-declared conformance input is invalid.");
  }
  const parsed = manifestConformanceInputV1Schema.parse(decoded);
  if (decodeUtf8(bytes) !== serializeCanonicalJson(parsed)) {
    throw new Error(
      "The manifest-declared conformance input must use canonical JSON bytes.",
    );
  }
  return parsed;
}

/**
 * Reads only the checksum-verified file inventory already declared by the
 * repository Solution Export manifest. It never discovers plugins, executes
 * workflows, accesses credentials, or contacts a provider.
 */
export function createManifestDeclaredConformancePortV1(options?: {
  readonly clock?: () => Date;
}): ArchitectureCliConformancePortV1 {
  const clock = options?.clock ?? (() => new Date());
  return {
    async read(input) {
      if (input.signal.aborted) {
        throw new Error("The conformance read was aborted.");
      }
      const repository = await loadArchitectureRepository(input.root);
      const file = repository.files.get(
        ARCHITECTURE_CLI_CONFORMANCE_INPUT_PATH,
      );
      if (file === undefined) return null;
      if (
        file.mediaType !== "application/json" ||
        file.ownership !== "evidence-artifact"
      ) {
        throw new Error(
          "The conformance input must be a manifest-declared Evidence artifact.",
        );
      }
      if (
        repository.lock.solutionRevision.id !== input.solutionRevision.id ||
        repository.lock.solutionRevision.digest !==
          input.solutionRevision.digest
      ) {
        throw new Error(
          "The conformance input repository does not bind the requested Solution Revision.",
        );
      }
      const document = parseCanonicalInput(file.bytes);
      const composition = composeConformanceReportV1({
        clock,
        currentSolutionRevision: {
          digest: sha256DigestSchema.parse(input.solutionRevision.digest),
          id: solutionRevisionIdSchema.parse(input.solutionRevision.id),
        },
        evaluation: downgradeManifestConformanceEvaluationV1(
          document.evaluation,
        ),
        evaluator: ARCHITECTURE_CLI_CONFORMANCE_EVALUATOR_V1,
        stalenessPolicy: defaultConformanceStalenessPolicyV1,
      });
      if (
        composition.report.environment.environmentId !== input.environmentId
      ) {
        return null;
      }
      return composition.report;
    },
  };
}
