import {
  validateArchitectureDocumentWithRules,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  AWS_CATALOG_DIGEST_V1,
  awsCatalogV1,
} from "@cloudmarkup/provider-aws/catalog";
import { awsValidationRulesV1 } from "@cloudmarkup/provider-aws/validation";

import type { EditorValidationEvaluator } from "../features/editor/validation/editor-validation.js";

function assertExactAwsCatalog(document: ArchitectureDocument): void {
  const artifact = awsCatalogV1.artifact;
  if (
    document.provider.id !== artifact.provider.id ||
    document.catalog.id !== artifact.catalog.id ||
    document.catalog.version !== artifact.catalog.version ||
    document.catalog.digest !== AWS_CATALOG_DIGEST_V1
  ) {
    throw new TypeError(
      "The AWS validation evaluator requires the exact bundled provider catalog.",
    );
  }
}

/**
 * Exact AWS composition for the local editor fixture. Unknown imported
 * resources are omitted from an honestly partial port inventory; known service
 * ports always come from the pinned catalog accessor.
 */
const evaluator: EditorValidationEvaluator = {
  environment: "unknown",
  evaluate({ document, target }) {
    assertExactAwsCatalog(document);
    const knownNodes = document.nodes.filter(
      (node) =>
        awsCatalogV1.getService(node.semantic.serviceType) !== undefined,
    );
    const portInventory = awsCatalogV1.createPortInventory(
      knownNodes.map((node) => ({
        nodeId: node.id,
        serviceId: node.semantic.serviceType,
      })),
      knownNodes.length === document.nodes.length ? "complete" : "partial",
    );

    return validateArchitectureDocumentWithRules({
      additionalRules: awsValidationRulesV1,
      document,
      environment: "unknown",
      portInventory,
      target,
    });
  },
};

export const awsEditorValidationEvaluator = Object.freeze(evaluator);
