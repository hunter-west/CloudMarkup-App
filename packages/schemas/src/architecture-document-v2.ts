import { z } from "zod";

import {
  architectureDocumentV1Schema,
  type ArchitectureDocumentV1,
} from "./architecture-document-v1.js";
import { workloadBehaviorV1Schema } from "./workload-behavior-v1.js";

export const architectureDocumentV2Schema = architectureDocumentV1Schema
  .omit({ schemaVersion: true })
  .extend({
    schemaVersion: z.literal(2),
    workloadBehavior: workloadBehaviorV1Schema,
  })
  .strict();

export type ArchitectureDocumentV2 = z.output<
  typeof architectureDocumentV2Schema
>;
export type VersionedArchitectureDocument =
  ArchitectureDocumentV1 | ArchitectureDocumentV2;

export function generateArchitectureDocumentV2JsonSchema() {
  const generated = z.toJSONSchema(architectureDocumentV2Schema, {
    io: "input",
    target: "draft-2020-12",
  });

  return {
    ...generated,
    $id: "https://schemas.cloudmarkup.com/architecture-document/v2.schema.json",
    title: "Cloud Markup Architecture Document v2",
  };
}
