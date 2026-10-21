import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  digestStructuredValue,
  frozenFullBetaEvaluationDatasetV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveEvaluationPlanV2Schema,
  solutionStableIdSchema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import { readStoredModelLiveObservationV2 } from "./model-live-observation-reader.js";
import { modelLiveProposalValidationReceiptV2Schema } from "./model-live-proposal-validation-codec.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import {
  liveJournalBindingSchema,
  liveJournalScope,
} from "./model-live-invocation-journal-codec.js";
import { parseLiveRuntimeRecord } from "./model-live-runtime-admission-codec.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlStatement,
} from "./sql.js";

const root = new URL("../../../../../", import.meta.url);
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
// A configured database makes this required. Missing historical preparation or
// native compiler is a failure, never a silently skipped compatibility claim.
const integration = configured ? describe : describe.skip;
const sha = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const principalSchema = z
  .object({
    principalId: solutionStableIdSchema,
    sessionId: solutionStableIdSchema,
    authenticationSource: z.literal("cognito"),
    authenticatedAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
  })
  .strict();
const capturedSchema = z
  .array(
    z
      .object({
        caseId: solutionStableIdSchema,
        validatorVersion: z.enum(["2.6.0", "2.7.0"]),
        plan: modelLiveEvaluationPlanV2Schema,
        principal: principalSchema,
        invocationId: solutionStableIdSchema,
        observation: z.unknown(),
      })
      .strict(),
  )
  .length(2);
type Capture = (input: {
  harness: ReturnType<typeof createModelAccountingPgTestHarness>;
  compiler: { executablePath: string; executableSha256: string };
}) => Promise<unknown>;
function isCapture(value: unknown): value is Capture {
  return typeof value === "function";
}
async function bounded(file: URL, maximum: number) {
  const path = fileURLToPath(file),
    stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size === 0 ||
    stat.size > maximum ||
    (await realpath(path)) !== path
  )
    throw Error(
      "Historical compatibility requires exact bounded local preparation.",
    );
  return readFile(path);
}
async function legacyCapture(useClockAdapter = false) {
  const contract = z
    .object({
      contractVersion: z.literal(1),
      sourceCommit: z.literal("a979e325b6584642d5d5a9b58631bd3599d85591"),
      sourceDirectory: z.literal(".cache/legacy-ai-a979e325"),
      outputDirectory: z.literal(".cache/legacy-ai-receipt-closure-v1"),
      sourceLockSha256: z.literal(
        "90175d72e7a150502c8438453d163e6e8837678fbf12a4d75d3aff5c15b24ca1",
      ),
      captureEntry: z.literal(
        "apps/api/src/adapters/persistence/fixtures/legacy-ai-receipt-capture.mjs",
      ),
      captureEntrySha256: hash,
      bundleSha256: hash,
      bundleFile: z.literal("packages/model-gateway/dist/capture.mjs"),
      manifestSha256: hash,
      maximumBundleBytes: z.literal(33554432),
      maximumManifestBytes: z.literal(1048576),
    })
    .strict()
    .parse(
      JSON.parse(
        (
          await bounded(
            new URL("scripts/fixtures/legacy-ai-receipt-closure-v1.json", root),
            8192,
          )
        ).toString(),
      ),
    );
  const file = new URL(
    contract.outputDirectory + "/" + contract.bundleFile,
    root,
  );
  const bytes = await bounded(file, contract.maximumBundleBytes);
  const manifestBytes = await bounded(
    new URL(contract.outputDirectory + "/manifest.json", root),
    contract.maximumManifestBytes,
  );
  expect(sha(bytes)).toBe(contract.bundleSha256);
  expect(sha(manifestBytes)).toBe(contract.manifestSha256);
  const metadata: z.infer<typeof metadataSchema> = metadataSchema.parse(
    JSON.parse(manifestBytes.toString()),
  );
  expect(metadata).toMatchObject({
    sourceCommit: contract.sourceCommit,
    sourceLockSha256: contract.sourceLockSha256,
    captureEntrySha256: contract.captureEntrySha256,
    bundle: {
      file: contract.bundleFile,
      sha256: contract.bundleSha256,
      sizeBytes: bytes.length,
    },
  });
  expect(sha(await bounded(new URL(contract.captureEntry, root), 65536))).toBe(
    contract.captureEntrySha256,
  );
  for (const asset of metadata.assets) {
    const assetBytes = await bounded(
      new URL(contract.outputDirectory + "/" + asset.path, root),
      asset.sizeBytes,
    );
    expect(assetBytes.length).toBe(asset.sizeBytes);
    expect(sha(assetBytes)).toBe(asset.sha256);
    expect(
      metadata.inputs.filter((input) => input.path === asset.path),
    ).toEqual([asset]);
  }
  let executable = file;
  if (useClockAdapter) {
    const clock = z
      .object({
        contractVersion: z.literal(2),
        sourceCommit: z.literal("a979e325b6584642d5d5a9b58631bd3599d85591"),
        baseBundleSha256: hash,
        baseManifestSha256: hash,
        adapter: z.literal("synthetic-configuration-caller-clock-only"),
        bundleFile: z.literal(
          "packages/model-gateway/dist/capture-clock-v2.mjs",
        ),
        bundleSha256: hash,
        sizeBytes: z.literal(5599794),
      })
      .strict()
      .parse(
        JSON.parse(
          (
            await bounded(
              new URL("scripts/fixtures/legacy-ai-receipt-clock-v2.json", root),
              8192,
            )
          ).toString(),
        ),
      );
    expect(clock.baseBundleSha256).toBe(sha(bytes));
    expect(clock.baseManifestSha256).toBe(sha(manifestBytes));
    executable = new URL(
      contract.outputDirectory + "/" + clock.bundleFile,
      root,
    );
    const adapted = await bounded(executable, clock.sizeBytes);
    expect(adapted.length).toBe(clock.sizeBytes);
    expect(sha(adapted)).toBe(clock.bundleSha256);
  }
  const module: unknown = await import(
    pathToFileURL(fileURLToPath(executable)).href
  );
  if (
    typeof module !== "object" ||
    module === null ||
    !("captureLegacyRepositoryReceipts" in module) ||
    !isCapture(module.captureLegacyRepositoryReceipts)
  )
    throw Error("The exact closed historical capture entry is unavailable.");
  return module.captureLegacyRepositoryReceipts;
}
const metadataSchema = z
  .object({
    contractVersion: z.literal(1),
    sourceCommit: z.literal("a979e325b6584642d5d5a9b58631bd3599d85591"),
    sourceLockSha256: hash,
    captureEntrySha256: hash,
    esbuildVersion: z.string().min(1),
    bundle: z
      .object({
        file: z.literal("packages/model-gateway/dist/capture.mjs"),
        sizeBytes: z.number().int().positive().max(33554432),
        sha256: hash,
      })
      .strict(),
    assets: z.tuple([
      z
        .object({
          path: z.literal(
            "packages/test-fixtures/fixtures/architecture-document/v3/valid/representative.json",
          ),
          sizeBytes: z.literal(7969),
          sha256: z.literal(
            "3ae0396db1c57dfbe50515ebb76286201f1f8726e67b0f9ea830b707ce45fc32",
          ),
        })
        .strict(),
      z
        .object({
          path: z.literal(
            "packages/test-fixtures/fixtures/intent-document/v1/valid/representative.json",
          ),
          sizeBytes: z.literal(10535),
          sha256: z.literal(
            "862462629fa3f6ec04068a10b87081308bc487a755ae6e1c8b9dd905d50dc3e7",
          ),
        })
        .strict(),
    ]),
    inputs: z
      .array(
        z
          .object({
            path: z.string().min(1).max(1000),
            sizeBytes: z.number().int().positive().max(33554432),
            sha256: hash,
          })
          .strict(),
      )
      .min(1)
      .max(10000),
  })
  .strict();

integration("historical fixture closure import", () => {
  it("imports the exact closed historical fixture assets before database work", async () => {
    expect(typeof (await legacyCapture())).toBe("function");
  }, 30000);
});

integration("genuine historical repository receipts across0055 to0057", () => {
  const harness = createModelAccountingPgTestHarness(configured, "0055");
  let captured: z.infer<typeof capturedSchema>;
  beforeAll(async () => {
    // V1 remains immutable. V2 changes only the synthetic helper clock; the
    // original validators, SQL, expiry checks and migration evidence still run.
    const capture = await legacyCapture(true);
    const executablePath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"],
      executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
    if (!executablePath || !executableSha256)
      throw Error("Historical receipt gate requires the pinned real compiler.");
    await harness.setup();
    captured = capturedSchema.parse(
      await capture({
        harness,
        compiler: { executablePath, executableSha256 },
      }),
    );
  }, 120000);
  afterAll(() => harness.teardown(), 30000);
  async function snapshot() {
    const result = await harness.database.query(
      sql(`SELECT
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.invocation_id) FROM model_live_invocations x) AS journal,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.invocation_id) FROM model_live_proposal_validation_receipts x) AS receipts,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ledger_entry_id) FROM usage_ledger_entries x) AS ledger,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.workflow_id,x.outcome_kind) FROM model_commercial_accounting_outcomes x) AS outcomes,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.workflow_id) FROM model_commercial_workflows x) AS workflows,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.reservation_id) FROM credit_reservations x) AS reservations,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.organization_id,x.scope_sha256) FROM model_runtime_admissions x) AS runtimes,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.organization_id,x.scope_sha256,x.workflow_id) FROM model_commercial_reservation_decisions x) AS decisions`),
    );
    return digestStructuredValue(result.rows);
  }
  it("retains original2.6/2.7 journals, quality and canonical settlement with no current-reader writes", async () => {
    const before = await snapshot();
    const historicalIdentities = await Promise.all(
      captured.map(async (original) => {
        const scope = original.plan.definition.scope;
        const found = await harness.database.query(
          sql(
            `SELECT j.binding,j.binding_sha256,r.snapshot,r.snapshot_sha256
         FROM model_live_invocations j
         JOIN model_commercial_reservation_decisions d
           ON d.organization_id=j.organization_id AND d.project_id=j.project_id
           AND d.principal_id=j.principal_id AND d.scope_sha256=j.scope_sha256
           AND d.workflow_id=j.workflow_id
         JOIN model_runtime_admissions r
           ON r.organization_id=j.organization_id AND r.project_id=j.project_id
           AND r.principal_id=j.principal_id AND r.scope_sha256=d.runtime_scope_sha256
         WHERE j.organization_id=$1 AND j.project_id=$2 AND j.principal_id=$3
           AND j.invocation_id=$4`,
            [
              scope.organizationId,
              scope.projectId,
              scope.userId,
              original.invocationId,
            ],
          ),
        );
        expect(found.rowCount).toBe(1);
        const row = found.rows[0];
        if (!row) throw Error("Historical identity row missing.");
        const binding = liveJournalBindingSchema.parse(row["binding"]);
        const runtime = parseLiveRuntimeRecord(
          row["snapshot"],
          liveJournalScope(binding),
        );
        expect(digestStructuredValue(binding).slice(7)).toBe(
          row["binding_sha256"],
        );
        expect(digestStructuredValue(runtime).slice(7)).toBe(
          row["snapshot_sha256"],
        );
        expect(binding.invocationId).toBe(original.invocationId);
        expect(binding.runtimeRequestDigest).toBe(
          runtime.request.requestDigest,
        );
        return {
          original,
          identity: {
            invocationId: binding.invocationId,
            journalBindingDigest: digestStructuredValue(binding),
            runtimeRequestDigest: runtime.request.requestDigest,
          },
        };
      }),
    );
    const oldRows = (
      await harness.database.query(
        sql(
          "SELECT receipt_record FROM model_live_proposal_validation_receipts ORDER BY invocation_id",
        ),
      )
    ).rows;
    expect(oldRows).toHaveLength(2);
    expect(
      oldRows
        .map(
          (row) =>
            modelLiveProposalValidationReceiptV2Schema.parse(
              row["receipt_record"],
            ).assessment.validatorVersion,
        )
        .sort(),
    ).toEqual(["2.6.0", "2.7.0"]);
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    await runMigrations(
      harness.database,
      migrations.filter(({ version }) => version <= "0057"),
    );
    expect(await snapshot()).toBe(before);
    expect(
      (
        await harness.database.query(
          sql("SELECT 1 FROM model_live_parser_input_receipts"),
        )
      ).rowCount,
    ).toBe(0);
    const writes: string[] = [];
    const inspect = (statement: SqlStatement) => {
      if (
        /^\s*(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/iu.test(
          statement.text,
        )
      ) {
        writes.push(statement.text);
        throw Error("Historical read attempted a write.");
      }
    };
    const wrap = (executor: SqlExecutor): SqlExecutor => ({
      query: (statement) => {
        inspect(statement);
        return executor.query(statement);
      },
    });
    const database: SqlDatabase = {
      ...wrap(harness.database),
      close: () => Promise.resolve(),
      transaction: (work) =>
        harness.database.transaction((tx) => work(wrap(tx))),
    };
    for (const { original, identity } of historicalIdentities) {
      const plan = original.plan;
      const plans = new PostgresModelLiveEvaluationPlans({
        database,
        scope: plan.definition.scope,
        principal: original.principal,
        configuration: {
          environment: plan.definition.scope.environment,
          resolveOperatorPrincipalIds: () =>
            Promise.resolve([original.principal.principalId]),
          resolveDefinition: (id) =>
            Promise.resolve(
              id === plan.definition.definitionId
                ? {
                    definition: plan.definition,
                    dataset: frozenFullBetaEvaluationDatasetV1,
                    policy: plan.definition.policy,
                  }
                : null,
            ),
        },
      });
      const input = {
        database,
        plans,
        definitionId: plan.definition.definitionId,
        planDigest: plan.planDigest,
        invocationId: original.invocationId,
      };
      const restored = await readStoredModelLiveObservationV2(input);
      const {
        invocationId,
        journalBindingDigest,
        runtimeRequestDigest,
        ...historicalObservation
      } = restored;
      expect({
        invocationId,
        journalBindingDigest,
        runtimeRequestDigest,
      }).toEqual(identity);
      expect(historicalObservation).toEqual(original.observation);
      expect(restored.observation.caseId).toBe(original.caseId);
      expect(await readStoredModelLiveObservationV2(input)).toEqual(restored);
      expect(await snapshot()).toBe(before);
    }
    expect(writes).toEqual([]);
    expect(
      (
        await harness.database.query(
          sql(
            "SELECT receipt_record FROM model_live_proposal_validation_receipts ORDER BY invocation_id",
          ),
        )
      ).rows,
    ).toEqual(oldRows);
  }, 120000);
});
