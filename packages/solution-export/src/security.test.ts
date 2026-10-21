import { describe, expect, it } from "vitest";

import { inspectMediaType } from "./security.js";

describe("solution export media-type inspection", () => {
  it("admits the exact Terraform variables example basename as reviewed HCL", () => {
    expect(
      inspectMediaType(
        "infrastructure/terraform.tfvars.example",
        "application/vnd.hashicorp.terraform",
        "generated-replaceable",
      ),
    ).toBeUndefined();
  });

  it.each([
    "infrastructure/customer.tfvars.example",
    "infrastructure/terraform.tfvars.example.txt",
    "application/terraform-config.example",
  ])("rejects Terraform media type for unreviewed example path %s", (path) => {
    expect(
      inspectMediaType(
        path,
        "application/vnd.hashicorp.terraform",
        "generated-replaceable",
      )?.code,
    ).toBe("EXPORT_MEDIA_TYPE_MISMATCH");
  });
  it("rejects plain text for the reviewed Terraform variables example", () => {
    expect(
      inspectMediaType(
        "infrastructure/terraform.tfvars.example",
        "text/plain",
        "generated-replaceable",
      )?.code,
    ).toBe("EXPORT_MEDIA_TYPE_MISMATCH");
  });
});
