import { describe, expect, it } from "vitest";
import { awsCatalogV1 } from "./catalog-v1-accessors.js";
describe("current nested policy placement", () => {
  it("permits graph-backed documents, statements and conditions at their declared depths", () => {
    for (const [id, depth] of Object.entries({
      "aws.iam.policy-document": 4,
      "aws.iam.policy-statement": 5,
      "aws.iam.policy-condition": 6,
    }))
      expect(awsCatalogV1.requireService(id).placement.maximumDepth).toBe(
        depth,
      );
  });
});
