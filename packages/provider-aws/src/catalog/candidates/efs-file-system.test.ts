import { validateProviderServiceConfigurationV1 } from "@cloudmarkup/provider-sdk";
import { describe, expect, it } from "vitest";
import { awsCatalogV1 } from "../../catalog-v1-accessors.js";
import {
  AWS_CURRENT_CATALOG_BINDING_V1,
  resolveAwsCurrentCatalogV1,
} from "../../current-catalog.js";
import { efsFileSystemCandidate } from "./efs-file-system.js";

describe("uninstalled EFS foundation", () => {
  it("validates safe defaults without exposing EFS in the installed catalog", () => {
    expect(efsFileSystemCandidate.configuration.jsonSchema.properties).toEqual({
      fileSystemType: {
        type: "string",
        enum: ["regional"],
        default: "regional",
      },
      encrypted: {
        type: "boolean",
        const: true,
        default: true,
      },
      encryptionMode: {
        type: "string",
        enum: ["aws-managed"],
        default: "aws-managed",
      },
      performanceMode: {
        type: "string",
        enum: ["generalPurpose"],
        default: "generalPurpose",
      },
      throughputMode: {
        type: "string",
        enum: ["bursting"],
        default: "bursting",
      },
      preventDestroy: {
        type: "boolean",
        const: true,
        default: true,
      },
    });
    expect(efsFileSystemCandidate.configuration.jsonSchema.required).toEqual([
      "fileSystemType",
      "encrypted",
      "encryptionMode",
      "performanceMode",
      "throughputMode",
      "preventDestroy",
    ]);
    expect(
      efsFileSystemCandidate.configuration.jsonSchema.additionalProperties,
    ).toBe(false);
    expect(
      efsFileSystemCandidate.configuration.uiHints.every(
        (hint) => hint.valueSource === "literal",
      ),
    ).toBe(true);
    expect(efsFileSystemCandidate.supportLevel).toBe("proof");
    expect(efsFileSystemCandidate.ports).toEqual([]);
    expect(
      efsFileSystemCandidate.mappings.map(
        (mapping) => mapping.implementationStatus,
      ),
    ).toEqual(["metadata-only", "metadata-only"]);
    const result = validateProviderServiceConfigurationV1(
      efsFileSystemCandidate,
      {},
    );
    expect(result).toEqual({
      success: true,
      values: {
        fileSystemType: { kind: "string", value: "regional" },
        encrypted: { kind: "boolean", value: true },
        encryptionMode: { kind: "string", value: "aws-managed" },
        performanceMode: { kind: "string", value: "generalPurpose" },
        throughputMode: { kind: "string", value: "bursting" },
        preventDestroy: { kind: "boolean", value: true },
      },
    });
    expect(awsCatalogV1.getService(efsFileSystemCandidate.id)).toBeUndefined();
    expect(
      resolveAwsCurrentCatalogV1(AWS_CURRENT_CATALOG_BINDING_V1).catalog,
    ).toBe(awsCatalogV1);
  });
});
