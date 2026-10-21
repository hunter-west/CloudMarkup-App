import { createHash } from "node:crypto";

import { serializeCanonicalJson } from "@cloudmarkup/schemas";

import type {
  ProviderCatalogArtifactV1,
  ProviderConnectionRuleDescriptorV1,
  ProviderPortDefinitionV1,
} from "./catalog-contract-v1.js";
import { parseVerifiedProviderCatalogArtifactV1 } from "./compiler.js";
import {
  PROVIDER_CONNECTION_PRESENTATION_ARTIFACT_KIND,
  PROVIDER_CONNECTION_PRESENTATION_CANONICALIZATION,
  providerConnectionPresentationArtifactV1Schema,
  providerConnectionPresentationSourceV1Schema,
  type ProviderConnectionDockV1,
  type ProviderConnectionPresentationArtifactContentV1,
  type ProviderConnectionPresentationArtifactV1,
  type ProviderConnectionPresentationSourceV1,
} from "./connection-presentation-contract-v1.js";

export {
  createProviderConnectionPresentationAccessorsV1,
  type ProviderConnectionPresentationAccessorsV1,
} from "./connection-presentation-accessors-v1.js";

type PresentationSchemaIssue = Extract<
  ReturnType<typeof providerConnectionPresentationSourceV1Schema.safeParse>,
  { success: false }
>["error"]["issues"][number];

export type ProviderConnectionPresentationValidationIssueCode =
  | "catalog-binding-mismatch"
  | "direction-placement-mismatch"
  | "direction-policy-mismatch"
  | "duplicate-dock-id"
  | "duplicate-dock-order"
  | "duplicate-port-assignment"
  | "duplicate-relationship-label"
  | "duplicate-service-presentation"
  | "exclusive-relationship-mismatch"
  | "invalid-cardinality"
  | "invalid-catalog-artifact"
  | "invalid-contract"
  | "missing-port-assignment"
  | "missing-relationship-label"
  | "missing-service-presentation"
  | "mixed-direction-dock"
  | "unknown-port"
  | "unknown-relationship-rule"
  | "unknown-service";

export interface ProviderConnectionPresentationValidationIssueV1 {
  readonly code: ProviderConnectionPresentationValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface CompiledProviderConnectionPresentationV1 {
  readonly artifact: ProviderConnectionPresentationArtifactV1;
  readonly hash: ProviderConnectionPresentationArtifactV1["digest"];
  readonly canonicalJson: string;
}

export interface ProviderConnectionPresentationAccessorModuleOptions {
  readonly artifactImportPath: string;
  readonly artifactExportName: string;
  readonly accessorsExportName: string;
  readonly digestExportName: string;
}

const issueMessages: Readonly<
  Record<ProviderConnectionPresentationValidationIssueCode, string>
> = Object.freeze({
  "catalog-binding-mismatch":
    "The presentation source must bind the exact semantic catalog ID, version, and digest.",
  "direction-placement-mismatch":
    "An input-only dock must be placed on the left and an output-only dock must be placed on the right.",
  "direction-policy-mismatch":
    "A dock direction policy must agree with every assigned semantic port.",
  "duplicate-dock-id": "Connection dock IDs must be globally unique.",
  "duplicate-dock-order":
    "Connection docks on the same service side must use unique order values.",
  "duplicate-port-assignment":
    "Every semantic port must be assigned to exactly one connection dock.",
  "duplicate-relationship-label":
    "Every semantic connection rule must have exactly one relationship label.",
  "duplicate-service-presentation":
    "Every semantic service must have exactly one presentation declaration.",
  "exclusive-relationship-mismatch":
    "A dock containing a single-cardinality semantic port must declare that it contains exclusive relationships.",
  "invalid-cardinality":
    "Dock cardinality must agree with its assigned semantic ports, exact connection rules, and multiple-edge metadata.",
  "invalid-catalog-artifact":
    "Connection presentation must be compiled against a valid semantic catalog artifact.",
  "invalid-contract": "The connection presentation contract is invalid.",
  "missing-port-assignment":
    "Every semantic port must be assigned to exactly one connection dock.",
  "missing-relationship-label":
    "Every semantic connection rule must have exactly one relationship label.",
  "missing-service-presentation":
    "Every semantic service must have exactly one presentation declaration.",
  "mixed-direction-dock":
    "Input and output semantic ports must use separate directional docks.",
  "unknown-port":
    "A connection dock references a semantic port that is not declared by its service.",
  "unknown-relationship-rule":
    "A relationship label references a semantic connection rule that does not exist.",
  "unknown-service":
    "A connection presentation references a semantic service that does not exist.",
});

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === "number") {
      return `${formatted}[${String(segment)}]`;
    }

    const key = String(segment);
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
      ? `${formatted}.${key}`
      : `${formatted}[${JSON.stringify(key)}]`;
  }, "$");
}

function createIssue(
  code: ProviderConnectionPresentationValidationIssueCode,
  path: string,
): ProviderConnectionPresentationValidationIssueV1 {
  return Object.freeze({ code, path, message: issueMessages[code] });
}

export function sortIssues<
  T extends { readonly code: string; readonly path: string },
>(issues: readonly T[]): T[] {
  const seen = new Set<string>();
  return [...issues]
    .sort((left, right) => {
      const pathOrder = compareStrings(left.path, right.path);
      return pathOrder === 0
        ? compareStrings(left.code, right.code)
        : pathOrder;
    })
    .filter((issue) => {
      const key = `${issue.code}\u0000${issue.path}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

export class ProviderConnectionPresentationCompilationError extends Error {
  readonly issues: readonly ProviderConnectionPresentationValidationIssueV1[];

  constructor(
    issues: readonly ProviderConnectionPresentationValidationIssueV1[],
  ) {
    super("Provider connection presentation compilation failed.");
    this.name = "ProviderConnectionPresentationCompilationError";
    this.issues = Object.freeze(sortIssues(issues));
  }
}

function collectStructuralIssues(
  issues: readonly PresentationSchemaIssue[],
): ProviderConnectionPresentationValidationIssueV1[] {
  return issues.map((issue) =>
    createIssue("invalid-contract", formatPath(issue.path)),
  );
}

function validateDockDirection(
  dock: ProviderConnectionDockV1,
  directions: ReadonlySet<"input" | "output">,
): boolean {
  switch (dock.directionPolicy) {
    case "input-only":
      return directions.size === 1 && directions.has("input");
    case "output-only":
      return directions.size === 1 && directions.has("output");
    case "mixed":
      return directions.has("input") && directions.has("output");
  }
}

function validateDockPlacement(
  dock: ProviderConnectionDockV1,
  dockPath: string,
): ProviderConnectionPresentationValidationIssueV1[] {
  if (dock.directionPolicy === "mixed") {
    return [createIssue("mixed-direction-dock", `${dockPath}.directionPolicy`)];
  }

  const expectedPlacement =
    dock.directionPolicy === "input-only" ? "left" : "right";
  return dock.placement === expectedPlacement
    ? []
    : [createIssue("direction-placement-mismatch", `${dockPath}.placement`)];
}

function endpointLimitForPort(
  rule: ProviderConnectionRuleDescriptorV1,
  serviceId: string,
  portId: string,
): number | undefined {
  if (rule.source.serviceId === serviceId && rule.source.portId === portId) {
    return rule.maximumConnectionsPerSource;
  }
  if (rule.target.serviceId === serviceId && rule.target.portId === portId) {
    return rule.maximumConnectionsPerTarget;
  }
  return undefined;
}

function validateDockCardinality(
  dock: ProviderConnectionDockV1,
  serviceId: string,
  ports: readonly ProviderPortDefinitionV1[],
  rules: readonly ProviderConnectionRuleDescriptorV1[],
  dockPath: string,
): ProviderConnectionPresentationValidationIssueV1[] {
  const issues: ProviderConnectionPresentationValidationIssueV1[] = [];
  const endpointLimits = rules.flatMap((rule) =>
    ports.flatMap((port) => {
      const limit = endpointLimitForPort(rule, serviceId, String(port.id));
      return limit === undefined ? [] : [limit];
    }),
  );
  const hasSinglePort = ports.some((port) => port.cardinality === "one");
  const hasRequiredPort = ports.some((port) => port.required);

  if (
    (hasSinglePort || dock.cardinality.maximum === 1) &&
    !dock.containsExclusiveRelationships
  ) {
    issues.push(
      createIssue(
        "exclusive-relationship-mismatch",
        `${dockPath}.containsExclusiveRelationships`,
      ),
    );
  }

  const multipleRange = dock.cardinality.maximum === "many";
  if (dock.allowsMultipleEdges !== multipleRange) {
    issues.push(createIssue("invalid-cardinality", `${dockPath}.cardinality`));
  }

  if (hasRequiredPort && dock.cardinality.minimum === 0) {
    issues.push(createIssue("invalid-cardinality", `${dockPath}.cardinality`));
  }

  if (dock.cardinality.maximum === 1) {
    const portAllowsMany = ports.some((port) => port.cardinality === "many");
    const ruleAllowsMany = endpointLimits.some((limit) => limit > 1);
    if (portAllowsMany || ruleAllowsMany) {
      issues.push(
        createIssue("invalid-cardinality", `${dockPath}.cardinality`),
      );
    }
  } else {
    const hasMultipleEvidence =
      ports.length > 1 || ports.some((port) => port.cardinality === "many");
    if (!hasMultipleEvidence) {
      issues.push(
        createIssue("invalid-cardinality", `${dockPath}.cardinality`),
      );
    }
  }

  if (dock.cardinality.enforcement === "semantic-port") {
    const semanticMinimum = hasRequiredPort ? 1 : 0;
    const semanticMaximum =
      ports.length > 1 || ports.some((port) => port.cardinality === "many")
        ? "many"
        : 1;
    if (
      dock.cardinality.minimum !== semanticMinimum ||
      dock.cardinality.maximum !== semanticMaximum
    ) {
      issues.push(
        createIssue("invalid-cardinality", `${dockPath}.cardinality`),
      );
    }
  }

  return issues;
}

function validatePresentationSemantics(
  source: ProviderConnectionPresentationSourceV1,
  catalog: ProviderCatalogArtifactV1,
): ProviderConnectionPresentationValidationIssueV1[] {
  const issues: ProviderConnectionPresentationValidationIssueV1[] = [];

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
  const sourceServiceIds = new Set<string>();
  const dockIds = new Set<string>();

  source.services.forEach((presentation, serviceIndex) => {
    const servicePath = `$.services[${String(serviceIndex)}]`;
    const serviceId = String(presentation.serviceId);
    if (sourceServiceIds.has(serviceId)) {
      issues.push(
        createIssue(
          "duplicate-service-presentation",
          `${servicePath}.serviceId`,
        ),
      );
    }
    sourceServiceIds.add(serviceId);

    const service = catalogServicesById.get(serviceId);
    if (service === undefined) {
      issues.push(createIssue("unknown-service", `${servicePath}.serviceId`));
      return;
    }

    const portsById = new Map(
      service.ports.map((port) => [String(port.id), port]),
    );
    const assignedPortIds = new Set<string>();
    const occupiedOrders = new Set<string>();

    presentation.docks.forEach((dock, dockIndex) => {
      const dockPath = `${servicePath}.docks[${String(dockIndex)}]`;
      const dockId = String(dock.id);
      if (dockIds.has(dockId)) {
        issues.push(createIssue("duplicate-dock-id", `${dockPath}.id`));
      }
      dockIds.add(dockId);

      const orderKey = `${dock.placement}\u0000${String(dock.order)}`;
      if (occupiedOrders.has(orderKey)) {
        issues.push(createIssue("duplicate-dock-order", `${dockPath}.order`));
      }
      occupiedOrders.add(orderKey);

      const directions = new Set<"input" | "output">();
      const assignedPorts: ProviderPortDefinitionV1[] = [];
      dock.portIds.forEach((portId, portIndex) => {
        const portPath = `${dockPath}.portIds[${String(portIndex)}]`;
        const portIdString = String(portId);
        const port = portsById.get(portIdString);
        if (port === undefined) {
          issues.push(createIssue("unknown-port", portPath));
          return;
        }
        assignedPorts.push(port);
        directions.add(port.direction);
        if (assignedPortIds.has(portIdString)) {
          issues.push(createIssue("duplicate-port-assignment", portPath));
        }
        assignedPortIds.add(portIdString);
      });

      if (directions.size > 0 && !validateDockDirection(dock, directions)) {
        issues.push(
          createIssue(
            "direction-policy-mismatch",
            `${dockPath}.directionPolicy`,
          ),
        );
      }
      issues.push(...validateDockPlacement(dock, dockPath));

      const matchingRules = catalog.connectionRules.filter((rule) =>
        assignedPorts.some(
          (port) =>
            endpointLimitForPort(rule, serviceId, String(port.id)) !==
            undefined,
        ),
      );
      issues.push(
        ...validateDockCardinality(
          dock,
          serviceId,
          assignedPorts,
          matchingRules,
          dockPath,
        ),
      );
    });

    service.ports.forEach((port) => {
      if (!assignedPortIds.has(String(port.id))) {
        issues.push(
          createIssue(
            "missing-port-assignment",
            `${servicePath}.docks[${JSON.stringify(String(port.id))}]`,
          ),
        );
      }
    });
  });

  catalog.services.forEach((service) => {
    if (!sourceServiceIds.has(String(service.id))) {
      issues.push(
        createIssue(
          "missing-service-presentation",
          `$.services[${JSON.stringify(String(service.id))}]`,
        ),
      );
    }
  });

  const catalogRuleIds = new Set(
    catalog.connectionRules.map((rule) => String(rule.id)),
  );
  const labeledRuleIds = new Set<string>();
  source.relationshipLabels.forEach((relationship, index) => {
    const path = `$.relationshipLabels[${String(index)}].ruleId`;
    const ruleId = String(relationship.ruleId);
    if (!catalogRuleIds.has(ruleId)) {
      issues.push(createIssue("unknown-relationship-rule", path));
    }
    if (labeledRuleIds.has(ruleId)) {
      issues.push(createIssue("duplicate-relationship-label", path));
    }
    labeledRuleIds.add(ruleId);
  });

  catalog.connectionRules.forEach((rule) => {
    if (!labeledRuleIds.has(String(rule.id))) {
      issues.push(
        createIssue(
          "missing-relationship-label",
          `$.relationshipLabels[${JSON.stringify(String(rule.id))}]`,
        ),
      );
    }
  });

  return issues;
}

function normalizePresentationSource(
  source: ProviderConnectionPresentationSourceV1,
): ProviderConnectionPresentationSourceV1 {
  return {
    ...source,
    catalog: { ...source.catalog },
    services: source.services
      .map((service) => ({
        ...service,
        docks: service.docks
          .map((dock) => ({
            ...dock,
            cardinality: { ...dock.cardinality },
            portIds: [...dock.portIds].sort(compareStrings),
          }))
          .sort((left, right) =>
            compareStrings(String(left.id), String(right.id)),
          ),
      }))
      .sort((left, right) =>
        compareStrings(String(left.serviceId), String(right.serviceId)),
      ),
    relationshipLabels: [...source.relationshipLabels].sort((left, right) =>
      compareStrings(String(left.ruleId), String(right.ruleId)),
    ),
  };
}

export function validateProviderConnectionPresentationSourceV1(
  input: unknown,
  semanticCatalogInput: unknown,
): ProviderConnectionPresentationSourceV1 {
  const catalog = parseVerifiedProviderCatalogArtifactV1(semanticCatalogInput);
  if (catalog === undefined) {
    throw new ProviderConnectionPresentationCompilationError([
      createIssue("invalid-catalog-artifact", "$semanticCatalog"),
    ]);
  }

  const sourceResult =
    providerConnectionPresentationSourceV1Schema.safeParse(input);
  if (!sourceResult.success) {
    throw new ProviderConnectionPresentationCompilationError(
      collectStructuralIssues(sourceResult.error.issues),
    );
  }

  const issues = validatePresentationSemantics(sourceResult.data, catalog);
  if (issues.length > 0) {
    throw new ProviderConnectionPresentationCompilationError(issues);
  }

  return normalizePresentationSource(sourceResult.data);
}

export function compileProviderConnectionPresentationV1(
  input: unknown,
  semanticCatalogInput: unknown,
): CompiledProviderConnectionPresentationV1 {
  const source = validateProviderConnectionPresentationSourceV1(
    input,
    semanticCatalogInput,
  );
  const content: ProviderConnectionPresentationArtifactContentV1 = {
    kind: PROVIDER_CONNECTION_PRESENTATION_ARTIFACT_KIND,
    canonicalization: PROVIDER_CONNECTION_PRESENTATION_CANONICALIZATION,
    ...source,
  };
  const contentCanonicalJson = serializeCanonicalJson(content);
  const digest = `sha256:${createHash("sha256")
    .update(contentCanonicalJson, "utf8")
    .digest("hex")}` as ProviderConnectionPresentationArtifactV1["digest"];
  const artifact = providerConnectionPresentationArtifactV1Schema.parse({
    ...content,
    digest,
  });

  return Object.freeze({
    artifact,
    hash: digest,
    canonicalJson: serializeCanonicalJson(artifact),
  });
}

function assertTypeScriptIdentifier(value: string, field: string): void {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value)) {
    throw new TypeError(`${field} must be a TypeScript identifier.`);
  }
}

export function assertAccessorModuleOptions(
  options: ProviderConnectionPresentationAccessorModuleOptions,
): void {
  assertTypeScriptIdentifier(options.artifactExportName, "artifactExportName");
  assertTypeScriptIdentifier(
    options.accessorsExportName,
    "accessorsExportName",
  );
  assertTypeScriptIdentifier(options.digestExportName, "digestExportName");
  if (
    !/^\.{1,2}\/[A-Za-z0-9_./-]+\.json$/u.test(options.artifactImportPath) ||
    options.artifactImportPath.split("/").includes("..")
  ) {
    throw new TypeError(
      "artifactImportPath must be a non-traversing relative JSON path.",
    );
  }
}

export function renderProviderConnectionPresentationAccessorModuleV1(
  compilation: CompiledProviderConnectionPresentationV1,
  options: ProviderConnectionPresentationAccessorModuleOptions,
): string {
  assertAccessorModuleOptions(options);

  return `// Generated by @cloudmarkup/provider-sdk. Do not edit by hand.
import {
  createProviderConnectionPresentationAccessorsV1,
  providerConnectionPresentationArtifactV1Schema,
} from "@cloudmarkup/provider-sdk";

import presentationArtifactJson from ${JSON.stringify(options.artifactImportPath)} with { type: "json" };

export const ${options.digestExportName} =
  ${JSON.stringify(compilation.hash)} as const;

export const ${options.artifactExportName} =
  providerConnectionPresentationArtifactV1Schema.parse(
    presentationArtifactJson,
  );

export const ${options.accessorsExportName} =
  createProviderConnectionPresentationAccessorsV1(
    ${options.artifactExportName},
  );
`;
}
