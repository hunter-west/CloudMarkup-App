import { createHash } from "node:crypto";

import {
  continuousConformanceAvailableReviewActionsV1Schema,
  continuousConformanceDiagramResultV1Schema,
  continuousConformanceReviewActionResultV1Schema,
  type ContinuousConformanceAvailableReviewActionsV1,
  type ContinuousConformanceDiagramResultV1,
  type ContinuousConformanceReviewActionResultV1,
  type ContinuousConformanceViewV1,
  type ExportContinuousConformanceDiagramV1,
  type ReviewContinuousConformanceActionV1,
} from "@cloudmarkup/api-contract";
import type {
  ConformanceDifferenceV1,
  ConformanceReportV1,
} from "@cloudmarkup/schemas";
import {
  getActiveIssueRecordHash,
  getConformanceDifferenceDigestV1,
  getConformanceReportDigestV1,
} from "@cloudmarkup/domain";
import { conformanceReportV1Schema } from "@cloudmarkup/schemas";

import type { OrganizationPermission } from "./authorization.js";
import { ApplicationError } from "./errors.js";
import type { ObjectAuthorizationService } from "./object-authorization.js";
import type { PrincipalContext } from "./ports.js";

export interface ContinuousConformanceAuthorizedScope {
  readonly organizationId: string;
}

export interface ContinuousConformanceAccessControl {
  authorizeProject(
    principal: PrincipalContext,
    projectId: string,
    permission: OrganizationPermission,
  ): Promise<ContinuousConformanceAuthorizedScope>;
}

export class ObjectAuthorizationContinuousConformanceAccessControl implements ContinuousConformanceAccessControl {
  readonly #authorization: ObjectAuthorizationService;

  constructor(authorization: ObjectAuthorizationService) {
    this.#authorization = authorization;
  }

  async authorizeProject(
    principal: PrincipalContext,
    projectId: string,
    permission: OrganizationPermission,
  ): Promise<ContinuousConformanceAuthorizedScope> {
    const authorized = await this.#authorization.authorizeProject(
      principal,
      principal.correlationId,
      projectId,
      permission,
    );
    return { organizationId: authorized.organizationId };
  }
}

export interface ContinuousConformanceReportSource {
  /**
   * A binding requests the exact server snapshot previously returned to the
   * caller. Sources return current evidence when that snapshot is no longer
   * the current semantic state so the application fails closed with a binding
   * conflict.
   */
  get(
    input: {
      readonly environmentId: string;
      readonly organizationId: string;
      readonly projectId: string;
      readonly solutionRevisionId: string;
    },
    binding?: {
      readonly reportDigest: string;
      readonly reportId: string;
    },
  ): Promise<unknown>;
}

export interface ContinuousConformanceDiagramRenderer {
  render(input: {
    readonly environmentId: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly report: ConformanceReportV1;
    readonly showDifferences: boolean;
    readonly solutionRevisionId: string;
    readonly state: ExportContinuousConformanceDiagramV1["state"];
  }): Promise<{ readonly artifactId: string; readonly svg: string }>;
}

export interface ContinuousConformanceReviewActionRegistry {
  execute(input: {
    readonly actionKey: string;
    readonly difference: ConformanceDifferenceV1;
    readonly environmentId: string;
    readonly kind: ReviewContinuousConformanceActionV1["kind"];
    readonly organizationId: string;
    readonly idempotencyKey: string;
    readonly principalId: string;
    readonly projectId: string;
    readonly report: ConformanceReportV1;
    readonly solutionRevisionId: string;
  }): Promise<ContinuousConformanceReviewActionResultV1["receipt"]>;
  list(input: {
    readonly environmentId: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly report: ConformanceReportV1;
    readonly solutionRevisionId: string;
  }): Promise<unknown>;
}

export interface ContinuousConformanceApplication {
  exportDiagram(
    principal: PrincipalContext,
    projectId: string,
    solutionRevisionId: string,
    environmentId: string,
    input: ExportContinuousConformanceDiagramV1,
  ): Promise<ContinuousConformanceDiagramResultV1>;
  getReport(
    principal: PrincipalContext,
    projectId: string,
    solutionRevisionId: string,
    environmentId: string,
  ): Promise<ConformanceReportV1>;
  getView(
    principal: PrincipalContext,
    projectId: string,
    solutionRevisionId: string,
    environmentId: string,
  ): Promise<ContinuousConformanceViewV1>;
  reviewAction(
    principal: PrincipalContext,
    projectId: string,
    solutionRevisionId: string,
    environmentId: string,
    input: ReviewContinuousConformanceActionV1,
    idempotencyKey: string,
  ): Promise<ContinuousConformanceReviewActionResultV1>;
}

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function unavailableEvidence(): ApplicationError {
  return new ApplicationError(
    "service_unavailable",
    "Continuous conformance evidence is not currently verifiable.",
  );
}

function assertExactReportBinding(
  report: ConformanceReportV1,
  input: { readonly reportDigest: string; readonly reportId: string },
): void {
  if (
    report.reportId !== input.reportId ||
    report.reportDigest !== input.reportDigest
  ) {
    throw new ApplicationError(
      "conflict",
      "The continuous conformance report binding is no longer current.",
    );
  }
}

export class ContinuousConformanceApplicationService implements ContinuousConformanceApplication {
  readonly #access: ContinuousConformanceAccessControl;
  readonly #actions: ContinuousConformanceReviewActionRegistry | undefined;
  readonly #diagrams: ContinuousConformanceDiagramRenderer | undefined;
  readonly #source: ContinuousConformanceReportSource;

  constructor(options: {
    readonly access: ContinuousConformanceAccessControl;
    readonly actions?: ContinuousConformanceReviewActionRegistry;
    readonly diagrams?: ContinuousConformanceDiagramRenderer;
    readonly source: ContinuousConformanceReportSource;
  }) {
    this.#access = options.access;
    this.#actions = options.actions;
    this.#diagrams = options.diagrams;
    this.#source = options.source;
  }

  async #availableActions(
    organizationId: string,
    projectId: string,
    solutionRevisionId: string,
    environmentId: string,
    report: ConformanceReportV1,
  ): Promise<ContinuousConformanceAvailableReviewActionsV1> {
    if (this.#actions === undefined) return [];
    let untrusted: unknown;
    try {
      untrusted = await this.#actions.list({
        environmentId,
        organizationId,
        projectId,
        report,
        solutionRevisionId,
      });
    } catch (cause) {
      if (cause instanceof ApplicationError) throw cause;
      throw unavailableEvidence();
    }
    const parsed =
      continuousConformanceAvailableReviewActionsV1Schema.safeParse(untrusted);
    if (!parsed.success) throw unavailableEvidence();
    const differences = new Map(
      report.differences.map((difference) => [
        difference.differenceId,
        difference,
      ]),
    );
    const actionKeys = new Set<string>();
    const differenceIds = new Set<string>();
    for (const entry of parsed.data) {
      const difference = differences.get(entry.differenceId);
      if (
        difference?.remediation.disposition !== "review-required" ||
        entry.actions.length === 0 ||
        differenceIds.has(entry.differenceId)
      ) {
        throw unavailableEvidence();
      }
      differenceIds.add(entry.differenceId);
      for (const action of entry.actions) {
        if (actionKeys.has(action.actionKey)) throw unavailableEvidence();
        actionKeys.add(action.actionKey);
      }
    }
    return continuousConformanceAvailableReviewActionsV1Schema.parse(
      [...parsed.data]
        .map((entry) => ({
          ...entry,
          actions: [...entry.actions].sort((left, right) =>
            left.kind === right.kind
              ? compareUtf16(left.actionKey, right.actionKey)
              : compareUtf16(left.kind, right.kind),
          ),
        }))
        .sort((left, right) =>
          compareUtf16(left.differenceId, right.differenceId),
        ),
    );
  }

  async #loadReport(
    principal: PrincipalContext,
    projectId: string,
    solutionRevisionId: string,
    environmentId: string,
    permission: OrganizationPermission,
    binding?: { readonly reportDigest: string; readonly reportId: string },
  ): Promise<{
    readonly organizationId: string;
    readonly report: ConformanceReportV1;
  }> {
    const authorized = await this.#access.authorizeProject(
      principal,
      projectId,
      permission,
    );
    const untrusted = await this.#source.get(
      {
        environmentId,
        organizationId: authorized.organizationId,
        projectId,
        solutionRevisionId,
      },
      binding,
    );
    if (untrusted === null) {
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    }
    const report = conformanceReportV1Schema.safeParse(untrusted);
    if (!report.success) {
      throw new ApplicationError(
        "service_unavailable",
        "Continuous conformance evidence is not currently verifiable.",
      );
    }
    const integrityValid =
      getConformanceReportDigestV1(report.data) === report.data.reportDigest &&
      report.data.differences.every(
        (difference) =>
          getConformanceDifferenceDigestV1(difference) ===
          difference.differenceDigest,
      ) &&
      report.data.issues.every(
        (issue) =>
          getActiveIssueRecordHash(issue) === issue.currentRecordDigest,
      );
    if (!integrityValid) {
      throw new ApplicationError(
        "service_unavailable",
        "Continuous conformance evidence is not currently verifiable.",
      );
    }
    if (
      report.data.projectId !== projectId ||
      report.data.evaluatedSolutionRevision.id !== solutionRevisionId ||
      report.data.environment.environmentId !== environmentId
    ) {
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    }
    if (binding !== undefined) assertExactReportBinding(report.data, binding);
    return {
      organizationId: authorized.organizationId,
      report: report.data,
    };
  }

  async getReport(
    principal: PrincipalContext,
    projectId: string,
    solutionRevisionId: string,
    environmentId: string,
  ): Promise<ConformanceReportV1> {
    return (
      await this.#loadReport(
        principal,
        projectId,
        solutionRevisionId,
        environmentId,
        "projects.read",
      )
    ).report;
  }

  async getView(
    principal: PrincipalContext,
    projectId: string,
    solutionRevisionId: string,
    environmentId: string,
  ): Promise<ContinuousConformanceViewV1> {
    const { organizationId, report } = await this.#loadReport(
      principal,
      projectId,
      solutionRevisionId,
      environmentId,
      "projects.read",
    );
    return {
      availableReviewActions: await this.#availableActions(
        organizationId,
        projectId,
        solutionRevisionId,
        environmentId,
        report,
      ),
      report,
    };
  }

  async exportDiagram(
    principal: PrincipalContext,
    projectId: string,
    solutionRevisionId: string,
    environmentId: string,
    input: ExportContinuousConformanceDiagramV1,
  ): Promise<ContinuousConformanceDiagramResultV1> {
    const { organizationId, report } = await this.#loadReport(
      principal,
      projectId,
      solutionRevisionId,
      environmentId,
      "exports.run",
      input,
    );
    assertExactReportBinding(report, input);
    if (this.#diagrams === undefined) throw unavailableEvidence();
    let rendered: { readonly artifactId: string; readonly svg: string };
    try {
      rendered = await this.#diagrams.render({
        environmentId,
        organizationId,
        projectId,
        report,
        showDifferences: input.showDifferences,
        solutionRevisionId,
        state: input.state,
      });
    } catch (cause) {
      if (cause instanceof ApplicationError) throw cause;
      throw unavailableEvidence();
    }
    const bytes = new TextEncoder().encode(rendered.svg);
    const result = continuousConformanceDiagramResultV1Schema.safeParse({
      artifact: {
        artifactId: rendered.artifactId,
        checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        mediaType: "image/svg+xml",
        sizeBytes: bytes.byteLength,
      },
      contractVersion: 1,
      reportDigest: report.reportDigest,
      reportId: report.reportId,
      showDifferences: input.showDifferences,
      state: input.state,
      svg: rendered.svg,
    });
    if (!result.success) throw unavailableEvidence();
    return result.data;
  }

  async reviewAction(
    principal: PrincipalContext,
    projectId: string,
    solutionRevisionId: string,
    environmentId: string,
    input: ReviewContinuousConformanceActionV1,
    idempotencyKey: string,
  ): Promise<ContinuousConformanceReviewActionResultV1> {
    const { organizationId, report } = await this.#loadReport(
      principal,
      projectId,
      solutionRevisionId,
      environmentId,
      "projects.mutate",
      input,
    );
    assertExactReportBinding(report, input);
    if (this.#actions === undefined) throw unavailableEvidence();
    const availability = await this.#availableActions(
      organizationId,
      projectId,
      solutionRevisionId,
      environmentId,
      report,
    );
    const known = availability
      .find(({ differenceId }) => differenceId === input.differenceId)
      ?.actions.some(
        ({ actionKey, kind }) =>
          actionKey === input.actionKey && kind === input.kind,
      );
    const difference = report.differences.find(
      ({ differenceId }) => differenceId === input.differenceId,
    );
    if (known !== true || difference === undefined) {
      throw new ApplicationError(
        "not_found",
        "The requested reviewed action is unavailable.",
      );
    }
    let receipt: ContinuousConformanceReviewActionResultV1["receipt"];
    try {
      receipt = await this.#actions.execute({
        actionKey: input.actionKey,
        difference,
        idempotencyKey,
        environmentId,
        kind: input.kind,
        organizationId,
        principalId: principal.principalId,
        projectId,
        report,
        solutionRevisionId,
      });
    } catch (cause) {
      if (cause instanceof ApplicationError) throw cause;
      throw unavailableEvidence();
    }
    const result = continuousConformanceReviewActionResultV1Schema.safeParse({
      actionKey: input.actionKey,
      contractVersion: 1,
      differenceId: input.differenceId,
      kind: input.kind,
      receipt,
      reportDigest: report.reportDigest,
      reportId: report.reportId,
    });
    if (!result.success) throw unavailableEvidence();
    return result.data;
  }
}
