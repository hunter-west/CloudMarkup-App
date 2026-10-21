import { it, expectTypeOf } from "vitest";
import type { ApiRequestV1, ApiResponseV1 } from "./client.js";
it("keeps required fields and operation unions correlated", () => {
  expectTypeOf<ApiRequestV1<"account.authenticator.start">>().toExtend<{
    headers: { "x-cloudmarkup-account": string };
    body: { contractVersion: 1; attemptId: string; acknowledgedRecovery: true };
  }>();
  expectTypeOf<
    ApiRequestV1<"account.authenticator.get">["body"]
  >().toEqualTypeOf<undefined>();
  interface Mixed {
    headers: { "x-cloudmarkup-account": string };
    body: { contractVersion: 1; attemptId: string; acknowledgedRecovery: true };
    path: { projectId: string };
  }
  expectTypeOf<
    Mixed extends ApiRequestV1<"account.authenticator.start" | "projects.get">
      ? true
      : false
  >().toEqualTypeOf<false>();
});

it("requires a repository discovery body and project path while preserving ID coercion", () => {
  expectTypeOf<ApiRequestV1<"github-repository-discovery.read">>().toExtend<{
    body: {
      contractVersion: 1;
      branch: string;
      commitSha: string;
      integrationId: string;
      repositoryId: unknown;
      selectedPaths: string[];
      ignoredPaths: string[];
    };
    path: { projectId: string };
  }>();
});

it("returns a numeric repository identifier after discovery validation", () => {
  expectTypeOf<
    ApiResponseV1<"github-repository-discovery.read">["data"]["repositoryId"]
  >().toEqualTypeOf<number>();
});
