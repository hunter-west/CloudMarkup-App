import { solutionRevisionV1Schema } from "@cloudmarkup/api-contract";
import { supportsInfrastructureOnlyDelivery } from "@cloudmarkup/solution-export-workflow";
import {
  asyncJobDurableInputReferenceV1Schema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import type { CloudMarkupApplication } from "../../application/ports.js";
import type {
  ImmutableSolutionRevisionExportBinding,
  SolutionExportRevisionRepository,
} from "../../application/solution-exports.js";
import {
  exportRunBytes,
  exportRunEqual,
  exportRunSha,
  exportRunText,
  exportRunUnavailable,
} from "./solution-export-run-codec.js";
import { SolutionExportProducerObjects } from "./solution-export-producer-objects.js";
import type { SolutionExportRequestAuthority } from "./solution-export-authority.js";
import { sql } from "./sql.js";

/** Resolves real published revision identities. Derived workload bytes are published
 * separately by prepare(); read-only binding resolution never writes objects. */
export class PostgresSolutionExportRevisionRepository implements SolutionExportRevisionRepository {
  // This repository is constructed once per authenticated export request.
  // Reuse verified immutable bytes only while all current publication metadata
  // still matches; authorization and lifecycle reads are never cached.
  readonly #verified = new Map<
    string,
    {
      metadata: unknown;
      value: {
        binding: ImmutableSolutionRevisionExportBinding;
        workloadBytes: Uint8Array;
      };
    }
  >();
  readonly objects: SolutionExportProducerObjects<SolutionExportRequestAuthority>;
  readonly readSolutionRevision: CloudMarkupApplication["getSolutionRevision"];
  constructor(
    objects: SolutionExportProducerObjects<SolutionExportRequestAuthority>,
    readSolutionRevision: CloudMarkupApplication["getSolutionRevision"],
  ) {
    this.objects = objects;
    this.readSolutionRevision = readSolutionRevision;
  }
  async load(
    input: Parameters<
      SolutionExportRevisionRepository["getImmutableBinding"]
    >[0],
  ) {
    if (
      !exportRunEqual(this.objects.authority.ownership, {
        organizationId: input.organizationId,
        projectId: input.projectId,
      })
    )
      exportRunUnavailable();
    const metadata = await this.objects.authority.query(
      sql(
        `SELECT m.solution_record_id,m.subject_id,m.content_object_id,m.content_sha256,m.architecture_revision_id,r.document_object_id,r.content_sha256 AS architecture_sha256
      FROM solution_records m JOIN architecture_revisions r ON r.organization_id=m.organization_id AND r.project_id=m.project_id AND r.revision_id=m.architecture_revision_id
      WHERE m.organization_id=$1 AND m.project_id=$2 AND m.subject_id=$3 AND m.record_kind='solution-revision-manifest'`,
        [input.organizationId, input.projectId, input.solutionRevisionId],
      ),
    );
    const row = metadata.rows[0];
    if (row === undefined) return null;
    if (metadata.rows.length !== 1) exportRunUnavailable();
    const [manifest, architecture] = await Promise.all([
      this.objects.metadata(exportRunText(row["content_object_id"])),
      this.objects.metadata(exportRunText(row["document_object_id"])),
    ]);
    if (
      manifest?.state !== "published" ||
      manifest.reference.purpose !== "solution-revision-manifest" ||
      manifest.reference.contentSha256 !== row["content_sha256"] ||
      architecture?.state !== "published" ||
      architecture.reference.purpose !== "architecture-revision" ||
      architecture.reference.contentSha256 !== row["architecture_sha256"]
    )
      exportRunUnavailable();
    const currentMetadata = { row, manifest, architecture };
    const prior = this.#verified.get(input.solutionRevisionId);
    if (
      prior !== undefined &&
      exportRunEqual(prior.metadata, currentMetadata)
    ) {
      await this.objects.authority.scope();
      return structuredClone(prior.value);
    }
    // Existing production reader rebuilds and checks the manifest against its immutable revision.
    const solution = solutionRevisionV1Schema.parse(
      await this.readSolutionRevision(
        this.objects.authority.principal,
        input.projectId,
        exportRunText(row["solution_record_id"]),
      ),
    );
    if (
      solution.summary.solutionRevisionId !== input.solutionRevisionId ||
      solution.summary.projectId !== input.projectId ||
      solution.revision.id !== row["architecture_revision_id"]
    )
      exportRunUnavailable();
    const parse = (bytes: Uint8Array): unknown => {
      try {
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        ) as unknown;
      } catch {
        return exportRunUnavailable();
      }
    };
    const [manifestBytes, architectureBytes] = await Promise.all([
      this.objects.read(manifest.reference),
      this.objects.read(architecture.reference),
    ]);
    if (
      !exportRunEqual(parse(manifestBytes), solution.manifest) ||
      !exportRunEqual(
        parse(architectureBytes),
        solution.revision.architectureDocument,
      )
    )
      exportRunUnavailable();
    const workloadBytes = exportRunBytes(
      solution.revision.architectureDocument.workloadBehavior,
    );
    const workloadDigest = exportRunSha(workloadBytes);
    const wire = (
      objectId: string,
      contentSha256: string,
      sizeBytes: number,
    ) => ({
      ...asyncJobDurableInputReferenceV1Schema.parse({
        contractVersion: 1,
        objectId,
        digest: `sha256:${contentSha256}`,
        mediaType: "application/json",
        purpose: "input-payload",
        sizeBytes,
      }),
      mediaType: "application/json" as const,
    });
    const binding: ImmutableSolutionRevisionExportBinding = {
      organizationId: input.organizationId,
      projectId: input.projectId,
      solutionRevisionId: input.solutionRevisionId,
      manifestRecordId: exportRunText(row["solution_record_id"]),
      manifestDigest: sha256DigestSchema.parse(
        `sha256:${manifest.reference.contentSha256}`,
      ),
      generationCoverage: solution.summary.generationCoverage,
      selectedTools: {
        compiler: solution.manifest.versions.compiler,
        diagramRenderer: solution.manifest.versions.diagramRenderer,
      },
      applicationCodeRequired:
        solution.revision.architectureDocument.workloadBehavior.workloads.some(
          (workload) => workload.implementation.mode !== "infrastructure-only",
        ),
      infrastructureOnlyDeliverySupported: supportsInfrastructureOnlyDelivery(
        solution.revision.architectureDocument,
      ),
      workflowSources: {
        architectureDocument: wire(
          architecture.reference.objectId,
          architecture.reference.contentSha256,
          architecture.reference.sizeBytes,
        ),
        solutionRevision: wire(
          manifest.reference.objectId,
          manifest.reference.contentSha256,
          manifest.reference.sizeBytes,
        ),
        workloadBehavior: wire(
          this.objects.identity("workload-input", `sha256:${workloadDigest}`),
          workloadDigest,
          workloadBytes.length,
        ),
      },
    };
    await this.objects.authority.scope();
    const value = { binding, workloadBytes };
    this.#verified.set(input.solutionRevisionId, {
      metadata: structuredClone(currentMetadata),
      value: structuredClone(value),
    });
    return value;
  }
  async getImmutableBinding(
    input: Parameters<
      SolutionExportRevisionRepository["getImmutableBinding"]
    >[0],
  ): Promise<ImmutableSolutionRevisionExportBinding | null> {
    return (await this.load(input))?.binding ?? null;
  }
  async prepare(
    expected: ImmutableSolutionRevisionExportBinding,
  ): Promise<void> {
    const loaded = await this.load(expected);
    if (loaded === null || !exportRunEqual(loaded.binding, expected))
      exportRunUnavailable();
    await this.objects.put(
      loaded.workloadBytes,
      "input-payload",
      expected.workflowSources.workloadBehavior.objectId,
    );
  }
}
