import {
  mkdtemp as createTemporaryDirectory,
  readFile,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { createNotesGenerationRequest } from "@cloudmarkup/application-generator/testing";
import {
  assignConformanceTargetKeysV1,
  applyGraphCommand,
  evaluateConformanceV1,
  getActiveIssueRecordHash,
  hashCanonicalValue,
  projectArchitectureConnectionIntentV1,
  projectArchitectureOutputIntentV1,
  projectArchitectureResourceIntentV1,
  projectArchitectureVariableIntentV1,
} from "@cloudmarkup/domain";
import { awsCatalogArtifactV1 } from "@cloudmarkup/provider-aws";
import {
  defaultConformanceStalenessPolicyV1,
  repositoryRelativePathSchema,
  repositorySnapshotV1Schema,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories = new Set<string>();
async function mkdtemp(prefix: string): Promise<string> {
  const directory = await createTemporaryDirectory(prefix);
  temporaryDirectories.add(directory);
  return directory;
}
afterEach(async () => {
  for (const directory of temporaryDirectories) {
    const target = resolve(directory);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("cloudmarkup-")
    )
      throw new Error("Refusing to remove an unverified importer fixture.");
    await rm(target, { recursive: true, force: false });
  }
  temporaryDirectories.clear();
});

import {
  REPOSITORY_IMPORTER_VERSION,
  createRepositoryImportService,
  calculateRepositoryImportSnapshotDigestV1,
  hclInspectionResultV1Schema,
  projectRepositoryImportToConformanceLayerInputV1,
  repositoryImportResultV1Schema,
  repositoryImportRequestV1Schema,
  validateRepositoryImportRelativePath,
  verifyRepositoryImport,
  type HCLInspectionResultV1,
  type RepositoryImportResultV1,
  type RepositoryImportRequestV1,
} from "./index.js";

const timestamp = "2026-08-19T12:00:00Z";
const commitSha = "1".repeat(40);

describe("literal CloudFormation catalog classification", () => {
  const cluster = {
    Type: "AWS::RDS::DBCluster",
    Properties: { Engine: "aurora-postgresql" },
  };
  async function importResources(
    resources: Readonly<Record<string, unknown>>,
    reverseCatalog = false,
  ) {
    const root = await mkdtemp(join(tmpdir(), "cloudmarkup-classification-"));
    await write(
      root,
      "template.json",
      JSON.stringify({ Resources: resources }),
    );
    const input = request();
    if (reverseCatalog)
      input.catalog = {
        ...input.catalog,
        services: [...input.catalog.services].reverse(),
      };
    return service.importRepository({ sourceDirectory: root, request: input });
  }
  it.each([undefined, { Ref: "Engine" }])(
    "does not identify a DBCluster as PostgreSQL from ambiguous engine %j",
    async (engine) => {
      const result = await importResources({
        Cluster: {
          Type: "AWS::RDS::DBCluster",
          Properties: engine === undefined ? {} : { Engine: engine },
        },
      });
      const fact = result.facts.find(
        (value) => value.logicalKey === "cloudformation.Cluster",
      );
      expect(fact?.kind).toBe("resource");
      if (fact?.kind !== "resource")
        throw new Error("Expected a DBCluster resource fact.");
      expect(fact).toMatchObject({
        confidence: "unresolved",
        resourceType: "cloudformation.aws.rds.dbcluster",
        deploymentIdentifier: "Cluster",
        ownership: "unknown",
      });
      expect(fact.serviceType).toBeUndefined();
      expect(fact.diagnostics.map((value) => value.code)).toContain(
        "cloudmarkup.import.ambiguous-resource-mapping",
      );
    },
  );
  it.each([
    {
      properties: { Engine: "postgres" },
      expected: "aws.rds.db-instance",
    },
    {
      properties: {
        Engine: "aurora-postgresql",
        DBClusterIdentifier: { Ref: "Cluster" },
      },
      expected: "aws.aurora.postgresql-instance",
    },
    {
      properties: {
        Engine: "aurora-postgresql",
        DBClusterIdentifier: "synthetic-existing-cluster",
      },
      expected: "aws.aurora.postgresql-instance",
    },
  ])(
    "classifies exact engine/cluster evidence as $expected",
    async ({ properties, expected }) => {
      const resources = {
        Cluster: cluster,
        Database: { Type: "AWS::RDS::DBInstance", Properties: properties },
      };
      const first = await importResources(resources);
      const reversed = await importResources(resources, true);
      const fact = (result: RepositoryImportResultV1) =>
        result.facts.find(
          (value) => value.logicalKey === "cloudformation.Database",
        );
      expect(fact(first)).toMatchObject({
        kind: "resource",
        confidence: "confirmed",
        resourceType: expected,
        serviceType: expected,
        deploymentIdentifier: "Database",
        ownership: "unknown",
      });
      expect(fact(reversed)).toEqual(fact(first));
      expect(first.diagnostics).toEqual([]);
      expect(first.observedSolution.designAuthority).toBe("none");
      expect(
        repositoryImportResultV1Schema.parse(JSON.parse(JSON.stringify(first))),
      ).toEqual(first);
    },
  );
  it.each([
    {
      Engine: { Ref: "EngineParameter" },
      DBClusterIdentifier: { Ref: "Cluster" },
    },
    { Engine: "postgres", DBClusterIdentifier: null },
    { Engine: "aurora-postgresql" },
    { Engine: "aurora-postgresql", DBClusterIdentifier: "   " },
    { Engine: "aurora-postgresql", DBClusterIdentifier: 123 },
    {
      Engine: "aurora-postgresql",
      DBClusterIdentifier: { Ref: "MissingCluster" },
    },
    {
      Engine: "aurora-postgresql",
      DBClusterIdentifier: { "Fn::ImportValue": "ExternalCluster" },
    },
  ])(
    "keeps ambiguous/unsupported DBInstance properties unresolved: %j",
    async (properties) => {
      const result = await importResources({
        Cluster: cluster,
        Database: { Type: "AWS::RDS::DBInstance", Properties: properties },
      });
      const fact = result.facts.find(
        (value) => value.logicalKey === "cloudformation.Database",
      );
      expect(fact).toMatchObject({
        kind: "resource",
        confidence: "unresolved",
        resourceType: "cloudformation.aws.rds.dbinstance",
      });
      expect(fact).not.toHaveProperty("serviceType");
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "cloudmarkup.import.ambiguous-resource-mapping",
          path: "template.json",
        }),
      );
      expect(result.observedSolution.designAuthority).toBe("none");
    },
  );
  it.each([
    { Type: "AWS::RDS::DBCluster", Properties: { Engine: "postgres" } },
    { Type: "AWS::RDS::DBCluster", Properties: { Engine: { Ref: "Engine" } } },
    {
      Type: "AWS::RDS::DBInstance",
      Properties: { Engine: "aurora-postgresql" },
    },
  ])(
    "does not confirm Aurora membership from a conflicting cluster reference: %j",
    async (referenced) => {
      const result = await importResources({
        Cluster: referenced,
        Database: {
          Type: "AWS::RDS::DBInstance",
          Properties: {
            Engine: "aurora-postgresql",
            DBClusterIdentifier: { Ref: "Cluster" },
          },
        },
      });
      expect(
        result.facts.find(
          (value) => value.logicalKey === "cloudformation.Database",
        ),
      ).toMatchObject({
        confidence: "unresolved",
        resourceType: "cloudformation.aws.rds.dbinstance",
      });
    },
  );
  it("imports a mixed standalone RDS and two-member Aurora template without collapsing identities", async () => {
    const member = {
      Type: "AWS::RDS::DBInstance",
      Properties: {
        Engine: "aurora-postgresql",
        DBClusterIdentifier: { Ref: "Cluster" },
        DBInstanceClass: "db.serverless",
      },
    };
    const result = await importResources({
      Cluster: cluster,
      MemberA: member,
      MemberB: member,
      Standalone: {
        Type: "AWS::RDS::DBInstance",
        Properties: { Engine: "postgres" },
      },
    });
    expect(
      result.facts
        .filter((fact) => fact.kind === "resource")
        .map((fact) => ({
          key: fact.logicalKey,
          serviceType: fact.serviceType,
        }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    ).toEqual([
      {
        key: "cloudformation.Cluster",
        serviceType: "aws.aurora.postgresql-cluster",
      },
      {
        key: "cloudformation.MemberA",
        serviceType: "aws.aurora.postgresql-instance",
      },
      {
        key: "cloudformation.MemberB",
        serviceType: "aws.aurora.postgresql-instance",
      },
      { key: "cloudformation.Standalone", serviceType: "aws.rds.db-instance" },
    ]);
    expect(result.diagnostics).toEqual([]);
  });
  it.each([
    ["LUSTRE", "aws.fsx.lustre-file-system"],
    ["ONTAP", "aws.fsx.ontap-file-system"],
    ["OPENZFS", "aws.fsx.openzfs-file-system"],
    ["WINDOWS", "aws.fsx.windows-file-system"],
  ])(
    "classifies the exact FSx family %s independently of catalog order",
    async (family, expected) => {
      const resources = {
        FileSystem: {
          Type: "AWS::FSx::FileSystem",
          Properties: { FileSystemType: family },
        },
      };
      for (const reverse of [false, true]) {
        const result = await importResources(resources, reverse);
        expect(
          result.facts.find(
            (value) => value.logicalKey === "cloudformation.FileSystem",
          ),
        ).toMatchObject({
          serviceType: expected,
          resourceType: expected,
          confidence: "confirmed",
        });
      }
    },
  );
  it.each([undefined, "OTHER", { Ref: "FamilyParameter" }])(
    "does not guess an ambiguous FSx family: %j",
    async (family) => {
      const result = await importResources({
        FileSystem: {
          Type: "AWS::FSx::FileSystem",
          Properties: { FileSystemType: family },
        },
      });
      const fact = result.facts.find(
        (value) => value.logicalKey === "cloudformation.FileSystem",
      );
      expect(fact).toMatchObject({
        confidence: "unresolved",
        resourceType: "cloudformation.aws.fsx.filesystem",
      });
      expect(fact).not.toHaveProperty("serviceType");
    },
  );
  it("imports the exact existing Aurora and standalone RDS compiler golden outputs with correct distinct identities", async () => {
    const root = await mkdtemp(join(tmpdir(), "cloudmarkup-db-export-import-"));
    for (const family of ["aurora", "rds"]) {
      const template = await readFile(
        new URL(
          `../../../services/iac-compiler/testdata/${family}-goldens-v1/template.json`,
          import.meta.url,
        ),
        "utf8",
      );
      await write(root, family + "/template.json", template);
    }
    const input = request();
    const before = hashCanonicalValue(input.approvedArchitecture);
    const result = await service.importRepository({
      sourceDirectory: root,
      request: input,
    });
    const databaseFacts = result.facts.filter(
      (fact) =>
        fact.kind === "resource" &&
        ["aws.rds.db-instance", "aws.aurora.postgresql-instance"].includes(
          fact.serviceType ?? "",
        ),
    );
    expect(
      databaseFacts.filter(
        (fact) => fact.source.path === "aurora/template.json",
      ),
    ).toHaveLength(1);
    expect(
      databaseFacts.filter((fact) => fact.source.path === "rds/template.json"),
    ).toHaveLength(1);
    for (const fact of databaseFacts)
      expect(fact).toMatchObject({
        confidence: "confirmed",
        serviceType:
          fact.source.path === "aurora/template.json"
            ? "aws.aurora.postgresql-instance"
            : "aws.rds.db-instance",
      });
    expect(hashCanonicalValue(input.approvedArchitecture)).toBe(before);
    expect(result.observedSolution.designAuthority).toBe("none");
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: "cloudmarkup.import.ambiguous-resource-mapping",
      }),
    );
    expect(
      repositoryImportResultV1Schema.parse(JSON.parse(JSON.stringify(result))),
    ).toEqual(result);
  });
});

function request(): RepositoryImportRequestV1 {
  const generated = createNotesGenerationRequest({
    mode: "complete-supported-pattern",
  });
  return repositoryImportRequestV1Schema.parse({
    contractVersion: 1,
    profile: {
      contractVersion: 1,
      profileId: "cloudmarkup.repository-import.default",
      profileVersion: "1.0.0",
      importedAt: timestamp,
      commitSha,
      snapshotId: "snapshot.test.1",
      observedSolutionId: "observed.test.1",
      sourceId: "repository.local.test",
      sourceDescriptor: "deterministic-test-repository",
      selectedPaths: ["."],
      limits: {
        maximumFileCount: 1_024,
        maximumFileBytes: 1024 * 1024,
        maximumTotalBytes: 16 * 1024 * 1024,
      },
    },
    approvedArchitecture: generated.architectureDocument,
    solutionRevision: generated.solutionRevision,
    catalog: awsCatalogArtifactV1,
  });
}
function withApprovedRepositoryObservation(
  solutionRevision: RepositoryImportRequestV1["solutionRevision"],
  result: RepositoryImportResultV1,
) {
  return {
    ...solutionRevision,
    repositoryObservations: [
      {
        approvalId: "approval.repository-import.test",
        approvedAt: timestamp,
        approvedBy: "actor.repository-reviewer.test",
        observedContentHash: result.observedSolution.observedContentHash,
        observedSolutionId: result.observedSolution.observedSolutionId,
        repositorySnapshotId: result.snapshot.snapshotId,
        snapshotContentHash: result.snapshot.snapshotDigest,
      },
    ],
  };
}

function resealRepositoryImportResult(
  result: RepositoryImportResultV1,
): RepositoryImportResultV1 {
  const { resultDigest, ...projection } = result;
  void resultDigest;
  return repositoryImportResultV1Schema.parse({
    ...projection,
    resultDigest: hashCanonicalValue(projection),
  });
}

const hclResult: HCLInspectionResultV1 = hclInspectionResultV1Schema.parse({
  contractVersion: 1,
  parser: {
    id: "cloudmarkup.terraform-hcl-inspector",
    version: "1.0.0",
  },
  succeeded: true,
  diagnostics: [],
  blocks: [
    {
      type: "resource",
      labels: ["aws_dynamodb_table", "notes"],
      blockPath: ["resource", "aws_dynamodb_table", "notes"],
      range: { startLine: 1, startColumn: 1, endLine: 4, endColumn: 2 },
      attributes: [
        {
          name: "name",
          expressionKind: "literal",
          expressionDigest: `sha256:${"2".repeat(64)}`,
          references: [],
          range: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 18 },
        },
      ],
    },
  ],
});

const service = createRepositoryImportService({
  hclInspector: {
    inspect() {
      return Promise.resolve(hclResult);
    },
  },
});

async function write(root: string, path: string, value: string): Promise<void> {
  await mkdir(join(root, ...path.split("/").slice(0, -1)), { recursive: true });
  await writeFile(join(root, ...path.split("/")), value, "utf8");
}

function architectureFiles(input: RepositoryImportRequestV1) {
  const {
    applicationContracts,
    externalResources,
    workloadBehavior,
    ...architecture
  } = input.approvedArchitecture;
  return {
    "cloudmarkup/architecture.json": serializeCanonicalJson(architecture),
    "cloudmarkup/contracts/application-contracts.json":
      serializeCanonicalJson(applicationContracts),
    "cloudmarkup/external-resources.json":
      serializeCanonicalJson(externalResources),
    "cloudmarkup/solution.json": serializeCanonicalJson(input.solutionRevision),
    "cloudmarkup/workloads.json": serializeCanonicalJson(workloadBehavior),
  };
}

async function fixture(
  extra: Readonly<Record<string, string>> = {},
  reverse = false,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-import-"));
  const entries = Object.entries({
    ...architectureFiles(request()),
    "application/custom.ts": "export const customize = () => true;\n",
    "application/index.ts":
      "export const handler = async () => ({ statusCode: 200 });\n",
    "application/manifest.json": serializeCanonicalJson({
      files: [
        {
          path: "application/custom.ts",
          ownership: "user-owned-extension",
          checksum: `sha256:${"e".repeat(64)}`,
        },
        {
          path: "application/index.ts",
          ownership: "generated",
          checksum: `sha256:${"f".repeat(64)}`,
          provenance: {
            workloadIds: ["workload_notes_api"],
            environmentBindingIds: ["binding.table-name"],
          },
        },
      ],
      workloadContracts: [
        {
          workloadId: "workload_notes_api",
          handler: "index.handler",
        },
      ],
    }),
    "infrastructure/main.tf":
      'resource "aws_dynamodb_table" "notes" {\n  name = "redacted-by-parser-boundary"\n}\n',
    "infrastructure/main.tf.json": JSON.stringify({
      resource: {
        aws_dynamodb_table: {
          notes_json: { name: "notes-json" },
        },
      },
    }),
    "infrastructure/plan.json": JSON.stringify({
      format_version: "1.2",
      planned_values: {
        root_module: {
          resources: [
            {
              address: "aws_dynamodb_table.notes",
              mode: "managed",
              type: "aws_dynamodb_table",
              values: {
                name: "notes",
                access_token: "MUST_NOT_SURVIVE",
                opaque: "MASKED_VALUE_MUST_NOT_SURVIVE",
              },
              sensitive_values: { opaque: true },
            },
            {
              address: "data.aws_dynamodb_table.external",
              mode: "data",
              type: "aws_dynamodb_table",
              values: { name: "external-notes" },
            },
          ],
        },
      },
    }),
    "cdk.out/application.template.json": JSON.stringify({
      Resources: {
        SynthesizedLogs: {
          Type: "AWS::Logs::LogGroup",
          Properties: {},
        },
      },
    }),
    "infrastructure/template.yaml": `AWSTemplateFormatVersion: "2010-09-09"\nResources:\n  NotesTable:\n    Type: AWS::DynamoDB::Table\n    Properties:\n      BillingMode: PAY_PER_REQUEST\n  NotesPolicy:\n    Type: AWS::IAM::Policy\n    Properties:\n      PolicyName: notes\n      PolicyDocument:\n        Statement:\n          - Effect: Allow\n            Action: dynamodb:*\n            Resource: "*"\n      Roles: []\n`,
    "infrastructure/intrinsics.template.yaml": `AWSTemplateFormatVersion: "2010-09-09"\nResources:\n  ExecutionRole:\n    Type: AWS::IAM::Role\n    Properties:\n      AssumeRolePolicyDocument:\n        Statement:\n          - Effect: Allow\n            Action: sts:AssumeRole\n            Principal:\n              Service: lambda.amazonaws.com\n  SharedPolicy:\n    Type: AWS::IAM::ManagedPolicy\n    Properties:\n      PolicyDocument:\n        Statement:\n          - Effect: Allow\n            Action: s3:GetObject\n            Resource: "*"\n  AuditLog:\n    Type: AWS::Logs::LogGroup\n    DependsOn: SharedPolicy\n  Function:\n    Type: AWS::Lambda::Function\n    Properties:\n      FunctionName: !Sub "notes-\${AWS::Region}"\n      Role: !GetAtt ExecutionRole.Arn\n      Environment:\n        Variables:\n          AUDIT_LOG: !Sub "\${AuditLog.Arn}"\n          SHARED_TABLE: !ImportValue shared-table-name\n`,
    ".github/workflows/cloudmarkup.yml": `name: CloudMarkup\non: [pull_request]\npermissions:\n  contents: read\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n      - run: cloudmarkup generate\n      - run: cloudmarkup verify\n`,
    ...extra,
  });
  if (reverse) entries.reverse();
  for (const [path, value] of entries) await write(root, path, value);
  return root;
}

describe("repository import service", () => {
  it("resolves nested and cross-file HCL references within each module and hashes nested settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "cloudmarkup-hcl-module-"));
    const paths = [
      "main.tf",
      "consumer.tf",
      "data.tf",
      "modules/child/main.tf",
      "modules/child/consumer.tf",
    ];
    for (const path of paths)
      await write(root, path, "# Synthetic parser boundary fixture\n");
    let nestedDigest = hashCanonicalValue("nested-setting-first");
    const importer = createRepositoryImportService({
      hclInspector: {
        inspect({ path }) {
          const consumer = path.endsWith("consumer.tf");
          const blockType = path === "data.tf" ? "data" : "resource";
          const resourceType = consumer
            ? "aws_lambda_function"
            : "aws_sqs_queue";
          const name = consumer ? "consumer" : "incoming";
          const blockPath = [blockType, resourceType, name];
          const range = {
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 2,
          };
          return Promise.resolve(
            hclInspectionResultV1Schema.parse({
              contractVersion: 1,
              parser: hclResult.parser,
              succeeded: true,
              diagnostics: [],
              blocks: [
                {
                  type: blockType,
                  labels: [resourceType, name],
                  blockPath,
                  range,
                  attributes: [],
                },
                ...(consumer
                  ? [
                      {
                        type: "environment",
                        labels: [],
                        blockPath: [...blockPath, "environment"],
                        range,
                        attributes: [
                          {
                            name: "variables",
                            expressionKind: "collection",
                            expressionDigest: nestedDigest,
                            range,
                            references: [
                              "aws_sqs_queue.incoming.url",
                              "aws_sqs_queue.incoming.arn",
                              "data.aws_sqs_queue.incoming.url",
                              "module.child.output",
                            ],
                          },
                        ],
                      },
                    ]
                  : []),
              ],
            }),
          );
        },
      },
    });
    const first = await importer.importRepository({
      sourceDirectory: root,
      request: request(),
    });
    const connections = first.facts.filter(
      (fact) => fact.kind === "connection",
    );
    expect(connections).toHaveLength(3);
    for (const edge of connections) {
      expect(edge.sourceKey.includes("terraform.module.")).toBe(
        edge.targetKey.includes("terraform.module."),
      );
    }
    expect(
      connections.some(
        (edge) => edge.targetKey === "terraform.data.aws_sqs_queue.incoming",
      ),
    ).toBe(true);
    expect(first.observedSolution.connections).toHaveLength(3);
    nestedDigest = hashCanonicalValue("nested-setting-edited");
    const second = await importer.importRepository({
      sourceDirectory: root,
      request: request(),
    });
    const configuration = (result: RepositoryImportResultV1) =>
      result.facts.find(
        (fact) =>
          fact.kind === "resource" &&
          fact.logicalKey === "terraform.resource.aws_lambda_function.consumer",
      );
    expect(configuration(first)).not.toEqual(configuration(second));
    expect(second.observedSolution.connections).toHaveLength(3);
  });
  it("imports all deterministic sources, redacts state, and is reproducible across file order", async () => {
    const first = await service.importRepository({
      sourceDirectory: await fixture(),
      request: request(),
    });
    const second = await service.importRepository({
      sourceDirectory: await fixture({}, true),
      request: request(),
    });
    expect(second).toEqual(first);
    expect(first.snapshot.importer.importerVersion).toBe(
      REPOSITORY_IMPORTER_VERSION,
    );
    expect(first.snapshot.redaction).toMatchObject({
      status: "applied",
      redactedFileCount: 1,
      redactedValueCount: 2,
    });
    expect(first.facts.map(({ target }) => target)).toEqual(
      expect.arrayContaining([
        "cloudmarkup",
        "terraform",
        "terraform-show-json",
        "cloudformation",
        "application-manifest",
        "workflow",
      ]),
    );
    expect(first.observedSolution.designAuthority).toBe("none");
    expect(first.observedSolution.mutationPolicy).toBe(
      "reviewed-reconciliation-required",
    );
    expect(first.evidence.level).toEqual({
      rank: 8,
      kind: "repository-conformance",
    });
    expect(JSON.stringify(first)).not.toContain("MUST_NOT_SURVIVE");
    expect(JSON.stringify(first)).not.toContain(
      "MASKED_VALUE_MUST_NOT_SURVIVE",
    );
    expect(JSON.stringify(first)).not.toContain("redacted-by-parser-boundary");
    expect(first.facts).toContainEqual(
      expect.objectContaining({ kind: "resource", external: true }),
    );
    expect(first.differences).toContainEqual(
      expect.objectContaining({ kind: "iam-expansion" }),
    );
    expect(first.differences).toContainEqual(
      expect.objectContaining({ kind: "external-resource" }),
    );
    expect(first.differences).toContainEqual(
      expect.objectContaining({ kind: "unmanaged-resource" }),
    );
    expect(first.facts).toContainEqual(
      expect.objectContaining({ providerId: "aws.cloudmarkup" }),
    );
    expect(first.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "cloudmarkup.import.yaml-invalid" }),
    );
    expect(first.facts).toContainEqual(
      expect.objectContaining({
        kind: "policy",
        actions: ["s3:GetObject"],
      }),
    );
    expect(first.observedSolution.externalResources.length).toBeGreaterThan(0);
    expect(
      first.facts.some(
        (fact) =>
          fact.kind === "connection" &&
          fact.sourceKey.endsWith(".Function") &&
          fact.targetKey.endsWith(".AuditLog"),
      ),
    ).toBe(true);
    expect(
      first.facts.some(
        (fact) =>
          fact.kind === "connection" &&
          fact.sourceKey.endsWith(".AuditLog") &&
          fact.targetKey.endsWith(".SharedPolicy"),
      ),
    ).toBe(true);
    expect(
      first.observedSolution.connections.some(
        ({ target }) => target.kind === "external-resource",
      ),
    ).toBe(true);
    expect(
      first.observedSolution.workloads.some(
        ({ designComparison }) =>
          designComparison.state === "matches-approved-design",
      ),
    ).toBe(true);
    expect(first.facts).toContainEqual(
      expect.objectContaining({ target: "cdk-synth" }),
    );
    expect(first.facts).toContainEqual(
      expect.objectContaining({
        kind: "generated-file",
        path: "application/custom.ts",
        ownership: "user-owned",
      }),
    );
    const customFact = first.facts.find(
      (fact) =>
        fact.kind === "generated-file" && fact.path === "application/custom.ts",
    );
    expect(
      first.differences.some(
        (difference) =>
          difference.kind === "generated-file-drift" &&
          customFact !== undefined &&
          difference.observedFactIds.includes(customFact.factId),
      ),
    ).toBe(false);
    expect(first.facts).toContainEqual(
      expect.objectContaining({
        kind: "workload-binding",
        environmentBindingNames: ["binding.table-name"],
      }),
    );
    for (const issue of first.issues)
      expect(issue.currentRecordDigest).toBe(getActiveIssueRecordHash(issue));

    const frozen = request();
    const revisionWithApprovedExtension = withApprovedRepositoryObservation(
      {
        ...frozen.solutionRevision,
        sourceOwnership: [
          ...frozen.solutionRevision.sourceOwnership,
          {
            conflictBehavior: "preserve-user-content" as const,
            ownerId: "application.notes.owner",
            ownership: "approved-extension" as const,
            path: repositoryRelativePathSchema.parse("application/custom.ts"),
          },
        ],
      },
      first,
    );
    const importedLayer = projectRepositoryImportToConformanceLayerInputV1({
      result: first,
      solutionRevision: revisionWithApprovedExtension,
    });
    expect(importedLayer).toMatchObject({
      evidenceIds: [first.evidence.id],
      evidenceType: "repository-snapshot",
      integrity: "verified",
      layer: "imported",
      sources: [
        expect.objectContaining({
          repositoryCommit: commitSha,
          sourceId: first.snapshot.snapshotId,
        }),
      ],
    });
    expect(importedLayer.facts).toContainEqual(
      expect.objectContaining({
        extensionPoint: true,
        ownership: "user-extension",
        sourceLocations: [
          expect.objectContaining({ path: "application/manifest.json" }),
        ],
      }),
    );
    expect(JSON.stringify(importedLayer)).not.toContain(
      "export const customize",
    );

    const tampered = structuredClone(first);
    tampered.resultDigest = hashCanonicalValue("tampered-import-result");
    expect(
      projectRepositoryImportToConformanceLayerInputV1({
        result: tampered,
        solutionRevision: revisionWithApprovedExtension,
      }),
    ).toMatchObject({ integrity: "invalid" });
  });

  it("requires one exact approved repository observation and rejects resealed substitutions", async () => {
    const input = request();
    const result = await service.importRepository({
      sourceDirectory: await fixture(),
      request: input,
    });
    const approvedRevision = withApprovedRepositoryObservation(
      input.solutionRevision,
      result,
    );
    expect(
      projectRepositoryImportToConformanceLayerInputV1({
        result,
        solutionRevision: input.solutionRevision,
      }),
    ).toMatchObject({ integrity: "invalid" });

    const substitutions: readonly [
      string,
      (candidate: RepositoryImportResultV1) => void,
    ][] = [
      [
        "snapshot identity",
        (candidate) => {
          candidate.snapshot.snapshotId =
            "snapshot.substituted" as typeof candidate.snapshot.snapshotId;
        },
      ],
      [
        "snapshot hash",
        (candidate) => {
          candidate.snapshot.snapshotDigest = hashCanonicalValue(
            "substituted repository snapshot",
          );
        },
      ],
      [
        "observed-solution identity",
        (candidate) => {
          candidate.observedSolution.observedSolutionId =
            "observed.substituted" as typeof candidate.observedSolution.observedSolutionId;
        },
      ],
      [
        "observed-solution hash",
        (candidate) => {
          candidate.observedSolution.observedContentHash = hashCanonicalValue(
            "substituted observed solution",
          );
        },
      ],
    ];
    for (const [label, substitute] of substitutions) {
      const candidate = structuredClone(result);
      substitute(candidate);
      const projected = projectRepositoryImportToConformanceLayerInputV1({
        result: resealRepositoryImportResult(candidate),
        solutionRevision: approvedRevision,
      });
      expect(projected.integrity, label).toBe("invalid");
      expect(projected.invalidReason, label).toContain(
        "approved repository-observation",
      );
    }
  });

  it("classifies exact CloudMarkup resource, connection, and configuration facts as matches", async () => {
    const input = request();
    const root = await mkdtemp(join(tmpdir(), "cloudmarkup-exact-"));
    for (const [path, value] of Object.entries(architectureFiles(input))) {
      await write(root, path, value);
    }
    const result = await service.importRepository({
      sourceDirectory: root,
      request: input,
    });
    const approvedSolutionRevision = withApprovedRepositoryObservation(
      input.solutionRevision,
      result,
    );
    const imported = projectRepositoryImportToConformanceLayerInputV1({
      result,
      solutionRevision: approvedSolutionRevision,
    });
    const targetKeys = assignConformanceTargetKeysV1({
      architectureDocument: input.approvedArchitecture,
    });
    const sourceId = "source.design.exact";
    const evidenceId = "evidence.design.exact";
    const sourceLocation = [{ path: "cloudmarkup/architecture.json" }];
    const designedFact = (
      kind: "configuration" | "connection" | "resource",
      stableKey: string,
      semanticDigest: string,
      mappedReference?:
        | { readonly kind: "architecture-node"; readonly nodeId: string }
        | {
            readonly edgeId: string;
            readonly kind: "architecture-edge";
          },
    ) => ({
      applicationBinding: "not-applicable" as const,
      evidenceIds: [evidenceId],
      extensionPoint: false,
      factId: `fact.design.${kind}.${stableKey}`,
      iamAccess: "not-applicable" as const,
      iamPermissions: [],
      layer: "designed" as const,
      management: "managed" as const,
      operation: "none" as const,
      ownership: "user-owned" as const,
      publicExposure: "unknown" as const,
      semanticComparison: {
        basis:
          kind === "resource"
            ? ("resource-intent" as const)
            : kind === "connection"
              ? ("connection-intent" as const)
              : ("configuration-intent" as const),
        contractVersion: 1 as const,
        coverage: "complete" as const,
      },
      semanticDigest,
      sourceIds: [sourceId],
      sourceLocations: sourceLocation,
      subject: {
        kind,
        ...(mappedReference === undefined ? {} : { mappedReference }),
        stableKey,
      },
    });
    const designedFacts = [
      ...input.approvedArchitecture.nodes.map((node) =>
        designedFact(
          "resource",
          node.id,
          hashCanonicalValue(
            projectArchitectureResourceIntentV1(
              {
                architectureDocument: input.approvedArchitecture,
                workloadBehavior: input.approvedArchitecture.workloadBehavior,
              },
              node,
              targetKeys,
            ),
          ),
          { kind: "architecture-node", nodeId: node.id },
        ),
      ),
      ...input.approvedArchitecture.edges.map((edge) =>
        designedFact(
          "connection",
          edge.id,
          hashCanonicalValue(
            projectArchitectureConnectionIntentV1(edge, targetKeys),
          ),
          { edgeId: edge.id, kind: "architecture-edge" },
        ),
      ),
      ...input.approvedArchitecture.variables.map((variable) =>
        designedFact(
          "configuration",
          `variable:${variable.id}`,
          hashCanonicalValue(projectArchitectureVariableIntentV1(variable)),
        ),
      ),
      ...input.approvedArchitecture.outputs.map((output) =>
        designedFact(
          "configuration",
          `output:${output.id}`,
          hashCanonicalValue(
            projectArchitectureOutputIntentV1(output, targetKeys),
          ),
        ),
      ),
    ];
    const revision = {
      digest: hashCanonicalValue(approvedSolutionRevision),
      id: approvedSolutionRevision.solutionRevisionId,
    };
    const designed = {
      availability: "available" as const,
      boundSolutionRevision: revision,
      completeness: "complete" as const,
      declaredFreshness: "current" as const,
      evidenceIds: [evidenceId],
      evidenceType: "approved-documents" as const,
      facts: designedFacts,
      integrity: "verified" as const,
      layer: "designed" as const,
      sources: [
        {
          digest: input.solutionRevision.architecture.documentHash,
          kind: "architecture-document" as const,
          observedAt: timestamp,
          solutionRevisionId: revision.id,
          sourceId,
        },
      ],
      verifiedAt: timestamp,
    };
    const comparableImported = {
      ...imported,
      completeness: "complete" as const,
      facts: imported.facts.filter(({ subject }) =>
        ["configuration", "connection", "resource"].includes(subject.kind),
      ),
    };
    const unavailable = (
      layer: "current-drift" | "deployed" | "generated" | "planned",
      evidenceType:
        | "cloud-plan-change-set"
        | "deployment-smoke-integration"
        | "generated-manifest"
        | "read-only-drift",
    ) => ({
      availability: "unavailable" as const,
      completeness: "unknown" as const,
      declaredFreshness: "current" as const,
      evidenceIds: [],
      evidenceType,
      ...(layer === "planned" ||
      layer === "deployed" ||
      layer === "current-drift"
        ? { environmentId: "environment.test" }
        : {}),
      facts: [],
      integrity: "unknown" as const,
      layer,
      sources: [],
    });
    const report = evaluateConformanceV1({
      contractVersion: 1,
      currentSolutionRevision: revision,
      environment: {
        environmentId: "environment.test",
        environmentType: "test",
      },
      evaluatedAt: timestamp,
      evaluatedSolutionRevision: revision,
      evaluator: {
        id: "cloudmarkup.continuous-conformance",
        version: "1.0.0",
      },
      layers: [
        designed,
        comparableImported,
        unavailable("generated", "generated-manifest"),
        unavailable("planned", "cloud-plan-change-set"),
        unavailable("deployed", "deployment-smoke-integration"),
        unavailable("current-drift", "read-only-drift"),
      ],
      projectId: "project.test",
      stalenessPolicy: structuredClone(defaultConformanceStalenessPolicyV1),
    });
    const kinds = new Set(report.differences.map(({ kind }) => kind));
    expect(kinds.has("matching-resource")).toBe(true);
    expect(kinds.has("matching-connection")).toBe(true);
    expect(kinds.has("matching-configuration")).toBe(true);
    expect(
      report.differences.filter(({ kind }) =>
        [
          "configuration-mismatch",
          "connection-mismatch",
          "generated-drift",
        ].includes(kind),
      ),
    ).toEqual([]);
  });

  it("classifies explicit workload handler mismatches without changing repository files", async () => {
    const manifest = serializeCanonicalJson({
      files: [],
      workloadContracts: [
        {
          workloadId: "workload_notes_api",
          handler: "unexpected.handler",
        },
      ],
    });
    const result = await service.importRepository({
      sourceDirectory: await fixture({
        "application/manifest.json": manifest,
      }),
      request: request(),
    });
    const fact = result.facts.find(
      (candidate) =>
        candidate.kind === "workload-binding" &&
        candidate.handler === "unexpected.handler",
    );
    if (fact === undefined) throw new Error("Expected workload binding fact.");
    const mismatch = result.differences.find(
      ({ kind }) => kind === "application-binding-mismatch",
    );
    expect(mismatch).toBeDefined();
    expect(mismatch?.observedFactIds).toContain(fact.factId);
  });

  it("enforces portable paths and the explicit selected subtree", async () => {
    for (const path of [
      "../escape.tf",
      "C:/escape.tf",
      "bad\\path.tf",
      "CON",
      "name:stream.tf",
    ])
      expect(() => validateRepositoryImportRelativePath(path)).toThrow(
        /portable/u,
      );
    expect(validateRepositoryImportRelativePath("infrastructure/main.tf")).toBe(
      "infrastructure/main.tf",
    );
    const root = await fixture({
      "outside/extra.tf": 'resource "x" "y" {}\n',
    });
    const selected = request();
    selected.profile.selectedPaths = [
      validateRepositoryImportRelativePath("cloudmarkup"),
    ];
    const result = await service.importRepository({
      sourceDirectory: root,
      request: selected,
    });
    expect(
      result.snapshot.files.every(({ path }) =>
        path.startsWith("cloudmarkup/"),
      ),
    ).toBe(true);
    expect(
      result.snapshot.files.some(({ path }) => path === "outside/extra.tf"),
    ).toBe(false);

    const historicalRequest = request();
    const historicalRoot = await fixture({
      "cloudcanvas/architecture.json": serializeCanonicalJson(
        historicalRequest.approvedArchitecture,
      ),
    });
    const historicalResult = await service.importRepository({
      sourceDirectory: historicalRoot,
      request: historicalRequest,
    });
    expect(
      historicalResult.snapshot.files.some(({ path }) =>
        path.startsWith("cloudcanvas/"),
      ),
    ).toBe(false);
  });

  it("rejects a structurally valid result whose integrity digest was changed", async () => {
    const result = await service.importRepository({
      sourceDirectory: await fixture(),
      request: request(),
    });
    const tampered = {
      ...result,
      resultDigest: ("sha256:" + "0".repeat(64)) as typeof result.resultDigest,
    };
    expect(verifyRepositoryImport(tampered)).toMatchObject({
      conforms: false,
      errors: [
        {
          code: "cloudmarkup.import.result-integrity-invalid",
          severity: "error",
        },
      ],
    });
  });

  it("marks mutable workflow actions unresolved and reports explicit IAM reduction", async () => {
    const root = await fixture({
      ".github/workflows/cloudmarkup.yml": `jobs:\n  verify:\n    steps:\n      - uses: actions/checkout@v4\n`,
      "infrastructure/deny.template.json": JSON.stringify({
        Resources: {
          Guardrail: {
            Type: "AWS::IAM::Policy",
            Properties: {
              PolicyDocument: {
                Statement: [
                  {
                    Effect: "Deny",
                    Action: "s3:DeleteObject",
                    Resource: "*",
                  },
                ],
              },
            },
          },
        },
      }),
    });
    const result = await service.importRepository({
      sourceDirectory: root,
      request: request(),
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "cloudmarkup.import.workflow-action-unpinned",
      }),
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: "workflow", confidence: "unresolved" }),
    );
    expect(result.differences).toContainEqual(
      expect.objectContaining({ kind: "iam-reduction" }),
    );
  });

  it("reports exact source matches, visual stability, and semantic mismatches", async () => {
    const input = request();
    const exactRoot = await mkdtemp(join(tmpdir(), "cloudmarkup-exact-"));
    for (const [path, value] of Object.entries(architectureFiles(input)))
      await write(exactRoot, path, value);
    const exact = await service.importRepository({
      sourceDirectory: exactRoot,
      request: input,
    });
    expect(exact.differences.every(({ kind }) => kind === "matches")).toBe(
      true,
    );
    expect(exact.proposal).toBeUndefined();

    const visual = structuredClone(input.approvedArchitecture);
    const visualNode = visual.nodes[0];
    if (visualNode === undefined) throw new Error("fixture node missing");
    visualNode.presentation.label = "Mutable imported label";
    const {
      applicationContracts: visualContracts,
      externalResources: visualExternal,
      workloadBehavior: visualWorkloads,
      ...visualProjection
    } = visual;
    const visualRoot = await mkdtemp(join(tmpdir(), "cloudmarkup-visual-"));
    for (const [path, value] of Object.entries({
      "cloudmarkup/architecture.json": serializeCanonicalJson(visualProjection),
      "cloudmarkup/contracts/application-contracts.json":
        serializeCanonicalJson(visualContracts),
      "cloudmarkup/external-resources.json":
        serializeCanonicalJson(visualExternal),
      "cloudmarkup/solution.json": serializeCanonicalJson(
        input.solutionRevision,
      ),
      "cloudmarkup/workloads.json": serializeCanonicalJson(visualWorkloads),
    }))
      await write(visualRoot, path, value);
    const visualResult = await service.importRepository({
      sourceDirectory: visualRoot,
      request: input,
    });
    expect(
      visualResult.differences.every(({ kind }) => kind === "matches"),
    ).toBe(true);

    visualNode.semantic.deploymentKey =
      "changed_deployment_key" as typeof visualNode.semantic.deploymentKey;
    await write(
      visualRoot,
      "cloudmarkup/architecture.json",
      serializeCanonicalJson(visualProjection),
    );
    const changed = await service.importRepository({
      sourceDirectory: visualRoot,
      request: input,
    });
    expect(changed.differences).toContainEqual(
      expect.objectContaining({ kind: "configuration-mismatch" }),
    );

    visualNode.semantic.deploymentKey =
      input.approvedArchitecture.nodes[0]?.semantic.deploymentKey ??
      visualNode.semantic.deploymentKey;
    const visualEdge = visual.edges[0];
    if (visualEdge === undefined) throw new Error("fixture edge missing");
    visualEdge.semantic.relationshipType =
      "cloudmarkup.import.changed-relationship" as typeof visualEdge.semantic.relationshipType;
    await write(
      visualRoot,
      "cloudmarkup/architecture.json",
      serializeCanonicalJson(visualProjection),
    );
    const changedConnection = await service.importRepository({
      sourceDirectory: visualRoot,
      request: input,
    });
    expect(changedConnection.differences).toContainEqual(
      expect.objectContaining({ kind: "connection-mismatch" }),
    );
  });

  it("marks ambiguous HCL expressions unresolved without reading values", async () => {
    const ambiguousService = createRepositoryImportService({
      hclInspector: {
        inspect() {
          const result = structuredClone(hclResult);
          const attribute = result.blocks[0]?.attributes[0];
          if (attribute === undefined)
            throw new Error("fixture attribute missing");
          attribute.expressionKind = "reference";
          attribute.references = ["var.table_name"];
          return Promise.resolve(result);
        },
      },
    });
    const result = await ambiguousService.importRepository({
      sourceDirectory: await fixture(),
      request: request(),
    });
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        target: "terraform",
        confidence: "unresolved",
      }),
    );
    expect(result.differences).toContainEqual(
      expect.objectContaining({ kind: "unsupported-unresolved-import" }),
    );
  });

  it("rejects binary surprises and reports malformed deterministic inputs", async () => {
    const binary = await mkdtemp(join(tmpdir(), "cloudmarkup-binary-"));
    await mkdir(join(binary, "infrastructure"), { recursive: true });
    await writeFile(
      join(binary, "infrastructure", "main.tf"),
      new Uint8Array([0, 1, 2, 3]),
    );
    await expect(
      service.importRepository({
        sourceDirectory: binary,
        request: request(),
      }),
    ).rejects.toThrow(/binary/u);

    const malformed = await mkdtemp(join(tmpdir(), "cloudmarkup-malformed-"));
    await write(malformed, "infrastructure/broken.json", "{not-json");
    const result = await service.importRepository({
      sourceDirectory: malformed,
      request: request(),
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "cloudmarkup.import.json-invalid" }),
    );

    const unsafeYaml = await mkdtemp(join(tmpdir(), "cloudmarkup-yaml-"));
    await write(
      unsafeYaml,
      "infrastructure/template.yaml",
      "Resources: !UnreviewedTag { Function: echo }\n",
    );
    const unsafe = await service.importRepository({
      sourceDirectory: unsafeYaml,
      request: request(),
    });
    expect(unsafe.diagnostics).toContainEqual(
      expect.objectContaining({ code: "cloudmarkup.import.yaml-invalid" }),
    );
  });

  it("detects generated-file drift without overwriting the file", async () => {
    const input = request();
    const result = await service.importRepository({
      sourceDirectory: await fixture(),
      request: input,
    });
    expect(result.differences).toContainEqual(
      expect.objectContaining({ kind: "generated-file-drift" }),
    );
    const generatedFact = result.facts.find(
      (fact) =>
        fact.kind === "generated-file" && fact.path === "application/index.ts",
    );
    if (generatedFact?.kind !== "generated-file")
      throw new Error("Expected generated-file fact.");
    expect(generatedFact.actualChecksum).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(generatedFact.actualChecksum).not.toBe(
      generatedFact.expectedChecksum,
    );

    const layer = projectRepositoryImportToConformanceLayerInputV1({
      result,
      solutionRevision: withApprovedRepositoryObservation(
        input.solutionRevision,
        result,
      ),
    });
    const projected = layer.facts.find(
      ({ subject }) =>
        subject.mappedReference?.kind === "repository-location" &&
        subject.mappedReference.location.path === "application/index.ts",
    );
    expect(projected).toMatchObject({
      extensionPoint: false,
      ownership: "generated",
      repositoryFileState: "generated-file-drift",
      semanticDigest: generatedFact.actualChecksum,
      subject: { kind: "repository-file" },
    });
  });

  it("emits review-only graph commands that apply through the domain engine", async () => {
    const input = request();
    const extraNode = structuredClone(input.approvedArchitecture.nodes[0]);
    if (extraNode === undefined) throw new Error("fixture node missing");
    extraNode.id = "node_imported_exact" as typeof extraNode.id;
    extraNode.semantic.deploymentKey =
      "imported_exact" as typeof extraNode.semantic.deploymentKey;
    extraNode.presentation.label = "Imported exact";
    const observedArchitecture = {
      ...input.approvedArchitecture,
      nodes: [...input.approvedArchitecture.nodes, extraNode],
    };
    const {
      applicationContracts,
      externalResources,
      workloadBehavior,
      ...projection
    } = observedArchitecture;
    const root = await fixture({
      "cloudmarkup/architecture.json": serializeCanonicalJson(projection),
      "cloudmarkup/contracts/application-contracts.json":
        serializeCanonicalJson(applicationContracts),
      "cloudmarkup/external-resources.json":
        serializeCanonicalJson(externalResources),
      "cloudmarkup/workloads.json": serializeCanonicalJson(workloadBehavior),
    });
    const result = await service.importRepository({
      sourceDirectory: root,
      request: input,
    });
    const operation = result.proposal?.operations.find(
      (candidate) => candidate.kind === "accept-observed-graph-change",
    );
    expect(operation?.kind).toBe("accept-observed-graph-change");
    if (operation?.kind !== "accept-observed-graph-change") return;
    const applied = applyGraphCommand(
      input.approvedArchitecture,
      operation.graphCommands,
    );
    expect(applied.document.nodes.some(({ id }) => id === extraNode.id)).toBe(
      true,
    );
  });

  it("rejects symlinks and selected oversized files", async () => {
    const linked = await mkdtemp(join(tmpdir(), "cloudmarkup-link-"));
    await write(linked, "source/main.tf", 'resource "x" "y" {}\n');
    await symlink(join(linked, "source", "main.tf"), join(linked, "linked.tf"));
    await expect(
      service.importRepository({ sourceDirectory: linked, request: request() }),
    ).rejects.toThrow(/links are forbidden/u);

    const large = await mkdtemp(join(tmpdir(), "cloudmarkup-large-"));
    await write(large, "main.tf", "x".repeat(1_025));
    const constrained = request();
    constrained.profile.limits.maximumFileBytes = 1_024;
    await expect(
      service.importRepository({
        sourceDirectory: large,
        request: constrained,
      }),
    ).rejects.toThrow(/size limit/u);
  });

  it("reports designed-only resources for an empty safe repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "cloudmarkup-empty-"));
    const result = await service.importRepository({
      sourceDirectory: root,
      request: request(),
    });
    expect(result.differences).toContainEqual(
      expect.objectContaining({ kind: "designed-but-not-observed" }),
    );
    expect(result.proposal).toBeUndefined();
  });
});

describe("unsupported Terraform modules and CloudFormation transforms", () => {
  const marker = "IMPORT_LITERAL_MUST_NOT_SURVIVE";
  const remote = "https://example.invalid/private-module";
  const moduleInspection = hclInspectionResultV1Schema.parse({
    ...hclResult,
    blocks: [
      {
        type: "module",
        labels: ["application"],
        blockPath: ["module", "application"],
        range: { startLine: 2, startColumn: 1, endLine: 5, endColumn: 2 },
        attributes: [
          {
            name: "source",
            expressionKind: "literal",
            expressionDigest: hashCanonicalValue("redacted module source"),
            references: [],
            range: { startLine: 3, startColumn: 3, endLine: 3, endColumn: 12 },
          },
        ],
      },
    ],
  });
  const moduleService = createRepositoryImportService({
    hclInspector: { inspect: () => Promise.resolve(moduleInspection) },
  });
  const cases = [
    {
      path: "main.tf",
      content:
        '# Reviewed source\nmodule "application" {\n  source = "' +
        remote +
        '"\n  token = "' +
        marker +
        '"\n}\n',
      code: "terraform-module-unresolved",
    },
    {
      path: "main.tf.json",
      content: JSON.stringify({
        module: { application: { source: remote, token: marker } },
      }),
      code: "terraform-module-unresolved",
    },
    {
      path: "template.json",
      content: JSON.stringify({
        Transform: {
          Name: "AWS::Include",
          Parameters: { Location: remote, token: marker },
        },
      }),
      code: "cloudformation-transform-unresolved",
    },
    {
      path: "template.yaml",
      content:
        'Transform:\n  Name: AWS::Include\n  Parameters:\n    Location: "' +
        remote +
        '"\n    token: "' +
        marker +
        '"\n',
      code: "cloudformation-transform-unresolved",
    },
  ];
  it.each(cases)(
    "retains $path source evidence and blocks conformance without invented facts",
    async ({ path, content, code }) => {
      const root = await mkdtemp(join(tmpdir(), "cloudmarkup-unsupported-"));
      await write(root, path, content);
      const input = request();
      const before = serializeCanonicalJson(input);
      const result = await moduleService.importRepository({
        sourceDirectory: root,
        request: input,
      });
      const diagnostic = result.diagnostics.find(
        (item) => item.code === "cloudmarkup.import." + code,
      );
      expect(diagnostic).toMatchObject({ severity: "error", path });
      const difference = result.differences.find(
        (item) => item.kind === "unsupported-unresolved-import",
      );
      expect(difference).toMatchObject({
        severity: "error",
        observedFactIds: [],
      });
      expect(difference?.evidenceIds).toHaveLength(1);
      const evidence = result.snapshot.evidence.find(
        (item) => item.evidenceId === difference?.evidenceIds[0],
      );
      expect(evidence).toMatchObject({
        path,
        fileChecksum: result.snapshot.files[0]?.checksum,
      });
      expect(result.snapshot.parseFindings).toContainEqual(
        expect.objectContaining({
          category: "diagnostic",
          status: "unsupported",
          severity: "error",
          evidenceIds: difference?.evidenceIds,
        }),
      );
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          severity: "error",
          sourceRecordId: difference?.differenceId,
        }),
      );
      expect(result.evidence.checks).toContainEqual(
        expect.objectContaining({ status: "failed" }),
      );
      expect(verifyRepositoryImport(result).conforms).toBe(false);
      expect(result.facts).toHaveLength(0);
      expect(result.proposal).toBeUndefined();
      expect(result.observedSolution.resources).toHaveLength(0);
      expect(JSON.stringify(result)).not.toContain(marker);
      expect(JSON.stringify(result)).not.toContain(remote);
      expect(await readFile(join(root, path), "utf8")).toBe(content);
      expect(serializeCanonicalJson(input)).toBe(before);
      expect(
        await moduleService.importRepository({
          sourceDirectory: root,
          request: input,
        }),
      ).toEqual(result);
      if (path.endsWith(".tf")) expect(evidence?.location.startLine).toBe(2);
      const layer = projectRepositoryImportToConformanceLayerInputV1({
        result,
        solutionRevision: withApprovedRepositoryObservation(
          input.solutionRevision,
          result,
        ),
      });
      expect(layer.completeness).toBe("partial");
    },
  );
  it.each(cases)(
    "keeps already matched design facts while $path makes the observation incomplete",
    async ({ path, content }) => {
      const root = await mkdtemp(
        join(tmpdir(), "cloudmarkup-unsupported-mixed-"),
      );
      const input = request();
      for (const [name, bytes] of Object.entries(architectureFiles(input)))
        await write(root, name, bytes);
      const baseline = await moduleService.importRepository({
        sourceDirectory: root,
        request: input,
      });
      await write(root, path, content);
      const result = await moduleService.importRepository({
        sourceDirectory: root,
        request: input,
      });
      expect(result.facts).toEqual(baseline.facts);
      expect(result.facts.length).toBeGreaterThan(0);
      expect(
        result.differences.filter(
          (item) => item.kind !== "unsupported-unresolved-import",
        ),
      ).toEqual(baseline.differences);
      expect(result.evidence.checks[0]?.status).toBe("failed");
      expect(verifyRepositoryImport(result).conforms).toBe(false);
      expect(
        result.proposal?.operations.some(
          (operation) => operation.kind === "accept-observed-graph-change",
        ) ?? false,
      ).toBe(false);
    },
  );
  it.each(["main.tf", "main.tf.json"])(
    "retains literal resource facts alongside a module in %s",
    async (path) => {
      const root = await mkdtemp(
        join(tmpdir(), "cloudmarkup-module-resource-"),
      );
      await write(
        root,
        path,
        path.endsWith(".json")
          ? JSON.stringify({
              module: { application: { source: remote, token: marker } },
              resource: { aws_dynamodb_table: { notes: {} } },
            })
          : 'module "application" { source = "' +
              remote +
              '" }\nresource "aws_dynamodb_table" "notes" {}\n',
      );
      const mixed = createRepositoryImportService({
        hclInspector: {
          inspect: () =>
            Promise.resolve(
              hclInspectionResultV1Schema.parse({
                ...hclResult,
                blocks: [...moduleInspection.blocks, ...hclResult.blocks],
              }),
            ),
        },
      });
      const result = await mixed.importRepository({
        sourceDirectory: root,
        request: request(),
      });
      expect(
        result.facts.filter((fact) => fact.kind === "resource"),
      ).toHaveLength(1);
      expect(result.facts).toContainEqual(
        expect.objectContaining({
          logicalKey: "terraform.resource.aws_dynamodb_table.notes",
        }),
      );
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "cloudmarkup.import.terraform-module-unresolved",
          severity: "error",
        }),
      );
      expect(result.evidence.checks[0]?.status).toBe("failed");
      expect(verifyRepositoryImport(result).conforms).toBe(false);
      expect(
        result.proposal?.operations.some(
          (operation) => operation.kind === "accept-observed-graph-change",
        ) ?? false,
      ).toBe(false);
      expect(JSON.stringify(result)).not.toContain(remote);
      expect(JSON.stringify(result)).not.toContain(marker);
    },
  );
  it.each([
    {
      path: "template.json",
      value: {
        Transform: "AWS::Serverless-2016-10-31",
        Resources: { Table: { Type: "AWS::DynamoDB::Table", Properties: {} } },
      },
    },
    {
      path: "nested.json",
      value: {
        Resources: {
          Table: {
            Type: "AWS::DynamoDB::Table",
            Properties: {
              "Fn::Transform": {
                Name: "AWS::Include",
                Parameters: { Location: remote },
              },
            },
          },
        },
      },
    },
  ])(
    "keeps literal known resources in $path but does not infer macro output",
    async ({ path, value }) => {
      const root = await mkdtemp(
        join(tmpdir(), "cloudmarkup-transform-resource-"),
      );
      await write(root, path, JSON.stringify(value));
      const result = await moduleService.importRepository({
        sourceDirectory: root,
        request: request(),
      });
      expect(
        result.facts.filter((fact) => fact.kind === "resource"),
      ).toHaveLength(1);
      expect(result.facts).toContainEqual(
        expect.objectContaining({
          logicalKey: "cloudformation.Table",
          resourceType: "aws.dynamodb.table",
        }),
      );
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "cloudmarkup.import.cloudformation-transform-unresolved",
          severity: "error",
        }),
      );
      expect(verifyRepositoryImport(result).conforms).toBe(false);
      expect(
        result.proposal?.operations.some(
          (operation) => operation.kind === "accept-observed-graph-change",
        ) ?? false,
      ).toBe(false);
      expect(JSON.stringify(result)).not.toContain(remote);
    },
  );
  it("does not classify an unrelated JSON payload or empty Terraform module map as unresolved modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "cloudmarkup-unrelated-"));
    await write(
      root,
      "settings.json",
      JSON.stringify({ application: { "Fn::Transform": "user-data" } }),
    );
    await write(
      root,
      "main.tf.json",
      JSON.stringify({
        module: {},
        resource: { aws_dynamodb_table: { notes: {} } },
      }),
    );
    const result = await moduleService.importRepository({
      sourceDirectory: root,
      request: request(),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        logicalKey: "terraform.resource.aws_dynamodb_table.notes",
      }),
    );
  });
  it("preserves historical digest reads without selecting historical behavior for new imports", async () => {
    const input = {
      files: [{ path: "main.tf", checksum: "sha256:" + "a".repeat(64) }],
      importedAt: timestamp,
      commitSha,
    };
    const historical = calculateRepositoryImportSnapshotDigestV1({
      ...input,
      importerVersion: "1.0.1",
    });
    expect(historical).toBe(
      "sha256:aee74794a15aca36cbc41a20aa66e68d7b222dfef603851b0dd04747c48a5df7",
    );
    expect(calculateRepositoryImportSnapshotDigestV1(input)).toBe(
      "sha256:f44c246d52f38ca0bf9f9786674ae5525eca570204e06559e5967efdaf8e90f8",
    );
    expect(calculateRepositoryImportSnapshotDigestV1(input)).not.toBe(
      historical,
    );
    expect(() =>
      calculateRepositoryImportSnapshotDigestV1({
        ...input,
        importerVersion: "9.0.0" as "1.0.2",
      }),
    ).toThrow();
    const root = await mkdtemp(join(tmpdir(), "cloudmarkup-version-"));
    const result = await moduleService.importRepository({
      sourceDirectory: root,
      request: request(),
    });
    expect(result.snapshot.importer.importerVersion).toBe("1.0.2");
    // Schema read compatibility only: no old execution, receipt issuance or
    // current AI assessment authority is inferred from this metadata parse.
    const oldSnapshot = {
      ...result.snapshot,
      importer: { ...result.snapshot.importer, importerVersion: "1.0.1" },
      snapshotDigest: historical,
    };
    expect(
      repositorySnapshotV1Schema.parse(oldSnapshot).importer.importerVersion,
    ).toBe("1.0.1");
    expect(result.snapshot.importer.importerVersion).toBe("1.0.2");
  });
});
