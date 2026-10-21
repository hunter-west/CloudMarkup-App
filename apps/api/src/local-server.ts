import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import {
  API_CONTRACT_VERSION,
  apiErrorEnvelopeV1Schema,
  MAX_JSON_REQUEST_BYTES,
  type ApiErrorCode,
} from "@cloudmarkup/api-contract";
import {
  defaultConformanceStalenessPolicyV1,
  sha256DigestSchema,
  solutionRevisionIdSchema,
  versionedToolReferenceV1Schema,
} from "@cloudmarkup/schemas";

import { createApp } from "./app.js";
import { LOCAL_CORS_EXPOSED_HEADERS_VALUE_V1 } from "./local-cors-policy.js";
import { FilesystemObjectStore } from "./adapters/persistence/filesystem-object-store.js";
import { PostgresDatabase } from "./adapters/persistence/postgres-driver.js";
import { PostgresCloudMarkupRepository } from "./adapters/persistence/repositories.js";
import { PostgresProjectEditingLeases } from "./adapters/persistence/project-editing-leases.js";
import { PostgresSolutionRecordRepository } from "./adapters/persistence/solution-record-repository.js";
import { sql } from "./adapters/persistence/sql.js";
import { ContinuousConformanceApplicationService } from "./application/continuous-conformance.js";
import { ComposingContinuousConformanceReportSource } from "./application/continuous-conformance-composition.js";
import { InMemoryLocalConformanceIssueHistory } from "./local-development/in-memory-conformance-issue-history.js";
import { InMemoryLocalConformanceReportSnapshots } from "./local-development/in-memory-conformance-report-snapshots.js";
import { VerifiedManifestDeclaredLocalConformanceInputSource } from "./local-development/verified-manifest-conformance-source.js";
import { createRepositoryBackedLocalApplication } from "./local-development/local-application.js";
import { createLocalInMemorySeed } from "./local-development/local-fixtures.js";
import { LocalDeterministicValidationBridge } from "./local-development/local-validation-bridge.js";
import {
  createLocalPrincipalResolver,
  LOCAL_IDENTITY_TOKENS,
} from "./local-development/local-principals.js";
import {
  InMemoryCloudMarkupApplication,
  StaticReadinessProbe,
} from "./testing/in-memory-adapters.js";

const HOST = "127.0.0.1";
const PORT = 8_787;
const WEB_ORIGIN = "http://127.0.0.1:4173";

class LocalHttpBridgeError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = "LocalHttpBridgeError";
    this.code = code;
    this.status = status;
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function assertLocalModes(): void {
  const expected = {
    CLOUDMARKUP_BILLING_MODE: "fake",
    CLOUDMARKUP_IDENTITY_MODE: "local",
    CLOUDMARKUP_JOB_MODE: "fake",
    CLOUDMARKUP_OBJECT_STORE_MODE: "filesystem",
    CLOUDMARKUP_RUNTIME_ENVIRONMENT: "local",
  } as const;
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("The local API refuses NODE_ENV=production.");
  }
  for (const [name, value] of Object.entries(expected)) {
    if (process.env[name] !== value) {
      throw new Error(`${name} must be ${value}.`);
    }
  }
}

async function readRequestBody(
  request: IncomingMessage,
): Promise<Uint8Array | undefined> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const unsafeChunk of request) {
    const chunk: unknown = unsafeChunk;
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
      throw new LocalHttpBridgeError(
        "internal_error",
        "The local API could not process the request.",
        500,
      );
    }
    const bytes =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    size += bytes.byteLength;
    if (size > MAX_JSON_REQUEST_BYTES) {
      throw new LocalHttpBridgeError(
        "payload_too_large",
        "The request body exceeds the local API limit.",
        413,
      );
    }
    chunks.push(bytes);
  }
  if (size === 0) {
    return undefined;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function copyRequestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        headers.append(name, entry);
      });
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function addCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", WEB_ORIGIN);
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Idempotency-Key, If-Match",
  );
  response.setHeader(
    "Access-Control-Allow-Methods",
    "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT",
  );
  response.setHeader(
    "Access-Control-Expose-Headers",
    LOCAL_CORS_EXPOSED_HEADERS_VALUE_V1,
  );
  response.setHeader("Vary", "Origin");
}

async function main(): Promise<void> {
  assertLocalModes();
  const databaseUrl = requireEnvironment("CLOUDMARKUP_DATABASE_URL");
  const objectRoot = requireEnvironment("CLOUDMARKUP_FILESYSTEM_OBJECT_ROOT");
  await mkdir(objectRoot, { recursive: true });
  const database = new PostgresDatabase({
    application_name: "cloudmarkup-local-api",
    connectionString: databaseUrl,
    max: 5,
  });
  await database.query(sql("SELECT 1"));

  const repository = new PostgresCloudMarkupRepository(database, {
    draftEditingLeases: "required",
  });
  const objectStore = new FilesystemObjectStore(objectRoot);
  const solutionRecords = new PostgresSolutionRecordRepository(database);
  const fallback = new InMemoryCloudMarkupApplication(
    createLocalInMemorySeed(),
  );
  const application = createRepositoryBackedLocalApplication({
    draftEditingLeases: "required",
    fallback,
    objectStore,
    repository,
    solution: {
      solutionRecords,
      validation: new LocalDeterministicValidationBridge({
        database,
        objectStore,
        repository,
      }),
    },
  });
  const conformanceRoot =
    process.env["CLOUDMARKUP_LOCAL_CONFORMANCE_REPOSITORY_ROOT"];
  const conformanceOrganizationId =
    process.env["CLOUDMARKUP_LOCAL_CONFORMANCE_ORGANIZATION_ID"];
  const conformanceCurrentRevisionId =
    process.env["CLOUDMARKUP_LOCAL_CURRENT_SOLUTION_REVISION_ID"];
  const conformanceCurrentRevisionDigest =
    process.env["CLOUDMARKUP_LOCAL_CURRENT_SOLUTION_REVISION_DIGEST"];
  const conformanceConfiguration = [
    conformanceRoot,
    conformanceOrganizationId,
    conformanceCurrentRevisionId,
    conformanceCurrentRevisionDigest,
  ];
  const conformanceConfigured = conformanceConfiguration.every(
    (value) => value !== undefined,
  );
  if (
    !conformanceConfigured &&
    conformanceConfiguration.some((value) => value !== undefined)
  ) {
    throw new Error(
      "Local conformance repository, tenant, and current Solution Revision must be configured together.",
    );
  }
  const trustedCurrentSolutionRevision = conformanceConfigured
    ? {
        digest: sha256DigestSchema.parse(conformanceCurrentRevisionDigest),
        id: solutionRevisionIdSchema.parse(conformanceCurrentRevisionId),
      }
    : null;
  const conformanceEvaluator = versionedToolReferenceV1Schema.parse({
    id: "cloudmarkup.continuous-conformance",
    version: "1.0.0",
  });
  const conformanceIssueHistory = new InMemoryLocalConformanceIssueHistory();
  const conformanceReportSnapshots =
    new InMemoryLocalConformanceReportSnapshots();
  const continuousConformance = new ContinuousConformanceApplicationService({
    access: {
      authorizeProject: async (principal, projectId, permission) => {
        if (permission !== "projects.read") {
          throw new Error("Local conformance requires project read access.");
        }
        const project = await application.getProject(principal, projectId);
        return { organizationId: project.value.organizationId };
      },
    },
    source: new ComposingContinuousConformanceReportSource({
      clock: () => new Date(),
      evaluator: conformanceEvaluator,
      issueUpdates: conformanceIssueHistory,
      snapshots: conformanceReportSnapshots,
      source:
        conformanceRoot === undefined || conformanceOrganizationId === undefined
          ? { get: () => Promise.resolve(null) }
          : new VerifiedManifestDeclaredLocalConformanceInputSource({
              organizationId: conformanceOrganizationId,
              root: conformanceRoot,
            }),
      stalenessPolicy: defaultConformanceStalenessPolicyV1,
      trustedContext: {
        get: (scope) =>
          Promise.resolve(
            trustedCurrentSolutionRevision === null ||
              scope.organizationId !== conformanceOrganizationId
              ? null
              : {
                  currentSolutionRevision: trustedCurrentSolutionRevision,
                  previousIssues: conformanceIssueHistory.latest(scope),
                },
          ),
      },
    }),
  });
  const hono = createApp({
    projectEditingLeases: new PostgresProjectEditingLeases(database),
    application,
    continuousConformance,
    principalResolver: createLocalPrincipalResolver(),
    readiness: new StaticReadinessProbe([
      { name: "filesystem-object-store", ready: true },
      { name: "fake-billing", ready: true },
      { name: "fake-jobs", ready: true },
      { name: "postgresql", ready: true },
    ]),
  });

  const handleRequest = async (
    incoming: IncomingMessage,
    outgoing: ServerResponse,
  ): Promise<void> => {
    addCorsHeaders(outgoing);
    if (incoming.method === "OPTIONS") {
      outgoing.writeHead(204);
      outgoing.end();
      return;
    }
    try {
      const body = await readRequestBody(incoming);
      const request = new Request(
        `http://${HOST}:${String(PORT)}${incoming.url ?? "/"}`,
        {
          ...(body === undefined ? {} : { body }),
          headers: copyRequestHeaders(incoming),
          method: incoming.method ?? "GET",
        },
      );
      const response = await hono.fetch(request);
      for (const [name, value] of response.headers) {
        outgoing.setHeader(name, value);
      }
      addCorsHeaders(outgoing);
      outgoing.writeHead(response.status);
      if (incoming.method !== "HEAD") {
        outgoing.write(new Uint8Array(await response.arrayBuffer()));
      }
      outgoing.end();
    } catch (cause) {
      const error =
        cause instanceof LocalHttpBridgeError
          ? cause
          : new LocalHttpBridgeError(
              "internal_error",
              "The local API could not process the request.",
              500,
            );
      const correlationId = randomUUID();
      const payload = apiErrorEnvelopeV1Schema.parse({
        apiVersion: API_CONTRACT_VERSION,
        error: {
          code: error.code,
          correlationId,
          message: error.message,
        },
      });
      outgoing.setHeader("Content-Type", "application/json; charset=utf-8");
      outgoing.setHeader("X-Correlation-Id", correlationId);
      outgoing.writeHead(error.status);
      outgoing.end(JSON.stringify(payload));
    }
  };
  const server = createServer((incoming, outgoing) => {
    void handleRequest(incoming, outgoing);
  });

  const shutdown = async (): Promise<void> => {
    server.close();
    await database.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(PORT, HOST, () => {
      resolvePromise();
    });
  });
  process.stdout.write(
    `CloudMarkup local API: http://${HOST}:${String(PORT)}\n`,
  );
  process.stdout.write(
    "Authorization: Bearer local-development:<token>, where <token> is one of:\n",
  );
  for (const token of LOCAL_IDENTITY_TOKENS) {
    process.stdout.write(`  ${token}\n`);
  }
}

await main();
