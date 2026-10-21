import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  applyGraphCommand,
  assignConformanceTargetKeysV1,
  getActiveIssueRecordHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getReviewedPublicExposureV1,
  hashCanonicalValue,
  projectArchitectureConnectionIntentV1,
  projectArchitectureOutputIntentV1,
  projectArchitectureResourceIntentV1,
  projectArchitectureVariableIntentV1,
} from "@cloudmarkup/domain";
import type { ProviderCatalogArtifactV1 } from "@cloudmarkup/provider-sdk";
import {
  activeIssueV1Schema,
  architectureDocumentV3Schema,
  evidenceRecordV1Schema,
  normalizeArchitectureDocumentV3,
  observedDesignComparisonV1Schema,
  observedSolutionV1Schema,
  reconciliationProposalV1Schema,
  repositoryRelativePathSchema,
  repositorySnapshotV1Schema,
  serializeCanonicalJson,
  type ArchitectureDocumentV3,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  Pair,
  Scalar,
  YAMLMap,
  parseDocument,
  type CollectionTag,
  type ScalarTag,
} from "yaml";

import {
  REPOSITORY_IMPORTER_ID,
  REPOSITORY_IMPORTER_VERSION,
  hclInspectionResultV1Schema,
  repositoryConformanceDifferenceV1Schema,
  repositoryImportRequestV1Schema,
  repositoryImportResultV1Schema,
  repositoryImportedFactV1Schema,
  type HCLInspectionResultV1,
  type RepositoryConformanceDifferenceV1,
  type RepositoryImportDiagnosticV1,
  type RepositoryImportedFactV1,
  type RepositoryImportRequestV1,
  type RepositoryImportResultV1,
} from "./contracts.js";

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const ignoredDirectories = new Set([
  ".git",
  ".terraform",
  ".turbo",
  ".cache",
  "node_modules",
  "coverage",
  "dist",
  "build",
  "tmp",
  "temp",
]);
const selectedBasenames = new Set([
  "serverless.yml",
  "serverless.yaml",
  "serverless.json",
  "template.json",
  "template.yaml",
  "template.yml",
]);
const selectedExtensions = [
  ".tf",
  ".tf.json",
  ".tfstate",
  ".json",
  ".yaml",
  ".yml",
];
const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const sensitiveKey =
  /(?:secret|token|password|private.?key|access.?key|credential|authorization|connection.?string)/iu;

const cloudFormationIntrinsicNames = new Map<string, string>([
  ["!Ref", "Ref"],
  ["!Condition", "Condition"],
  ["!And", "Fn::And"],
  ["!Base64", "Fn::Base64"],
  ["!Cidr", "Fn::Cidr"],
  ["!Equals", "Fn::Equals"],
  ["!FindInMap", "Fn::FindInMap"],
  ["!GetAtt", "Fn::GetAtt"],
  ["!GetAZs", "Fn::GetAZs"],
  ["!If", "Fn::If"],
  ["!ImportValue", "Fn::ImportValue"],
  ["!Join", "Fn::Join"],
  ["!Not", "Fn::Not"],
  ["!Or", "Fn::Or"],
  ["!Select", "Fn::Select"],
  ["!Split", "Fn::Split"],
  ["!Sub", "Fn::Sub"],
  ["!Transform", "Fn::Transform"],
]);

function wrapCloudFormationCollection(
  intrinsic: string,
  value: Parameters<NonNullable<CollectionTag["resolve"]>>[0],
): YAMLMap {
  delete value.tag;
  const mapping = new YAMLMap(value.schema);
  mapping.items = [new Pair(new Scalar(intrinsic), value)];
  return mapping;
}

const cloudFormationYamlTags = [...cloudFormationIntrinsicNames].flatMap(
  ([tag, intrinsic]): (ScalarTag | CollectionTag)[] => [
    { tag, resolve: (value) => ({ [intrinsic]: value }) },
    {
      tag,
      collection: "seq",
      resolve: (value) => wrapCloudFormationCollection(intrinsic, value),
    },
    {
      tag,
      collection: "map",
      resolve: (value) => wrapCloudFormationCollection(intrinsic, value),
    },
  ],
);

export interface TerraformHCLInspectorPort {
  inspect(
    input: Readonly<{ path: string; source: Uint8Array }>,
  ): Promise<HCLInspectionResultV1>;
}

export interface RepositoryImportService {
  importRepository(
    input: Readonly<{
      sourceDirectory: string;
      request: RepositoryImportRequestV1;
    }>,
  ): Promise<RepositoryImportResultV1>;
}

interface JsonObject extends Record<string, unknown> {
  Ref?: unknown;
  Statement?: unknown;
  Action?: unknown;
  Effect?: unknown;
  Resource?: unknown;
  sensitive?: unknown;
  resources?: unknown;
  child_modules?: unknown;
  format_version?: unknown;
  planned_values?: unknown;
  values?: unknown;
  root_module?: unknown;
  address?: unknown;
  type?: unknown;
  mode?: unknown;
  policy?: unknown;
  Resources?: unknown;
  Type?: unknown;
  Properties?: unknown;
  Policies?: unknown;
  PolicyDocument?: unknown;
  Parameters?: unknown;
  NoEcho?: unknown;
  Outputs?: unknown;
  files?: unknown;
  sourceManifest?: unknown;
  artifact?: unknown;
  sourceFiles?: unknown;
  provenance?: unknown;
  environmentBindingIds?: unknown;
  workloadIds?: unknown;
  environmentBindings?: unknown;
  bindingId?: unknown;
  name?: unknown;
  path?: unknown;
  checksum?: unknown;
  ownership?: unknown;
  workloadContracts?: unknown;
  workloadId?: unknown;
  handler?: unknown;
  jobs?: unknown;
  steps?: unknown;
  uses?: unknown;
  run?: unknown;
}

interface ScannedFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly checksum: Sha256Digest;
  readonly kind:
    "iac" | "application" | "workflow" | "contract" | "configuration" | "other";
}

interface FactContext {
  readonly facts: RepositoryImportedFactV1[];
  readonly diagnostics: RepositoryImportDiagnosticV1[];
  readonly evidence: Map<string, ReturnType<typeof evidenceFor>>;
  readonly unsupportedSources: {
    readonly diagnostic: RepositoryImportDiagnosticV1;
    readonly evidenceId: string;
  }[];
  readonly exactNodes: Map<string, ArchitectureDocumentV3["nodes"][number]>;
  readonly exactEdges: Map<string, ArchitectureDocumentV3["edges"][number]>;
  redactedFileCount: number;
  redactedValueCount: number;
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1)
    if (value.charCodeAt(index) <= 0x1f) return true;
  return false;
}

function digestBytes(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as Sha256Digest;
}

function digestText(value: string): Sha256Digest {
  return digestBytes(new TextEncoder().encode(value));
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}.${hashCanonicalValue(value).slice(7, 27)}`;
}

function cleanDiagnostic(
  code: string,
  severity: RepositoryImportDiagnosticV1["severity"],
  summary: string,
  path?: string,
  line?: number,
  column?: number,
): RepositoryImportDiagnosticV1 {
  return {
    code: `cloudmarkup.import.${code}`,
    severity,
    summary,
    ...(path === undefined
      ? {}
      : { path: repositoryRelativePathSchema.parse(path) }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}

export function validateRepositoryImportRelativePath(
  path: string,
): ReturnType<typeof repositoryRelativePathSchema.parse> {
  if (
    path === "" ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.length > 240
  ) {
    throw new Error("Repository path is not a bounded portable relative path.");
  }
  for (const segment of path.split("/")) {
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      segment.endsWith(".") ||
      segment.endsWith(" ") ||
      /[<>:"|?*]/u.test(segment) ||
      containsControlCharacter(segment) ||
      windowsReserved.test(segment)
    ) {
      throw new Error("Repository path contains a non-portable component.");
    }
  }
  return repositoryRelativePathSchema.parse(path);
}

function isSelectedByProfile(
  path: string,
  selectedPaths: readonly string[],
): boolean {
  return selectedPaths.some(
    (selected) =>
      selected === "." || path === selected || path.startsWith(`${selected}/`),
  );
}

function shouldTraverse(
  path: string,
  selectedPaths: readonly string[],
): boolean {
  return selectedPaths.some(
    (selected) =>
      selected === "." ||
      selected === path ||
      selected.startsWith(`${path}/`) ||
      path.startsWith(`${selected}/`),
  );
}

function classifyPath(path: string): ScannedFile["kind"] {
  if (path.startsWith(".github/workflows/")) return "workflow";
  if (
    path.endsWith(".tf") ||
    path.endsWith(".tf.json") ||
    /(?:^|\/)template\.ya?ml$/u.test(path)
  )
    return "iac";
  if (path.includes("contracts/") || path.endsWith("contracts.json"))
    return "contract";
  if (path.startsWith("application/") || path.includes("application/manifest"))
    return "application";
  if (path.endsWith(".json") || path.endsWith(".yaml") || path.endsWith(".yml"))
    return "configuration";
  return "other";
}

function shouldSelect(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.startsWith("cloudcanvas/")) return false;
  if (lower.startsWith("cloudmarkup/")) return true;
  if (lower.startsWith(".github/workflows/"))
    return lower.endsWith(".yml") || lower.endsWith(".yaml");
  if (
    lower.startsWith("cdk.out/") &&
    (lower.endsWith(".template.json") || lower.endsWith("template.json"))
  )
    return true;
  if (
    lower.includes("application/manifest") ||
    lower.includes("environment-bindings")
  )
    return true;
  if (
    lower.startsWith("application/") &&
    /\.(?:ts|js|mjs|cjs|json|ya?ml|md)$/u.test(lower) &&
    !/(?:^|\/)\.env(?:\.|$)/u.test(lower)
  )
    return true;
  const basename = lower.split("/").at(-1) ?? lower;
  return (
    selectedBasenames.has(basename) ||
    selectedExtensions.some((extension) => lower.endsWith(extension))
  );
}

async function scanRepository(
  rootInput: string,
  request: RepositoryImportRequestV1,
): Promise<ScannedFile[]> {
  if (!isAbsolute(rootInput))
    throw new Error(
      "Import source must be an explicit absolute local directory.",
    );
  const root = resolve(rootInput);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error(
      "Import source must be a real local directory, not a link.",
    );
  const rootReal = await realpath(root);
  const selected: ScannedFile[] = [];
  const portableOwners = new Map<string, string>();
  let scannedCount = 0;
  let totalBytes = 0;

  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareUtf16(left.name, right.name));
    for (const entry of entries) {
      const relativePath =
        prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      validateRepositoryImportRelativePath(relativePath);
      const absolute = resolve(directory, entry.name);
      const lexical = relative(root, absolute);
      if (
        lexical.startsWith(`..${sep}`) ||
        lexical === ".." ||
        isAbsolute(lexical)
      )
        throw new Error("Repository entry escaped the selected root.");
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink())
        throw new Error(`Repository links are forbidden: ${relativePath}`);
      if (stat.isDirectory()) {
        if (
          !ignoredDirectories.has(entry.name.toLowerCase()) &&
          shouldTraverse(relativePath, request.profile.selectedPaths)
        )
          await walk(absolute, relativePath);
        continue;
      }
      if (!stat.isFile())
        throw new Error(
          `Repository entry is not a regular file: ${relativePath}`,
        );
      if (!isSelectedByProfile(relativePath, request.profile.selectedPaths))
        continue;
      scannedCount += 1;
      if (scannedCount > request.profile.limits.maximumFileCount)
        throw new Error("Repository file-count limit exceeded.");
      if (!shouldSelect(relativePath)) continue;
      if (stat.size > request.profile.limits.maximumFileBytes)
        throw new Error(
          `Selected repository file exceeds its size limit: ${relativePath}`,
        );
      totalBytes += stat.size;
      if (totalBytes > request.profile.limits.maximumTotalBytes)
        throw new Error(
          "Selected repository bytes exceed the aggregate limit.",
        );
      const actualReal = await realpath(absolute);
      const realRelative = relative(rootReal, actualReal);
      if (
        realRelative.startsWith(`..${sep}`) ||
        realRelative === ".." ||
        isAbsolute(realRelative)
      )
        throw new Error("Repository file resolves outside the selected root.");
      const key = relativePath.normalize("NFC").toLowerCase();
      const owner = portableOwners.get(key);
      if (owner !== undefined)
        throw new Error(
          `Repository paths collide portably: ${owner} and ${relativePath}`,
        );
      portableOwners.set(key, relativePath);
      const bytes = await readFile(absolute);
      if (bytes.subarray(0, Math.min(bytes.byteLength, 8_192)).includes(0))
        throw new Error(`Selected repository file is binary: ${relativePath}`);
      let text: string;
      try {
        text = UTF8.decode(bytes);
      } catch {
        throw new Error(
          `Selected repository file is not valid UTF-8: ${relativePath}`,
        );
      }
      selected.push({
        path: relativePath,
        bytes,
        text,
        checksum: digestBytes(bytes),
        kind: classifyPath(relativePath),
      });
    }
  }
  await walk(root, "");
  return selected.sort((left, right) => compareUtf16(left.path, right.path));
}

function evidenceFor(file: ScannedFile, kind: string, line = 1, column = 1) {
  const factDigest = hashCanonicalValue({
    checksum: file.checksum,
    kind,
    line,
    column,
  });
  return {
    evidenceId: stableId("source", { path: file.path, kind, line, column }),
    path: file.path,
    fileChecksum: file.checksum,
    location: {
      startLine: line,
      endLine: line,
      startColumn: column,
      endColumn: column,
    },
    evidenceKind:
      kind === "generated-file"
        ? ("generated-marker" as const)
        : ("declaration" as const),
    factDigest,
  };
}

function sourceReference(
  context: FactContext,
  file: ScannedFile,
  kind: string,
  line = 1,
  column = 1,
) {
  const evidence = evidenceFor(file, kind, line, column);
  context.evidence.set(evidence.evidenceId, evidence);
  return { path: file.path, evidenceId: evidence.evidenceId, line, column };
}

function addUnsupportedSource(
  context: FactContext,
  file: ScannedFile,
  kind: "terraform-module-unresolved" | "cloudformation-transform-unresolved",
  line = 1,
  column = 1,
) {
  const diagnostic = cleanDiagnostic(
    kind,
    "error",
    kind === "terraform-module-unresolved"
      ? "Terraform modules were found. Module resources are not resolved during import; review the module code separately before relying on conformance."
      : "CloudFormation transforms were found. Expanded resources are not resolved during import; review a processed template before relying on conformance.",
    file.path,
    line,
    column,
  );
  const source = sourceReference(context, file, kind, line, column);
  context.diagnostics.push(diagnostic);
  context.unsupportedSources.push({
    diagnostic,
    evidenceId: source.evidenceId,
  });
}

function addFact(
  context: FactContext,
  file: ScannedFile,
  kind: string,
  input: Record<string, unknown>,
  line = 1,
  column = 1,
): RepositoryImportedFactV1 {
  const basis = { kind, path: file.path, line, input };
  const fact = repositoryImportedFactV1Schema.parse({
    ...input,
    kind,
    factId: stableId("fact", basis),
    digest: hashCanonicalValue(basis),
    source: sourceReference(context, file, kind, line, column),
  });
  context.facts.push(fact);
  return fact;
}

function parseJson(
  file: ScannedFile,
  diagnostics: RepositoryImportDiagnosticV1[],
): unknown {
  try {
    return JSON.parse(file.text) as unknown;
  } catch {
    diagnostics.push(
      cleanDiagnostic(
        "json-invalid",
        "error",
        "JSON source is malformed.",
        file.path,
      ),
    );
    return undefined;
  }
}

function parseYaml(
  file: ScannedFile,
  diagnostics: RepositoryImportDiagnosticV1[],
): unknown {
  const document = parseDocument(file.text, {
    schema: "core",
    customTags: cloudFormationYamlTags,
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    diagnostics.push(
      cleanDiagnostic(
        "yaml-invalid",
        "error",
        "YAML source is malformed or uses unsupported aliases/tags.",
        file.path,
      ),
    );
    return undefined;
  }
  try {
    return document.toJS({ maxAliasCount: 0 }) as unknown;
  } catch {
    diagnostics.push(
      cleanDiagnostic(
        "yaml-invalid",
        "error",
        "YAML source could not be converted safely.",
        file.path,
      ),
    );
    return undefined;
  }
}

function objectValue(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function sanitizeValue(
  value: unknown,
  context: FactContext,
  key = "",
  depth = 0,
): unknown {
  if (depth > 64) return "[depth-limit]";
  if (sensitiveKey.test(key)) {
    context.redactedValueCount += 1;
    return "[redacted]";
  }
  if (Array.isArray(value))
    return value
      .slice(0, 10_000)
      .map((entry) => sanitizeValue(entry, context, "", depth + 1));
  const object = objectValue(value);
  if (object !== undefined) {
    return Object.fromEntries(
      Object.keys(object)
        .sort(compareUtf16)
        .slice(0, 10_000)
        .map((entry) => [
          entry,
          sanitizeValue(object[entry], context, entry, depth + 1),
        ]),
    );
  }
  if (typeof value === "string")
    return value.length > 512 ? `[string:${digestText(value)}]` : value;
  return value;
}

function sanitizeTerraformValue(
  value: unknown,
  sensitive: unknown,
  context: FactContext,
  key = "",
  depth = 0,
): unknown {
  if (sensitive === true) {
    context.redactedValueCount += 1;
    return "[redacted]";
  }
  if (depth > 64) return "[depth-limit]";
  if (sensitiveKey.test(key)) {
    context.redactedValueCount += 1;
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    const sensitivity = Array.isArray(sensitive) ? sensitive : [];
    return value
      .slice(0, 10_000)
      .map((entry, index) =>
        sanitizeTerraformValue(
          entry,
          sensitivity[index],
          context,
          "",
          depth + 1,
        ),
      );
  }
  const object = objectValue(value);
  if (object !== undefined) {
    const sensitivity = objectValue(sensitive);
    return Object.fromEntries(
      Object.keys(object)
        .sort(compareUtf16)
        .slice(0, 10_000)
        .map((entry) => [
          entry,
          sanitizeTerraformValue(
            object[entry],
            sensitivity?.[entry],
            context,
            entry,
            depth + 1,
          ),
        ]),
    );
  }
  if (typeof value === "string")
    return value.length > 512 ? "[string:" + digestText(value) + "]" : value;
  return value;
}

function catalogMaps(catalog: ProviderCatalogArtifactV1) {
  const terraform = new Map<
    string,
    ProviderCatalogArtifactV1["services"][number]
  >();
  const cloudformation = new Map<
    string,
    ProviderCatalogArtifactV1["services"][number][]
  >();
  for (const service of catalog.services) {
    for (const mapping of service.mappings) {
      if (mapping.target === "terraform" && mapping.kind === "resource") {
        terraform.set(mapping.resourceType, service);
      } else if (mapping.target === "cloudformation") {
        const candidates = cloudformation.get(mapping.typeName) ?? [];
        if (!candidates.some((candidate) => candidate.id === service.id))
          candidates.push(service);
        cloudformation.set(mapping.typeName, candidates);
      }
    }
  }
  return { terraform, cloudformation, providerId: catalog.provider.id };
}

function resolveCloudFormationService(
  resource: JsonObject,
  resources: JsonObject,
  maps: ReturnType<typeof catalogMaps>,
) {
  const candidates = maps.cloudformation.get(String(resource.Type)) ?? [];
  const properties = objectValue(resource.Properties);
  if (resource.Type === "AWS::RDS::DBCluster") {
    return candidates.length === 1 &&
      candidates[0]?.id === "aws.aurora.postgresql-cluster" &&
      properties?.["Engine"] === "aurora-postgresql"
      ? candidates[0]
      : undefined;
  }
  if (resource.Type === "AWS::RDS::DBInstance") {
    const supportedIds = [
      "aws.rds.db-instance",
      "aws.aurora.postgresql-instance",
    ];
    if (candidates.some((candidate) => !supportedIds.includes(candidate.id)))
      return undefined;
    if (
      properties?.["Engine"] === "postgres" &&
      !Object.hasOwn(properties, "DBClusterIdentifier")
    )
      return candidates.find((candidate) => candidate.id === supportedIds[0]);
    if (properties?.["Engine"] !== "aurora-postgresql") return undefined;
    const cluster = properties["DBClusterIdentifier"];
    let clusterIdentified =
      typeof cluster === "string" && cluster.trim() !== "";
    const reference = objectValue(cluster);
    if (
      reference !== undefined &&
      Object.keys(reference).length === 1 &&
      typeof reference.Ref === "string"
    ) {
      const referencedCluster = objectValue(resources[reference.Ref]);
      clusterIdentified =
        referencedCluster?.Type === "AWS::RDS::DBCluster" &&
        objectValue(referencedCluster.Properties)?.["Engine"] ===
          "aurora-postgresql";
    }
    return clusterIdentified
      ? candidates.find((candidate) => candidate.id === supportedIds[1])
      : undefined;
  }
  if (resource.Type === "AWS::FSx::FileSystem") {
    const familyIds: Readonly<Record<string, string>> = {
      LUSTRE: "aws.fsx.lustre-file-system",
      ONTAP: "aws.fsx.ontap-file-system",
      OPENZFS: "aws.fsx.openzfs-file-system",
      WINDOWS: "aws.fsx.windows-file-system",
    };
    if (
      candidates.some(
        (candidate) => !Object.values(familyIds).includes(candidate.id),
      )
    )
      return undefined;
    const family = properties?.["FileSystemType"];
    return typeof family === "string"
      ? candidates.find((candidate) => candidate.id === familyIds[family])
      : undefined;
  }
  if (candidates.length === 1) return candidates[0];
  return undefined;
}

function commonFact(
  target: RepositoryImportedFactV1["target"],
  parserId: string,
  file: ScannedFile,
  confidence: "confirmed" | "unresolved",
  ownership: RepositoryImportedFactV1["ownership"] = "unknown",
) {
  void file;
  return {
    target,
    parser: { id: parserId, version: REPOSITORY_IMPORTER_VERSION },
    confidence,
    ownership,
    diagnostics: [] as RepositoryImportDiagnosticV1[],
  };
}

function collectReferences(
  value: unknown,
  references = new Set<string>(),
  depth = 0,
): string[] {
  if (depth > 64) return [...references].sort(compareUtf16);
  if (Array.isArray(value))
    for (const entry of value) collectReferences(entry, references, depth + 1);
  else {
    const object = objectValue(value);
    if (object !== undefined) {
      if (typeof object.Ref === "string") references.add(object.Ref);
      const getAtt = object["Fn::GetAtt"];
      if (typeof getAtt === "string")
        references.add(getAtt.split(".", 1)[0] ?? getAtt);
      if (Array.isArray(getAtt) && typeof getAtt[0] === "string")
        references.add(getAtt[0]);
      const importValue = object["Fn::ImportValue"];
      if (importValue !== undefined)
        references.add(
          `external:${hashCanonicalValue(importValue).slice(7, 23)}`,
        );
      const substitution = object["Fn::Sub"];
      const template =
        typeof substitution === "string"
          ? substitution
          : Array.isArray(substitution) && typeof substitution[0] === "string"
            ? substitution[0]
            : undefined;
      if (template !== undefined) {
        const substituted = Array.isArray(substitution)
          ? objectValue(substitution[1])
          : undefined;
        for (const match of template.matchAll(
          /\$\{([A-Za-z][A-Za-z0-9._:-]*)\}/gu,
        )) {
          const reference = match[1];
          const logicalId = reference?.split(".", 1)[0];
          if (
            logicalId !== undefined &&
            !logicalId.startsWith("AWS::") &&
            substituted?.[logicalId] === undefined
          )
            references.add(logicalId);
        }
      }
      for (const entry of Object.values(object))
        collectReferences(entry, references, depth + 1);
    }
  }
  return [...references].sort(compareUtf16);
}

function extractPolicy(value: unknown): {
  actions: string[];
  effect: "allow" | "deny" | "mixed" | "unresolved";
  resourceScope: "specific" | "wildcard" | "unresolved";
} {
  let parsed = value;
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return { actions: [], effect: "unresolved", resourceScope: "unresolved" };
    }
  }
  const object = objectValue(parsed);
  const statements = object?.Statement;
  const entries = Array.isArray(statements)
    ? statements
    : statements === undefined
      ? []
      : [statements];
  const actions = new Set<string>();
  const effects = new Set<string>();
  let wildcard = false;
  for (const entry of entries) {
    const statement = objectValue(entry);
    if (statement === undefined) continue;
    for (const action of stringArray(statement.Action))
      if (/^[A-Za-z0-9*_-]+:[A-Za-z0-9*_-]+$/u.test(action))
        actions.add(action);
    if (typeof statement.Effect === "string")
      effects.add(statement.Effect.toLowerCase());
    wildcard ||= stringArray(statement.Resource).includes("*");
  }
  const effect =
    effects.size !== 1
      ? effects.size > 1
        ? "mixed"
        : "unresolved"
      : effects.has("allow")
        ? "allow"
        : effects.has("deny")
          ? "deny"
          : "unresolved";
  return {
    actions: [...actions].sort(compareUtf16),
    effect,
    resourceScope:
      entries.length === 0 ? "unresolved" : wildcard ? "wildcard" : "specific",
  };
}

function parseCloudMarkupSources(
  files: readonly ScannedFile[],
  request: RepositoryImportRequestV1,
  context: FactContext,
): void {
  const architectureFile = files.find((file) =>
    /^cloudmarkup\/architecture\.json$/u.test(file.path),
  );
  if (architectureFile === undefined) return;
  const applicationContracts = files.find((file) =>
    /^cloudmarkup\/contracts\/application-contracts\.json$/u.test(file.path),
  );
  const externalResources = files.find((file) =>
    /^cloudmarkup\/external-resources\.json$/u.test(file.path),
  );
  const workloads = files.find((file) =>
    /^cloudmarkup\/workloads\.json$/u.test(file.path),
  );
  const architectureProjection = parseJson(
    architectureFile,
    context.diagnostics,
  );
  if (architectureProjection === undefined) return;
  const combined = objectValue(architectureProjection);
  if (combined === undefined) return;
  const source = architectureDocumentV3Schema.safeParse({
    ...combined,
    applicationContracts:
      applicationContracts === undefined
        ? request.approvedArchitecture.applicationContracts
        : parseJson(applicationContracts, context.diagnostics),
    externalResources:
      externalResources === undefined
        ? request.approvedArchitecture.externalResources
        : parseJson(externalResources, context.diagnostics),
    workloadBehavior:
      workloads === undefined
        ? request.approvedArchitecture.workloadBehavior
        : parseJson(workloads, context.diagnostics),
  });
  if (!source.success) {
    context.diagnostics.push(
      cleanDiagnostic(
        "cloudmarkup-source-invalid",
        "error",
        "CloudMarkup source documents do not form one valid immutable architecture.",
        architectureFile.path,
      ),
    );
    return;
  }
  const document = normalizeArchitectureDocumentV3(source.data);
  const semanticSources = {
    architectureDocument: document,
    workloadBehavior: document.workloadBehavior,
  };
  const targetKeys = assignConformanceTargetKeysV1(semanticSources);
  for (const node of [...document.nodes].sort((left, right) =>
    compareUtf16(left.id, right.id),
  )) {
    context.exactNodes.set(node.id, node);
    addFact(context, architectureFile, "resource", {
      ...commonFact(
        "cloudmarkup",
        REPOSITORY_IMPORTER_ID,
        architectureFile,
        "confirmed",
        node.semantic.lifecycle.ownership === "generated"
          ? "generated"
          : "user-owned",
      ),
      logicalKey: `cloudmarkup.node.${node.id}`,
      resourceType: node.semantic.resourceType,
      serviceType: node.semantic.serviceType,
      providerId: document.provider.id,
      deploymentIdentifier: node.semantic.deploymentKey,
      configurationDigest: hashCanonicalValue(node.semantic.configuration),
      semanticIntentDigest: hashCanonicalValue(
        projectArchitectureResourceIntentV1(semanticSources, node, targetKeys),
      ),
      ...(getReviewedPublicExposureV1(node.semantic.configuration) === undefined
        ? {}
        : {
            reviewedPublicExposure: getReviewedPublicExposureV1(
              node.semantic.configuration,
            ),
          }),
      references:
        node.semantic.parent === undefined ? [] : [node.semantic.parent.nodeId],
      external: false,
    });
  }
  for (const edge of [...document.edges].sort((left, right) =>
    compareUtf16(left.id, right.id),
  )) {
    context.exactEdges.set(edge.id, edge);
    addFact(context, architectureFile, "connection", {
      ...commonFact(
        "cloudmarkup",
        REPOSITORY_IMPORTER_ID,
        architectureFile,
        "confirmed",
        edge.semantic.lifecycle.ownership === "generated"
          ? "generated"
          : "user-owned",
      ),
      logicalKey: `cloudmarkup.edge.${edge.id}`,
      relationshipType: edge.semantic.relationshipType,
      sourceKey: `cloudmarkup.node.${edge.semantic.source.nodeId}`,
      targetKey: `cloudmarkup.node.${edge.semantic.target.nodeId}`,
      configurationDigest: hashCanonicalValue(edge.semantic.configuration),
      semanticIntentDigest: hashCanonicalValue(
        projectArchitectureConnectionIntentV1(edge, targetKeys),
      ),
      providerId: document.provider.id,
    });
  }
  for (const variable of document.variables) {
    addFact(context, architectureFile, "variable", {
      ...commonFact(
        "cloudmarkup",
        REPOSITORY_IMPORTER_ID,
        architectureFile,
        "confirmed",
        "user-owned",
      ),
      logicalKey: `cloudmarkup.variable.${variable.id}`,
      variableType: variable.valueType,
      sensitive: false,
      semanticIntentDigest: hashCanonicalValue(
        projectArchitectureVariableIntentV1(variable),
      ),
    });
  }
  for (const output of document.outputs) {
    addFact(context, architectureFile, "output", {
      ...commonFact(
        "cloudmarkup",
        REPOSITORY_IMPORTER_ID,
        architectureFile,
        "confirmed",
        "user-owned",
      ),
      logicalKey: `cloudmarkup.output.${output.id}`,
      sensitive: false,
      references:
        output.source.kind === "node-attribute"
          ? [output.source.nodeId]
          : [output.source.variableId],
      semanticIntentDigest: hashCanonicalValue(
        projectArchitectureOutputIntentV1(output, targetKeys),
      ),
    });
  }
  const workloadFile = workloads ?? architectureFile;
  for (const workload of document.workloadBehavior.workloads) {
    const implementation = workload.implementation;
    addFact(context, workloadFile, "workload-binding", {
      ...commonFact(
        "cloudmarkup",
        REPOSITORY_IMPORTER_ID,
        workloadFile,
        "confirmed",
        "user-owned",
      ),
      logicalKey: `cloudmarkup.workload.${workload.id}`,
      workloadId: workload.id,
      ...("handler" in implementation
        ? { handler: implementation.handler }
        : {}),
      environmentBindingNames: [],
      semanticIntentDigest: hashCanonicalValue(workload),
    });
  }
}

async function parseTerraformHCL(
  file: ScannedFile,
  inspector: TerraformHCLInspectorPort,
  maps: ReturnType<typeof catalogMaps>,
  context: FactContext,
  resources: Map<string, RepositoryImportedFactV1[]>,
): Promise<void> {
  const inspected = hclInspectionResultV1Schema.parse(
    await inspector.inspect({ path: file.path, source: file.bytes }),
  );
  for (const diagnostic of inspected.diagnostics) {
    context.diagnostics.push(
      cleanDiagnostic(
        "terraform-hcl-unresolved",
        diagnostic.severity,
        "Terraform HCL contains an unresolved parser diagnostic.",
        file.path,
        diagnostic.range.startLine,
        diagnostic.range.startColumn,
      ),
    );
  }
  const moduleBlock = inspected.blocks.find(
    (block) => block.type === "module" && block.blockPath[0] === "module",
  );
  if (moduleBlock !== undefined)
    addUnsupportedSource(
      context,
      file,
      "terraform-module-unresolved",
      moduleBlock.range.startLine,
      moduleBlock.range.startColumn,
    );
  const modulePath = file.path.split("/").slice(0, -1).join("/");
  const ownedBlocks = new Map<string, HCLInspectionResultV1["blocks"]>();
  for (const candidate of inspected.blocks) {
    if (
      candidate.blockPath[0] !== "resource" &&
      candidate.blockPath[0] !== "data"
    )
      continue;
    const key = JSON.stringify(candidate.blockPath.slice(0, 3));
    const blocks = ownedBlocks.get(key) ?? [];
    blocks.push(candidate);
    ownedBlocks.set(key, blocks);
  }
  for (const block of inspected.blocks) {
    if (
      (block.type === "resource" || block.type === "data") &&
      block.labels.length === 2 &&
      block.blockPath.length === 3
    ) {
      const [resourceType, name] = block.labels;
      if (resourceType === undefined || name === undefined) continue;
      const service = maps.terraform.get(resourceType);
      const blocks = ownedBlocks.get(JSON.stringify(block.blockPath)) ?? [
        block,
      ];
      const attributes = blocks.flatMap((item) => item.attributes);
      const unresolved =
        !inspected.succeeded ||
        service === undefined ||
        attributes.some(
          (attribute) =>
            attribute.expressionKind !== "literal" &&
            attribute.expressionKind !== "collection",
        );
      const references = [
        ...new Set(attributes.flatMap((attribute) => attribute.references)),
      ].sort(compareUtf16);
      const moduleKey =
        modulePath === ""
          ? ""
          : `module.${hashCanonicalValue(modulePath).slice(7)}.`;
      const logicalKey = `terraform.${moduleKey}${block.type}.${resourceType}.${name}`;
      const fact = addFact(
        context,
        file,
        "resource",
        {
          ...commonFact(
            "terraform",
            inspected.parser.id,
            file,
            unresolved ? "unresolved" : "confirmed",
            block.type === "data" ? "external" : "unknown",
          ),
          logicalKey,
          resourceType:
            service?.nodeKind.kind === "resource"
              ? service.nodeKind.resourceType
              : `terraform.${resourceType.replaceAll("_", ".")}`,
          ...(service === undefined ? {} : { serviceType: service.id }),
          ...(service === undefined ? {} : { providerId: maps.providerId }),
          deploymentIdentifier: name,
          configurationDigest: hashCanonicalValue(
            blocks.map((item) => ({
              blockPath: item.blockPath.slice(3),
              attributes: item.attributes.map(
                ({
                  name: attributeName,
                  expressionDigest,
                  references: refs,
                }) => ({
                  name: attributeName,
                  expressionDigest,
                  references: refs,
                }),
              ),
            })),
          ),
          references,
          external: block.type === "data",
        },
        block.range.startLine,
        block.range.startColumn,
      );
      const address = `${modulePath}:${block.type === "data" ? "data." : ""}${resourceType}.${name}`;
      resources.set(address, [...(resources.get(address) ?? []), fact]);
      if (resourceType.includes("iam_policy")) {
        addFact(
          context,
          file,
          "policy",
          {
            ...commonFact(
              "terraform",
              inspected.parser.id,
              file,
              "unresolved",
              "unknown",
            ),
            logicalKey: `${logicalKey}.policy`,
            effect: "unresolved",
            actions: [],
            resourceScope: "unresolved",
          },
          block.range.startLine,
          block.range.startColumn,
        );
      }
    } else if (block.type === "variable" && block.labels[0] !== undefined) {
      addFact(
        context,
        file,
        "variable",
        {
          ...commonFact(
            "terraform",
            inspected.parser.id,
            file,
            "confirmed",
            "user-owned",
          ),
          logicalKey: `terraform.variable.${block.labels[0]}`,
          sensitive: block.attributes.some(
            (attribute) => attribute.name === "sensitive",
          ),
        },
        block.range.startLine,
        block.range.startColumn,
      );
    } else if (block.type === "output" && block.labels[0] !== undefined) {
      addFact(
        context,
        file,
        "output",
        {
          ...commonFact(
            "terraform",
            inspected.parser.id,
            file,
            "confirmed",
            "user-owned",
          ),
          logicalKey: `terraform.output.${block.labels[0]}`,
          sensitive: block.attributes.some(
            (attribute) => attribute.name === "sensitive",
          ),
          references: [
            ...new Set(
              block.attributes.flatMap((attribute) => attribute.references),
            ),
          ].sort(compareUtf16),
        },
        block.range.startLine,
        block.range.startColumn,
      );
    }
  }
}

/** Resolve only unambiguous addresses in the same Terraform module after all files are parsed. */
function connectTerraformHCL(
  resources: ReadonlyMap<string, readonly RepositoryImportedFactV1[]>,
  files: readonly ScannedFile[],
  context: FactContext,
): void {
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const fact of [...resources.values()].flat()) {
    if (fact.kind !== "resource") continue;
    const file = byPath.get(fact.source.path);
    if (file === undefined) continue;
    const modulePath = file.path.split("/").slice(0, -1).join("/");
    const connected = new Set<string>();
    for (const reference of fact.references) {
      const parts = reference.split(".");
      const address = parts.slice(0, parts[0] === "data" ? 3 : 2).join(".");
      const candidates = resources.get(`${modulePath}:${address}`);
      const target = candidates?.length === 1 ? candidates[0] : undefined;
      if (
        target?.kind !== "resource" ||
        target.factId === fact.factId ||
        connected.has(target.factId)
      )
        continue;
      connected.add(target.factId);
      addFact(
        context,
        file,
        "connection",
        {
          ...commonFact(
            "terraform",
            fact.parser.id,
            file,
            "unresolved",
            "unknown",
          ),
          logicalKey: `terraform.connection.${fact.factId}.${target.factId}`,
          relationshipType: "cloudmarkup.import.reference",
          sourceKey: fact.logicalKey,
          targetKey: target.logicalKey,
          configurationDigest: hashCanonicalValue({
            relationshipType: "cloudmarkup.import.reference",
            sourceKey: fact.logicalKey,
            targetKey: target.logicalKey,
          }),
        },
        fact.source.line,
        fact.source.column,
      );
    }
  }
}

function parseTerraformJson(
  file: ScannedFile,
  value: unknown,
  maps: ReturnType<typeof catalogMaps>,
  context: FactContext,
): void {
  const root = objectValue(value);
  if (root === undefined) return;
  if (
    Object.hasOwn(root, "module") &&
    (objectValue(root["module"]) === undefined ||
      Object.keys(objectValue(root["module"]) ?? {}).length > 0)
  )
    addUnsupportedSource(context, file, "terraform-module-unresolved");
  for (const blockType of ["resource", "data"] as const) {
    const resources = objectValue(root[blockType]);
    if (resources === undefined) continue;
    for (const resourceType of Object.keys(resources).sort(compareUtf16)) {
      const instances = objectValue(resources[resourceType]);
      if (instances === undefined) continue;
      for (const name of Object.keys(instances).sort(compareUtf16)) {
        const configuration = sanitizeValue(instances[name], context);
        const service = maps.terraform.get(resourceType);
        addFact(context, file, "resource", {
          ...commonFact(
            "terraform",
            "cloudmarkup.terraform-json-importer",
            file,
            service === undefined ? "unresolved" : "confirmed",
            blockType === "data" ? "external" : "unknown",
          ),
          logicalKey: `terraform.${blockType}.${resourceType}.${name}`,
          resourceType:
            service?.nodeKind.kind === "resource"
              ? service.nodeKind.resourceType
              : `terraform.${resourceType.replaceAll("_", ".")}`,
          ...(service === undefined ? {} : { serviceType: service.id }),
          deploymentIdentifier: name,
          configurationDigest: hashCanonicalValue(configuration),
          references: [],
          external: blockType === "data",
        });
      }
    }
  }
  for (const kind of ["variable", "output"] as const) {
    const entries = objectValue(root[kind]);
    if (entries === undefined) continue;
    for (const name of Object.keys(entries).sort(compareUtf16)) {
      addFact(context, file, kind, {
        ...commonFact(
          "terraform",
          "cloudmarkup.terraform-json-importer",
          file,
          "confirmed",
          "user-owned",
        ),
        logicalKey: `terraform.${kind}.${name}`,
        sensitive: objectValue(entries[name])?.sensitive === true,
        ...(kind === "output" ? { references: [] } : {}),
      });
    }
  }
}

function terraformShowResources(
  root: unknown,
  result: JsonObject[] = [],
): JsonObject[] {
  const object = objectValue(root);
  if (object === undefined) return result;
  const resources = Array.isArray(object.resources) ? object.resources : [];
  for (const resource of resources) {
    const typed = objectValue(resource);
    if (typed !== undefined) result.push(typed);
  }
  const children = Array.isArray(object.child_modules)
    ? object.child_modules
    : [];
  for (const child of children) terraformShowResources(child, result);
  return result;
}

function parseTerraformShow(
  file: ScannedFile,
  root: JsonObject,
  maps: ReturnType<typeof catalogMaps>,
  context: FactContext,
): boolean {
  const formatVersion = root.format_version;
  const values =
    objectValue(root.planned_values)?.root_module ??
    objectValue(root.values)?.root_module;
  if (typeof formatVersion !== "string" || values === undefined) return false;
  context.redactedFileCount += 1;
  for (const resource of terraformShowResources(values)) {
    if (
      typeof resource.address !== "string" ||
      typeof resource.type !== "string"
    )
      continue;
    const service = maps.terraform.get(resource.type);
    const mode = resource.mode === "data" ? "data" : "managed";
    const sanitized = sanitizeTerraformValue(
      resource.values,
      resource["sensitive_values"],
      context,
    );
    addFact(context, file, "resource", {
      ...commonFact(
        "terraform-show-json",
        "cloudmarkup.terraform-show-json-importer",
        file,
        service === undefined ? "unresolved" : "confirmed",
        mode === "data" ? "external" : "unknown",
      ),
      logicalKey: `terraform-show.${resource.address}`,
      resourceType:
        service?.nodeKind.kind === "resource"
          ? service.nodeKind.resourceType
          : `terraform.${resource.type.replaceAll("_", ".")}`,
      ...(service === undefined ? {} : { serviceType: service.id }),
      ...(service === undefined ? {} : { providerId: maps.providerId }),
      deploymentIdentifier: resource.address,
      configurationDigest: hashCanonicalValue(sanitized),
      references: [],
      external: mode === "data",
    });
    if (resource.type.includes("iam_policy")) {
      const policy = extractPolicy(objectValue(resource.values)?.policy);
      addFact(context, file, "policy", {
        ...commonFact(
          "terraform-show-json",
          "cloudmarkup.terraform-show-json-importer",
          file,
          policy.effect === "unresolved" ? "unresolved" : "confirmed",
          "unknown",
        ),
        logicalKey: `terraform-show.${resource.address}.policy`,
        ...policy,
      });
    }
  }
  return true;
}

function containsCloudFormationTransform(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (Array.isArray(next)) {
      for (const child of next) pending.push(child);
    } else {
      const object = objectValue(next);
      if (object === undefined) continue;
      if (Object.hasOwn(object, "Fn::Transform")) return true;
      for (const child of Object.values(object)) pending.push(child);
    }
  }
  return false;
}

function parseCloudFormation(
  file: ScannedFile,
  value: unknown,
  maps: ReturnType<typeof catalogMaps>,
  context: FactContext,
): boolean {
  const root = objectValue(value);
  if (root === undefined) return false;
  const resources = objectValue(root.Resources);
  const transformed =
    Object.hasOwn(root, "Transform") ||
    ((resources !== undefined ||
      Object.hasOwn(root, "AWSTemplateFormatVersion") ||
      Object.hasOwn(root, "Fn::Transform")) &&
      containsCloudFormationTransform(root));
  if (transformed)
    addUnsupportedSource(context, file, "cloudformation-transform-unresolved");
  if (resources === undefined) return transformed;
  const target = file.path.startsWith("cdk.out/")
    ? ("cdk-synth" as const)
    : ("cloudformation" as const);
  const keys = new Map<string, RepositoryImportedFactV1>();
  for (const logicalId of Object.keys(resources).sort(compareUtf16)) {
    const resource = objectValue(resources[logicalId]);
    if (resource === undefined || typeof resource.Type !== "string") continue;
    const service = resolveCloudFormationService(resource, resources, maps);
    const mappingDiagnostics =
      service === undefined &&
      ((maps.cloudformation.get(resource.Type)?.length ?? 0) > 1 ||
        resource.Type === "AWS::RDS::DBCluster")
        ? [
            cleanDiagnostic(
              "ambiguous-resource-mapping",
              "warning",
              "The native resource type does not establish its catalog variant from literal engine, family or cluster identity. Review the source before relying on classification.",
              file.path,
            ),
          ]
        : [];
    context.diagnostics.push(...mappingDiagnostics);
    const properties = sanitizeValue(resource.Properties ?? {}, context);
    const references = [
      ...new Set([
        ...collectReferences(resource.Properties),
        ...stringArray(resource["DependsOn"]),
      ]),
    ].sort(compareUtf16);
    const fact = addFact(context, file, "resource", {
      ...commonFact(
        target,
        "cloudmarkup.cloudformation-importer",
        file,
        service === undefined ? "unresolved" : "confirmed",
        "unknown",
      ),
      logicalKey: `${target}.${logicalId}`,
      resourceType:
        service?.nodeKind.kind === "resource"
          ? service.nodeKind.resourceType
          : `cloudformation.${resource.Type.replaceAll("::", ".").toLowerCase()}`,
      ...(service === undefined ? {} : { serviceType: service.id }),
      ...(service === undefined ? {} : { providerId: maps.providerId }),
      deploymentIdentifier: logicalId,
      configurationDigest: hashCanonicalValue(properties),
      references,
      external: false,
      diagnostics: mappingDiagnostics,
    });
    keys.set(logicalId, fact);
    if (resource.Type.startsWith("AWS::IAM::")) {
      const props = objectValue(resource.Properties);
      const policies = Array.isArray(props?.Policies) ? props.Policies : [];
      const documents = [
        props?.PolicyDocument,
        props?.["AssumeRolePolicyDocument"],
        ...policies.map((entry) => objectValue(entry)?.PolicyDocument),
      ].filter((entry) => entry !== undefined);
      for (const [index, document] of documents.entries()) {
        addFact(context, file, "policy", {
          ...commonFact(
            target,
            "cloudmarkup.cloudformation-importer",
            file,
            "confirmed",
            "unknown",
          ),
          logicalKey: `${target}.${logicalId}.policy.${String(index)}`,
          ...extractPolicy(document),
        });
      }
    }
  }
  for (const fact of [...keys.values()]) {
    if (fact.kind !== "resource") continue;
    for (const reference of fact.references) {
      if (!reference.startsWith("external:") || keys.has(reference)) continue;
      const externalFact = addFact(context, file, "resource", {
        ...commonFact(
          target,
          "cloudmarkup.cloudformation-importer",
          file,
          "unresolved",
          "external",
        ),
        logicalKey: target + "." + reference,
        resourceType: "cloudformation.external.reference",
        providerId: maps.providerId,
        deploymentIdentifier: reference.slice("external:".length),
        configurationDigest: hashCanonicalValue(reference),
        references: [],
        external: true,
      });
      keys.set(reference, externalFact);
    }
  }
  for (const fact of keys.values()) {
    if (fact.kind !== "resource" || fact.external) continue;
    for (const reference of fact.references) {
      const targetFact = keys.get(reference);
      if (targetFact?.kind !== "resource") continue;
      addFact(context, file, "connection", {
        ...commonFact(
          target,
          "cloudmarkup.cloudformation-importer",
          file,
          "unresolved",
          "unknown",
        ),
        logicalKey: `${target}.connection.${fact.factId}.${targetFact.factId}`,
        relationshipType: "cloudmarkup.import.reference",
        sourceKey: fact.logicalKey,
        targetKey: targetFact.logicalKey,
        configurationDigest: hashCanonicalValue({
          relationshipType: "cloudmarkup.import.reference",
          sourceKey: fact.logicalKey,
          targetKey: targetFact.logicalKey,
        }),
      });
    }
  }
  const parameters = objectValue(root.Parameters);
  if (parameters !== undefined)
    for (const name of Object.keys(parameters).sort(compareUtf16))
      addFact(context, file, "variable", {
        ...commonFact(
          target,
          "cloudmarkup.cloudformation-importer",
          file,
          "confirmed",
          "user-owned",
        ),
        logicalKey: `${target}.parameter.${name}`,
        sensitive: objectValue(parameters[name])?.NoEcho === true,
      });
  const outputs = objectValue(root.Outputs);
  if (outputs !== undefined)
    for (const name of Object.keys(outputs).sort(compareUtf16))
      addFact(context, file, "output", {
        ...commonFact(
          target,
          "cloudmarkup.cloudformation-importer",
          file,
          "confirmed",
          "user-owned",
        ),
        logicalKey: `${target}.output.${name}`,
        sensitive: false,
        references: collectReferences(outputs[name]),
      });
  return true;
}

function manifestOwnership(
  value: unknown,
): RepositoryImportedFactV1["ownership"] {
  if (
    value === "generated" ||
    value === "generated-replaceable" ||
    value === "generated-build-artifact" ||
    value === "evidence-artifact"
  )
    return "generated";
  if (
    value === "user-owned" ||
    value === "user-owned-extension" ||
    value === "user-provided" ||
    value === "approved-extension" ||
    value === "ai-authored" ||
    value === "source" ||
    value === "architecture-as-code-source"
  )
    return "user-owned";
  if (value === "external" || value === "external-artifact") return "external";
  return "unknown";
}

function parseManifest(
  file: ScannedFile,
  value: unknown,
  context: FactContext,
): boolean {
  const root = objectValue(value);
  if (
    root === undefined ||
    (!file.path.includes("manifest") &&
      !file.path.includes("environment-bindings"))
  )
    return false;
  const arrays: unknown[][] = [];
  if (Array.isArray(root.files)) arrays.push(root.files);
  const sourceManifest = objectValue(root.sourceManifest);
  if (Array.isArray(sourceManifest?.files)) arrays.push(sourceManifest.files);
  const artifact = objectValue(root.artifact);
  if (Array.isArray(artifact?.sourceFiles)) arrays.push(artifact.sourceFiles);
  const environmentBindingsByWorkload = new Map<string, Set<string>>();
  const recordBindings = (record: JsonObject): void => {
    const provenance = objectValue(record.provenance);
    const environmentBindingIds = stringArray(
      provenance?.environmentBindingIds ?? record.environmentBindingIds,
    );
    const workloadIds = stringArray(
      provenance?.workloadIds ?? record.workloadIds,
    );
    for (const workloadId of workloadIds) {
      const bindings =
        environmentBindingsByWorkload.get(workloadId) ?? new Set<string>();
      for (const bindingId of environmentBindingIds) bindings.add(bindingId);
      environmentBindingsByWorkload.set(workloadId, bindings);
    }
  };
  let found = false;
  for (const entries of arrays)
    for (const entry of entries) {
      const record = objectValue(entry);
      if (
        typeof record?.path !== "string" ||
        typeof record.checksum !== "string"
      )
        continue;
      const parsedPath = repositoryRelativePathSchema.safeParse(record.path);
      const parsedChecksum = /^sha256:[0-9a-f]{64}$/u.test(record.checksum)
        ? record.checksum
        : undefined;
      if (!parsedPath.success || parsedChecksum === undefined) continue;
      found = true;
      recordBindings(record);
      addFact(context, file, "generated-file", {
        ...commonFact(
          "application-manifest",
          "cloudmarkup.application-manifest-importer",
          file,
          "confirmed",
          manifestOwnership(record.ownership),
        ),
        logicalKey: `generated-file.${parsedPath.data}`,
        path: parsedPath.data,
        expectedChecksum: parsedChecksum,
      });
    }
  const declaredBindings = Array.isArray(root.environmentBindings)
    ? root.environmentBindings
    : [];
  for (const entry of declaredBindings) {
    const record = objectValue(entry);
    if (record === undefined || typeof record.workloadId !== "string") continue;
    const name =
      typeof record.bindingId === "string"
        ? record.bindingId
        : typeof record.name === "string"
          ? record.name
          : undefined;
    if (name === undefined) continue;
    const bindings =
      environmentBindingsByWorkload.get(record.workloadId) ?? new Set<string>();
    bindings.add(name);
    environmentBindingsByWorkload.set(record.workloadId, bindings);
    found = true;
  }
  const workloads = Array.isArray(root.workloadContracts)
    ? root.workloadContracts
    : Array.isArray(artifact?.workloadContracts)
      ? artifact.workloadContracts
      : [];
  for (const entry of workloads) {
    const record = objectValue(entry);
    if (typeof record?.workloadId !== "string") continue;
    addFact(context, file, "workload-binding", {
      ...commonFact(
        "application-manifest",
        "cloudmarkup.application-manifest-importer",
        file,
        "confirmed",
        "generated",
      ),
      logicalKey: `application.workload.${record.workloadId}`,
      workloadId: record.workloadId,
      ...(typeof record.handler === "string"
        ? { handler: record.handler }
        : {}),
      environmentBindingNames: [
        ...(environmentBindingsByWorkload.get(record.workloadId) ?? []),
      ].sort(compareUtf16),
    });
    found = true;
  }
  return found;
}

function parseWorkflow(
  file: ScannedFile,
  value: unknown,
  context: FactContext,
): void {
  const root = objectValue(value);
  if (root === undefined) return;
  const jobs = objectValue(root.jobs);
  const uses = new Set<string>();
  let generates = false,
    plans = false,
    deploys = false,
    checksDrift = false;
  for (const job of Object.values(jobs ?? {})) {
    const steps = objectValue(job)?.steps;
    if (!Array.isArray(steps)) continue;
    for (const step of steps) {
      const record = objectValue(step);
      if (
        typeof record?.uses === "string" &&
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[A-Za-z0-9._-]+$/u.test(record.uses)
      )
        uses.add(record.uses);
      if (typeof record?.run !== "string") continue;
      const normalized = record.run.toLowerCase();
      generates ||= /cloud(?:markup|canvas)\s+generate/u.test(normalized);
      plans ||= /terraform\s+plan/u.test(normalized);
      deploys ||= /(?:terraform\s+apply|cloud(?:markup|canvas)\s+deploy)/u.test(
        normalized,
      );
      checksDrift ||= /cloud(?:markup|canvas)\s+(?:verify|compare)|drift/u.test(
        normalized,
      );
    }
  }
  const actionUses = [...uses].sort(compareUtf16);
  const unpinned = actionUses.some(
    (entry) => !/@(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(entry),
  );
  const diagnostic = unpinned
    ? cleanDiagnostic(
        "workflow-action-unpinned",
        "warning",
        "Workflow action is not pinned to a reviewed immutable commit.",
        file.path,
      )
    : undefined;
  if (diagnostic !== undefined) context.diagnostics.push(diagnostic);
  addFact(context, file, "workflow", {
    ...commonFact(
      "workflow",
      "cloudmarkup.github-workflow-importer",
      file,
      unpinned ? "unresolved" : "confirmed",
      "user-owned",
    ),
    ...(diagnostic === undefined ? {} : { diagnostics: [diagnostic] }),
    logicalKey: `workflow.${file.path}`,
    generates,
    plans,
    deploys,
    checksDrift,
    actionUses,
  });
}

async function parseFiles(
  files: readonly ScannedFile[],
  request: RepositoryImportRequestV1,
  inspector: TerraformHCLInspectorPort,
  context: FactContext,
): Promise<void> {
  const maps = catalogMaps(request.catalog);
  const terraformResources = new Map<string, RepositoryImportedFactV1[]>();
  parseCloudMarkupSources(files, request, context);
  for (const file of files) {
    if (file.path.endsWith(".tf") && !file.path.endsWith(".tf.json")) {
      await parseTerraformHCL(
        file,
        inspector,
        maps,
        context,
        terraformResources,
      );
      continue;
    }
    const lower = file.path.toLowerCase();
    const parsed = lower.endsWith(".json")
      ? parseJson(file, context.diagnostics)
      : lower.endsWith(".yaml") || lower.endsWith(".yml")
        ? parseYaml(file, context.diagnostics)
        : undefined;
    if (parsed === undefined) continue;
    if (file.path.startsWith(".github/workflows/")) {
      parseWorkflow(file, parsed, context);
      continue;
    }
    if (parseManifest(file, parsed, context)) continue;
    const object = objectValue(parsed);
    if (object !== undefined && parseTerraformShow(file, object, maps, context))
      continue;
    if (parseCloudFormation(file, parsed, maps, context)) continue;
    if (file.path.endsWith(".tf.json"))
      parseTerraformJson(file, parsed, maps, context);
  }
  connectTerraformHCL(terraformResources, files, context);
  const fileChecksums = new Map(
    files.map((file) => [file.path, file.checksum]),
  );
  for (const fact of context.facts) {
    if (fact.kind !== "generated-file") continue;
    const actualChecksum = fileChecksums.get(fact.path);
    if (actualChecksum !== undefined) {
      fact.actualChecksum = actualChecksum;
    }
  }
  context.facts.sort((left, right) => compareUtf16(left.factId, right.factId));
}

function detectedKinds(
  file: ScannedFile,
): (
  | "infrastructure-as-code"
  | "application-source"
  | "workflow"
  | "contract"
  | "configuration"
  | "other"
)[] {
  const value =
    file.kind === "iac"
      ? "infrastructure-as-code"
      : file.kind === "application"
        ? "application-source"
        : file.kind;
  return [value];
}

function buildSnapshot(
  files: readonly ScannedFile[],
  request: RepositoryImportRequestV1,
  context: FactContext,
) {
  const evidence = [...context.evidence.values()].sort((left, right) =>
    compareUtf16(left.evidenceId, right.evidenceId),
  );
  const fileMap = new Map(files.map((file) => [file.path, file]));
  const parseFindings = [
    ...context.facts.map((fact) => ({
      findingId: stableId("finding", fact.factId),
      parserId: fact.parser.id,
      parserVersion: fact.parser.version,
      category:
        fact.kind === "workload-binding"
          ? "workload"
          : fact.kind === "generated-file"
            ? "source-ownership"
            : fact.kind === "workflow"
              ? "workflow"
              : fact.kind === "connection"
                ? "connection"
                : fact.kind === "resource"
                  ? "resource"
                  : "diagnostic",
      status: fact.confidence === "confirmed" ? "confirmed" : "unresolved",
      severity: fact.confidence === "confirmed" ? "information" : "warning",
      summary:
        fact.confidence === "confirmed"
          ? "Deterministic repository fact confirmed."
          : "Repository fact requires explicit mapping review.",
      certainty:
        fact.confidence === "confirmed"
          ? { kind: "deterministic" as const, confidence: 1 as const }
          : {
              kind: "inferred" as const,
              confidence: 0.5,
              methodId: fact.parser.id,
              methodVersion: fact.parser.version,
            },
      evidenceIds: [fact.source.evidenceId],
    })),
    ...context.unsupportedSources.map(({ diagnostic, evidenceId }) => ({
      findingId: stableId("finding", { diagnostic, evidenceId }),
      parserId: REPOSITORY_IMPORTER_ID,
      parserVersion: REPOSITORY_IMPORTER_VERSION,
      category: "diagnostic" as const,
      status: "unsupported" as const,
      severity: "error" as const,
      summary: diagnostic.summary,
      certainty: { kind: "deterministic" as const, confidence: 1 as const },
      evidenceIds: [evidenceId],
    })),
  ];
  const detectedTypes = [
    ...new Map(
      context.facts.map((fact) => {
        const category =
          fact.target === "workflow"
            ? ("workflow" as const)
            : fact.kind === "workload-binding"
              ? ("application" as const)
              : ("iac" as const);
        const key = `${category}:${fact.target}:${fact.parser.id}:${fact.parser.version}`;
        return [
          key,
          {
            category,
            typeId: `cloudmarkup.import.${fact.target}`,
            detectorId: fact.parser.id,
            detectorVersion: fact.parser.version,
            evidenceIds: [] as string[],
          },
        ];
      }),
    ).values(),
  ];
  for (const detected of detectedTypes) {
    detected.evidenceIds = [
      ...new Set(
        context.facts
          .filter(
            (fact) =>
              `cloudmarkup.import.${fact.target}` === detected.typeId &&
              fact.parser.id === detected.detectorId,
          )
          .map((fact) => fact.source.evidenceId),
      ),
    ].sort(compareUtf16);
  }
  const selectedPaths = request.profile.selectedPaths.map((path, index) => ({
    ruleId: `selection.${String(index + 1)}`,
    path,
    scope: path === "." ? ("subtree" as const) : ("subtree" as const),
  }));
  const ignoreRules = [...ignoredDirectories]
    .sort(compareUtf16)
    .map((path, index) => ({
      ruleId: `ignore.${String(index + 1)}`,
      path,
      scope: "subtree" as const,
      reason:
        "Excluded executable, cache, dependency, or generated build directory.",
    }));
  const snapshotInput = {
    schemaVersion: 1 as const,
    snapshotId: request.profile.snapshotId,
    source: {
      kind: "local" as const,
      sourceId: request.profile.sourceId,
      descriptor: request.profile.sourceDescriptor,
    },
    revision: {
      selector: { kind: "detached" as const },
      commitSha: request.profile.commitSha,
    },
    importedAt: request.profile.importedAt,
    importer: {
      importerId: REPOSITORY_IMPORTER_ID,
      importerVersion: REPOSITORY_IMPORTER_VERSION,
    },
    selectedPaths,
    ignoreRules,
    files: files.map((file) => ({
      path: file.path,
      checksum: file.checksum,
      sizeBytes: file.bytes.byteLength,
      detectedKinds: detectedKinds(file),
    })),
    detectedTypes,
    redaction: {
      status:
        context.redactedValueCount > 0
          ? ("applied" as const)
          : ("not-required" as const),
      redactedFileCount: context.redactedFileCount,
      redactedValueCount: context.redactedValueCount,
      categories:
        context.redactedValueCount > 0
          ? ["secret-candidate" as const, "sensitive-content" as const]
          : [],
    },
    sizeLimits: {
      status: "within-limits" as const,
      configured: request.profile.limits,
      scannedFileCount: files.length,
      scannedBytes: files.reduce((sum, file) => sum + file.bytes.byteLength, 0),
      includedFileCount: files.length,
      excludedFileCount: 0,
    },
    evidence,
    parseFindings,
    inferredRelationships: [],
    unsupportedFiles: context.diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.path !== undefined && diagnostic.code.endsWith("invalid"),
      )
      .flatMap((diagnostic) => {
        const file =
          diagnostic.path === undefined
            ? undefined
            : fileMap.get(diagnostic.path);
        return file === undefined
          ? []
          : [
              {
                path: file.path,
                checksum: file.checksum,
                reason: "parse-error" as const,
                detail: diagnostic.summary,
              },
            ];
      }),
    snapshotDigest: calculateRepositoryImportSnapshotDigestV1({
      files,
      importedAt: request.profile.importedAt,
      commitSha: request.profile.commitSha,
    }),
  };
  return repositorySnapshotV1Schema.parse(snapshotInput);
}

function designComparisonForFact(
  fact: RepositoryImportedFactV1,
  architecture: ArchitectureDocumentV3,
): ReturnType<typeof observedDesignComparisonV1Schema.parse> {
  if (fact.kind === "resource") {
    const exactId = fact.logicalKey.startsWith("cloudmarkup.node.")
      ? fact.logicalKey.slice("cloudmarkup.node.".length)
      : undefined;
    const node =
      exactId === undefined
        ? architecture.nodes.filter(
            (candidate) =>
              candidate.semantic.resourceType === fact.resourceType ||
              candidate.semantic.serviceType === fact.serviceType,
          ).length === 1
          ? architecture.nodes.find(
              (candidate) =>
                candidate.semantic.resourceType === fact.resourceType ||
                candidate.semantic.serviceType === fact.serviceType,
            )
          : undefined
        : architecture.nodes.find((candidate) => candidate.id === exactId);
    if (node === undefined) return { state: "no-approved-match" as const };
    if (
      exactId !== undefined &&
      (node.semantic.resourceType !== fact.resourceType ||
        node.semantic.serviceType !== fact.serviceType ||
        node.semantic.deploymentKey !== fact.deploymentIdentifier ||
        architecture.provider.id !== fact.providerId ||
        hashCanonicalValue(node.semantic.configuration) !==
          fact.configurationDigest)
    )
      return {
        state: "conflicts-with-approved-design" as const,
        target: { kind: "architecture-node" as const, nodeId: node.id },
        conflictKind: "configuration-mismatch" as const,
        summary:
          "Observed resource configuration differs from the approved design.",
      };
    if (exactId === undefined) return { state: "no-approved-match" as const };
    return {
      state: "matches-approved-design" as const,
      target: { kind: "architecture-node" as const, nodeId: node.id },
    };
  }
  if (
    fact.kind === "connection" &&
    fact.logicalKey.startsWith("cloudmarkup.edge.")
  ) {
    const id = fact.logicalKey.slice("cloudmarkup.edge.".length);
    const edge = architecture.edges.find((candidate) => candidate.id === id);
    if (edge === undefined) return { state: "no-approved-match" as const };
    const expectedSource = `cloudmarkup.node.${edge.semantic.source.nodeId}`;
    const expectedTarget = `cloudmarkup.node.${edge.semantic.target.nodeId}`;
    if (
      fact.relationshipType !== edge.semantic.relationshipType ||
      fact.sourceKey !== expectedSource ||
      fact.targetKey !== expectedTarget ||
      fact.configurationDigest !==
        hashCanonicalValue(edge.semantic.configuration)
    )
      return {
        state: "conflicts-with-approved-design" as const,
        target: { kind: "architecture-edge" as const, edgeId: edge.id },
        conflictKind: "relationship-mismatch" as const,
        summary:
          "Observed connection semantics differ from the approved design.",
      };
    return {
      state: "matches-approved-design" as const,
      target: { kind: "architecture-edge" as const, edgeId: edge.id },
    };
  }
  if (fact.kind === "workload-binding" && fact.workloadId !== undefined) {
    const workload = architecture.workloadBehavior.workloads.find(
      (candidate) => candidate.id === fact.workloadId,
    );
    if (workload === undefined) return { state: "no-approved-match" as const };
    const approvedHandlers = new Set<string>([
      ...("handler" in workload.implementation
        ? [String(workload.implementation.handler)]
        : []),
      ...workload.entrypoints.map(({ handler }) => String(handler)),
    ]);
    const approvedEnvironmentBindingIds = new Set<string>(
      workload.environment.map(({ id }) => String(id)),
    );
    const handlerMismatch =
      fact.handler !== undefined && !approvedHandlers.has(fact.handler);
    const environmentMismatch = fact.environmentBindingNames.some(
      (bindingId) => !approvedEnvironmentBindingIds.has(bindingId),
    );
    if (handlerMismatch || environmentMismatch)
      return {
        state: "conflicts-with-approved-design" as const,
        target: { kind: "workload" as const, workloadId: workload.id },
        conflictKind: "implementation-mismatch" as const,
        summary:
          "Observed application handler or environment binding differs from the approved workload contract.",
      };
    return {
      state: "matches-approved-design" as const,
      target: { kind: "workload" as const, workloadId: workload.id },
    };
  }
  return { state: "not-compared" as const };
}

function buildObserved(
  snapshot: ReturnType<typeof buildSnapshot>,
  request: RepositoryImportRequestV1,
  context: FactContext,
) {
  const evidenceById = new Map(
    snapshot.evidence.map((entry) => [entry.evidenceId, entry]),
  );
  const evidence = snapshot.evidence.map((entry) => ({
    sourceEvidenceId: entry.evidenceId,
    path: entry.path,
    fileChecksum: entry.fileChecksum,
    location: entry.location,
  }));
  const resourceFacts = context.facts.filter(
    (fact): fact is Extract<RepositoryImportedFactV1, { kind: "resource" }> =>
      fact.kind === "resource" && !fact.external,
  );
  const allResourceFacts = context.facts.filter(
    (fact): fact is Extract<RepositoryImportedFactV1, { kind: "resource" }> =>
      fact.kind === "resource",
  );
  const resourceByKey = new Map(
    allResourceFacts.map((fact) => [fact.logicalKey, fact]),
  );
  const resources = resourceFacts.map((fact) => ({
    observedResourceId: `observed.${fact.factId}`,
    capability: "cloudmarkup.import.resource",
    resourceType: fact.resourceType,
    ...(fact.providerId === undefined ? {} : { providerId: fact.providerId }),
    ...(fact.serviceType === undefined
      ? {}
      : { serviceFamily: fact.serviceType }),
    certainty:
      fact.confidence === "confirmed"
        ? { kind: "deterministic" as const, confidence: 1 as const }
        : {
            kind: "inferred" as const,
            confidence: 0.5,
            methodId: fact.parser.id,
            methodVersion: fact.parser.version,
          },
    sourceEvidenceIds: [fact.source.evidenceId],
    designComparison: designComparisonForFact(
      fact,
      request.approvedArchitecture,
    ),
  }));
  const externalResources = context.facts
    .filter(
      (fact): fact is Extract<RepositoryImportedFactV1, { kind: "resource" }> =>
        fact.kind === "resource" && fact.external,
    )
    .map((fact) => ({
      candidateId: `external.${fact.factId}`,
      capability: "cloudmarkup.import.external-resource",
      ownershipCandidate: "repository-defined-external-dependency" as const,
      certainty:
        fact.confidence === "confirmed"
          ? { kind: "deterministic" as const, confidence: 1 as const }
          : {
              kind: "inferred" as const,
              confidence: 0.5,
              methodId: fact.parser.id,
              methodVersion: fact.parser.version,
            },
      sourceEvidenceIds: [fact.source.evidenceId],
      designComparison: { state: "no-approved-match" as const },
    }));
  const connections = context.facts
    .filter(
      (
        fact,
      ): fact is Extract<RepositoryImportedFactV1, { kind: "connection" }> =>
        fact.kind === "connection",
    )
    .flatMap((fact) => {
      const source = resourceByKey.get(fact.sourceKey),
        target = resourceByKey.get(fact.targetKey);
      if (source === undefined || target === undefined) return [];
      const endpoint = (
        resource: Extract<RepositoryImportedFactV1, { kind: "resource" }>,
      ) =>
        resource.external
          ? {
              kind: "external-resource" as const,
              candidateId: `external.${resource.factId}`,
            }
          : {
              kind: "resource" as const,
              observedResourceId: `observed.${resource.factId}`,
            };
      return [
        {
          observedConnectionId: `observed.${fact.factId}`,
          source: endpoint(source),
          target: endpoint(target),
          relationshipType: fact.relationshipType,
          certainty:
            fact.confidence === "confirmed"
              ? { kind: "deterministic" as const, confidence: 1 as const }
              : {
                  kind: "inferred" as const,
                  confidence: 0.5,
                  methodId: fact.parser.id,
                  methodVersion: fact.parser.version,
                },
          sourceEvidenceIds: [fact.source.evidenceId],
          designComparison: designComparisonForFact(
            fact,
            request.approvedArchitecture,
          ),
        },
      ];
    });
  const workloadFacts = context.facts.filter(
    (
      fact,
    ): fact is Extract<
      RepositoryImportedFactV1,
      { kind: "workload-binding" }
    > => fact.kind === "workload-binding" && fact.workloadId !== undefined,
  );
  const workloads = [
    ...new Set(workloadFacts.map((fact) => fact.workloadId)),
  ].flatMap((workloadId) => {
    if (workloadId === undefined) return [];
    const approved =
      request.approvedArchitecture.workloadBehavior.workloads.find(
        (workload) => workload.id === workloadId,
      );
    if (approved === undefined) return [];
    const owner = resourceByKey.get(
      `cloudmarkup.node.${approved.owningNodeId}`,
    );
    if (owner === undefined || owner.external) return [];
    const matchingFacts = workloadFacts.filter(
      (fact) => fact.workloadId === workloadId,
    );
    const primary =
      matchingFacts.find((fact) => fact.target === "cloudmarkup") ??
      matchingFacts[0];
    if (primary === undefined) return [];
    const sourceEvidenceIds = [
      ...new Set(matchingFacts.map((fact) => fact.source.evidenceId)),
    ].sort(compareUtf16);
    const ownerObservedId = `observed.${owner.factId}`;
    const applicationRelationshipIds = connections
      .filter(
        (connection) =>
          (connection.source.kind === "resource" &&
            connection.source.observedResourceId === ownerObservedId) ||
          (connection.target.kind === "resource" &&
            connection.target.observedResourceId === ownerObservedId),
      )
      .map((connection) => connection.observedConnectionId)
      .sort(compareUtf16);
    const entrypoints = [
      ...new Set(
        [
          primary.handler,
          ...approved.entrypoints.map((entrypoint) => entrypoint.handler),
        ].filter((handler): handler is string => handler !== undefined),
      ),
    ]
      .filter(
        (handler) => repositoryRelativePathSchema.safeParse(handler).success,
      )
      .sort(compareUtf16);
    return [
      {
        observedWorkloadId: `observed.${stableId("workload", workloadId)}`,
        owningObservedResourceId: ownerObservedId,
        ...(approved.implementation.mode === "infrastructure-only"
          ? {}
          : { runtimeFamily: approved.implementation.runtimeFamily }),
        ...(approved.languageFamily === undefined
          ? {}
          : { languageFamily: approved.languageFamily }),
        entrypoints,
        applicationRelationshipIds,
        certainty:
          primary.confidence === "confirmed"
            ? { kind: "deterministic" as const, confidence: 1 as const }
            : {
                kind: "inferred" as const,
                confidence: 0.5,
                methodId: primary.parser.id,
                methodVersion: primary.parser.version,
              },
        sourceEvidenceIds,
        designComparison: designComparisonForFact(
          primary,
          request.approvedArchitecture,
        ),
      },
    ];
  });
  const generatedFileOwnership = context.facts
    .filter(
      (
        fact,
      ): fact is Extract<
        RepositoryImportedFactV1,
        { kind: "generated-file" }
      > => fact.kind === "generated-file" && fact.ownership === "generated",
    )
    .map((fact) => ({
      observedGeneratedFileId: `observed.${fact.factId}`,
      path: fact.path,
      checksum: fact.actualChecksum ?? fact.expectedChecksum,
      ownership: "generated" as const,
      generatorId: REPOSITORY_IMPORTER_ID,
      generatorVersion: REPOSITORY_IMPORTER_VERSION,
      certainty: { kind: "deterministic" as const, confidence: 1 as const },
      sourceEvidenceIds: [fact.source.evidenceId],
      designComparison: { state: "not-compared" as const },
    }));
  for (const entry of evidence)
    if (!evidenceById.has(entry.sourceEvidenceId))
      throw new Error("Observed evidence was not in the snapshot.");
  const basis = {
    snapshot: snapshot.snapshotDigest,
    resources,
    connections,
    workloads,
    externalResources,
    generatedFileOwnership,
  };
  return observedSolutionV1Schema.parse({
    contractVersion: 1,
    kind: "cloudmarkup.observed-solution",
    observedSolutionId: request.profile.observedSolutionId,
    designAuthority: "none",
    mutationPolicy: "reviewed-reconciliation-required",
    provenance: {
      repositorySnapshotId: snapshot.snapshotId,
      repositorySnapshotDigest: snapshot.snapshotDigest,
      commitSha: snapshot.revision.commitSha,
      importedAt: snapshot.importedAt,
      importerId: REPOSITORY_IMPORTER_ID,
      importerVersion: REPOSITORY_IMPORTER_VERSION,
    },
    evidence,
    resources,
    connections,
    workloads,
    externalResources,
    generatedFileOwnership,
    observedContentHash: hashCanonicalValue(basis),
  });
}

function makeDifference(
  kind: RepositoryConformanceDifferenceV1["kind"],
  severity: RepositoryConformanceDifferenceV1["severity"],
  summary: string,
  observedFactIds: string[],
  evidenceIds: string[],
  designTargetId?: string,
) {
  const basis = {
    kind,
    severity,
    summary,
    observedFactIds: [...observedFactIds].sort(compareUtf16),
    evidenceIds: [...evidenceIds].sort(compareUtf16),
    designTargetId,
  };
  return repositoryConformanceDifferenceV1Schema.parse({
    differenceId: stableId("difference", basis),
    kind,
    severity,
    summary,
    ...(designTargetId === undefined ? {} : { designTargetId }),
    observedFactIds: basis.observedFactIds,
    evidenceIds: basis.evidenceIds,
    digest: hashCanonicalValue(basis),
  });
}

function compareConformance(
  files: readonly ScannedFile[],
  request: RepositoryImportRequestV1,
  context: FactContext,
): RepositoryConformanceDifferenceV1[] {
  const differences: RepositoryConformanceDifferenceV1[] =
    context.unsupportedSources.map(({ diagnostic, evidenceId }) =>
      makeDifference(
        "unsupported-unresolved-import",
        "error",
        diagnostic.summary,
        [],
        [evidenceId],
      ),
    );
  const matchedNodes = new Set<string>(),
    matchedEdges = new Set<string>(),
    matchedWorkloads = new Set<string>();
  for (const fact of context.facts) {
    const comparison = designComparisonForFact(
      fact,
      request.approvedArchitecture,
    );
    if (comparison.state === "matches-approved-design") {
      const target = comparison.target;
      if (target.kind === "architecture-node") matchedNodes.add(target.nodeId);
      else if (target.kind === "architecture-edge")
        matchedEdges.add(target.edgeId);
      else if (target.kind === "workload")
        matchedWorkloads.add(target.workloadId);
      differences.push(
        makeDifference(
          "matches",
          "information",
          "Observed repository fact matches the approved design.",
          [fact.factId],
          [fact.source.evidenceId],
          "nodeId" in target
            ? target.nodeId
            : "edgeId" in target
              ? target.edgeId
              : "workloadId" in target
                ? target.workloadId
                : undefined,
        ),
      );
    } else if (comparison.state === "conflicts-with-approved-design") {
      differences.push(
        makeDifference(
          comparison.conflictKind === "configuration-mismatch"
            ? "configuration-mismatch"
            : comparison.conflictKind === "relationship-mismatch"
              ? "connection-mismatch"
              : comparison.conflictKind === "implementation-mismatch"
                ? "application-binding-mismatch"
                : "ownership-mismatch",
          "error",
          comparison.summary,
          [fact.factId],
          [fact.source.evidenceId],
          "nodeId" in comparison.target
            ? comparison.target.nodeId
            : "edgeId" in comparison.target
              ? comparison.target.edgeId
              : "workloadId" in comparison.target
                ? comparison.target.workloadId
                : undefined,
        ),
      );
    } else if (comparison.state === "no-approved-match") {
      differences.push(
        makeDifference(
          fact.confidence === "unresolved"
            ? "unsupported-unresolved-import"
            : fact.kind === "resource" &&
                (fact.external || fact.ownership === "external")
              ? "external-resource"
              : fact.kind === "resource" && fact.ownership === "unknown"
                ? "unmanaged-resource"
                : fact.kind === "workload-binding"
                  ? "application-binding-mismatch"
                  : "observed-but-not-designed",
          "warning",
          fact.confidence === "unresolved"
            ? "Imported repository fact requires an explicit mapping decision."
            : fact.kind === "resource" &&
                (fact.external || fact.ownership === "external")
              ? "Repository evidence identifies an external resource outside generated ownership."
              : fact.kind === "resource" && fact.ownership === "unknown"
                ? "Repository evidence identifies a resource without approved ownership."
                : fact.kind === "workload-binding"
                  ? "Observed application binding has no approved workload contract."
                  : "Repository fact is not present in the approved design.",
          [fact.factId],
          [fact.source.evidenceId],
        ),
      );
    }
    if (
      fact.kind === "policy" &&
      fact.effect === "allow" &&
      (fact.resourceScope === "wildcard" ||
        fact.actions.some((action) => action.includes("*")))
    )
      differences.push(
        makeDifference(
          "iam-expansion",
          "error",
          "Observed IAM policy expands access with a wildcard allow.",
          [fact.factId],
          [fact.source.evidenceId],
        ),
      );
    if (fact.kind === "policy" && fact.effect === "deny")
      differences.push(
        makeDifference(
          "iam-reduction",
          "warning",
          "Observed IAM policy explicitly reduces access with a deny statement.",
          [fact.factId],
          [fact.source.evidenceId],
        ),
      );
    if (fact.kind === "generated-file") {
      const declared = request.solutionRevision.sourceOwnership.find(
        (entry) => entry.path === fact.path,
      );
      const expectedOwnership =
        declared?.ownership === "generated" ? "generated" : "user-owned";
      if (declared !== undefined && expectedOwnership !== fact.ownership)
        differences.push(
          makeDifference(
            "ownership-mismatch",
            "error",
            "Repository ownership differs from the immutable Solution Revision declaration.",
            [fact.factId],
            [fact.source.evidenceId],
            fact.factId,
          ),
        );
      const actual = files.find((file) => file.path === fact.path)?.checksum;
      if (
        fact.ownership === "generated" &&
        actual !== undefined &&
        actual !== fact.expectedChecksum
      )
        differences.push(
          makeDifference(
            "generated-file-drift",
            "error",
            "Generated file checksum differs from its reviewed manifest.",
            [fact.factId],
            [fact.source.evidenceId],
            fact.factId,
          ),
        );
    }
  }
  for (const node of request.approvedArchitecture.nodes)
    if (!matchedNodes.has(node.id))
      differences.push(
        makeDifference(
          "designed-but-not-observed",
          "warning",
          "Approved design resource was not confirmed in the repository.",
          [],
          [],
          node.id,
        ),
      );
  for (const edge of request.approvedArchitecture.edges)
    if (!matchedEdges.has(edge.id))
      differences.push(
        makeDifference(
          "designed-but-not-observed",
          "warning",
          "Approved design connection was not confirmed in the repository.",
          [],
          [],
          edge.id,
        ),
      );
  for (const workload of request.approvedArchitecture.workloadBehavior
    .workloads)
    if (!matchedWorkloads.has(workload.id))
      differences.push(
        makeDifference(
          "designed-but-not-observed",
          "warning",
          "Approved workload was not confirmed in the repository.",
          [],
          [],
          workload.id,
        ),
      );
  return differences.sort((left, right) =>
    compareUtf16(left.differenceId, right.differenceId),
  );
}

function buildIssues(
  differences: readonly RepositoryConformanceDifferenceV1[],
  request: RepositoryImportRequestV1,
) {
  return differences
    .filter((difference) => difference.kind !== "matches")
    .map((difference) => {
      const basis = {
        difference: difference.digest,
        revision: request.solutionRevision.solutionRevisionId,
      };
      const issue = activeIssueV1Schema.parse({
        affected: [
          {
            kind: "solution-revision",
            solutionRevisionId: request.solutionRevision.solutionRevisionId,
          },
        ],
        category:
          difference.kind === "ownership-mismatch"
            ? "source-ownership"
            : "repository-conformance",
        closureRequirements: [
          {
            description:
              "Reimport and confirm repository conformance after an explicit review action.",
            evidenceCheckId: "cloudmarkup.repository.conformance",
            evidenceLevel: { rank: 8, kind: "repository-conformance" },
          },
        ],
        contractVersion: 1,
        currentRecordDigest: hashCanonicalValue(basis),
        id: stableId("issue", basis),
        lifecycle: { state: "current" },
        provenance: {
          actor: {
            kind: "deterministic-tool",
            tool: {
              id: REPOSITORY_IMPORTER_ID,
              version: REPOSITORY_IMPORTER_VERSION,
            },
          },
          createdAt: request.profile.importedAt,
          inputDigests: [difference.digest],
        },
        recordVersion: 1,
        severity: difference.severity === "error" ? "error" : "warning",
        solutionRevisionId: request.solutionRevision.solutionRevisionId,
        source: "repository-import-mismatch",
        sourceRecordId: difference.differenceId,
        summary: difference.summary,
        technicalDetail:
          "The deterministic repository import differs from the frozen Solution Revision. No design mutation was applied.",
      });
      return activeIssueV1Schema.parse({
        ...issue,
        currentRecordDigest: getActiveIssueRecordHash(issue),
      });
    });
}

function buildProposal(
  snapshot: ReturnType<typeof buildSnapshot>,
  observed: ReturnType<typeof buildObserved>,
  differences: readonly RepositoryConformanceDifferenceV1[],
  request: RepositoryImportRequestV1,
  context: FactContext,
) {
  const operations: unknown[] = [];
  const target = {
    documentId: request.approvedArchitecture.documentId,
    architectureId: request.approvedArchitecture.architectureId,
    revisionId: request.approvedArchitecture.revision.revisionId,
  };
  for (const difference of differences
    .filter((entry) => entry.kind !== "matches")
    .slice(0, 256)) {
    const fact = context.facts.find((candidate) =>
      difference.observedFactIds.includes(candidate.factId),
    );
    if (fact === undefined) continue;
    const recordDigest = fact.digest;
    const operationId = stableId("reconcile", difference.digest);
    const observedTarget =
      fact.kind === "resource"
        ? {
            kind: "resource" as const,
            observedResourceId: `observed.${fact.factId}`,
            recordDigest,
          }
        : fact.kind === "connection"
          ? {
              kind: "connection" as const,
              observedConnectionId: `observed.${fact.factId}`,
              recordDigest,
            }
          : fact.kind === "generated-file"
            ? {
                kind: "generated-file" as const,
                observedGeneratedFileId: `observed.${fact.factId}`,
                recordDigest,
              }
            : undefined;
    if (observedTarget === undefined) continue;
    if (
      fact.kind === "resource" &&
      fact.logicalKey.startsWith("cloudmarkup.node.")
    ) {
      const node = context.exactNodes.get(
        fact.logicalKey.slice("cloudmarkup.node.".length),
      );
      if (
        node !== undefined &&
        !request.approvedArchitecture.nodes.some(
          (candidate) => candidate.id === node.id,
        )
      ) {
        const commandId = stableId("command", { operationId, node: node.id });
        const command = {
          schemaVersion: 1 as const,
          commandId,
          inverseCommandId: `${commandId}.inverse`,
          origin: "migration" as const,
          target,
          kind: "add-node" as const,
          node,
        };
        const batch = {
          schemaVersion: 1 as const,
          commandId: `${commandId}.batch`,
          inverseCommandId: `${commandId}.batch.inverse`,
          origin: "migration" as const,
          target,
          kind: "batch" as const,
          commands: [command],
        };
        const applied = applyGraphCommand(request.approvedArchitecture, batch);
        operations.push({
          operationId,
          target: observedTarget,
          rationale:
            "Accept the exact imported CloudMarkup node through the deterministic Graph Command engine.",
          kind: "accept-observed-graph-change",
          expectedArchitectureContentHash: getArchitectureDocumentContentHash(
            request.approvedArchitecture,
          ),
          resultingArchitectureContentHash: getArchitectureDocumentContentHash(
            applied.document,
          ),
          graphCommands: batch,
        });
        continue;
      }
    }
    if (fact.kind === "generated-file") {
      operations.push({
        operationId,
        target: observedTarget,
        rationale:
          "Regenerate reviewed repository output from the frozen design.",
        kind: "update-generated-output-to-design",
        action: "regenerate-from-approved-design",
        expectedDesignDigest: getArchitectureDocumentContentHash(
          request.approvedArchitecture,
        ),
        expectedRepositoryManifestDigest: fact.expectedChecksum,
        generator: {
          id: REPOSITORY_IMPORTER_ID,
          version: REPOSITORY_IMPORTER_VERSION,
        },
      });
    } else {
      operations.push({
        operationId,
        target: observedTarget,
        rationale:
          "Keep the imported fact observed-only until an explicit mapping decision is reviewed.",
        kind: "keep-observed-only",
      });
    }
  }
  if (operations.length === 0) return undefined;
  return reconciliationProposalV1Schema.parse({
    contractVersion: 1,
    kind: "cloudmarkup.reconciliation-proposal",
    proposalId: stableId("proposal", {
      snapshot: snapshot.snapshotDigest,
      observed: observed.observedContentHash,
    }),
    authority: "proposal-only",
    applyPolicy: "explicit-review-and-deterministic-operation",
    repositorySnapshotId: snapshot.snapshotId,
    repositorySnapshotDigest: snapshot.snapshotDigest,
    observedSolutionId: observed.observedSolutionId,
    observedContentHash: observed.observedContentHash,
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: {
          id: REPOSITORY_IMPORTER_ID,
          version: REPOSITORY_IMPORTER_VERSION,
        },
      },
      createdAt: request.profile.importedAt,
      inputDigests: [snapshot.snapshotDigest, observed.observedContentHash],
    },
    operations,
    review: { state: "pending-review" },
  });
}

function buildConformanceEvidence(
  snapshot: ReturnType<typeof buildSnapshot>,
  observed: ReturnType<typeof buildObserved>,
  differences: readonly RepositoryConformanceDifferenceV1[],
  issues: ReturnType<typeof buildIssues>,
  request: RepositoryImportRequestV1,
) {
  const passed = differences.every(
    (difference) =>
      difference.kind === "matches" || difference.severity === "information",
  );
  return evidenceRecordV1Schema.parse({
    artifacts: [
      {
        digest: snapshot.snapshotDigest,
        mediaType: "application/vnd.cloudmarkup.repository-snapshot+json",
        sizeBytes: new TextEncoder().encode(serializeCanonicalJson(snapshot))
          .byteLength,
      },
      {
        digest: observed.observedContentHash,
        mediaType: "application/vnd.cloudmarkup.observed-solution+json",
        sizeBytes: new TextEncoder().encode(serializeCanonicalJson(observed))
          .byteLength,
      },
    ],
    checks: [
      {
        artifactDigests: [
          snapshot.snapshotDigest,
          observed.observedContentHash,
        ],
        checkId: "cloudmarkup.repository.conformance",
        issueIds: issues.map((issue) => issue.id),
        status: passed ? "passed" : "failed",
        summary: passed
          ? "Repository facts conform to the approved Solution Revision."
          : "Repository differences require explicit review.",
        ...(passed
          ? {}
          : {
              redactedFailure:
                "Repository conformance differences remain; no deployed-state claim was made.",
            }),
      },
    ],
    contractVersion: 1,
    environment: { environmentType: "unknown" },
    id: stableId("evidence", {
      snapshot: snapshot.snapshotDigest,
      revision: request.solutionRevision.solutionRevisionId,
    }),
    layer: "imported",
    level: { rank: 8, kind: "repository-conformance" },
    models: [],
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: {
          id: REPOSITORY_IMPORTER_ID,
          version: REPOSITORY_IMPORTER_VERSION,
        },
      },
      createdAt: request.profile.importedAt,
      inputDigests: [
        snapshot.snapshotDigest,
        observed.observedContentHash,
        getArchitectureDocumentCanonicalHash(request.approvedArchitecture),
      ],
    },
    solutionRevisionId: request.solutionRevision.solutionRevisionId,
    staleness: { assessedAt: request.profile.importedAt, state: "current" },
    tools: [
      { id: REPOSITORY_IMPORTER_ID, version: REPOSITORY_IMPORTER_VERSION },
    ],
  });
}

export function createRepositoryImportService(
  input: Readonly<{ hclInspector: TerraformHCLInspectorPort }>,
): RepositoryImportService {
  return Object.freeze({
    async importRepository(
      raw: Readonly<{
        sourceDirectory: string;
        request: RepositoryImportRequestV1;
      }>,
    ) {
      const request = repositoryImportRequestV1Schema.parse(raw.request);
      const files = await scanRepository(raw.sourceDirectory, request);
      const context: FactContext = {
        facts: [],
        diagnostics: [],
        evidence: new Map(),
        unsupportedSources: [],
        exactNodes: new Map(),
        exactEdges: new Map(),
        redactedFileCount: 0,
        redactedValueCount: 0,
      };
      await parseFiles(files, request, input.hclInspector, context);
      const snapshot = buildSnapshot(files, request, context);
      const observedSolution = buildObserved(snapshot, request, context);
      const differences = compareConformance(files, request, context);
      const issues = buildIssues(differences, request);
      const evidence = buildConformanceEvidence(
        snapshot,
        observedSolution,
        differences,
        issues,
        request,
      );
      const proposal = buildProposal(
        snapshot,
        observedSolution,
        differences,
        request,
        context,
      );
      const basis = {
        contractVersion: 1 as const,
        kind: "cloudmarkup.repository-import-result" as const,
        snapshot,
        observedSolution,
        facts: context.facts,
        differences,
        issues,
        evidence,
        ...(proposal === undefined ? {} : { proposal }),
        diagnostics: context.diagnostics.sort((left, right) =>
          compareUtf16(
            `${left.path ?? ""}:${String(left.line ?? 0)}:${left.code}`,
            `${right.path ?? ""}:${String(right.line ?? 0)}:${right.code}`,
          ),
        ),
      };
      return repositoryImportResultV1Schema.parse({
        ...basis,
        resultDigest: hashCanonicalValue(basis),
      });
    },
  });
}

export function verifyRepositoryImport(
  result: RepositoryImportResultV1,
): Readonly<{
  conforms: boolean;
  errors: readonly RepositoryImportDiagnosticV1[];
}> {
  const parsed = repositoryImportResultV1Schema.parse(result);
  const { resultDigest, ...basis } = parsed;
  const integrityErrors =
    hashCanonicalValue(basis) === resultDigest
      ? []
      : [
          cleanDiagnostic(
            "result-integrity-invalid",
            "error",
            "Repository import result integrity verification failed.",
          ),
        ];
  const blockingDifferences = parsed.differences.filter(
    (difference) =>
      difference.kind !== "matches" && difference.severity === "error",
  );
  return Object.freeze({
    conforms:
      integrityErrors.length === 0 &&
      blockingDifferences.length === 0 &&
      parsed.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    errors: [
      ...integrityErrors,
      ...parsed.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ],
  });
}

/** Pure metadata digest for current imports or explicit historical reads. This
 * does not run an old importer or grant current parser/evaluation authority. */
export function calculateRepositoryImportSnapshotDigestV1(input: {
  readonly files: readonly {
    readonly path: string;
    readonly checksum: string;
  }[];
  readonly importedAt: string;
  readonly commitSha: string;
  readonly importerVersion?: "1.0.1" | "1.0.2";
}) {
  const version = input.importerVersion ?? REPOSITORY_IMPORTER_VERSION;
  if (!["1.0.1", "1.0.2"].includes(version))
    throw new TypeError("Unsupported repository importer digest version.");
  return hashCanonicalValue({
    files: input.files.map(({ path, checksum }) => ({ path, checksum })),
    importer: version,
    importedAt: input.importedAt,
    commitSha: input.commitSha,
  });
}
