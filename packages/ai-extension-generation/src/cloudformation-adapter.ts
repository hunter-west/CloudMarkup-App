import { modelGenerationContextV1Schema } from "@cloudmarkup/schemas";

import {
  validateCloudFormationExtension,
  getCloudFormationReviewedSchemaDocument,
  type CloudFormationExtensionValidationPolicyV1,
} from "./cloudformation.js";
import { digestCanonicalValue, sameStringSet, sha256Text } from "./security.js";
import {
  candidateTargetValidationResultV1Schema,
  type CandidateTargetValidationInput,
  type CandidateTargetValidationPort,
} from "./validation.js";

export function createCloudFormationCandidateValidator(input: {
  readonly policy: CloudFormationExtensionValidationPolicyV1;
}): CandidateTargetValidationPort {
  return Object.freeze({
    validate(validationInput: CandidateTargetValidationInput) {
      const generationContext = modelGenerationContextV1Schema.parse(
        validationInput.generationContext,
      );
      const providerIds = [
        ...new Set(
          input.policy.resourceAuthorities.map(
            (authority) => authority.providerId,
          ),
        ),
      ];
      const allowedProviderIds = generationContext.allowedProviders.map(
        (provider) => provider.providerId,
      );
      const resourceAuthorityKeys = input.policy.resourceAuthorities.map(
        (authority) =>
          [authority.providerId, authority.resourceType].join("\u0000"),
      );
      const allowedResourceKeys = generationContext.allowedResources.map(
        (resource) =>
          [resource.providerId, resource.resourceType].join("\u0000"),
      );
      const schemaAuthorityKeys = input.policy.resourceAuthorities.map(
        (authority) =>
          [
            authority.schemaId,
            authority.schemaVersion,
            authority.schemaDigest,
          ].join("\u0000"),
      );
      const officialSchemaKeys = generationContext.officialSchemas.map(
        (schema) =>
          [schema.schemaId, schema.schemaVersion, schema.schemaDigest].join(
            "\u0000",
          ),
      );
      const limitsWithinGenerationAuthority =
        input.policy.limits.maximumFiles <=
          generationContext.limits.maximumCandidateFiles &&
        input.policy.limits.maximumFileBytes <=
          generationContext.limits.maximumCandidateFileBytes &&
        input.policy.limits.maximumTotalBytes <=
          generationContext.limits.maximumCandidateTotalBytes &&
        input.policy.limits.maximumResources <=
          generationContext.limits.maximumResourceCount;
      const resourceAuthoritiesAreGrounded =
        input.policy.resourceAuthorities.every((authority) =>
          generationContext.catalogSlice.entries.some(
            (entry) => entry.resourceType === authority.catalogResourceType,
          ),
        ) &&
        input.policy.resourceAuthorities.every((authority) =>
          generationContext.officialSchemas.some(
            (schema) =>
              schema.schemaId === authority.schemaId &&
              schema.schemaVersion === authority.schemaVersion &&
              schema.schemaDigest === authority.schemaDigest &&
              sha256Text(schema.document) === authority.schemaDigest &&
              schema.document ===
                getCloudFormationReviewedSchemaDocument(authority),
          ),
        );
      if (
        generationContext.kind !== "iac-extension" ||
        generationContext.targetFormat !== "cloudformation" ||
        generationContext.extensionId !== input.policy.extensionId ||
        generationContext.extensionSlotId !== input.policy.slotId ||
        !sameStringSet(
          generationContext.ownedPaths,
          input.policy.allowedPaths,
        ) ||
        !sameStringSet(
          generationContext.protectedResourceAddresses,
          input.policy.protectedLogicalIds,
        ) ||
        !sameStringSet(providerIds, allowedProviderIds) ||
        !sameStringSet(resourceAuthorityKeys, allowedResourceKeys) ||
        !sameStringSet(schemaAuthorityKeys, officialSchemaKeys) ||
        !limitsWithinGenerationAuthority ||
        !resourceAuthoritiesAreGrounded
      ) {
        throw new Error(
          "CloudFormation validator policy does not match exact generation authority.",
        );
      }
      const result = validateCloudFormationExtension({
        assessedAt: validationInput.assessedAt,
        candidateArtifactDigest: validationInput.artifact.artifactDigest,
        contractVersion: 1,
        files: validationInput.files.map((file) => ({
          content: file.content,
          digest: file.digest,
          path: file.path,
        })),
        model: {
          modelId: validationInput.descriptor.modelId,
          modelVersion: validationInput.descriptor.modelVersion,
          promptVersion: validationInput.descriptor.promptVersion,
          providerId: validationInput.descriptor.providerId,
        },
        policy: input.policy,
        solutionRevisionDigest: digestCanonicalValue(
          validationInput.solutionRevision,
        ),
        solutionRevisionId: validationInput.solutionRevision.solutionRevisionId,
      });
      const failed = (
        categories: readonly (typeof result.diagnostics)[number]["category"][],
      ) =>
        result.diagnostics.some(
          (entry) =>
            entry.severity === "error" && categories.includes(entry.category),
        );
      return Promise.resolve(
        candidateTargetValidationResultV1Schema.parse({
          diagnostics: result.diagnostics,
          evidence: [result.evidence],
          outcomes: [
            {
              kind: "parse",
              result: failed(["parse"]) ? "failed" : "passed",
              toolVersion: input.policy.parser.version,
            },
            {
              kind: "static-analysis",
              result: failed([
                "admission",
                "ownership",
                "static-analysis",
                "target-readiness",
                "provenance",
              ])
                ? "failed"
                : "passed",
              toolVersion: input.policy.parser.version,
            },
            {
              kind: "security",
              result: failed(["security"]) ? "failed" : "passed",
              toolVersion: input.policy.parser.version,
            },
          ],
          representationDigest: digestCanonicalValue(result.resources),
          state: result.state,
        }),
      );
    },
  });
}
