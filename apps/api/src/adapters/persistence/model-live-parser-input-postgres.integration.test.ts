import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { syntheticRepositoryCase } from "../../model-live-repository-test-helpers.js";
import { prepareProductionModelLiveProposalValidation } from "../../production-model-live-proposal-validation.js";
import { modelLiveRepositoryCaseAssessmentV2Schema } from "../../model-live-repository-case-assessment.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import {
  issueModelLiveParserInputReceipt,
  readModelLiveParserInputReceipt,
} from "./model-live-parser-input.js";
import { identifyModelLiveParserInputReceipt } from "./model-live-parser-input-codec.js";
import { identifyLiveProposalValidationReceipt } from "./model-live-proposal-validation-codec.js";
import {
  sql,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const executablePath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"];
const executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
const integration =
  configured && executablePath && executableSha256 ? describe : describe.skip;

/** Real pinned parser and isolated PostgreSQL only. Model responses, accounting
 * seeds and scopes are explicitly synthetic; there is no provider invocation. */
integration("immutable pre-inference parser input issuance", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(async () => {
    await harness.setup();
  }, 120000);
  afterAll(() => harness.teardown(), 30000);
  async function fixture() {
    if (!executablePath || !executableSha256)
      throw Error("Pinned parser required");
    const sample = syntheticRepositoryCase("ambiguous-source-code-inference");
    const f = await createLiveHostEvidencePgFixture(
      harness,
      "candidate",
      true,
      true,
      "standard",
      {
        request: sample.request,
        caseId: sample.evaluationCase.caseId,
        fullBeta: true,
      },
    );
    if (!f.executionInput || !f.liveRouting)
      throw Error("Actual issued input required");
    const execution = f.executionInput,
      context = f.liveRouting.context;
    const options = {
      plans: f.plans,
      definitionId: f.identity.definitionId,
      invocation: f.hostInput.invocation,
      admission: execution.admissionRequest,
      compiler: { executablePath, executableSha256 },
    };
    const read = () =>
      f.plans.withIssuedMetadata(f.identity, ({ transaction }) =>
        readModelLiveParserInputReceipt(transaction, {
          organizationId: f.scope.organizationId,
          projectId: f.scope.projectId,
          userId: f.scope.userId,
          invocationId: f.hostInput.invocation.descriptor.invocationId,
        }),
      );
    const prepare = () =>
      prepareProductionModelLiveProposalValidation({
        plans: f.plans,
        invocation: f.hostInput.invocation,
        context,
        execution,
        allowedApprovalPathIds: [],
        repositoryCompiler: options.compiler,
      });
    return { ...f, options, read, prepare };
  }
  it("issues one exact immutable receipt before the invocation and replays it", async () => {
    const f = await fixture();
    const first = await issueModelLiveParserInputReceipt(f.options);
    expect(first.repositoryParser.importerVersion).toBe("1.0.2");
    expect(await f.read()).toEqual(first);
    expect(await issueModelLiveParserInputReceipt(f.options)).toEqual(first);
    expect(
      (
        await harness.database.query(
          sql("SELECT 1 FROM model_live_invocations WHERE organization_id=$1", [
            f.scope.organizationId,
          ]),
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await harness.database.query(
          sql(
            "SELECT 1 FROM model_live_parser_input_receipts WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        )
      ).rowCount,
    ).toBe(1);
    await expect(
      harness.database.query(
        sql(
          "UPDATE model_live_parser_input_receipts SET receipt_sha256=receipt_sha256 WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      harness.database.query(
        sql(
          "DELETE FROM model_live_parser_input_receipts WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      ),
    ).rejects.toMatchObject({ code: "55000" });
  }, 120000);
  it("refuses a new parser receipt after the invocation has begun", async () => {
    const f = await fixture();
    await f.complete();
    await expect(issueModelLiveParserInputReceipt(f.options)).rejects.toThrow(
      "exact issued repository parser input",
    );
    expect(await f.read()).toBeNull();
  }, 120000);
  it("waits behind the real journal organization lock and then rejects late parser issuance", async () => {
    const f = await fixture();
    const barrier = () => {
      let open = () => {
        /* replaced synchronously by the Promise executor */
      };
      const wait = new Promise<void>((resolve) => {
        open = resolve;
      });
      return { open, wait };
    };
    const inserted = barrier(),
      release = barrier(),
      attempting = barrier();
    let holdingJournal = false;
    let parserPid: number | undefined;
    const lockOrder: string[] = [];
    const original = harness.database.transaction.bind(harness.database);
    const spy = vi
      .spyOn(harness.database, "transaction")
      .mockImplementation(
        async <T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> =>
          original(async (transaction) =>
            work({
              async query<R extends SqlRow>(statement: SqlStatement) {
                if (
                  holdingJournal &&
                  statement.text.includes("pg_advisory_xact_lock")
                ) {
                  const key = statement.values[0];
                  if (typeof key === "string") lockOrder.push(key);
                  if (parserPid === undefined) {
                    const pid = (
                      await transaction.query(
                        sql("SELECT pg_backend_pid() AS pid"),
                      )
                    ).rows[0]?.["pid"];
                    if (typeof pid !== "number")
                      throw Error("Missing actual parser transaction PID");
                    parserPid = pid;
                    attempting.open();
                  }
                }
                const result = await transaction.query<R>(statement);
                if (
                  statement.text.includes("INSERT INTO model_live_invocations")
                ) {
                  holdingJournal = true;
                  inserted.open();
                  await release.wait;
                }
                return result;
              },
            }),
          ),
      );
    const journal = f.journal.prepare(f.callback);
    let parsing: Promise<unknown> | undefined;
    try {
      await Promise.race([
        inserted.wait,
        journal.then(() => {
          throw Error("Journal did not reach its held insert");
        }),
      ]);
      parsing = issueModelLiveParserInputReceipt(f.options).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await Promise.race([
        attempting.wait,
        parsing.then(() => {
          throw Error("Parser did not attempt the current organization lock");
        }),
      ]);
      const pid = parserPid;
      if (pid === undefined) throw Error("Missing parser lock waiter");
      await vi.waitFor(
        async () => {
          expect(
            (
              await harness.database.query(
                sql(
                  "SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted",
                  [pid],
                ),
              )
            ).rowCount,
          ).toBe(1);
        },
        { timeout: 5000, interval: 20 },
      );
      release.open();
      await journal;
      expect(await parsing).toMatchObject({
        error: { code: "model-live-evaluation.parser-input-unavailable" },
      });
      expect(lockOrder.slice(0, 2)).toEqual([
        "runtime-admission:" + f.scope.organizationId,
        "live-evaluation-plan:" +
          f.scope.organizationId +
          ":" +
          f.scope.projectId +
          ":" +
          f.scope.userId,
      ]);
      expect(await f.read()).toBeNull();
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT 1 FROM model_live_invocations WHERE organization_id=$1 AND invocation_id=$2",
              [
                f.scope.organizationId,
                f.hostInput.invocation.descriptor.invocationId,
              ],
            ),
          )
        ).rowCount,
      ).toBe(1);
    } finally {
      release.open();
      await Promise.allSettled([
        journal,
        ...(parsing === undefined ? [] : [parsing]),
      ]);
      spy.mockRestore();
    }
  }, 120000);
  it("preserves existing metadata for historical reads after approval withdrawal", async () => {
    const f = await fixture();
    const receipt = await issueModelLiveParserInputReceipt(f.options);
    f.removeOperators();
    expect(await f.read()).toEqual(receipt);
    await expect(issueModelLiveParserInputReceipt(f.options)).rejects.toThrow();
  }, 120000);
  it("denies cross-tenant invocation substitution", async () => {
    const f = await fixture(),
      other = await fixture();
    await expect(
      issueModelLiveParserInputReceipt({
        ...f.options,
        invocation: other.options.invocation,
      }),
    ).rejects.toThrow();
    expect(await f.read()).toBeNull();
    expect(await other.read()).toBeNull();
  }, 120000);
  it.each([
    "sourceInputDigest",
    "inputEvidenceDigest",
    "descriptorDigest",
  ] as const)(
    "denies a self-rehashed SQL %s substitution",
    async (field) => {
      const f = await fixture();
      const issued = await issueModelLiveParserInputReceipt(f.options);
      const { receiptId, receiptDigest, ...body } = issued;
      void receiptId;
      void receiptDigest;
      const changed = identifyModelLiveParserInputReceipt({
        ...body,
        [field]: digestStructuredValue("changed authority"),
      });
      await expect(
        harness.database.query(
          sql(
            "INSERT INTO model_live_parser_input_receipts (organization_id,project_id,principal_id,invocation_id,receipt_id,receipt_sha256,plan_sha256,case_id,input_evidence_id,receipt_record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)",
            [
              changed.organizationId,
              changed.projectId,
              changed.userId,
              changed.invocationId,
              changed.receiptId,
              changed.receiptDigest.slice(7),
              changed.planDigest.slice(7),
              changed.caseId,
              changed.inputEvidenceId,
              JSON.stringify(changed),
            ],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
      expect(await f.read()).toEqual(issued);
    },
    120000,
  );
  it("denies a self-rehashed old-validator downgrade before any uniqueness conflict", async () => {
    const f = await fixture();
    const host = await f.prepare();
    if (!host) throw Error("Fixed successor required");
    await f.complete();
    const receipt = await host.issue({
      plans: f.plans,
      evidence: f.issuer,
      journal: f.journal,
      result: f.gatewayResult,
      signal: new AbortController().signal,
      authorize: () => Promise.resolve(),
    });
    const body = Object.fromEntries(
      Object.entries(receipt.assessment).filter(
        ([key]) =>
          ![
            "assessmentDigest",
            "repositoryParser",
            "repositoryInputReceipt",
          ].includes(key),
      ),
    );
    body["validatorVersion"] = "2.6.0";
    const assessment = modelLiveRepositoryCaseAssessmentV2Schema.parse({
      ...body,
      assessmentDigest: digestStructuredValue(body),
    });
    const { receiptId, receiptDigest, ...base } = receipt;
    void receiptId;
    void receiptDigest;
    const old = identifyLiveProposalValidationReceipt({ ...base, assessment });
    await expect(
      harness.database.query(
        sql(
          "INSERT INTO model_live_proposal_validation_receipts (organization_id,project_id,principal_id,invocation_id,receipt_id,receipt_sha256,input_evidence_id,operations_evidence_id,ownership_evidence_id,receipt_record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)",
          [
            old.organizationId,
            old.projectId,
            old.userId,
            old.invocationId,
            old.receiptId,
            old.receiptDigest.slice(7),
            old.inputEvidenceId,
            old.operationsEvidenceId,
            old.ownershipEvidenceId,
            JSON.stringify(old),
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect((await f.journal.readValidatedUsage()).receipt).toEqual(receipt);
  }, 120000);
});
