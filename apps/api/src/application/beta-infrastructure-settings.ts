import {
  isReviewedLiteralConfigurationPropertyV1,
  validateProviderConfigurationV1,
  type ProviderServiceConfigurationV1,
} from "@cloudmarkup/provider-sdk";
import type { ConfigurationValue } from "@cloudmarkup/schemas";

type Settings = Readonly<Record<string, string | number | boolean | string[]>>;
function writableProperty(
  configuration: ProviderServiceConfigurationV1,
  key: string,
  reviewedMetadata: boolean,
) {
  return (
    isReviewedLiteralConfigurationPropertyV1(configuration, key) &&
    (reviewedMetadata ||
      !/password|secret|credential|private.?key|access.?key|token/iu.test(key))
  );
}

/** Advertise only the literal fields representable by proposal v5. The model's
 * transport limits can be narrower than the provider's own limits. */
export function projectBetaInfrastructureConfiguration(
  configuration: ProviderServiceConfigurationV1,
  reviewedMetadata = true,
) {
  const entries = Object.entries(configuration.jsonSchema.properties);
  const properties = Object.fromEntries(
    entries
      .filter(([key]) => writableProperty(configuration, key, reviewedMetadata))
      .map(([key, property]) => [
        key,
        property.type === "array" && property.items.type === "string"
          ? {
              ...property,
              maxItems: Math.min(property.maxItems ?? 16, 16),
              items: { ...property.items, maxLength: 256 },
            }
          : property.type === "string"
            ? {
                ...property,
                maxLength: Math.min(property.maxLength ?? 256, 256),
              }
            : property,
      ]),
  );
  return {
    configuration: {
      ...configuration.jsonSchema,
      properties,
      required: configuration.jsonSchema.required.filter((key) =>
        Object.hasOwn(properties, key),
      ),
    },
    unsupportedConfigurationKeys: entries
      .filter(([key]) => !Object.hasOwn(properties, key))
      .map(([key]) => key),
  };
}

/** Validate only explicitly supplied settings. Do not apply the validator's
 * defaults: omitted current values are unknown, never instructions to reset. */
export function validBetaInfrastructureSettings(
  configuration: ProviderServiceConfigurationV1,
  settings: Settings,
  reviewedMetadata = true,
): boolean {
  if (
    Object.keys(settings).some(
      (key) => !writableProperty(configuration, key, reviewedMetadata),
    )
  )
    return false;
  const values = Object.fromEntries(
    Object.entries(settings).map(
      ([key, value]): [string, ConfigurationValue] => [
        key,
        Array.isArray(value)
          ? { kind: "string-list", value }
          : typeof value === "number"
            ? {
                kind:
                  Object.entries(configuration.jsonSchema.properties).find(
                    ([property]) => property === key,
                  )?.[1]?.type === "integer"
                    ? "integer"
                    : "number",
                value,
              }
            : typeof value === "boolean"
              ? { kind: "boolean", value }
              : { kind: "string", value },
      ],
    ),
  );
  return validateProviderConfigurationV1(
    {
      ...configuration,
      jsonSchema: {
        ...configuration.jsonSchema,
        properties: Object.fromEntries(
          Object.entries(configuration.jsonSchema.properties).filter(([key]) =>
            Object.hasOwn(settings, key),
          ),
        ),
        required: [],
      },
    },
    values,
  ).success;
}
