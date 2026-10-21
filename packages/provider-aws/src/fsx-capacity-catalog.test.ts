import { describe, expect, it } from "vitest";
import { awsCatalogV1 } from "./catalog-v1-accessors.js";

describe("versioned FSx capacity catalog", () => {
  it("enforces the one-pair ONTAP schema for current configurations", () => {
    const id = "aws.fsx.ontap-file-system";
    expect(awsCatalogV1.validateConfiguration(id, {}).success).toBe(false);
    for (const throughput of [1536, 3072, 6144]) {
      expect(
        awsCatalogV1.validateConfiguration(id, {
          throughputCapacity: { kind: "integer", value: throughput },
        }).success,
      ).toBe(true);
    }
    for (const throughput of [384, 768]) {
      expect(
        awsCatalogV1.validateConfiguration(id, {
          throughputCapacity: { kind: "integer", value: throughput },
        }).success,
      ).toBe(false);
    }
    for (const capacity of [1024, 524288])
      expect(
        awsCatalogV1.validateConfiguration(id, {
          storageCapacity: { kind: "integer", value: capacity },
          throughputCapacity: { kind: "integer", value: 1536 },
        }).success,
      ).toBe(true);
    for (const capacity of [524289, 1048576]) {
      const values = { storageCapacity: { kind: "integer", value: capacity } };
      expect(awsCatalogV1.validateConfiguration(id, values).success).toBe(
        false,
      );
    }
  });
  it("declares accurate Lustre field guidance and an authoritative validator", () => {
    const service = awsCatalogV1.requireService("aws.fsx.lustre-file-system");
    expect(service.validationRuleIds).toContain(
      "aws.cloudmarkup.validation.fsx-storage-capacity",
    );
    expect(
      service.configuration.uiHints.find(
        (h) => h.property === "storageCapacity",
      )?.helpText,
    ).toContain("1,200 GiB or a multiple of 2,400 GiB");
  });
});
