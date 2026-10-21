import type { ProviderServiceConfigurationV1 } from "./catalog-contract-v1.js";

const credentialName =
  /^(?:password|passwd|secret|token|authorization|credential|credentials|client[-_]?secret|access[-_]?token|refresh[-_]?token|api[-_]?key|private[-_]?key|access[-_]?key)$/iu;
const credentialTextName =
  /password|secret|credential|private.?key|access.?key|token/iu;

/** Catalog-declared numeric/boolean security policy metadata is not credential
 * material. Text remains conservatively excluded by name. Callers must still
 * validate types/bounds and inspect values for secret candidates. */
export function isReviewedLiteralConfigurationPropertyV1(
  configuration: ProviderServiceConfigurationV1,
  key: string,
): boolean {
  const property = Object.entries(configuration.jsonSchema.properties).find(
    ([name]) => name === key,
  )?.[1];
  const hint = configuration.uiHints.find((field) => field.property === key);
  if (
    !property ||
    hint?.valueSource !== "literal" ||
    hint.securityImpact === "secret-reference" ||
    credentialName.test(key)
  )
    return false;
  if (
    property.type === "number" ||
    property.type === "integer" ||
    property.type === "boolean"
  )
    return true;
  if (credentialTextName.test(key)) return false;
  return (
    property.type === "string" ||
    ("items" in property && property.items.type === "string")
  );
}
