import { describe, expect, it } from "vitest";
import { awsCatalogV1 } from "./catalog-v1-accessors.js";

describe("current S3 accuracy", () => {
  it.each(["example..bucket", "example\n"])(
    "rejects %j in current configuration admission",
    (name) => {
      const input = { bucketName: { kind: "string", value: name } };
      expect(
        awsCatalogV1.validateConfiguration("aws.s3.bucket", input).success,
      ).toBe(false);
    },
  );
  // validation.test.ts owns the shared name grammar; these prove catalog wiring.
  it.each(["abc", "a".repeat(63)])(
    "accepts supported configuration %j",
    (name) => {
      const result = awsCatalogV1.validateConfiguration("aws.s3.bucket", {
        bucketName: { kind: "string", value: name },
      });
      expect(result.success).toBe(true);
      if (result.success)
        expect(result.values["bucketName"]).toEqual({
          kind: "string",
          value: name,
        });
    },
  );
});
