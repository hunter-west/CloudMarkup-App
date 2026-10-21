import { parseArchitectureDocument } from "@cloudmarkup/domain";

import {
  isAwsEventTemplateId,
  loadAwsEventTemplateArchitectureDocument,
} from "../../provider-catalog/aws-event-template-fixture.js";
import { findEventTemplate } from "./event-templates.js";

/** Route values select reviewed local data; they never supply document content. */
export function readReviewedProjectTemplate(search: string) {
  const selectors = new URLSearchParams(search).getAll("template");
  if (selectors.length === 0) return null;
  const templateId = selectors[0];
  if (
    selectors.length !== 1 ||
    templateId === undefined ||
    !isAwsEventTemplateId(templateId)
  ) {
    throw new TypeError("The selected project template is unavailable.");
  }
  const definition = findEventTemplate(templateId);
  if (definition === undefined) {
    throw new TypeError("The selected project template is unavailable.");
  }
  return {
    architectureDocument: parseArchitectureDocument(
      loadAwsEventTemplateArchitectureDocument(templateId),
    ),
    definition,
  };
}
