import { runAuthorizedCleanupPage } from "./application/beta-ai-cleanup-owner.js";
import { ApplicationError } from "./application/errors.js";
import type { PrincipalContext } from "./application/ports.js";
import {
  accountSessionAllowed,
  lockAccountSessions,
} from "./adapters/persistence/account-sessions.js";
import { PostgresBetaAiCreditMeter } from "./adapters/persistence/beta-ai-credit-meter.js";
import {
  PostgresBetaAiCleanupStore,
  lockCleanupControl,
  type CleanupRestoreAdmission,
} from "./adapters/persistence/beta-ai-cleanup-store.js";
import type { SqlDatabase, SqlExecutor } from "./adapters/persistence/sql.js";
import { AuthorizedCommercialRequestDatabase } from "./production-commercial-authorization.js";

/** Current canonical session + organization checks on EVERY transaction.
 * The staff read permission confers no cleanup write access. */
export class AuthorizedBetaAiCleanupDatabase extends AuthorizedCommercialRequestDatabase {
  readonly admission: CleanupRestoreAdmission;
  constructor(
    database: SqlDatabase,
    principal: PrincipalContext,
    organizationId: string,
    admission: CleanupRestoreAdmission,
    clock: () => Date = () => new Date(),
  ) {
    super(
      database,
      Object.freeze({ ...principal }),
      organizationId,
      "commercial.summary.read",
      clock,
    );
    this.admission = admission;
  }
  override async authorize(tx: SqlExecutor) {
    if (
      this.principal.authenticationSource !== "cognito" &&
      this.principal.authenticationSource !== "local-owner"
    )
      throw new ApplicationError(
        "authentication_required",
        "Current account session is required.",
      );
    await lockAccountSessions(tx, this.principal.principalId);
    if (
      !(await accountSessionAllowed(
        tx,
        this.principal,
        this.principal.authenticationSource,
      ))
    )
      throw new ApplicationError(
        "authentication_required",
        "Current account session is required.",
      );
    const context = await super.authorize(tx);
    await lockCleanupControl(
      tx,
      context.organizationId,
      await this.admission.currentEpoch(context.organizationId),
    );
    return context;
  }
  override transaction<T>(work: (tx: SqlExecutor) => Promise<T>) {
    return this.database.transaction(async (tx) => {
      await this.authorize(tx);
      const result = await work(tx);
      await this.authorize(tx);
      return result;
    });
  }
}

/** Existing request owner; no new endpoint, audience, schedule or dispatch.
 * A qualified restore owner must be supplied by server composition. There is
 * deliberately no default that trusts a restored database's own active flag. */
export async function runProductionBetaAiCleanup(options: {
  readonly database: SqlDatabase;
  readonly principal: PrincipalContext;
  readonly organizationId: string;
  readonly admission: CleanupRestoreAdmission;
  readonly clock?: () => Date;
}) {
  const database = new AuthorizedBetaAiCleanupDatabase(
    options.database,
    options.principal,
    options.organizationId,
    options.admission,
    options.clock,
  );
  const meter = new PostgresBetaAiCreditMeter(database, database);
  return runAuthorizedCleanupPage({
    authorize: () => database.context(),
    checkpoints: new PostgresBetaAiCleanupStore(
      database,
      options.organizationId,
      options.admission,
    ),
    meter: {
      select: (org, cursor) => meter.selectReleasedAccounting(org, cursor),
      reconcile: (identity) =>
        meter.reconcileReleasedAccountingIdentity(identity),
    },
  });
}
