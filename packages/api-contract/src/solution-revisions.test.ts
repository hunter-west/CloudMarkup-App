import { describe, expect, it } from "vitest";

import {
  createSolutionRevisionV1Schema,
  solutionRevisionSummaryV1Schema,
} from "./solution-revisions.js";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;

describe("Solution Revision API contract v1", () => {
  it("accepts only an exact persisted draft selector and immutable name", () => {
    expect(
      createSolutionRevisionV1Schema.parse({
        contractVersion: 1,
        draftId: "draft_notes",
        draftVersion: 4,
        name: "Reviewed notes API",
      }),
    ).toEqual({
      contractVersion: 1,
      draftId: "draft_notes",
      draftVersion: 4,
      name: "Reviewed notes API",
    });

    expect(
      createSolutionRevisionV1Schema.safeParse({
        architectureHash: digestA,
        contractVersion: 1,
        draftId: "draft_notes",
        draftVersion: 4,
        name: "Untrusted hashes",
        organizationId: "organization_other",
        workloadHash: digestB,
      }).success,
    ).toBe(false);
  });

  it("represents infrastructure-only coverage without pretending an application exists", () => {
    expect(
      solutionRevisionSummaryV1Schema.parse({
        architectureRevisionId: "revision_notes_1",
        contentDigest: digestA,
        createdAt: "2026-08-15T12:00:00.000Z",
        createdBy: {
          displayName: "Local Owner",
          id: "principal_local_owner",
        },
        documentDigest: digestB,
        generationCoverage: {
          contractVersion: 1,
          evidence: [],
          missingRequirements: [],
          solutionRevisionId: "solution_local_1",
          state: "infrastructure-only",
          workloads: [],
        },
        name: "Infrastructure baseline",
        projectId: "project_infrastructure",
        semanticDigest: digestA,
        solutionRevisionId: "solution_local_1",
        sourceDraftId: "draft_infrastructure",
        sourceDraftVersion: 3,
        visualDigest: digestB,
      }).generationCoverage.state,
    ).toBe("infrastructure-only");
  });

  it("rejects summary coverage for another Solution Revision", () => {
    expect(
      solutionRevisionSummaryV1Schema.safeParse({
        architectureRevisionId: "revision_notes_1",
        contentDigest: digestA,
        createdAt: "2026-08-15T12:00:00.000Z",
        createdBy: {
          displayName: "Local Owner",
          id: "principal_local_owner",
        },
        documentDigest: digestB,
        generationCoverage: {
          contractVersion: 1,
          evidence: [],
          missingRequirements: [],
          solutionRevisionId: "solution_other_1",
          state: "custom-implementation-required",
          workloads: [],
        },
        name: "Mismatched",
        projectId: "project_notes",
        semanticDigest: digestA,
        solutionRevisionId: "solution_local_1",
        sourceDraftId: "draft_notes",
        sourceDraftVersion: 3,
        visualDigest: digestB,
      }).success,
    ).toBe(false);
  });
});
