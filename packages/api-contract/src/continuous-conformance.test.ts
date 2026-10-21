import { describe, expect, it } from "vitest";

import {
  continuousConformancePathV1Schema,
  continuousConformanceResponseV1Schema,
} from "./continuous-conformance.js";
import { apiOperationsV1 } from "./operations.js";

describe("continuous conformance API contract", () => {
  it("binds one project, Solution Revision, and environment", () => {
    expect(
      continuousConformancePathV1Schema.parse({
        environmentId: "env_conformance_1",
        projectId: "project_conformance_1",
        solutionRevisionId: "solution_revision_conformance_1",
      }),
    ).toEqual({
      environmentId: "env_conformance_1",
      projectId: "project_conformance_1",
      solutionRevisionId: "solution_revision_conformance_1",
    });
  });

  it("rejects malformed paths and incomplete report envelopes", () => {
    expect(
      continuousConformancePathV1Schema.safeParse({
        environmentId: "../other",
        projectId: "project_conformance_1",
        solutionRevisionId: "solution_revision_conformance_1",
      }).success,
    ).toBe(false);
    expect(
      continuousConformanceResponseV1Schema.safeParse({ data: {} }).success,
    ).toBe(false);
  });

  it("registers a principal-protected read-only operation", () => {
    expect(apiOperationsV1["continuous-conformance.get"]).toMatchObject({
      method: "GET",
      path: "/v1/projects/:projectId/solution-revisions/:solutionRevisionId/environments/:environmentId/conformance",
      security: "principal",
      successStatus: 200,
    });
  });
});
