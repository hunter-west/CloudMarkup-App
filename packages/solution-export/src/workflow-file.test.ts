import { describe, expect, it } from "vitest";

import {
  NO_CREDENTIAL_PULL_REQUEST_WORKFLOW,
  NO_CREDENTIAL_PULL_REQUEST_WORKFLOW_PATH,
} from "./export-service.js";
import { inspectMediaType } from "./security.js";

describe("credentialless pull-request validation workflow", () => {
  it("is a pinned, read-only, no-deployment workflow that is safe to preview", () => {
    expect(NO_CREDENTIAL_PULL_REQUEST_WORKFLOW_PATH).toBe(
      ".github/workflows/cloudmarkup-validate.yml",
    );
    expect(
      inspectMediaType(
        NO_CREDENTIAL_PULL_REQUEST_WORKFLOW_PATH,
        "application/yaml",
        "generated-replaceable",
      ),
    ).toBeUndefined();
    expect(NO_CREDENTIAL_PULL_REQUEST_WORKFLOW).toContain(
      "permissions:\n  contents: read",
    );
    expect(NO_CREDENTIAL_PULL_REQUEST_WORKFLOW).toContain(
      "persist-credentials: false",
    );
    expect(NO_CREDENTIAL_PULL_REQUEST_WORKFLOW).toContain(
      "actions/checkout@de0fac2e",
    );
    expect(NO_CREDENTIAL_PULL_REQUEST_WORKFLOW).toContain(
      "actions/setup-node@48b55a0",
    );
    expect(NO_CREDENTIAL_PULL_REQUEST_WORKFLOW).not.toMatch(
      /id-token: write|contents: write|terraform apply|deploy/i,
    );
  });
});
