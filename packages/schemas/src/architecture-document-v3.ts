import { z } from "zod";

import { applicationContractsV1Schema } from "./application-contracts-v1.js";
import type { ArchitectureDocumentV1 } from "./architecture-document-v1.js";
import {
  architectureDocumentV2Schema,
  type ArchitectureDocumentV2,
} from "./architecture-document-v2.js";
import { externalResourceReferenceDocumentV1Schema } from "./external-resource-reference-v1.js";
import { workloadBehaviorV2Schema } from "./workload-behavior-v2.js";

function revisionsMatch(
  left: {
    readonly createdAt: string;
    readonly createdBy: string;
    readonly previousRevisionId?: string | undefined;
    readonly revisionId: string;
    readonly revisionNumber: number;
  },
  right: {
    readonly createdAt: string;
    readonly createdBy: string;
    readonly previousRevisionId?: string | undefined;
    readonly revisionId: string;
    readonly revisionNumber: number;
  },
): boolean {
  return (
    left.revisionId === right.revisionId &&
    left.revisionNumber === right.revisionNumber &&
    left.createdAt === right.createdAt &&
    left.createdBy === right.createdBy &&
    left.previousRevisionId === right.previousRevisionId
  );
}

export const architectureDocumentV3Schema = architectureDocumentV2Schema
  .omit({ schemaVersion: true, workloadBehavior: true })
  .extend({
    applicationContracts: applicationContractsV1Schema,
    externalResources: externalResourceReferenceDocumentV1Schema,
    schemaVersion: z.literal(3),
    workloadBehavior: workloadBehaviorV2Schema,
  })
  .strict()
  .superRefine((document, context) => {
    if (
      document.externalResources.documentId !== document.documentId ||
      document.externalResources.architectureId !== document.architectureId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "External Resource truth must bind the containing architecture identity.",
        path: ["externalResources"],
      });
    }
    if (
      !revisionsMatch(document.externalResources.revision, document.revision)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "External Resource truth must bind the containing immutable revision.",
        path: ["externalResources", "revision"],
      });
    }
    if (document.applicationContracts.documentId !== document.documentId) {
      context.addIssue({
        code: "custom",
        message:
          "Application Contracts must bind the containing document identity.",
        path: ["applicationContracts", "documentId"],
      });
    }
    if (
      !revisionsMatch(document.applicationContracts.revision, document.revision)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Application Contracts must bind the containing immutable revision.",
        path: ["applicationContracts", "revision"],
      });
    }
  });

export type ArchitectureDocumentV3 = z.output<
  typeof architectureDocumentV3Schema
>;
export type VersionedArchitectureDocument =
  ArchitectureDocumentV1 | ArchitectureDocumentV2 | ArchitectureDocumentV3;

export function generateArchitectureDocumentV3JsonSchema() {
  const generated = z.toJSONSchema(architectureDocumentV3Schema, {
    io: "input",
    target: "draft-2020-12",
  });

  return {
    ...generated,
    $id: "https://schemas.cloudmarkup.com/architecture-document/v3.schema.json",
    title: "Cloud Markup Architecture Document v3",
  };
}
