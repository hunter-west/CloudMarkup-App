import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { solutionExportArtifactV1Schema } from "@cloudmarkup/api-contract";
import { asyncJobArtifactReferenceV1Schema } from "@cloudmarkup/schemas";
import { retainedArtifactFixture } from "../adapters/persistence/solution-export-artifact-test-helpers.js";
import { exportRunFixture } from "../adapters/persistence/solution-export-run-test-helpers.js";
import { BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES } from "../production-solution-export-reads.js";
import { ApplicationError } from "./errors.js";
import {
  DefaultSolutionExportReadApplication,
  type SolutionExportReadRepository,
} from "./solution-export-reads.js";
import type {
  SolutionExportAccessControl,
  StoredSolutionExportArtifact,
  StoredSolutionExportDownloadGrant,
  StoredSolutionExportJob,
} from "./solution-exports.js";

function fixture(
  maximumDownloadBytes = BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES,
) {
  const f = exportRunFixture();
  const verified = retainedArtifactFixture();
  const artifactId = "solutionartifact_readtest";
  const files = verified.files.map((file, index) => ({
    id: `solutionfile_readtest_${String(index)}`,
    path: file.path,
    checksum: file.checksum,
    semanticChecksum: file.semanticChecksum,
    sizeBytes: file.bytes.length,
    mediaType: file.mediaType,
    ownership: file.ownership,
    previewAvailable: file.mediaType === "text/markdown",
  }));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3600000).toISOString();
  const artifact: StoredSolutionExportArtifact = {
    artifact: solutionExportArtifactV1Schema.parse({
      contractVersion: 1,
      id: artifactId,
      jobId: f.record.job.id,
      projectId: f.record.job.projectId,
      solutionRevisionId: f.record.job.solutionRevision.solutionRevisionId,
      createdAt: now.toISOString(),
      archiveFileName: verified.archiveFileName,
      digest: verified.zipDigest,
      manifestDigest: verified.manifestDigest,
      sizeBytes: verified.zipBytes.length,
      fileCount: files.length,
      files,
      warnings: [],
      downloadAvailability: { state: "available", expiresAt },
    }),
    organizationId: f.record.organizationId,
    targetEnvironment: f.record.job.target.environment,
    targetProfileId: f.record.targetProfileId,
    targetSettingsDigest:
      f.record.workflowSubmission.request.targetSettings.digest,
    verifiedArtifact: verified,
    zipBytes: verified.zipBytes,
    fileContents: new Map(
      files.map((file, index) => [
        file.id,
        verified.files[index]?.bytes ?? new Uint8Array(),
      ]),
    ),
    workflowPackage: asyncJobArtifactReferenceV1Schema.parse({
      artifactId,
      availability: { state: "available" },
      object: {
        contractVersion: 1,
        objectId: "object.read-test",
        digest: verified.zipDigest,
        sizeBytes: verified.zipBytes.length,
        purpose: "export-package",
        mediaType: "application/zip",
      },
    }),
  };
  const job: StoredSolutionExportJob = {
    ...f.record,
    job: {
      ...f.record.job,
      state: "succeeded",
      completedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      progress: {
        completedStages: 8,
        totalStages: 8,
        message: "The verified export is ready.",
      },
      stages: f.record.job.stages.map((stage) => ({
        ...stage,
        status: "succeeded",
      })),
      artifact: {
        artifactId,
        digest: artifact.artifact.digest,
        manifestDigest: artifact.artifact.manifestDigest,
        downloadAvailability: artifact.artifact.downloadAvailability,
        fileCount: files.length,
        sizeBytes: artifact.artifact.sizeBytes,
      },
    },
  };
  let grant: StoredSolutionExportDownloadGrant | null = null;
  const reserve = vi.fn(
    (
      input: Parameters<
        SolutionExportReadRepository["reserveDownloadGrant"]
      >[0],
    ) => {
      grant ??= input.grant;
      return Promise.resolve(grant);
    },
  );
  const repository: SolutionExportReadRepository = {
    getArtifact: () => Promise.resolve(artifact),
    getJob: () => Promise.resolve(job),
    getDownloadGrant: () => Promise.resolve(grant),
    reserveDownloadGrant: reserve,
  };
  const access = {
    authorizeProject: vi.fn<SolutionExportAccessControl["authorizeProject"]>(
      () =>
        Promise.resolve({
          organizationId: f.record.organizationId,
          projectId: f.record.job.projectId,
        }),
    ),
  };
  const application = new DefaultSolutionExportReadApplication({
    repository,
    access,
    maximumDownloadBytes,
    clock: () => now,
  });
  return { f, artifact, job, now, application, access, reserve };
}

describe("solution export reads without mutation or workflow ports", () => {
  it("reviews metadata and previews and issues an exact verified byte download", async () => {
    const h = fixture();
    const { principal } = h.f;
    const { projectId, id } = h.artifact.artifact;
    expect(await h.application.getArtifact(principal, projectId, id)).toEqual(
      h.artifact.artifact,
    );
    const file = h.artifact.artifact.files.find(
      (file) => file.previewAvailable,
    );
    if (file === undefined)
      throw new Error("Synthetic Markdown fixture required.");
    const preview = await h.application.getFilePreview(
      principal,
      projectId,
      id,
      file.id,
    );
    expect(preview.content).toBe(
      new TextDecoder().decode(h.artifact.fileContents.get(file.id)),
    );
    expect(
      await h.application.getArtifactDiff(principal, projectId, id),
    ).toMatchObject({ state: "unavailable", files: [] });
    const grant = await h.application.createDownloadGrant(
      principal,
      projectId,
      id,
      "synthetic-read-key",
    );
    expect(Date.parse(grant.expiresAt) - h.now.getTime()).toBe(300000);
    expect(
      await h.application.download(principal, projectId, id, grant.id),
    ).toMatchObject({
      bytes: h.artifact.zipBytes,
      digest: h.artifact.artifact.digest,
    });
    expect(h.reserve).toHaveBeenCalledTimes(1);
    expect(h.access.authorizeProject).toHaveBeenCalledWith(
      principal,
      projectId,
      "artifacts.read",
    );
  });
  it("keeps oversized artifact metadata reviewable but rejects before creating a grant", async () => {
    const h = fixture(1);
    const { principal } = h.f;
    const { projectId, id } = h.artifact.artifact;
    expect(
      (await h.application.getArtifact(principal, projectId, id))
        .downloadAvailability.state,
    ).toBe("available");
    await expect(
      h.application.createDownloadGrant(
        principal,
        projectId,
        id,
        "synthetic-limit",
      ),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      message:
        "This archive requires streaming, which is not yet available. You can still review its files and metadata; creating a new download link will not resolve this limit.",
      fieldIssues: [
        {
          code: "solution-export.download-streaming-required.v1",
          path: ["artifact", "download"],
          message:
            "This archive requires the unavailable streaming download transport; new download links cannot resolve this limit.",
        },
      ],
    });
    expect(h.reserve).not.toHaveBeenCalled();
    await expect(
      h.application.download(
        principal,
        projectId,
        id,
        "downloadgrant_existing",
      ),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      fieldIssues: [
        {
          code: "solution-export.download-streaming-required.v1",
          path: ["artifact", "download"],
        },
      ],
    });
  });
  it("uses a transport ceiling safe for REST-v1 base64 plus a bounded response envelope", () => {
    const encodedBytes =
      Math.ceil(BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES / 3) * 4;
    expect(encodedBytes + 64 * 1024).toBeLessThan(6 * 1024 * 1024);
  });
  it("serializes the actual REST-v1 binary response at the ceiling below Lambda's payload limit", async () => {
    // Transport-only synthetic bytes: this case does not claim ZIP validation.
    const bytes = new Uint8Array(BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES);
    const app = new Hono();
    app.get(
      "/download",
      () =>
        new Response(bytes, {
          headers: {
            "content-type": "application/zip",
            "cache-control": "private, no-store",
            "content-disposition": 'attachment; filename="synthetic.zip"',
            "content-length": String(bytes.length),
            "content-security-policy": "sandbox",
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
          },
        }),
    );
    const response = await handle(app)(
      {
        version: "1.0",
        httpMethod: "GET",
        path: "/download",
        resource: "/download",
        headers: {},
        body: null,
        isBase64Encoded: false,
        requestContext: {
          accountId: "000000000000",
          apiId: "synthetic",
          authorizer: {},
          domainName: "synthetic.test",
          domainPrefix: "synthetic",
          extendedRequestId: "synthetic",
          httpMethod: "GET",
          identity: { sourceIp: "127.0.0.1", userAgent: "vitest" },
          path: "/download",
          protocol: "HTTP/1.1",
          requestId: "synthetic",
          requestTime: "synthetic",
          requestTimeEpoch: 0,
          resourcePath: "/download",
          stage: "test",
        },
      },
      {
        callbackWaitsForEmptyEventLoop: false,
        functionName: "synthetic",
        functionVersion: "$LATEST",
        invokedFunctionArn:
          "arn:aws:lambda:us-east-1:000000000000:function:synthetic",
        memoryLimitInMB: "256",
        awsRequestId: "synthetic",
        logGroupName: "synthetic",
        logStreamName: "synthetic",
        getRemainingTimeInMillis: () => 1000,
      },
    );
    expect(response.statusCode).toBe(200);
    expect(response.isBase64Encoded).toBe(true);
    expect(Buffer.from(response.body, "base64").length).toBe(bytes.length);
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(
      6 * 1024 * 1024,
    );
  });
  it("rejects a reported archive above the fixed production ceiling before grant reservation", async () => {
    const h = fixture();
    const oversized = {
      ...h.artifact,
      artifact: {
        ...h.artifact.artifact,
        sizeBytes: BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES + 1,
      },
    };
    const reads = new DefaultSolutionExportReadApplication({
      repository: {
        getArtifact: () => Promise.resolve(oversized),
        getJob: () => Promise.resolve(h.job),
        getDownloadGrant: () => Promise.resolve(null),
        reserveDownloadGrant: h.reserve,
      },
      access: h.access,
      maximumDownloadBytes: BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES,
      clock: () => h.now,
    });
    await expect(
      reads.createDownloadGrant(
        h.f.principal,
        h.artifact.artifact.projectId,
        h.artifact.artifact.id,
        "synthetic-4mib-limit",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(h.reserve).not.toHaveBeenCalled();
  });
  it("permits the exact configured boundary but rejects one byte beyond it", async () => {
    const h = fixture();
    const exact = new DefaultSolutionExportReadApplication({
      repository: {
        getArtifact: () => Promise.resolve(h.artifact),
        getJob: () => Promise.resolve(h.job),
        getDownloadGrant: () => Promise.resolve(null),
        reserveDownloadGrant: h.reserve,
      },
      access: h.access,
      maximumDownloadBytes: h.artifact.zipBytes.length,
      clock: () => h.now,
    });
    await expect(
      exact.createDownloadGrant(
        h.f.principal,
        h.artifact.artifact.projectId,
        h.artifact.artifact.id,
        "synthetic-exact",
      ),
    ).resolves.toMatchObject({ sizeBytes: h.artifact.zipBytes.length });
    const tooSmall = fixture(h.artifact.zipBytes.length - 1);
    await expect(
      tooSmall.application.createDownloadGrant(
        tooSmall.f.principal,
        tooSmall.artifact.artifact.projectId,
        tooSmall.artifact.artifact.id,
        "synthetic-too-large",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(tooSmall.reserve).not.toHaveBeenCalled();
  });
  it("does not let a transport check replace current authorization", async () => {
    const h = fixture(1);
    h.access.authorizeProject.mockRejectedValue(
      new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      ),
    );
    await expect(
      h.application.createDownloadGrant(
        h.f.principal,
        h.artifact.artifact.projectId,
        h.artifact.artifact.id,
        "synthetic-denied",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(h.reserve).not.toHaveBeenCalled();
  });
  it.each([0, Number.NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid host transport limit %s",
    (limit) => {
      expect(() => fixture(limit)).toThrow(
        "Invalid export download transport limit.",
      );
    },
  );
});
