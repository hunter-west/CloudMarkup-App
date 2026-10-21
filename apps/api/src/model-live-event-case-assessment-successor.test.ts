import { describe, expect, it } from "vitest";
import { getActiveIssueRecordHash } from "@cloudmarkup/domain";
import {
  activeIssueV1Schema,
  modelGatewayUnknownV1Schema,
  sha256Text,
} from "@cloudmarkup/schemas";
import {
  inspectModelLiveEventIssueBindings,
  type EventIssueBindingInput,
} from "./model-live-event-case-assessment-successor.js";
function fixture(): EventIssueBindingInput {
  const inputDigest = sha256Text("synthetic-event-input");
  const solutionRevisionId = "revision_synthetic_event";
  const unknown = modelGatewayUnknownV1Schema.parse({
    unknownId: "missing_transform",
    blocking: true,
    question: "Which transformation should run?",
    confidence: {
      basisPoints: 8000,
      evidenceReferences: [],
      rationale: "Synthetic test source",
    },
  });
  const placeholder = activeIssueV1Schema.parse({
    contractVersion: 1,
    id: "issue_synthetic",
    recordVersion: 1,
    currentRecordDigest: sha256Text("placeholder"),
    source: "ai-generation-repair",
    sourceRecordId: unknown.unknownId,
    category: "configuration",
    severity: "warning",
    summary: unknown.question,
    technicalDetail:
      "Confirm the transformation behavior before generating application code.",
    solutionRevisionId,
    lifecycle: { state: "current" },
    affected: [{ kind: "solution-revision", solutionRevisionId }],
    closureRequirements: [],
    provenance: {
      actor: {
        kind: "model-assisted",
        modelId: "cloudmarkup.synthetic.model",
        modelVersion: "1",
        promptVersion: "1.0.0",
        providerId: "cloudmarkup.synthetic.provider",
      },
      createdAt: "2026-09-12T12:00:00.000Z",
      inputDigests: [inputDigest],
    },
  });
  const issue = activeIssueV1Schema.parse({
    ...placeholder,
    currentRecordDigest: getActiveIssueRecordHash(placeholder),
  });
  return {
    assessmentWriteAuthority: "none",
    inputDigest,
    solutionRevisionId,
    unknowns: [unknown],
    issues: [issue],
    workflows: (["guided", "professional"] as const).map(
      (assistancePreference) => ({
        assistancePreference,
        state: "needs-user-input",
        writeAuthority: "none",
        review: {
          writeAuthority: "none",
          decision: { state: "pending" },
          activeIssues: [issue],
        },
      }),
    ),
  };
}
describe("actual blocking unknown to review issue binding", () => {
  it("recognizes the exact warning in both needs-user-input flows without retaining source text", () => {
    const f = fixture(),
      result = inspectModelLiveEventIssueBindings(f);
    expect(result.satisfied).toBe(true);
    expect(JSON.stringify(result)).not.toContain("transformation");
    expect(inspectModelLiveEventIssueBindings(structuredClone(f))).toEqual(
      result,
    );
  });
  it("requires a present blocking unknown and a real pending review", () => {
    const f = fixture();
    expect(
      inspectModelLiveEventIssueBindings({
        ...f,
        assessmentWriteAuthority: "apply",
      }).satisfied,
    ).toBe(false);
    expect(
      inspectModelLiveEventIssueBindings({ ...f, unknowns: [] }).satisfied,
    ).toBe(false);
    expect(
      inspectModelLiveEventIssueBindings({
        ...f,
        unknowns: f.unknowns.map((u) => ({ ...u, blocking: false })),
      }).satisfied,
    ).toBe(false);
    expect(
      inspectModelLiveEventIssueBindings({
        ...f,
        workflows: f.workflows.map((w) => ({ ...w, review: null })),
      }).satisfied,
    ).toBe(false);
  });
  it.each([
    "source",
    "revision",
    "input",
    "summary",
    "digest",
    "severity",
    "affected",
    "stale",
    "duplicate-source",
    "duplicate-issue",
    "missing-review-issue",
    "review-ready",
    "write-authority",
    "accepted",
  ] as const)(
    "rejects %s while preserving original source identity",
    (mutation) => {
      const f = structuredClone(fixture());
      const issue = f.issues[0],
        unknown = f.unknowns[0],
        workflow = f.workflows[0];
      if (!issue || !unknown || !workflow?.review)
        throw Error("Missing synthetic issue");
      let changed = issue;
      switch (mutation) {
        case "source":
          changed = activeIssueV1Schema.parse({
            ...issue,
            sourceRecordId: "different_unknown",
          });
          break;
        case "revision":
          changed = activeIssueV1Schema.parse({
            ...issue,
            solutionRevisionId: "revision_other",
          });
          break;
        case "input":
          changed = activeIssueV1Schema.parse({
            ...issue,
            provenance: {
              ...issue.provenance,
              inputDigests: [sha256Text("other")],
            },
          });
          break;
        case "summary":
          changed = activeIssueV1Schema.parse({
            ...issue,
            summary: "Unrelated warning",
          });
          break;
        case "digest":
          changed = activeIssueV1Schema.parse({
            ...issue,
            currentRecordDigest: sha256Text("stale"),
          });
          break;
        case "severity":
          changed = activeIssueV1Schema.parse({ ...issue, severity: "error" });
          break;
        case "affected":
          changed = activeIssueV1Schema.parse({
            ...issue,
            affected: [
              {
                kind: "solution-revision",
                solutionRevisionId: "revision_other",
              },
            ],
          });
          break;
        case "stale":
          changed = activeIssueV1Schema.parse({
            ...issue,
            lifecycle: {
              state: "stale",
              staleAt: "2026-09-12T12:01:00.000Z",
              reason: "Synthetic stale source",
            },
          });
          break;
        case "duplicate-source":
          expect(
            inspectModelLiveEventIssueBindings({
              ...f,
              unknowns: [unknown, unknown],
            }).satisfied,
          ).toBe(false);
          return;
        case "duplicate-issue":
          expect(
            inspectModelLiveEventIssueBindings({ ...f, issues: [issue, issue] })
              .satisfied,
          ).toBe(false);
          return;
        case "missing-review-issue":
          expect(
            inspectModelLiveEventIssueBindings({
              ...f,
              workflows: [
                {
                  ...workflow,
                  review: { ...workflow.review, activeIssues: [] },
                },
                ...f.workflows.slice(1),
              ],
            }).satisfied,
          ).toBe(false);
          return;
        case "review-ready":
          expect(
            inspectModelLiveEventIssueBindings({
              ...f,
              workflows: f.workflows.map((w) => ({
                ...w,
                state: "review-ready",
              })),
            }).satisfied,
          ).toBe(false);
          return;
        case "write-authority":
          expect(
            inspectModelLiveEventIssueBindings({
              ...f,
              workflows: f.workflows.map((w) => ({
                ...w,
                writeAuthority: "apply",
              })),
            }).satisfied,
          ).toBe(false);
          return;
        case "accepted":
          expect(
            inspectModelLiveEventIssueBindings({
              ...f,
              workflows: [
                {
                  ...workflow,
                  review: {
                    ...workflow.review,
                    decision: { state: "accepted" },
                  },
                },
                ...f.workflows.slice(1),
              ],
            }).satisfied,
          ).toBe(false);
          return;
      }
      if (mutation !== "digest")
        changed = activeIssueV1Schema.parse({
          ...changed,
          currentRecordDigest: getActiveIssueRecordHash(changed),
        });
      const altered = {
        ...f,
        issues: [changed],
        workflows: f.workflows.map((w) => ({
          ...w,
          review:
            w.review === null ? null : { ...w.review, activeIssues: [changed] },
        })),
      };
      expect(inspectModelLiveEventIssueBindings(altered).satisfied).toBe(false);
      expect(
        inspectModelLiveEventIssueBindings(altered).bindingDigest,
      ).not.toBe(inspectModelLiveEventIssueBindings(f).bindingDigest);
    },
  );
});
