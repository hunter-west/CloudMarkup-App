import { createHash } from "node:crypto";

import { serializeCanonicalJson } from "@cloudmarkup/schemas";

import {
  assertAccessorModuleOptions,
  formatPath,
  sortIssues,
} from "./connection-presentation-compiler-v1.js";
import type {
  ProviderCatalogArtifactV1,
  ProviderConnectionRuleDescriptorV1,
  ProviderPortDefinitionV1,
  ProviderServiceDefinitionV1,
} from "./catalog-contract-v1.js";
import { parseVerifiedProviderCatalogArtifactV1 } from "./compiler.js";
import {
  PROVIDER_SERVICE_EXTENSION_ARTIFACT_KIND,
  PROVIDER_SERVICE_EXTENSION_CANONICALIZATION,
  providerServiceExtensionArtifactV1Schema,
  providerServiceExtensionSourceV1Schema,
  type ProviderServiceExtensionArtifactContentV1,
  type ProviderServiceExtensionArtifactV1,
  type ProviderServiceExtensionSourceV1,
} from "./provider-service-extension-contract-v1.js";

export {
  createProviderServiceExtensionAccessorsV1,
  type ProviderServiceExtensionAccessorsV1,
} from "./provider-service-extension-accessors-v1.js";

type ServiceExtensionSchemaIssue = Extract<
  ReturnType<typeof providerServiceExtensionSourceV1Schema.safeParse>,
  { success: false }
>["error"]["issues"][number];

export type ProviderServiceExtensionValidationIssueCode =
  | "ambiguous-ownership-relationship"
  | "catalog-binding-mismatch"
  | "duplicate-configuration-kind-binding"
  | "duplicate-policy-kind-binding"
  | "duplicate-service-extension"
  | "duplicate-slot-id"
  | "invalid-catalog-artifact"
  | "invalid-contract"
  | "ownership-cardinality-mismatch"
  | "missing-service-extension"
  | "unknown-configuration-service"
  | "unknown-ownership-relationship"
  | "unsupported-policy-kind"
  | "unknown-service";

export interface ProviderServiceExtensionValidationIssueV1 {
  readonly code: ProviderServiceExtensionValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface CompiledProviderServiceExtensionV1 {
  readonly artifact: ProviderServiceExtensionArtifactV1;
  readonly hash: ProviderServiceExtensionArtifactV1["digest"];
  readonly canonicalJson: string;
}

export interface ProviderServiceExtensionAccessorModuleOptions {
  readonly artifactImportPath: string;
  readonly artifactExportName: string;
  readonly accessorsExportName: string;
  readonly digestExportName: string;
}

const issueMessages: Readonly<
  Record<ProviderServiceExtensionValidationIssueCode, string>
> = Object.freeze({
  "ambiguous-ownership-relationship":
    "An owned-configuration slot must resolve to exactly one semantic ownership relationship.",
  "catalog-binding-mismatch":
    "The service extension source must bind the exact semantic catalog ID, version, and digest.",
  "duplicate-configuration-kind-binding":
    "One owner service cannot bind the same configuration kind to multiple owned-configuration slots.",
  "duplicate-policy-kind-binding":
    "One owner service cannot bind the same policy kind to multiple owned-configuration slots.",
  "duplicate-service-extension":
    "Every semantic service must have exactly one service extension declaration.",
  "duplicate-slot-id":
    "Owned-configuration slot IDs must be globally unique in the bound catalog.",
  "invalid-catalog-artifact":
    "Service extensions must be compiled against a valid semantic catalog artifact.",
  "invalid-contract": "The provider service extension contract is invalid.",
  "ownership-cardinality-mismatch":
    "Owned-configuration slot cardinality must agree with the exact ownership rule and both bound semantic ports.",
  "missing-service-extension":
    "Every semantic service must have exactly one service extension declaration.",
  "unknown-configuration-service":
    "An owned-configuration slot references a graph service absent from the semantic catalog.",
  "unknown-ownership-relationship":
    "An owned-configuration slot must reference a semantic relationship between its owner and configuration service.",
  "unsupported-policy-kind":
    "An owned-configuration slot policy kind must be accepted by the bound configuration service schema.",
  "unknown-service":
    "A provider service extension references a semantic service that does not exist.",
});

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function createIssue(
  code: ProviderServiceExtensionValidationIssueCode,
  path: string,
): ProviderServiceExtensionValidationIssueV1 {
  return Object.freeze({ code, path, message: issueMessages[code] });
}

export class ProviderServiceExtensionCompilationError extends Error {
  readonly issues: readonly ProviderServiceExtensionValidationIssueV1[];

  constructor(issues: readonly ProviderServiceExtensionValidationIssueV1[]) {
    super("Provider service extension compilation failed.");
    this.name = "ProviderServiceExtensionCompilationError";
    this.issues = Object.freeze(sortIssues(issues));
  }
}

function collectStructuralIssues(
  issues: readonly ServiceExtensionSchemaIssue[],
): ProviderServiceExtensionValidationIssueV1[] {
  return issues.map((issue) =>
    createIssue("invalid-contract", formatPath(issue.path)),
  );
}

function relationshipEndpoint(
  rule: ProviderConnectionRuleDescriptorV1,
  serviceId: string,
): { readonly portId: string; readonly maximum: number } | undefined {
  if (rule.source.serviceId === serviceId) {
    return {
      portId: String(rule.source.portId),
      maximum: rule.maximumConnectionsPerSource,
    };
  }
  if (rule.target.serviceId === serviceId) {
    return {
      portId: String(rule.target.portId),
      maximum: rule.maximumConnectionsPerTarget,
    };
  }
  return undefined;
}

function portById(
  service: ProviderServiceDefinitionV1,
  portId: string,
): ProviderPortDefinitionV1 | undefined {
  return service.ports.find((port) => String(port.id) === portId);
}

function collectStringEnumValues(
  value: unknown,
  result: Set<string> = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectStringEnumValues(item, result));
    return result;
  }
  if (value === null || typeof value !== "object") {
    return result;
  }

  const record = value as Readonly<Record<string, unknown>>;
  if (Array.isArray(record["enum"])) {
    record["enum"].forEach((item) => {
      if (typeof item === "string") {
        result.add(item);
      }
    });
  }
  Object.values(record).forEach((item) =>
    collectStringEnumValues(item, result),
  );
  return result;
}

function validateServiceExtensionSemantics(
  source: ProviderServiceExtensionSourceV1,
  catalog: ProviderCatalogArtifactV1,
): ProviderServiceExtensionValidationIssueV1[] {
  const issues: ProviderServiceExtensionValidationIssueV1[] = [];
  if (
    source.catalog.id !== catalog.catalog.id ||
    source.catalog.version !== catalog.catalog.version ||
    source.catalog.digest !== catalog.digest
  ) {
    issues.push(createIssue("catalog-binding-mismatch", "$.catalog"));
  }

  const catalogServicesById = new Map(
    catalog.services.map((service) => [String(service.id), service]),
  );
  const catalogServiceIds = new Set(catalogServicesById.keys());
  const declaredServiceIds = new Set<string>();
  const slotIds = new Set<string>();

  source.services.forEach((extension, serviceIndex) => {
    const servicePath = `$.services[${String(serviceIndex)}]`;
    const ownerServiceId = String(extension.serviceId);
    if (declaredServiceIds.has(ownerServiceId)) {
      issues.push(
        createIssue("duplicate-service-extension", `${servicePath}.serviceId`),
      );
    }
    declaredServiceIds.add(ownerServiceId);

    if (!catalogServiceIds.has(ownerServiceId)) {
      issues.push(createIssue("unknown-service", `${servicePath}.serviceId`));
      return;
    }

    const configurationKinds = new Set<string>();
    const policyKinds = new Set<string>();

    extension.ownedConfigurationSlots.forEach((slot, slotIndex) => {
      const slotPath = `${servicePath}.ownedConfigurationSlots[${String(slotIndex)}]`;
      const slotId = String(slot.id);
      if (slotIds.has(slotId)) {
        issues.push(createIssue("duplicate-slot-id", `${slotPath}.id`));
      }
      slotIds.add(slotId);

      const configurationKind = String(slot.configurationKind);
      if (configurationKinds.has(configurationKind)) {
        issues.push(
          createIssue(
            "duplicate-configuration-kind-binding",
            `${slotPath}.configurationKind`,
          ),
        );
      }
      configurationKinds.add(configurationKind);

      slot.policyKinds.forEach((policyKind, policyKindIndex) => {
        const policyKindString = policyKind;
        if (policyKinds.has(policyKindString)) {
          issues.push(
            createIssue(
              "duplicate-policy-kind-binding",
              `${slotPath}.policyKinds[${String(policyKindIndex)}]`,
            ),
          );
        }
        policyKinds.add(policyKindString);
      });

      const configurationServiceId = String(
        slot.graphBinding.configurationServiceId,
      );
      const configurationService = catalogServicesById.get(
        configurationServiceId,
      );
      if (configurationService === undefined) {
        issues.push(
          createIssue(
            "unknown-configuration-service",
            `${slotPath}.graphBinding.configurationServiceId`,
          ),
        );
        return;
      }

      const supportedPolicyKinds = collectStringEnumValues(
        configurationService.configuration.jsonSchema,
      );
      slot.policyKinds.forEach((policyKind, policyKindIndex) => {
        if (!supportedPolicyKinds.has(policyKind)) {
          issues.push(
            createIssue(
              "unsupported-policy-kind",
              `${slotPath}.policyKinds[${String(policyKindIndex)}]`,
            ),
          );
        }
      });

      const relationshipType = String(
        slot.graphBinding.ownershipRelationshipType,
      );
      const matchingRelationships = catalog.connectionRules.filter(
        (rule) =>
          rule.relationshipType === relationshipType &&
          ((rule.source.serviceId === ownerServiceId &&
            rule.target.serviceId === configurationServiceId) ||
            (rule.source.serviceId === configurationServiceId &&
              rule.target.serviceId === ownerServiceId)),
      );
      if (matchingRelationships.length === 0) {
        issues.push(
          createIssue(
            "unknown-ownership-relationship",
            `${slotPath}.graphBinding.ownershipRelationshipType`,
          ),
        );
      } else if (matchingRelationships.length > 1) {
        issues.push(
          createIssue(
            "ambiguous-ownership-relationship",
            `${slotPath}.graphBinding.ownershipRelationshipType`,
          ),
        );
      } else if (ownerServiceId !== configurationServiceId) {
        const relationship = matchingRelationships[0];
        const ownerService = catalogServicesById.get(ownerServiceId);
        if (relationship === undefined || ownerService === undefined) {
          return;
        }
        const ownerEndpoint = relationshipEndpoint(
          relationship,
          ownerServiceId,
        );
        const configurationEndpoint = relationshipEndpoint(
          relationship,
          configurationServiceId,
        );
        if (
          ownerEndpoint === undefined ||
          configurationEndpoint === undefined
        ) {
          return;
        }
        const ownerPort = portById(ownerService, ownerEndpoint.portId);
        const configurationPort = portById(
          configurationService,
          configurationEndpoint.portId,
        );
        if (ownerPort === undefined || configurationPort === undefined) {
          return;
        }

        const expectedMinimum = ownerPort.required ? 1 : 0;
        const expectedMaximum = ownerEndpoint.maximum === 1 ? 1 : "many";
        if (
          slot.cardinality.enforcement !== "provider-rule" ||
          slot.cardinality.minimum !== expectedMinimum ||
          slot.cardinality.maximum !== expectedMaximum
        ) {
          issues.push(
            createIssue(
              "ownership-cardinality-mismatch",
              `${slotPath}.cardinality`,
            ),
          );
        }

        if (
          configurationPort.cardinality !== "one" ||
          configurationEndpoint.maximum !== 1
        ) {
          issues.push(
            createIssue(
              "ownership-cardinality-mismatch",
              `${slotPath}.graphBinding`,
            ),
          );
        }
      }
    });
  });

  catalog.services.forEach((service) => {
    if (!declaredServiceIds.has(String(service.id))) {
      issues.push(
        createIssue(
          "missing-service-extension",
          `$.services[${JSON.stringify(String(service.id))}]`,
        ),
      );
    }
  });

  return issues;
}

function normalizeServiceExtensionSource(
  source: ProviderServiceExtensionSourceV1,
): ProviderServiceExtensionSourceV1 {
  return {
    ...source,
    catalog: { ...source.catalog },
    services: source.services
      .map((extension) => ({
        ...extension,
        targetReadiness: { ...extension.targetReadiness },
        ownedConfigurationSlots: extension.ownedConfigurationSlots
          .map((slot) => ({
            ...slot,
            graphBinding: { ...slot.graphBinding },
            cardinality: { ...slot.cardinality },
            allowedOwnership: [...slot.allowedOwnership].sort(compareStrings),
            policyKinds: [...slot.policyKinds].sort(compareStrings),
            targetReadiness: { ...slot.targetReadiness },
          }))
          .sort((left, right) =>
            compareStrings(String(left.id), String(right.id)),
          ),
      }))
      .sort((left, right) =>
        compareStrings(String(left.serviceId), String(right.serviceId)),
      ),
  };
}

export function validateProviderServiceExtensionSourceV1(
  input: unknown,
  semanticCatalogInput: unknown,
): ProviderServiceExtensionSourceV1 {
  const catalog = parseVerifiedProviderCatalogArtifactV1(semanticCatalogInput);
  if (catalog === undefined) {
    throw new ProviderServiceExtensionCompilationError([
      createIssue("invalid-catalog-artifact", "$semanticCatalog"),
    ]);
  }

  const sourceResult = providerServiceExtensionSourceV1Schema.safeParse(input);
  if (!sourceResult.success) {
    throw new ProviderServiceExtensionCompilationError(
      collectStructuralIssues(sourceResult.error.issues),
    );
  }

  const issues = validateServiceExtensionSemantics(sourceResult.data, catalog);
  if (issues.length > 0) {
    throw new ProviderServiceExtensionCompilationError(issues);
  }
  return normalizeServiceExtensionSource(sourceResult.data);
}

export function compileProviderServiceExtensionV1(
  input: unknown,
  semanticCatalogInput: unknown,
): CompiledProviderServiceExtensionV1 {
  const source = validateProviderServiceExtensionSourceV1(
    input,
    semanticCatalogInput,
  );
  const content: ProviderServiceExtensionArtifactContentV1 = {
    kind: PROVIDER_SERVICE_EXTENSION_ARTIFACT_KIND,
    canonicalization: PROVIDER_SERVICE_EXTENSION_CANONICALIZATION,
    ...source,
  };
  const contentCanonicalJson = serializeCanonicalJson(content);
  const digest = `sha256:${createHash("sha256")
    .update(contentCanonicalJson, "utf8")
    .digest("hex")}` as ProviderServiceExtensionArtifactV1["digest"];
  const artifact = providerServiceExtensionArtifactV1Schema.parse({
    ...content,
    digest,
  });
  return Object.freeze({
    artifact,
    hash: digest,
    canonicalJson: serializeCanonicalJson(artifact),
  });
}

export function renderProviderServiceExtensionAccessorModuleV1(
  compilation: CompiledProviderServiceExtensionV1,
  options: ProviderServiceExtensionAccessorModuleOptions,
): string {
  assertAccessorModuleOptions(options);

  return `// Generated by @cloudmarkup/provider-sdk. Do not edit by hand.
import {
  createProviderServiceExtensionAccessorsV1,
  providerServiceExtensionArtifactV1Schema,
} from "@cloudmarkup/provider-sdk";

import serviceExtensionArtifactJson from ${JSON.stringify(options.artifactImportPath)} with { type: "json" };

export const ${options.digestExportName} =
  ${JSON.stringify(compilation.hash)} as const;

export const ${options.artifactExportName} =
  providerServiceExtensionArtifactV1Schema.parse(serviceExtensionArtifactJson);

export const ${options.accessorsExportName} = createProviderServiceExtensionAccessorsV1(
  ${options.artifactExportName},
);
`;
}
