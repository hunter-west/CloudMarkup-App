import { createHash } from "node:crypto";

import {
  semanticVersionSchema,
  sha256DigestSchema,
  type ModelGatewayOperationV1,
} from "@cloudmarkup/schemas";

import { applicationGenerationPromptV1 } from "./application-generation.js";
import { architecturePlanningPromptV1 } from "./architecture-planning.js";
import { explanationsPromptV1 } from "./explanations.js";
import { iacExtensionGenerationPromptV1 } from "./iac-extension-generation.js";
import { repairPromptV1 } from "./repair.js";
import { repositoryInterpretationPromptV1 } from "./repository-interpretation.js";
import type {
  ModelPromptRegistry,
  PromptTemplateSourceV1,
  ReviewedPromptTemplateV1,
} from "./types.js";
import { workloadPlanningPromptV1 } from "./workload-planning.js";

const sources = [
  architecturePlanningPromptV1,
  workloadPlanningPromptV1,
  repositoryInterpretationPromptV1,
  applicationGenerationPromptV1,
  iacExtensionGenerationPromptV1,
  repairPromptV1,
  explanationsPromptV1,
] as const satisfies readonly PromptTemplateSourceV1[];

function review(source: PromptTemplateSourceV1): ReviewedPromptTemplateV1 {
  return Object.freeze({
    ...source,
    digest: sha256DigestSchema.parse(
      `sha256:${createHash("sha256").update(source.content).digest("hex")}`,
    ),
    reviewed: true,
    version: semanticVersionSchema.parse(source.version),
  });
}

export class ReviewedModelPromptRegistry implements ModelPromptRegistry {
  readonly #templates: readonly ReviewedPromptTemplateV1[];
  readonly #byOperation: ReadonlyMap<
    ModelGatewayOperationV1,
    ReviewedPromptTemplateV1
  >;

  public constructor(
    promptSources: readonly PromptTemplateSourceV1[] = sources,
  ) {
    const templates = promptSources.map(review);
    const byOperation = new Map<
      ModelGatewayOperationV1,
      ReviewedPromptTemplateV1
    >();
    for (const template of templates) {
      for (const operation of template.operations) {
        if (byOperation.has(operation)) {
          throw new Error(`Duplicate prompt registration for ${operation}.`);
        }
        byOperation.set(operation, template);
      }
    }
    this.#templates = Object.freeze(templates);
    this.#byOperation = byOperation;
  }

  public get(
    operation: ModelGatewayOperationV1,
  ): ReviewedPromptTemplateV1 | null {
    return this.#byOperation.get(operation) ?? null;
  }

  public list(): readonly ReviewedPromptTemplateV1[] {
    return this.#templates;
  }
}

export const reviewedModelPromptRegistry = new ReviewedModelPromptRegistry();
