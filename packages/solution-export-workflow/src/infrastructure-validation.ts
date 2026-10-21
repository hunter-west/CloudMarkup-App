import {
  evidenceRecordV1Schema,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  serializeCanonicalJson,
  sha256DigestSchema,
  type EvidenceRecordV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  encodeUtf8,
  sha256Digest,
  type SolutionExportInfrastructureArtifactV1,
} from "@cloudmarkup/solution-export";
import { z } from "zod";

import type {
  SolutionExportCloudFormationWorkflowStageDescriptorsV1,
  SolutionExportWorkflowRequestV1,
} from "./contracts.js";

const CLOUDFORMATION_LOCAL_VALIDATION = "cloudmarkup-structured-template-v1";
const CLOUDFORMATION_TEMPLATE_MEDIA_TYPE =
  "application/vnd.amazon.cloudformation.template+json";
const CLOUDFORMATION_TEMPLATE_VERSION = "2010-09-09";

const exactToolPinV1Schema = z
  .object({
    digest: sha256DigestSchema,
    id: namespacedIdentifierSchema,
    version: semanticVersionSchema,
  })
  .strict();

const cloudFormationValidationProjectionV1Schema = z
  .object({
    diagnostics: z.array(z.never()).max(0),
    target: z.literal("cloudformation"),
    validation: z
      .object({
        artifactDigest: sha256DigestSchema,
        localValidation: z.literal(CLOUDFORMATION_LOCAL_VALIDATION),
        resourceCount: z.number().int().nonnegative().max(10_000),
        templateChecksum: sha256DigestSchema,
        templatePath: z.string().min(1).max(512),
        templateSpecificationVersion: z.literal(
          CLOUDFORMATION_TEMPLATE_VERSION,
        ),
        validator: exactToolPinV1Schema,
      })
      .strict(),
  })
  .strict();

export const cloudFormationValidationResultV1Schema = z
  .object({
    contractVersion: z.literal(1),
    diagnostics: cloudFormationValidationProjectionV1Schema.shape.diagnostics,
    evidenceRecords: z.array(evidenceRecordV1Schema).length(1),
    reportDigest: sha256DigestSchema,
    state: z.literal("passed"),
    target: z.literal("cloudformation"),
    validation: cloudFormationValidationProjectionV1Schema.shape.validation,
  })
  .strict();

export type CloudFormationValidationResultV1 = z.output<
  typeof cloudFormationValidationResultV1Schema
>;

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validatedTemplate(input: {
  readonly infrastructure: Extract<
    SolutionExportInfrastructureArtifactV1,
    { target: "cloudformation" }
  >;
}): {
  readonly checksum: Sha256Digest;
  readonly path: string;
  readonly resourceCount: number;
} {
  const metadata = input.infrastructure as {
    readonly localValidation: string;
    readonly templateFormat: string;
    readonly templateSpecificationVersion: string;
  };
  if (
    metadata.localValidation !== CLOUDFORMATION_LOCAL_VALIDATION ||
    metadata.templateFormat !== "json" ||
    metadata.templateSpecificationVersion !== CLOUDFORMATION_TEMPLATE_VERSION
  ) {
    throw new TypeError(
      "CloudFormation compiler metadata does not name the reviewed local validator.",
    );
  }
  const candidates = input.infrastructure.files.filter(
    (file) =>
      file.mediaType === CLOUDFORMATION_TEMPLATE_MEDIA_TYPE &&
      (file.path === "template.json" || file.path.endsWith("/template.json")),
  );
  const file = candidates[0];
  if (candidates.length !== 1 || file === undefined) {
    throw new TypeError(
      "CloudFormation output must contain one structured template.json file.",
    );
  }
  if (sha256Digest(encodeUtf8(file.content)) !== file.checksum) {
    throw new TypeError(
      "CloudFormation template checksum does not match its bytes.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    throw new TypeError("CloudFormation template is not valid JSON.");
  }
  const template = objectRecord(parsed);
  const resources = objectRecord(template?.["Resources"]);
  if (
    template?.["AWSTemplateFormatVersion"] !==
      CLOUDFORMATION_TEMPLATE_VERSION ||
    resources === undefined
  ) {
    throw new TypeError(
      "CloudFormation template does not carry the reviewed format and Resources object.",
    );
  }
  for (const section of ["Outputs", "Parameters"] as const) {
    const value = template[section];
    if (value !== undefined && objectRecord(value) === undefined) {
      throw new TypeError(
        "CloudFormation " + section + " must be a JSON object.",
      );
    }
  }
  return {
    checksum: file.checksum,
    path: file.path,
    resourceCount: Object.keys(resources).length,
  };
}

export function cloudFormationValidationReportDigest(
  result: Pick<
    CloudFormationValidationResultV1,
    "diagnostics" | "target" | "validation"
  >,
): Sha256Digest {
  return sha256Digest(
    serializeCanonicalJson({
      diagnostics: result.diagnostics,
      target: result.target,
      validation: result.validation,
    }),
  );
}

/** Validate the compiler's structured CloudFormation JSON without credentials. */
export function validateCloudFormationInfrastructure(input: {
  readonly infrastructure: SolutionExportInfrastructureArtifactV1;
  readonly now: string;
  readonly request: SolutionExportWorkflowRequestV1;
  readonly settings: SolutionExportCloudFormationWorkflowStageDescriptorsV1["cloudFormationValidation"];
}): CloudFormationValidationResultV1 {
  if (
    input.infrastructure.target !== "cloudformation" ||
    input.request.targetSettings.target !== "cloudformation"
  ) {
    throw new TypeError(
      "CloudFormation local validation requires an exact CloudFormation target binding.",
    );
  }
  const template = validatedTemplate({ infrastructure: input.infrastructure });
  const projection = cloudFormationValidationProjectionV1Schema.parse({
    diagnostics: [],
    target: "cloudformation",
    validation: {
      artifactDigest: input.infrastructure.artifactDigest,
      localValidation: input.infrastructure.localValidation,
      resourceCount: template.resourceCount,
      templateChecksum: template.checksum,
      templatePath: template.path,
      templateSpecificationVersion:
        input.infrastructure.templateSpecificationVersion,
      validator: input.settings.adapter,
    },
  });
  const reportDigest = cloudFormationValidationReportDigest(projection);
  const reportBytes = encodeUtf8(serializeCanonicalJson(projection));
  const evidence: EvidenceRecordV1 = evidenceRecordV1Schema.parse({
    artifacts: [
      {
        digest: reportDigest,
        mediaType: "application/json",
        sizeBytes: reportBytes.byteLength,
      },
    ],
    checks: [
      {
        artifactDigests: [input.infrastructure.artifactDigest, reportDigest],
        checkId:
          "cloudmarkup.evidence.cloudformation-local-structural-validation",
        generationCoverageRequirement:
          "deterministic-infrastructure-compilation",
        issueIds: [],
        status: "passed",
        summary:
          "Structured CloudFormation JSON passed deterministic offline validation.",
      },
    ],
    contractVersion: 1,
    environment: input.request.environment,
    id: "evidence_cloudformation_validation_" + reportDigest.slice(7, 31),
    layer: "generated",
    level: { kind: "deterministic-target-compilation", rank: 3 },
    models: [],
    provenance: {
      actor: { kind: "deterministic-tool", tool: input.settings.adapter },
      createdAt: input.now,
      inputDigests: [
        input.infrastructure.artifactDigest,
        input.request.subject.manifestDigest,
        input.request.targetSettings.digest,
      ].sort(),
    },
    solutionRevisionId: input.request.subject.solutionRevisionId,
    staleness: { assessedAt: input.now, state: "current" },
    tools: [input.settings.adapter],
  });
  return cloudFormationValidationResultV1Schema.parse({
    contractVersion: 1,
    diagnostics: projection.diagnostics,
    evidenceRecords: [evidence],
    reportDigest,
    state: "passed",
    target: projection.target,
    validation: projection.validation,
  });
}
