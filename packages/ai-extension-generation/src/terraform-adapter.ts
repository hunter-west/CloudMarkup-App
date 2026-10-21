import type { TerraformHCLInspectorPort } from "@cloudmarkup/repository-importer";
import {
  modelCandidateBundleV1Schema,
  modelGenerationContextV1Schema,
  modelInvocationDescriptorV1Schema,
  solutionRevisionManifestV1Schema,
} from "@cloudmarkup/schemas";
import {
  terraformValidationFileV1Schema,
  terraformValidationReferenceV1Schema,
  terraformValidationRequestV1Schema,
  terraformValidationResultV1Schema,
  terraformValidationTreeDigest,
  type TerraformValidationFileV1,
  type TerraformValidationReferenceV1,
  type TerraformValidationRequestV1,
  type TerraformValidationRunner,
} from "@cloudmarkup/terraform-validation-runner";

import { getCandidateArtifactDigest } from "./artifact-store.js";
import {
  candidateArtifactReferenceV1Schema,
  candidateDiagnosticV1Schema,
  type CandidateDiagnosticV1,
} from "./contracts.js";
import { digestCanonicalValue, sameStringSet, sha256Text } from "./security.js";
import {
  candidateTargetValidationResultV1Schema,
  type CandidateTargetValidationInput,
  type CandidateTargetValidationPort,
} from "./validation.js";

export interface TerraformCandidateValidatorConfigurationV1 {
  readonly baselineRequest: TerraformValidationRequestV1;
  readonly candidateReferences: TerraformValidationReferenceV1;
  readonly hclInspector: TerraformHCLInspectorPort;
  readonly runner: TerraformValidationRunner;
}

function mappedDiagnostic(input: {
  readonly category: CandidateDiagnosticV1["category"];
  readonly code: string;
  readonly detail: string;
  readonly path?: string;
  readonly repairable: boolean;
  readonly severity: "error" | "warning" | "information";
  readonly summary: string;
}): CandidateDiagnosticV1 {
  return candidateDiagnosticV1Schema.parse({
    category: input.category,
    checkId: `cloudmarkup.ai-extension.terraform-${input.category}`,
    code: input.code,
    ...(input.path === undefined ? {} : { path: input.path }),
    repairable: input.repairable,
    severity: input.severity,
    summary: input.summary,
    technicalDetail: input.detail,
  });
}

function runnerDiagnosticCategory(input: {
  readonly code: string;
  readonly source: string;
}): CandidateDiagnosticV1["category"] {
  if (
    /provisioner|backend|external|shell|module|credential|secret|plan|apply|state/iu.test(
      input.code,
    ) ||
    input.source === "scanner"
  ) {
    return "security";
  }
  if (input.source === "terraform-fmt") return "format";
  if (input.source === "terraform-validate") return "static-analysis";
  if (input.source === "admission") return "static-analysis";
  return "static-analysis";
}

function bundleProvenanceMatchesDescriptor(
  bundle: ReturnType<typeof modelCandidateBundleV1Schema.parse>,
  descriptor: ReturnType<typeof modelInvocationDescriptorV1Schema.parse>,
): boolean {
  return (
    bundle.provenance.inputDigest === descriptor.inputDigest &&
    bundle.provenance.invocationId === descriptor.invocationId &&
    bundle.provenance.modelId === descriptor.modelId &&
    bundle.provenance.modelVersion === descriptor.modelVersion &&
    bundle.provenance.promptDigest === descriptor.promptDigest &&
    bundle.provenance.promptTemplateId === descriptor.promptTemplateId &&
    bundle.provenance.promptVersion === descriptor.promptVersion &&
    bundle.provenance.providerId === descriptor.providerId
  );
}

function exactTerraformResourceAuthorities(
  context: ReturnType<typeof modelGenerationContextV1Schema.parse>,
) {
  if (context.kind !== "iac-extension") {
    throw new Error("Terraform resource authority requires an IaC context.");
  }
  const kindsByResourceType = new Map<string, Set<"data" | "resource">>();
  for (const address of context.ownedResourceAddresses) {
    const match =
      /^(?:(data)\.)?([a-z][a-z0-9_]{0,127})\.[A-Za-z0-9_-]{1,128}$/u.exec(
        address,
      );
    if (match?.[2] === undefined) {
      throw new Error(
        "Terraform owned resource addresses must be exact resource or data addresses.",
      );
    }
    const blockKind = match[1] === "data" ? "data" : "resource";
    const kinds = kindsByResourceType.get(match[2]) ?? new Set();
    kinds.add(blockKind);
    kindsByResourceType.set(match[2], kinds);
  }
  const authorities = context.allowedResources.flatMap((resource) => {
    const blockKinds = kindsByResourceType.get(resource.resourceType);
    if (blockKinds === undefined || blockKinds.size === 0) {
      throw new Error(
        "Every allowed Terraform provider/resource tuple must bind an exact owned block kind.",
      );
    }
    return [...blockKinds].map((blockKind) => ({
      blockKind,
      providerId: resource.providerId,
      resourceType: resource.resourceType,
    }));
  });
  const allowedResourceTypes = new Set(
    context.allowedResources.map(({ resourceType }) => resourceType),
  );
  if (
    [...kindsByResourceType.keys()].some(
      (resourceType) => !allowedResourceTypes.has(resourceType),
    )
  ) {
    throw new Error(
      "Every owned Terraform address must bind an allowed provider/resource tuple.",
    );
  }
  return authorities;
}

function exactTerraformCandidateInput(input: CandidateTargetValidationInput) {
  const context = modelGenerationContextV1Schema.parse(input.generationContext);
  const artifact = candidateArtifactReferenceV1Schema.parse(input.artifact);
  const bundle = modelCandidateBundleV1Schema.parse(input.bundle);
  const descriptor = modelInvocationDescriptorV1Schema.parse(input.descriptor);
  const solutionRevision = solutionRevisionManifestV1Schema.parse(
    input.solutionRevision,
  );
  if (
    context.kind !== "iac-extension" ||
    context.targetFormat !== "terraform" ||
    context.extensionId !== artifact.extensionId ||
    artifact.solutionRevisionId !== solutionRevision.solutionRevisionId ||
    descriptor.scope.solutionRevisionId !==
      solutionRevision.solutionRevisionId ||
    (descriptor.feature !== "iac-extension.generate" &&
      descriptor.feature !== "candidate.repair") ||
    artifact.scope.organizationId !== descriptor.scope.organizationId ||
    artifact.scope.projectId !== descriptor.scope.projectId ||
    !bundleProvenanceMatchesDescriptor(bundle, descriptor) ||
    sha256Text(context.catalogSlice.content) !==
      context.catalogSlice.sliceDigest ||
    !sameStringSet(
      context.ownedPaths,
      input.files.map(({ path }) => path),
    ) ||
    !sameStringSet(
      context.ownedPaths,
      artifact.files.map(({ path }) => path),
    ) ||
    !sameStringSet(context.ownedPaths, bundle.boundary.ownedPaths) ||
    !sameStringSet(
      context.ownedPaths,
      bundle.candidates.map(({ path }) => path),
    ) ||
    digestCanonicalValue(context.validationExpectations) !==
      digestCanonicalValue(bundle.validationExpectations)
  ) {
    throw new Error(
      "Terraform candidate input does not match exact extension, revision, model, path, and validation authority.",
    );
  }
  const exactBundleDigest = digestCanonicalValue(bundle);
  const artifactFileByPath = new Map(
    artifact.files.map((file) => [file.path, file]),
  );
  const bundleCandidateByPath = new Map(
    bundle.candidates.map((candidate) => [candidate.path, candidate]),
  );
  for (const file of input.files) {
    const reference = artifactFileByPath.get(file.path);
    const candidate = bundleCandidateByPath.get(file.path);
    const sizeBytes = new TextEncoder().encode(file.content).byteLength;
    if (
      sha256Text(file.content) !== file.digest ||
      sizeBytes !== file.sizeBytes ||
      reference?.digest !== file.digest ||
      reference.sizeBytes !== sizeBytes ||
      reference.sourceKind !== file.sourceKind ||
      reference.ownership !== file.ownership ||
      candidate?.kind !== file.sourceKind ||
      (candidate.kind === "file" &&
        (candidate.content !== file.content ||
          candidate.contentDigest !== file.digest)) ||
      (candidate.kind === "patch" &&
        candidate.proposedResultDigest !== file.digest)
    ) {
      throw new Error(
        "Terraform candidate file bytes and artifact metadata do not match exactly.",
      );
    }
  }
  if (
    artifact.bundleDigest !== exactBundleDigest ||
    getCandidateArtifactDigest({
      bundleDigest: artifact.bundleDigest,
      extensionId: artifact.extensionId,
      files: input.files,
      scope: artifact.scope,
      solutionRevisionId: artifact.solutionRevisionId,
      targetKind: "terraform",
    }) !== artifact.artifactDigest ||
    context.officialSchemas.some(
      (schema) => sha256Text(schema.document) !== schema.schemaDigest,
    )
  ) {
    throw new Error(
      "Terraform candidate artifact, bundle, or official schema integrity does not match.",
    );
  }
  return {
    artifact,
    bundle,
    context,
    descriptor,
    solutionRevision,
  };
}

export function createTerraformCandidateValidator(
  configuration: TerraformCandidateValidatorConfigurationV1,
): CandidateTargetValidationPort {
  const baseline = terraformValidationRequestV1Schema.parse(
    configuration.baselineRequest,
  );
  const candidateReferences = terraformValidationReferenceV1Schema.parse(
    configuration.candidateReferences,
  );
  if (
    baseline.extensionContext !== undefined ||
    terraformValidationTreeDigest(baseline.files) !== baseline.artifactDigest
  ) {
    throw new Error(
      "Terraform candidate validator requires one exact deterministic baseline tree.",
    );
  }
  return Object.freeze({
    async validate(
      input: CandidateTargetValidationInput,
      signal?: AbortSignal,
    ) {
      const { artifact, context, descriptor, solutionRevision } =
        exactTerraformCandidateInput(input);
      const resourceAuthorities = exactTerraformResourceAuthorities(context);
      if (
        context.extensionSlotId.length === 0 ||
        candidateReferences.solutionRevisionId !==
          solutionRevision.solutionRevisionId ||
        baseline.solutionRevisionId !== solutionRevision.solutionRevisionId ||
        baseline.solutionRevisionDigest !==
          digestCanonicalValue(solutionRevision) ||
        !sameStringSet(
          context.protectedPaths,
          baseline.files.map(({ path }) => path),
        )
      ) {
        throw new Error(
          "Terraform validator baseline and generation authority do not match exactly.",
        );
      }
      const candidateFiles: TerraformValidationFileV1[] = input.files.map(
        (file) =>
          terraformValidationFileV1Schema.parse({
            checksum: file.digest,
            content: file.content,
            path: file.path,
            references: candidateReferences,
          }),
      );
      const files = [...baseline.files, ...candidateFiles];
      const candidateDigest = terraformValidationTreeDigest(candidateFiles);
      const request = terraformValidationRequestV1Schema.parse({
        artifactDigest: terraformValidationTreeDigest(files),
        assessedAt: input.assessedAt,
        compiler: baseline.compiler,
        contractVersion: 1,
        environment: baseline.environment,
        extensionContext: {
          baseline: {
            artifactDigest: baseline.artifactDigest,
            compiler: baseline.compiler,
            solutionRevisionDigest: baseline.solutionRevisionDigest,
          },
          candidateArtifactDigest: artifact.artifactDigest,
          candidateDigest,
          candidateDigestCanonicalization:
            "cloudmarkup.terraform-validation-tree.path-checksum.v1",
          candidateOwnedPaths: context.ownedPaths,
          contractVersion: 1,
          extensionId: context.extensionId,
          maximumResourceCount: context.limits.maximumResourceCount,
          mode: "ai-authored-extension",
          modelDescriptor: descriptor,
          modelOutputDigest: artifact.bundleDigest,
          officialSchemaAuthorities: context.officialSchemas.map(
            ({ schemaDigest, schemaId, schemaVersion }) => ({
              schemaDigest,
              schemaId,
              schemaVersion,
            }),
          ),
          ownedResourceAddresses: context.ownedResourceAddresses,
          providerAuthorities: context.allowedProviders.map(
            ({ providerId, source, versionConstraint }) => ({
              providerId,
              source,
              versionConstraint,
            }),
          ),
          protectedDeterministicFiles: baseline.files.map(
            ({ checksum, path }) => ({ checksum, path }),
          ),
          protectedDeterministicResourceAddresses:
            context.protectedResourceAddresses,
          resourceAuthorities,
          slotId: context.extensionSlotId,
          target: "terraform",
          validationTreeDigestCanonicalization:
            "cloudmarkup.terraform-validation-tree.path-checksum.v1",
        },
        files,
        solutionRevisionDigest: baseline.solutionRevisionDigest,
        solutionRevisionId: baseline.solutionRevisionId,
      });
      const diagnostics: CandidateDiagnosticV1[] = [];
      const inspections = await Promise.all(
        candidateFiles.map(async (file) => ({
          path: file.path,
          result: await configuration.hclInspector.inspect({
            path: file.path,
            source: new TextEncoder().encode(file.content),
          }),
        })),
      );
      for (const inspection of inspections) {
        if (
          !inspection.result.succeeded ||
          inspection.result.diagnostics.some(
            ({ severity }) => severity === "error",
          )
        ) {
          diagnostics.push(
            mappedDiagnostic({
              category: "parse",
              code: "cloudmarkup.ai-extension.terraform-hcl-parse",
              detail:
                "The fixed value-free HCL inspector reported a parse error.",
              path: inspection.path,
              repairable: true,
              severity: "error",
              summary: "Terraform extension contains invalid HCL.",
            }),
          );
        }
      }
      const runnerResult = terraformValidationResultV1Schema.parse(
        await configuration.runner.run(
          request,
          signal === undefined ? {} : { signal },
        ),
      );
      const candidateSizeBytes = artifact.files.reduce(
        (total, file) => total + file.sizeBytes,
        0,
      );
      const exactEvidence = runnerResult.evidenceRecords.filter((record) => {
        const candidateArtifacts = record.artifacts.filter(
          ({ digest }) => digest === artifact.artifactDigest,
        );
        return (
          record.level.kind === "ai-extension-parse-static-validity" &&
          record.solutionRevisionId === solutionRevision.solutionRevisionId &&
          record.staleness.state === "current" &&
          record.provenance.inputDigests.includes(artifact.artifactDigest) &&
          candidateArtifacts.length === 1 &&
          candidateArtifacts[0]?.mediaType ===
            "application/vnd.cloudmarkup.ai-extension-candidate.v1+json" &&
          candidateArtifacts[0].sizeBytes === candidateSizeBytes &&
          record.checks.every(({ artifactDigests }) =>
            artifactDigests.includes(artifact.artifactDigest),
          ) &&
          record.checks.filter(
            ({ generationCoverageRequirement }) =>
              generationCoverageRequirement ===
              "ai-extension-parse-static-validity",
          ).length === 1 &&
          record.models.some(
            (model) =>
              model.providerId === descriptor.providerId &&
              model.modelId === descriptor.modelId &&
              model.modelVersion === descriptor.modelVersion &&
              model.promptVersion === descriptor.promptVersion,
          )
        );
      });
      const candidatePathSet = new Set(context.ownedPaths);
      diagnostics.push(
        ...runnerResult.diagnostics.map((entry) =>
          mappedDiagnostic({
            category: runnerDiagnosticCategory(entry),
            code: entry.code,
            detail: entry.detail,
            ...(entry.path === undefined ? {} : { path: entry.path }),
            repairable:
              entry.path !== undefined && candidatePathSet.has(entry.path),
            severity:
              entry.severity === "info" ? "information" : entry.severity,
            summary: entry.summary,
          }),
        ),
      );
      if (exactEvidence.length !== 1) {
        diagnostics.push(
          mappedDiagnostic({
            category: "provenance",
            code: "cloudmarkup.ai-extension.terraform-evidence-mismatch",
            detail:
              "Exactly one rank-4 Terraform Evidence record must bind the exact restricted candidate artifact, coverage claim, model descriptor, and Solution Revision.",
            repairable: false,
            severity: "error",
            summary:
              "Terraform validation Evidence is not grounded in this candidate.",
          }),
        );
      }
      const failed = (category: CandidateDiagnosticV1["category"]): boolean =>
        diagnostics.some(
          (entry) => entry.category === category && entry.severity === "error",
        );
      const stepState = (step: "fmt" | "validate") =>
        runnerResult.commandSummaries.find((entry) => entry.step === step)
          ?.state;
      return candidateTargetValidationResultV1Schema.parse({
        diagnostics,
        evidence: exactEvidence.length === 1 ? exactEvidence : [],
        outcomes: [
          {
            kind: "parse",
            result: failed("parse") ? "failed" : "passed",
            toolVersion: inspections[0]?.result.parser.version ?? "1.0.0",
          },
          {
            kind: "format",
            result: stepState("fmt") === "passed" ? "passed" : "failed",
            toolVersion: baseline.compiler.version,
          },
          {
            kind: "static-analysis",
            result:
              stepState("validate") === "passed" && !failed("static-analysis")
                ? "passed"
                : "failed",
            toolVersion: baseline.compiler.version,
          },
          {
            kind: "security",
            result: failed("security") ? "failed" : "passed",
            toolVersion: baseline.compiler.version,
          },
        ],
        representationDigest: digestCanonicalValue(
          inspections.map(({ path, result }) => ({
            blocks: result.blocks,
            parser: result.parser,
            path,
          })),
        ),
        state:
          runnerResult.state === "passed" &&
          !diagnostics.some(({ severity }) => severity === "error")
            ? "passed"
            : runnerResult.state === "error"
              ? "error"
              : "failed",
      });
    },
  });
}
