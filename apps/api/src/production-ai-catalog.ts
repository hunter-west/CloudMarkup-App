import {
  AWS_CURRENT_CATALOG_BINDING_V1,
  AWS_IAM_POLICY_RESOURCE_SCOPES_V1,
  resolveAwsModelCatalogV1,
  resolveAwsCurrentCatalogV1,
  type AwsCatalogBindingV1,
} from "@cloudmarkup/provider-aws";
import type { ProviderServiceConfigurationV1 } from "@cloudmarkup/provider-sdk";
import {
  digestCanonicalValue,
  modelCatalogConfigurationValidationV1Schema,
  modelOperationCatalogGroundingV1Schema,
} from "@cloudmarkup/schemas";

const canonicalization =
  "cloudmarkup.provider-configuration-authority.canonical-json.v1" as const;

function configurationAuthority(
  configuration: ProviderServiceConfigurationV1,
  installedServiceTypes: ReadonlySet<string>,
) {
  const valueSources = Object.fromEntries(
    configuration.uiHints.map((hint) => [hint.property, hint.valueSource]),
  );
  const references = configuration.uiHints.filter(
    (hint) => hint.valueSource === "node-reference",
  );
  const nodeReferenceAuthorities = Object.fromEntries(
    references.map((hint) => {
      // This field belongs to the reviewed AWS policy projection. Never infer
      // ARN/ID attributes from a model, UI label or an arbitrary service name.
      if (
        configuration.schemaId !== "aws.iam.policy-statement.configuration" ||
        configuration.schemaVersion !== "2.0.0" ||
        hint.property !== "resourceNode"
      )
        throw new Error("The AI catalog reference authority is unavailable.");
      return [
        hint.property,
        AWS_IAM_POLICY_RESOURCE_SCOPES_V1.filter((scope) =>
          installedServiceTypes.has(scope.resourceServiceType),
        ).map((scope) => ({
          serviceType: scope.resourceServiceType,
          attribute: scope.resourceAttribute,
        })),
      ];
    }),
  );
  const authority = {
    canonicalization,
    jsonSchema: configuration.jsonSchema,
    nodeReferenceAuthorities,
    valueSources,
  };
  return modelCatalogConfigurationValidationV1Schema.parse({
    ...authority,
    schemaDigest: digestCanonicalValue({
      ...authority,
      schemaId: configuration.schemaId,
      schemaVersion: configuration.schemaVersion,
    }),
  });
}

/** The no-argument entry uses the installed current catalog.
 * New planning passes its exact architecture binding. No abbreviated
 * service list, invented defaults or browser-supplied catalog authority. */
export function createProductionAiCatalogGrounding(
  binding: AwsCatalogBindingV1 = AWS_CURRENT_CATALOG_BINDING_V1,
) {
  const { catalog: awsCatalogV1 } = resolveAwsModelCatalogV1(binding);
  const services = awsCatalogV1.listServices();
  // A frozen catalog cannot acquire reference authority from newer services.
  const installedServiceTypes = new Set(services.map((service) => service.id));
  return modelOperationCatalogGroundingV1Schema.parse({
    manifestVersion: 1,
    catalog: {
      id: awsCatalogV1.artifact.catalog.id,
      version: awsCatalogV1.artifact.catalog.version,
      digest: awsCatalogV1.artifact.digest,
    },
    nodes: services.map((service) => ({
      serviceType: service.id,
      resourceType:
        service.nodeKind.kind === "resource"
          ? service.nodeKind.resourceType
          : service.nodeKind.boundaryType,
      configurationSchemaId: service.configuration.schemaId,
      configurationSchemaVersion: service.configuration.schemaVersion,
      configurationValidation: configurationAuthority(
        service.configuration,
        installedServiceTypes,
      ),
      placement: {
        rootPlacement: service.placement.rootPlacement,
        allowedParentTypes: service.placement.allowedParentTypes.map(
          (parent) => ({
            serviceType: parent.serviceId,
            relationshipType: parent.relationshipType,
          }),
        ),
        ...(service.placement.maximumDepth === undefined
          ? {}
          : { maximumDepth: service.placement.maximumDepth }),
      },
      ports: service.ports.map((port) => ({
        port: port.id,
        direction: port.direction,
      })),
    })),
    connectionRules: awsCatalogV1.listConnectionRules().map((rule) => ({
      ruleId: rule.id,
      ruleVersion: rule.ruleVersion,
      relationshipType: rule.relationshipType,
      configurationSchemaId: rule.configuration.schemaId,
      configurationSchemaVersion: rule.configuration.schemaVersion,
      configurationValidation: configurationAuthority(
        rule.configuration,
        installedServiceTypes,
      ),
      source: { serviceType: rule.source.serviceId, port: rule.source.portId },
      target: { serviceType: rule.target.serviceId, port: rule.target.portId },
    })),
  });
}

/** Current planning stays current-only even when historical model inputs are
 * readable through the explicit immutable-binding entry above. */
export function createCurrentProductionAiCatalogGrounding(
  binding: AwsCatalogBindingV1 = AWS_CURRENT_CATALOG_BINDING_V1,
) {
  resolveAwsCurrentCatalogV1(binding);
  return createProductionAiCatalogGrounding(binding);
}
