import {
  applyGraphCommand,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  parseGraphCommandV1,
  type GraphCommandActionV1,
} from "@cloudmarkup/schemas";

import {
  hasExactEditorCatalogBinding,
  resolveExactEditorCatalogRelationship,
  resolveExactEditorCatalogService,
} from "./catalog-selection.js";
import type {
  EditorCatalog,
  EditorCatalogConfiguration,
} from "./editor-catalog.js";

export interface CatalogOpeningIssue {
  readonly path: string;
  readonly message: string;
}

export interface EditorCatalogOpening {
  readonly status: "current" | "compatible" | "review-required" | "unavailable";
  /** The source is never changed. Only a validated, lossless candidate is returned. */
  readonly document: ArchitectureDocument;
  readonly issues: readonly CatalogOpeningIssue[];
}

/** Opening a mutable draft is separate from approving an immutable export.
 * Catalog additions need no data migration. Schema identity changes require an
 * explicit review; unavailable definitions never authorize dropping resources.
 */
export function prepareEditorCatalogOpening(
  input: ArchitectureDocument,
  catalog: EditorCatalog,
): EditorCatalogOpening {
  const source = parseArchitectureDocument(input);
  if (hasExactEditorCatalogBinding(source, catalog)) {
    return { status: "current", document: source, issues: [] };
  }
  const issues: CatalogOpeningIssue[] = [];
  const unavailable = (message: string): EditorCatalogOpening => ({
    status: "unavailable",
    document: source,
    issues: [{ path: "$.catalog", message }],
  });
  if (
    source.provider.id !== catalog.providerId ||
    source.catalog.id !== catalog.identity.id
  ) {
    return unavailable(
      "The installed catalog describes a different provider or catalog. Keep the original project and request a reviewed provider migration.",
    );
  }
  if (
    !/^\d+\.\d+\.\d+$/u.test(source.catalog.version) ||
    !/^\d+\.\d+\.\d+$/u.test(catalog.identity.version)
  ) {
    return unavailable(
      "A prerelease catalog change requires an explicit reviewed migration. The saved project is retained.",
    );
  }
  const sourceVersion = source.catalog.version.split(".").map(Number);
  const targetVersion = catalog.identity.version.split(".").map(Number);
  const firstDifference = sourceVersion.findIndex(
    (value, index) => value !== targetVersion[index],
  );
  if (
    firstDifference !== -1 &&
    (sourceVersion[firstDifference] ?? 0) >
      (targetVersion[firstDifference] ?? 0)
  ) {
    return unavailable(
      "This project was saved with a newer catalog. Open it with that release or a newer one; do not downgrade its configuration.",
    );
  }

  let nextId = 0;
  const envelope = () => ({
    schemaVersion: 1,
    commandId: `operation_catalog_open_${String(++nextId)}`,
    inverseCommandId: `operation_catalog_open_${String(++nextId)}`,
    origin: "user",
    target: {
      documentId: source.documentId,
      architectureId: source.architectureId,
      revisionId: source.revision.revisionId,
    },
  });
  const bindingCommand = parseGraphCommandV1({
    ...envelope(),
    kind: "replace-catalog-binding",
    expectedCatalog: source.catalog,
    catalog: catalog.identity,
  });
  const candidate = applyGraphCommand(source, bindingCommand).document;
  const actions: GraphCommandActionV1[] = [];
  const blockers: CatalogOpeningIssue[] = [];
  const issue = (path: string, message: string) => {
    const problem = { path, message };
    blockers.push(problem);
    issues.push(problem);
  };
  function configuration(
    stored: ArchitectureDocument["nodes"][number]["semantic"]["configuration"],
    definition: EditorCatalogConfiguration,
    path: string,
    target: { readonly nodeId: string } | { readonly edgeId: string },
  ) {
    if (stored.schemaId !== definition.schemaId) {
      issue(
        path,
        "The configuration schema was replaced. A reviewed migration must map its fields; the saved configuration is retained.",
      );
      return;
    }
    const unknown = Object.keys(stored.values).filter(
      (property) =>
        !definition.fields.some((field) => field.property === property),
    );
    for (const property of unknown) {
      issue(
        path + ".values." + property,
        "This saved field is not described by the current schema. Its value is retained; request an explicit field mapping before adaptation.",
      );
    }
    if (unknown.length > 0) return;
    let result;
    try {
      result = definition.validate(structuredClone(stored.values));
    } catch {
      issue(
        path,
        "The current configuration validator is unavailable. The saved configuration is retained; retry with a working catalog release.",
      );
      return;
    }
    if (!result.success) {
      for (const problem of result.issues) {
        issue(
          path + problem.path.replace(/^\$/u, ""),
          problem.message +
            " The saved value is retained; review this field against the current service schema.",
        );
      }
      return;
    }
    if (stored.schemaVersion !== definition.schemaVersion) {
      issues.push({
        path,
        message: `Review configuration schema ${stored.schemaVersion} → ${definition.schemaVersion}. All saved values pass the current validator and will be retained unchanged. Review service behavior before applying this adaptation.`,
      });
      const action = parseGraphCommandV1({
        ...envelope(),
        ...target,
        kind:
          "nodeId" in target
            ? "update-node-configuration"
            : "update-edge-configuration",
        expectedConfiguration: stored,
        configuration: { ...stored, schemaVersion: definition.schemaVersion },
      });
      if (action.kind !== "batch") actions.push(action);
    }
  }
  for (const [index, node] of candidate.nodes.entries()) {
    const path = `$.nodes[${String(index)}].semantic`;
    const service = resolveExactEditorCatalogService(candidate, node, catalog);
    if (service?.supportState !== "available") {
      issue(
        path + ".serviceType",
        `Service ${node.semantic.serviceType} / ${node.semantic.resourceType} is unavailable. Keep this resource and its connections; request a reviewed replacement mapping.`,
      );
      continue;
    }
    configuration(
      node.semantic.configuration,
      service.configuration,
      path + ".configuration",
      { nodeId: node.id },
    );
    const parent = node.semantic.parent;
    const parentNode = candidate.nodes.find(
      (entry) => entry.id === parent?.nodeId,
    );
    if (
      parent === undefined
        ? service.placement.rootPlacement === "forbidden"
        : service.placement.rootPlacement === "required" ||
          !service.placement.allowedParents.some(
            (allowed) =>
              allowed.serviceType === parentNode?.semantic.serviceType &&
              allowed.relationshipType === parent.relationshipType,
          )
    ) {
      issue(
        path + ".parent",
        "The current catalog does not allow this saved placement. Review the parent relationship without removing the resource or its connections.",
      );
    }
  }
  for (const [index, edge] of candidate.edges.entries()) {
    const path = `$.edges[${String(index)}].semantic`;
    const relationship = resolveExactEditorCatalogRelationship(
      candidate,
      edge,
      catalog,
    );
    if (relationship === undefined) {
      issue(
        path + ".relationshipType",
        `Connection ${edge.semantic.relationshipType} or its endpoint ports is unavailable. Keep the connection and review an explicit replacement rule.`,
      );
      continue;
    }
    configuration(
      edge.semantic.configuration,
      relationship.configuration,
      path + ".configuration",
      { edgeId: edge.id },
    );
  }
  if (blockers.length > 0)
    return { status: "unavailable", document: source, issues };
  if (actions.length === 0)
    return { status: "compatible", document: candidate, issues };
  if (actions.length > 255)
    return unavailable(
      "This project needs more schema changes than one atomic adaptation supports. Request a reviewed staged migration; the saved project is retained.",
    );
  const batch = parseGraphCommandV1({
    ...envelope(),
    kind: "batch",
    commands: [bindingCommand, ...actions],
  });
  try {
    return {
      status: "review-required",
      document: applyGraphCommand(source, batch).document,
      issues,
    };
  } catch {
    return unavailable(
      "The schema adaptation could not pass the atomic graph command checks. Keep the original and request a reviewed migration that respects generated-resource ownership and references.",
    );
  }
}
