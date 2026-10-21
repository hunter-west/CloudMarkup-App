import { providerServiceConfigurationV1Schema } from "@cloudmarkup/provider-sdk";

export function emptyConfiguration(
  schemaId: string,
  title: string,
  description: string,
) {
  return providerServiceConfigurationV1Schema.parse({
    schemaId,
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `urn:cloudmarkup:configuration:${schemaId}:1.0.0`,
      type: "object",
      title,
      description,
      additionalProperties: false,
      properties: {},
      required: [],
    },
    uiHints: [],
  });
}
