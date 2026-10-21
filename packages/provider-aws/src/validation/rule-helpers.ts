import {
  VALIDATION_ENVIRONMENTS,
  VALIDATION_TARGETS,
  createValidationDocumentPath,
  createValidationDocumentationId,
  createValidationDocumentationPath,
  createValidationDocumentationUrl,
  createValidationFindingCode,
  defineValidationRuleV1,
  type ValidationAffectedLocation,
  type ValidationDocumentationReference,
  type ValidationFindingCandidate,
  type ValidationRuleApplicabilityV1,
  type ValidationRuleContextV1,
  type ValidationRuleV1,
  type ValidationTarget,
} from "@cloudmarkup/domain";
import type {
  ProviderCatalogArtifactV1,
  ProviderValidationRuleDescriptorV1,
} from "@cloudmarkup/provider-sdk";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { resolveAwsCurrentCatalogV1 } from "../current-catalog.js";

export type AwsValidationNode = NonNullable<
  ValidationRuleContextV1["document"]
>["nodes"][number];
export type AwsValidationDocument = NonNullable<
  ValidationRuleContextV1["document"]
>;
export type AwsValidationEdge = NonNullable<
  ValidationRuleContextV1["document"]
>["edges"][number];
export type AwsConfigurationValue = ConfigurationValue;

export type AwsValidationCatalogV1 = Pick<
  ProviderCatalogArtifactV1,
  "catalog" | "provider" | "services" | "connectionRules"
>;

export interface AwsValidationRuleDefinition {
  readonly descriptor: ProviderValidationRuleDescriptorV1;
  readonly catalog: AwsValidationCatalogV1;
  readonly targets?: readonly ValidationTarget[];
  readonly evaluate: ValidationRuleV1["evaluate"];
}

export function defineAwsValidationRuleV1(
  definition: AwsValidationRuleDefinition,
): ValidationRuleV1 {
  const applicability: ValidationRuleApplicabilityV1 = {
    providers: {
      kind: "include",
      providerIds: [definition.catalog.provider.id],
    },
    catalogs: {
      kind: "include",
      catalogs: [
        {
          catalogId: definition.catalog.catalog.id,
          versions: [definition.catalog.catalog.version],
        },
      ],
    },
    targets: definition.targets ?? VALIDATION_TARGETS,
    environments: VALIDATION_ENVIRONMENTS,
  };

  return defineValidationRuleV1({
    interfaceVersion: 1,
    id: String(definition.descriptor.id),
    ruleVersion: definition.descriptor.ruleVersion,
    input: "architecture-document",
    applicability,
    evaluate(context) {
      if (context.document)
        resolveAwsCurrentCatalogV1(context.document.catalog);
      return definition.evaluate(context);
    },
  });
}

export function documentationFor(
  descriptor: ProviderValidationRuleDescriptorV1,
): readonly ValidationDocumentationReference[] {
  return descriptor.documentation.map((reference) =>
    reference.kind === "official"
      ? {
          kind: "external",
          id: createValidationDocumentationId(String(reference.id)),
          title: reference.title,
          publisher: reference.publisher,
          url: createValidationDocumentationUrl(reference.url),
        }
      : {
          kind: "cloudmarkup-document",
          id: createValidationDocumentationId(String(reference.id)),
          title: reference.title,
          path: createValidationDocumentationPath(reference.path),
        },
  );
}

export function finding(
  descriptor: ProviderValidationRuleDescriptorV1,
  definition: Omit<
    ValidationFindingCandidate,
    "code" | "documentationReferences"
  > & {
    readonly code: string;
  },
): ValidationFindingCandidate {
  return {
    ...definition,
    code: createValidationFindingCode(definition.code),
    documentationReferences: documentationFor(descriptor),
  };
}

export function nodeLocation(
  node: AwsValidationNode,
  nodeIndex: number,
  suffix = "",
): ValidationAffectedLocation {
  return {
    kind: "node",
    nodeId: node.id,
    path: createValidationDocumentPath(
      `$.nodes[${String(nodeIndex)}]${suffix}`,
    ),
  };
}

export function edgeLocation(
  edge: AwsValidationEdge,
  edgeIndex: number,
  suffix = "",
): ValidationAffectedLocation {
  return {
    kind: "edge",
    edgeId: edge.id,
    path: createValidationDocumentPath(
      `$.edges[${String(edgeIndex)}]${suffix}`,
    ),
  };
}

export function nodeConfigurationLocation(
  node: AwsValidationNode,
  nodeIndex: number,
  key: string,
): ValidationAffectedLocation {
  return {
    kind: "configuration",
    owner: { kind: "node", nodeId: node.id },
    key,
    path: createValidationDocumentPath(
      `$.nodes[${String(nodeIndex)}].semantic.configuration.values.${key}`,
    ),
  };
}

export function edgeConfigurationLocation(
  edge: AwsValidationEdge,
  edgeIndex: number,
  key: string,
): ValidationAffectedLocation {
  return {
    kind: "configuration",
    owner: { kind: "edge", edgeId: edge.id },
    key,
    path: createValidationDocumentPath(
      `$.edges[${String(edgeIndex)}].semantic.configuration.values.${key}`,
    ),
  };
}

export function configurationValue(
  values: Readonly<Record<string, AwsConfigurationValue>>,
  key: string,
): AwsConfigurationValue | undefined {
  return values[key];
}

export function literalString(
  values: Readonly<Record<string, AwsConfigurationValue>>,
  key: string,
): string | undefined {
  const value = configurationValue(values, key);
  return value?.kind === "string" ? value.value : undefined;
}

export function literalInteger(
  values: Readonly<Record<string, AwsConfigurationValue>>,
  key: string,
): number | undefined {
  const value = configurationValue(values, key);
  return value?.kind === "integer" ? value.value : undefined;
}

export function literalBoolean(
  values: Readonly<Record<string, AwsConfigurationValue>>,
  key: string,
): boolean | undefined {
  const value = configurationValue(values, key);
  return value?.kind === "boolean" ? value.value : undefined;
}

export function isLowerEnvironment(
  environment: ValidationRuleContextV1["environment"],
): boolean {
  return environment === "development" || environment === "test";
}
