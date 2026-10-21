import { canonicalJson, sha256Digest } from "./constants.js";
import {
  emitDeterministicFile,
  type ApplicationReadmeMetadata,
  type EmittedSourceFile,
  type SourceProvenance,
} from "./source-emitter.js";
import type { ResolvedHttpNoContentWorkload } from "./http-no-content-types.js";

export function emitHttpNoContentSource(
  workloads: readonly ResolvedHttpNoContentWorkload[],
  metadata: ApplicationReadmeMetadata,
): readonly EmittedSourceFile[] {
  const files: EmittedSourceFile[] = [];
  const root: SourceProvenance = {
    workloadIds: workloads.map((workload) => workload.workloadId).sort(),
    operationIds: [],
    contractIds: [],
    edgeIds: [],
    environmentBindingIds: [],
    resourceTargetKeys: [],
    extensionPointIds: [],
  };
  const add = (
    path: string,
    content: string,
    provenance: SourceProvenance = root,
  ) =>
    files.push(
      emitDeterministicFile({
        path,
        content,
        mediaType: path.endsWith(".json")
          ? "application/json"
          : path.endsWith(".md")
            ? "text/markdown"
            : "text/typescript",
        ownership: "generated",
        semanticDiff: path.endsWith(".json") ? "canonical-json" : "byte-exact",
        provenance,
      }),
    );
  const packageJson = canonicalJson({
    name: "@cloudmarkup/generated-application",
    version: "0.0.0",
    private: true,
    type: "module",
    engines: { node: ">=24.0.0 <25" },
    packageManager: "pnpm@11.16.0",
    dependencies: {},
    devDependencies: {
      "@types/node": "24.13.3",
      typescript: "6.0.3",
      vitest: "4.1.10",
    },
  });
  add("application/package.json", packageJson);
  add(
    "application/tsconfig.json",
    canonicalJson({
      compilerOptions: {
        exactOptionalPropertyTypes: true,
        lib: ["ES2024"],
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noUncheckedIndexedAccess: true,
        outDir: "dist",
        rootDir: ".",
        strict: true,
        target: "ES2024",
        types: ["node"],
      },
      include: ["src/**/*.ts", "tests/**/*.ts"],
    }),
  );
  // The build envelope supplies exact dependencies and immutable source checksums.
  add(
    "application/lockfile.contract.json",
    canonicalJson({
      contractVersion: 1,
      packageManager: { id: "pnpm", version: "11.16.0" },
      policy: "resolve-only-in-prompt-32a-isolated-builder",
      packageManifestDigest: sha256Digest(packageJson),
    }),
  );
  add(
    "application/README.md",
    `# Authenticated no-content API\n\nThis explicit pattern returns an empty HTTP 204 for its declared authenticated GET route. It performs no data access, network calls or business logic. Missing authorizer context is denied. API Gateway's compiled managed JWT authorizer owns token signature, issuer, audience and expiry verification. Direct handler tests do not replace authorizer integration evidence.\n\nSolution revision: ${metadata.solutionRevisionId}\nGenerator: ${metadata.generator.id}@${metadata.generator.version}\n\nThe generator does not execute, install, build or deploy source. The isolated builder must complete the checks in application/build-contracts before an application artifact is ready.\n`,
  );
  for (const workload of [...workloads].sort((a, b) =>
    a.deploymentKey < b.deploymentKey
      ? -1
      : a.deploymentKey > b.deploymentKey
        ? 1
        : 0,
  )) {
    const operation = workload.operations[0];
    if (operation === undefined || workload.auth === undefined)
      throw new TypeError(
        "Resolved no-content operation and auth are required.",
      );
    const provenance: SourceProvenance = {
      workloadIds: [workload.workloadId],
      operationIds: [operation.id],
      contractIds: [
        operation.routeContractId,
        operation.behaviorContractId,
        workload.auth.contractId,
        ...workload.tests.map((test) => test.testCaseContractId),
      ].sort(),
      edgeIds: [
        operation.triggerEdgeId,
        ...workload.authenticationEdgeIds,
      ].sort(),
      environmentBindingIds: [],
      resourceTargetKeys: [],
      extensionPointIds: [],
    };
    const auth = workload.auth;
    const roles = auth.roles.filter((role) =>
      operation.permittedRoleIds.includes(role.roleId),
    );
    const contract = {
      routeKey: operation.routeKey,
      path: operation.pathTemplate,
      claims: auth.claimNames,
      roles: roles.map((role) =>
        role.claimRequirements.map((claim) => claim.claimName),
      ),
    };
    add(
      `application/src/functions/${workload.deploymentKey}/index.ts`,
      `// Authentication is supplied by the compiled managed JWT authorizer. Never parse an Authorization header here.
const contract = ${canonicalJson(contract).trimEnd()} as const;
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function empty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
}
export function handler(input: unknown): { statusCode: number; body: string } {
  const event = record(input);
  const context = record(event["requestContext"]);
  const claims = record(record(record(context["authorizer"])["jwt"])["claims"]);
  const hasClaim = (name: string) => typeof claims[name] === "string" && (claims[name] as string).length > 0;
  if (!contract.claims.every(hasClaim) || !contract.roles.some((role) => role.every(hasClaim))) return { statusCode: 403, body: "" };
  if (event["version"] !== "2.0" || event["routeKey"] !== contract.routeKey || event["rawPath"] !== contract.path || record(context["http"])["method"] !== "GET") return { statusCode: 404, body: "" };
  if ((event["body"] !== undefined && event["body"] !== null && event["body"] !== "") || event["isBase64Encoded"] === true || (event["rawQueryString"] !== undefined && event["rawQueryString"] !== "") || !empty(event["queryStringParameters"]) || !empty(event["pathParameters"])) return { statusCode: 400, body: "" };
  return { statusCode: 204, body: "" };
}
`,
      provenance,
    );
    const claims = Object.fromEntries(
      auth.claimNames.map((claim) => [claim, "synthetic-verified-claim"]),
    );
    const fixture = canonicalJson({
      version: "2.0",
      routeKey: operation.routeKey,
      rawPath: operation.pathTemplate,
      requestContext: {
        http: { method: "GET" },
        authorizer: { jwt: { claims } },
      },
    });
    for (const level of ["unit", "contract"] as const) {
      const test = workload.tests.find(
        (candidate) => candidate.level === level,
      );
      if (test === undefined)
        throw new TypeError("Resolved no-content tests are required.");
      const checks =
        level === "unit"
          ? `
  it("denies missing or malformed verified authorizer context", () => {
    for (const input of [null, {}, { ...event, requestContext: {} }, { ...event, requestContext: { ...event.requestContext, authorizer: { jwt: { claims: { sub: "" } } } } }]) expect(handler(input)).toEqual({ statusCode: 403, body: "" });
  });
  it("denies an undeclared route and undeclared business input", () => {
    expect(handler({ ...event, routeKey: "GET /unknown" })).toEqual({ statusCode: 404, body: "" });
    expect(handler({ ...event, body: "unexpected" })).toEqual({ statusCode: 400, body: "" });
  });`
          : `
  it("returns only the explicit empty 204 for the authenticated route", () => {
    expect(handler(event)).toEqual({ statusCode: 204, body: "" });
    expect(handler(event)).toEqual(handler(event));
  });`;
      add(
        `application/tests/functions/${workload.deploymentKey}/${level === "unit" ? "unit" : "contracts"}.test.ts`,
        `import { describe, expect, it } from "vitest";
import { handler } from "../../../src/functions/${workload.deploymentKey}/index.js";
const event = ${fixture};
describe(${JSON.stringify(test.testCaseContractId + "@" + test.testCaseContractVersion)}, () => {${checks}
});
`,
        provenance,
      );
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
