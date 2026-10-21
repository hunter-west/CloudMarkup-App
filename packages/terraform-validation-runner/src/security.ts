import { createHash } from "node:crypto";

import {
  repositoryRelativePathSchema,
  namespacedIdentifierSchema,
  serializeCanonicalJson,
  sha256DigestSchema,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import type {
  TerraformAiExtensionContextV1,
  TerraformValidationDiagnosticV1,
  TerraformValidationFileV1,
  TerraformValidationLimitsV1,
  TerraformValidationPolicyV1,
  TerraformValidationReferenceV1,
} from "./contracts.js";

const textEncoder = new TextEncoder();
const absolutePathPattern =
  /(?:[A-Za-z]:\\(?:[^\s"']+\\)*[^\s"']*|[A-Za-z]:\/(?:[^\s"']+\/)*[^\s"']*|\/(?:home|Users|tmp|var\/tmp|workspace)(?:\/[^\s"']*)?)/gu;
const secretPatterns = [
  /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/gu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  /\b(?:github_pat_|ghp_|glpat-|sk_live_|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/giu,
  /\b(?:authorization|aws_access_key_id|aws_secret_access_key|aws_session_token|password|private_key|secret|token)\s*=\s*["'][^"'\r\n]{8,}["']/giu,
  /[?&](?:X-Amz-(?:Credential|Security-Token|Signature)|sig|token)=[^\s&]+/giu,
] as const;

export function sha256(value: string | Uint8Array): Sha256Digest {
  return sha256DigestSchema.parse(
    `sha256:${createHash("sha256").update(value).digest("hex")}`,
  );
}

export function canonicalDigest(value: unknown): Sha256Digest {
  return sha256(serializeCanonicalJson(value));
}

export function compareUtf16(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf16);
}

export const TERRAFORM_VALIDATION_TREE_DIGEST_CANONICALIZATION =
  "cloudmarkup.terraform-validation-tree.path-checksum.v1" as const;

export function terraformValidationTreeDigest(
  files: readonly Pick<TerraformValidationFileV1, "checksum" | "path">[],
): Sha256Digest {
  return canonicalDigest(
    files
      .map(({ checksum, path }) => ({ checksum, path }))
      .sort((left, right) => compareUtf16(left.path, right.path)),
  );
}

export function sanitizeToolText(value: string, maximum = 2_000): string {
  let sanitized = value.normalize("NFC").replace(absolutePathPattern, "[path]");
  for (const pattern of secretPatterns)
    sanitized = sanitized.replace(pattern, "[redacted]");
  sanitized = Array.from(sanitized)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 && character !== "\n" && character !== "\t"
        ? " "
        : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  return (
    sanitized.length === 0 ? "Tool returned no safe detail." : sanitized
  ).slice(0, maximum);
}

export function containsSensitiveMaterial(value: string): boolean {
  if (absolutePathPattern.test(value)) {
    absolutePathPattern.lastIndex = 0;
    return true;
  }
  absolutePathPattern.lastIndex = 0;
  return secretPatterns.some((pattern) => {
    const found = pattern.test(value);
    pattern.lastIndex = 0;
    return found;
  });
}

interface HclToken {
  readonly kind: "identifier" | "string" | "symbol";
  readonly value: string;
}

function tokenizeHcl(source: string): readonly HclToken[] {
  const tokens: HclToken[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? "";
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "#" || (character === "/" && source[index + 1] === "/")) {
      index = source.indexOf("\n", index + 1);
      if (index < 0) break;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) throw new TypeError("Unterminated HCL block comment.");
      index = end + 2;
      continue;
    }
    if (character === '"') {
      let value = "";
      let escaped = false;
      index += 1;
      for (; index < source.length; index += 1) {
        const next = source[index] ?? "";
        if (escaped) {
          value += next;
          escaped = false;
        } else if (next === "\\") {
          escaped = true;
        } else if (next === '"') {
          index += 1;
          break;
        } else {
          value += next;
        }
      }
      if (index > source.length || source[index - 1] !== '"') {
        throw new TypeError("Unterminated HCL string.");
      }
      tokens.push({ kind: "string", value });
      continue;
    }
    if (/[A-Za-z0-9_-]/u.test(character)) {
      const start = index;
      index += 1;
      while (
        index < source.length &&
        /[A-Za-z0-9_.-]/u.test(source[index] ?? "")
      ) {
        index += 1;
      }
      tokens.push({ kind: "identifier", value: source.slice(start, index) });
      continue;
    }
    tokens.push({ kind: "symbol", value: character });
    index += 1;
  }
  return tokens;
}

function blockEnd(tokens: readonly HclToken[], openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const value = tokens[index]?.value;
    if (value === "{") depth += 1;
    if (value === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new TypeError("Unbalanced HCL block braces.");
}

function assignment(
  tokens: readonly HclToken[],
  start: number,
  end: number,
  name: string,
): string | undefined {
  for (let index = start; index + 2 < end; index += 1) {
    if (
      tokens[index]?.kind === "identifier" &&
      tokens[index]?.value === name &&
      tokens[index + 1]?.value === "=" &&
      tokens[index + 2]?.kind === "string"
    ) {
      return tokens[index + 2]?.value;
    }
  }
  return undefined;
}

export interface HclAdmissionIssue {
  readonly code: string;
  readonly detail: string;
}

export function inspectTerraformHcl(
  content: string,
  policy: TerraformValidationPolicyV1,
): readonly HclAdmissionIssue[] {
  let tokens: readonly HclToken[];
  try {
    tokens = tokenizeHcl(content);
  } catch {
    return [
      {
        code: "terraform.validation.hcl-malformed",
        detail: "Terraform source could not be safely tokenized.",
      },
    ];
  }
  const issues: HclAdmissionIssue[] = [];
  const providerVersions = new Map(
    policy.providers.map(
      (provider) => [provider.source, provider.version] as const,
    ),
  );
  const providerNames = new Set(
    policy.providers.map(({ source }) => source.split("/").at(-1) ?? ""),
  );
  const modules = new Map(
    policy.modules.map((module) => [module.source, module.version] as const),
  );

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "identifier") continue;
    if (token.value === "backend") {
      issues.push({
        code: "terraform.validation.backend-forbidden",
        detail: "Terraform backend blocks are forbidden in validation input.",
      });
    }
    if (
      token.value === "provisioner" ||
      token.value === "local-exec" ||
      token.value === "remote-exec"
    ) {
      issues.push({
        code: "terraform.validation.provisioner-forbidden",
        detail: "Terraform provisioners and command execution are forbidden.",
      });
    }
    if (
      token.value === "data" &&
      tokens[index + 1]?.kind === "string" &&
      (tokens[index + 1]?.value === "external" ||
        tokens[index + 1]?.value === "terraform_remote_state")
    ) {
      issues.push({
        code: "terraform.validation.external-data-forbidden",
        detail:
          "External commands and remote state data sources are forbidden.",
      });
    }
    if (token.value === "provider" && tokens[index + 1]?.kind === "string") {
      const providerName = tokens[index + 1]?.value ?? "";
      if (!providerNames.has(providerName)) {
        issues.push({
          code: "terraform.validation.provider-unsupported",
          detail: `Provider ${providerName} is not approved.`,
        });
      }
    }
    if (
      token.value === "source" &&
      tokens[index + 1]?.value === "=" &&
      tokens[index + 2]?.kind === "string"
    ) {
      const source = tokens[index + 2]?.value ?? "";
      const approvedProviderVersion = providerVersions.get(source);
      if (approvedProviderVersion === undefined && !modules.has(source)) {
        issues.push({
          code: "terraform.validation.source-unsupported",
          detail: `Provider or module source ${source} is not approved.`,
        });
      } else if (approvedProviderVersion !== undefined) {
        let openIndex = index - 1;
        let end: number | undefined;
        while (openIndex >= 0) {
          if (tokens[openIndex]?.value === "{") {
            try {
              const candidateEnd = blockEnd(tokens, openIndex);
              if (candidateEnd > index) {
                end = candidateEnd;
                break;
              }
            } catch {
              break;
            }
          }
          openIndex -= 1;
        }
        const version =
          end === undefined
            ? undefined
            : assignment(tokens, openIndex + 1, end, "version");
        if (version !== approvedProviderVersion) {
          issues.push({
            code: "terraform.validation.provider-version-unsupported",
            detail:
              "Provider source and version must match one prepackaged approved provider.",
          });
        }
      }
    }
    if (token.value === "module" && tokens[index + 1]?.kind === "string") {
      const openIndex = index + 2;
      if (tokens[openIndex]?.value !== "{") {
        issues.push({
          code: "terraform.validation.hcl-malformed",
          detail: "Module block is malformed.",
        });
        continue;
      }
      let end: number;
      try {
        end = blockEnd(tokens, openIndex);
      } catch {
        issues.push({
          code: "terraform.validation.hcl-malformed",
          detail: "Module block braces are malformed.",
        });
        continue;
      }
      const source = assignment(tokens, openIndex + 1, end, "source");
      const version = assignment(tokens, openIndex + 1, end, "version");
      if (
        source === undefined ||
        version === undefined ||
        modules.get(source) !== version
      ) {
        issues.push({
          code: "terraform.validation.module-unsupported",
          detail:
            "Module source and version must match one prepackaged approved module.",
        });
      }
      index = end;
    }
  }
  return issues;
}
interface TerraformAiExtensionAdmissionInput {
  readonly artifactDigest: Sha256Digest;
  readonly compiler: TerraformAiExtensionContextV1["baseline"]["compiler"];
  readonly context: TerraformAiExtensionContextV1;
  readonly files: readonly TerraformValidationFileV1[];
  readonly solutionRevisionDigest: Sha256Digest;
  readonly solutionRevisionId: string;
}

function extensionDiagnostic(
  code: string,
  detail: string,
  solutionRevisionId: string,
  file?: TerraformValidationFileV1,
): TerraformValidationDiagnosticV1 {
  return {
    code: namespacedIdentifierSchema.parse(code),
    detail,
    ...(file === undefined ? {} : { path: file.path }),
    references: file?.references ?? emptyReferences(solutionRevisionId),
    severity: "error",
    source: "admission",
    summary: detail,
  };
}

function portablePath(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function hclSymbolsAreBalanced(tokens: readonly HclToken[]): boolean {
  const stack: string[] = [];
  const closeForOpen = new Map([
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ]);
  for (const token of tokens) {
    if (token.kind !== "symbol") continue;
    if (closeForOpen.has(token.value)) {
      stack.push(token.value);
      continue;
    }
    if (token.value === "}" || token.value === "]" || token.value === ")") {
      const open = stack.pop();
      if (open === undefined || closeForOpen.get(open) !== token.value) {
        return false;
      }
    }
  }
  return stack.length === 0;
}

type SemanticVersionTuple = readonly [number, number, number];

function semanticVersionTuple(value: string): SemanticVersionTuple | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value.trim());
  if (match === null) return undefined;
  const tuple = match.slice(1).map(Number);
  return tuple.length === 3 &&
    tuple.every((part) => Number.isSafeInteger(part) && part >= 0)
    ? (tuple as unknown as SemanticVersionTuple)
    : undefined;
}

function compareSemanticVersions(
  left: SemanticVersionTuple,
  right: SemanticVersionTuple,
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function providerVersionSatisfies(
  version: string,
  constraint: string,
): boolean {
  const actual = semanticVersionTuple(version);
  if (actual === undefined) return false;
  const clauses = constraint.split(",").map((clause) => clause.trim());
  return (
    clauses.length > 0 &&
    clauses.every((clause) => {
      const match = /^(>=|<=|>|<|=|==|~>)?\s*(\d+\.\d+\.\d+)$/u.exec(clause);
      if (match?.[2] === undefined) return false;
      const expected = semanticVersionTuple(match[2]);
      if (expected === undefined) return false;
      const comparison = compareSemanticVersions(actual, expected);
      switch (match[1] ?? "=") {
        case ">=":
          return comparison >= 0;
        case "<=":
          return comparison <= 0;
        case ">":
          return comparison > 0;
        case "<":
          return comparison < 0;
        case "~>":
          return (
            comparison >= 0 &&
            actual[0] === expected[0] &&
            actual[1] === expected[1]
          );
        default:
          return comparison === 0;
      }
    })
  );
}

interface TerraformAiExtensionHclInspection {
  readonly declaredAddresses: readonly string[];
  readonly issues: readonly HclAdmissionIssue[];
  readonly resourceCount: number;
}

function inspectTerraformAiExtensionHcl(
  content: string,
  context: TerraformAiExtensionContextV1,
): TerraformAiExtensionHclInspection {
  let tokens: readonly HclToken[];
  try {
    tokens = tokenizeHcl(content);
  } catch {
    return {
      declaredAddresses: [],
      issues: [
        {
          code: "terraform.validation.hcl-malformed",
          detail: "AI-authored Terraform source could not be safely tokenized.",
        },
      ],
      resourceCount: 0,
    };
  }
  if (!hclSymbolsAreBalanced(tokens)) {
    return {
      declaredAddresses: [],
      issues: [
        {
          code: "terraform.validation.hcl-malformed",
          detail: "AI-authored Terraform source has unbalanced delimiters.",
        },
      ],
      resourceCount: 0,
    };
  }

  const issues: HclAdmissionIssue[] = [];
  const declaredAddresses = new Set<string>();
  let resourceCount = 0;
  const providerById = new Map(
    context.providerAuthorities.map((provider) => [
      provider.providerId,
      provider,
    ]),
  );
  const allowedProviderSources = new Set(
    context.providerAuthorities.map(({ source }) => source),
  );
  const resourceByKindAndType = new Map(
    context.resourceAuthorities.map((resource) => [
      [resource.blockKind, resource.resourceType].join("\u0000"),
      resource,
    ]),
  );
  const ownedAddresses = new Set(
    context.ownedResourceAddresses.map((address) =>
      address.normalize("NFC").toLowerCase(),
    ),
  );
  const protectedAddresses = new Set(
    context.protectedDeterministicResourceAddresses.map((address) =>
      address.normalize("NFC").toLowerCase(),
    ),
  );
  const providerSourcePattern = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "identifier") continue;

    if (token.value === "module") {
      issues.push({
        code: "terraform.validation.extension-module-forbidden",
        detail: "AI-authored Terraform extensions cannot declare modules.",
      });
    }

    if (
      token.value === "import" ||
      token.value === "moved" ||
      token.value === "removed" ||
      token.value === "state"
    ) {
      issues.push({
        code: "terraform.validation.extension-state-forbidden",
        detail:
          "AI-authored Terraform extensions cannot declare state or import operations.",
      });
    }

    if (
      token.value === "run" ||
      token.value === "plan" ||
      (token.value === "command" &&
        tokens[index + 1]?.value === "=" &&
        (tokens[index + 2]?.value === "plan" ||
          tokens[index + 2]?.value === "apply"))
    ) {
      issues.push({
        code: "terraform.validation.extension-plan-forbidden",
        detail:
          "AI-authored Terraform extensions cannot declare plan, apply, or test-run operations.",
      });
    }

    if (token.value === "provider" && tokens[index + 1]?.kind === "string") {
      if (
        tokens[index + 1]?.kind !== "string" ||
        tokens[index + 2]?.value !== "{"
      ) {
        issues.push({
          code: "terraform.validation.hcl-malformed",
          detail: "AI-authored provider block is malformed.",
        });
      } else {
        issues.push({
          code: "terraform.validation.extension-provider-configuration-forbidden",
          detail:
            "AI-authored Terraform extensions cannot configure providers; the deterministic baseline owns provider credentials, endpoints, and role authority.",
        });
      }
    }

    if (
      token.value === "source" &&
      tokens[index + 1]?.value === "=" &&
      tokens[index + 2]?.kind === "string"
    ) {
      const source = tokens[index + 2]?.value ?? "";
      if (
        providerSourcePattern.test(source) &&
        !allowedProviderSources.has(source)
      ) {
        issues.push({
          code: "terraform.validation.extension-provider-unsupported",
          detail:
            "AI-authored Terraform extension references a provider source outside its approved slot.",
        });
      }
    }

    if (token.value === "provider" && tokens[index + 1]?.value === "=") {
      issues.push({
        code: "terraform.validation.extension-provider-configuration-forbidden",
        detail:
          "AI-authored Terraform extensions cannot select provider aliases; the deterministic baseline owns provider authority.",
      });
    }

    if (token.value !== "resource" && token.value !== "data") continue;
    const resourceType = tokens[index + 1]?.value;
    const resourceName = tokens[index + 2]?.value;
    if (
      tokens[index + 1]?.kind !== "string" ||
      tokens[index + 2]?.kind !== "string" ||
      tokens[index + 3]?.value !== "{" ||
      resourceType === undefined ||
      resourceName === undefined ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(resourceName)
    ) {
      issues.push({
        code: "terraform.validation.hcl-malformed",
        detail: "AI-authored Terraform resource block is malformed.",
      });
      continue;
    }
    resourceCount += 1;
    const blockKind = token.value;
    const authority = resourceByKindAndType.get(
      [blockKind, resourceType].join("\u0000"),
    );
    if (authority === undefined) {
      issues.push({
        code: "terraform.validation.extension-resource-unsupported",
        detail:
          "AI-authored Terraform extension declares a block kind/resource tuple outside its approved slot.",
      });
    }
    const provider =
      authority === undefined
        ? undefined
        : providerById.get(authority.providerId);
    const providerName = resourceType.split("_")[0] ?? "";
    const approvedProviderName = provider?.source.split("/").at(-1) ?? "";
    if (
      provider === undefined ||
      providerName.length === 0 ||
      providerName !== approvedProviderName
    ) {
      issues.push({
        code: "terraform.validation.extension-provider-unsupported",
        detail:
          "AI-authored Terraform extension does not bind the resource tuple to its exact approved provider.",
      });
    }
    const address =
      blockKind === "data"
        ? "data." + resourceType + "." + resourceName
        : resourceType + "." + resourceName;
    const normalizedAddress = address.normalize("NFC").toLowerCase();
    if (declaredAddresses.has(normalizedAddress)) {
      issues.push({
        code: "terraform.validation.extension-address-duplicate",
        detail: "AI-authored Terraform resource addresses must be unique.",
      });
    }
    declaredAddresses.add(normalizedAddress);
    if (!ownedAddresses.has(normalizedAddress)) {
      issues.push({
        code: "terraform.validation.extension-address-not-owned",
        detail:
          "AI-authored Terraform extension declared a resource address outside its exact owned authority.",
      });
    }
    if (protectedAddresses.has(normalizedAddress)) {
      issues.push({
        code: "terraform.validation.extension-address-collision",
        detail:
          "AI-authored Terraform extension collides with a protected deterministic resource address.",
      });
    }
  }
  return {
    declaredAddresses: [...declaredAddresses].sort(compareUtf16),
    issues,
    resourceCount,
  };
}

export function validateTerraformAiExtensionInput(
  input: TerraformAiExtensionAdmissionInput,
  policy: TerraformValidationPolicyV1,
): readonly TerraformValidationDiagnosticV1[] {
  const {
    artifactDigest,
    compiler,
    context,
    files,
    solutionRevisionDigest,
    solutionRevisionId,
  } = input;
  const diagnostics: TerraformValidationDiagnosticV1[] = [];
  const filesByPath = new Map(
    files.map((file) => [portablePath(file.path), file] as const),
  );
  const candidatePaths = new Map(
    context.candidateOwnedPaths.map(
      (path) => [portablePath(path), path] as const,
    ),
  );
  const protectedFiles = new Map(
    context.protectedDeterministicFiles.map(
      (file) => [portablePath(file.path), file] as const,
    ),
  );

  for (const [pathKey, path] of candidatePaths) {
    if (protectedFiles.has(pathKey)) {
      diagnostics.push(
        extensionDiagnostic(
          "terraform.validation.extension-path-collision",
          "AI-authored candidate paths must be disjoint from protected deterministic paths.",
          solutionRevisionId,
          filesByPath.get(pathKey),
        ),
      );
    }
    const candidateFile = filesByPath.get(pathKey);
    if (candidateFile === undefined) {
      diagnostics.push(
        extensionDiagnostic(
          "terraform.validation.extension-tree-binding-invalid",
          "The detached validation tree is missing an exact candidate-owned path.",
          solutionRevisionId,
        ),
      );
    } else if (candidateFile.path !== path) {
      diagnostics.push(
        extensionDiagnostic(
          "terraform.validation.extension-tree-binding-invalid",
          "A candidate file path does not exactly match its owned path.",
          solutionRevisionId,
          candidateFile,
        ),
      );
    }
  }

  for (const [pathKey, protectedFile] of protectedFiles) {
    const actual = filesByPath.get(pathKey);
    if (actual === undefined) {
      diagnostics.push(
        extensionDiagnostic(
          "terraform.validation.extension-baseline-missing",
          "The detached validation tree is missing a protected deterministic file.",
          solutionRevisionId,
        ),
      );
    } else if (
      actual.path !== protectedFile.path ||
      actual.checksum !== protectedFile.checksum
    ) {
      diagnostics.push(
        extensionDiagnostic(
          "terraform.validation.extension-baseline-mismatch",
          "A protected deterministic file does not match its exact pinned path and checksum.",
          solutionRevisionId,
          actual,
        ),
      );
    }
  }

  for (const [pathKey, file] of filesByPath) {
    if (!candidatePaths.has(pathKey) && !protectedFiles.has(pathKey)) {
      diagnostics.push(
        extensionDiagnostic(
          "terraform.validation.extension-tree-binding-invalid",
          "The detached validation tree contains a file outside the exact candidate and protected baseline sets.",
          solutionRevisionId,
          file,
        ),
      );
    }
    if (file.references.solutionRevisionId !== solutionRevisionId) {
      diagnostics.push(
        extensionDiagnostic(
          "terraform.validation.extension-reference-invalid",
          "Terraform file references do not match the exact Solution Revision.",
          solutionRevisionId,
          file,
        ),
      );
    }
  }

  const candidateFiles = files.filter((file) =>
    candidatePaths.has(portablePath(file.path)),
  );
  if (terraformValidationTreeDigest(files) !== artifactDigest) {
    diagnostics.push(
      extensionDiagnostic(
        "terraform.validation.extension-artifact-digest-mismatch",
        "The complete detached Terraform validation tree does not match its exact artifact digest.",
        solutionRevisionId,
      ),
    );
  }
  if (
    candidateFiles.length !== candidatePaths.size ||
    terraformValidationTreeDigest(candidateFiles) !== context.candidateDigest
  ) {
    diagnostics.push(
      extensionDiagnostic(
        "terraform.validation.extension-candidate-digest-mismatch",
        "AI-authored Terraform candidate files do not match their exact candidate digest.",
        solutionRevisionId,
      ),
    );
  }

  if (
    terraformValidationTreeDigest(context.protectedDeterministicFiles) !==
      context.baseline.artifactDigest ||
    context.baseline.solutionRevisionDigest !== solutionRevisionDigest ||
    serializeCanonicalJson(context.baseline.compiler) !==
      serializeCanonicalJson(compiler)
  ) {
    diagnostics.push(
      extensionDiagnostic(
        "terraform.validation.extension-baseline-provenance-mismatch",
        "Protected baseline provenance does not match the exact revision and compiler pins.",
        solutionRevisionId,
      ),
    );
  }
  if (context.modelDescriptor.scope.solutionRevisionId !== solutionRevisionId) {
    diagnostics.push(
      extensionDiagnostic(
        "terraform.validation.extension-model-provenance-mismatch",
        "The model invocation descriptor does not bind the exact Solution Revision.",
        solutionRevisionId,
      ),
    );
  }

  const approvedProviderBySource = new Map(
    policy.providers.map((provider) => [provider.source, provider]),
  );
  for (const provider of context.providerAuthorities) {
    const approved = approvedProviderBySource.get(provider.source);
    if (approved === undefined) {
      diagnostics.push(
        extensionDiagnostic(
          "terraform.validation.extension-provider-unsupported",
          "The extension slot allows a provider outside runner policy.",
          solutionRevisionId,
        ),
      );
    } else if (
      !providerVersionSatisfies(approved.version, provider.versionConstraint)
    ) {
      diagnostics.push(
        extensionDiagnostic(
          "terraform.validation.extension-provider-version-unsupported",
          "The fixed offline provider version does not satisfy the exact extension authority constraint.",
          solutionRevisionId,
        ),
      );
    }
  }

  const declaredAddresses = new Set<string>();
  let resourceCount = 0;
  for (const file of candidateFiles) {
    const inspection = inspectTerraformAiExtensionHcl(file.content, context);
    resourceCount += inspection.resourceCount;
    for (const address of inspection.declaredAddresses) {
      if (declaredAddresses.has(address)) {
        diagnostics.push(
          extensionDiagnostic(
            "terraform.validation.extension-address-duplicate",
            "AI-authored Terraform resource addresses must be unique across candidate files.",
            solutionRevisionId,
            file,
          ),
        );
      }
      declaredAddresses.add(address);
    }
    for (const issue of inspection.issues) {
      diagnostics.push(
        extensionDiagnostic(issue.code, issue.detail, solutionRevisionId, file),
      );
    }
  }
  const ownedAddresses = new Set(
    context.ownedResourceAddresses.map((address) =>
      address.normalize("NFC").toLowerCase(),
    ),
  );
  if (
    declaredAddresses.size !== ownedAddresses.size ||
    [...ownedAddresses].some((address) => !declaredAddresses.has(address))
  ) {
    diagnostics.push(
      extensionDiagnostic(
        "terraform.validation.extension-owned-addresses-mismatch",
        "Declared Terraform resource addresses must equal the exact owned extension-slot authority.",
        solutionRevisionId,
      ),
    );
  }
  if (resourceCount > context.maximumResourceCount) {
    diagnostics.push(
      extensionDiagnostic(
        "terraform.validation.extension-resource-count-exceeded",
        "AI-authored Terraform resources exceed the exact extension-slot maximum.",
        solutionRevisionId,
      ),
    );
  }
  return diagnostics;
}

function emptyReferences(
  solutionRevisionId: string,
): TerraformValidationReferenceV1 {
  return {
    edgeIds: [],
    nodeIds: [],
    ownedPolicyIds: [],
    solutionRevisionId:
      solutionRevisionId as TerraformValidationReferenceV1["solutionRevisionId"],
  };
}

export function validateInputFiles(
  files: readonly TerraformValidationFileV1[],
  limits: TerraformValidationLimitsV1,
  policy: TerraformValidationPolicyV1,
  solutionRevisionId: string,
): readonly TerraformValidationDiagnosticV1[] {
  const diagnostics: TerraformValidationDiagnosticV1[] = [];
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    const parsedPath = repositoryRelativePathSchema.safeParse(file.path);
    const bytes = textEncoder.encode(file.content).byteLength;
    totalBytes += bytes;
    const key = file.path.normalize("NFC").toLowerCase();
    let code: string | undefined;
    let detail: string | undefined;
    if (
      !parsedPath.success ||
      !file.path.startsWith("infrastructure/") ||
      !file.path.endsWith(".tf")
    ) {
      code = "terraform.validation.path-forbidden";
      detail =
        "Validation accepts only repository-relative infrastructure/*.tf files.";
    } else if (paths.has(key)) {
      code = "terraform.validation.path-duplicate";
      detail = "Terraform paths must be unique across portable filesystems.";
    } else if (bytes > limits.maxFileBytes) {
      code = "terraform.validation.file-limit";
      detail = "Terraform file exceeds the configured byte limit.";
    } else if (sha256(file.content) !== file.checksum) {
      code = "terraform.validation.checksum-mismatch";
      detail = "Terraform file checksum does not match its exact bytes.";
    } else if (containsSensitiveMaterial(file.content)) {
      code = "terraform.validation.sensitive-input";
      detail =
        "Terraform source contains prohibited secret or local-path material.";
    }
    paths.add(key);
    if (code !== undefined && detail !== undefined) {
      diagnostics.push({
        code: namespacedIdentifierSchema.parse(code),
        detail,
        ...(parsedPath.success ? { path: parsedPath.data } : {}),
        references: file.references,
        severity: "error",
        source: "admission",
        summary: detail,
      });
      continue;
    }
    for (const issue of inspectTerraformHcl(file.content, policy)) {
      diagnostics.push({
        code: namespacedIdentifierSchema.parse(issue.code),
        detail: issue.detail,
        ...(parsedPath.success ? { path: parsedPath.data } : {}),
        references: file.references,
        severity: "error",
        source: "admission",
        summary: issue.detail,
      });
    }
  }
  if (files.length > limits.maxFiles || totalBytes > limits.maxTotalFileBytes) {
    const detail =
      "Terraform tree exceeds the configured file-count or total-byte limit.";
    diagnostics.push({
      code: namespacedIdentifierSchema.parse("terraform.validation.tree-limit"),
      detail,
      references: emptyReferences(solutionRevisionId),
      severity: "error",
      source: "admission",
      summary: detail,
    });
  }
  if (sha256(policy.providerLock.content) !== policy.providerLock.checksum) {
    const detail =
      "Approved provider lock checksum does not match its exact content.";
    diagnostics.push({
      code: namespacedIdentifierSchema.parse(
        "terraform.validation.provider-lock-invalid",
      ),
      detail,
      references: emptyReferences(solutionRevisionId),
      severity: "error",
      source: "runner",
      summary: detail,
    });
  }
  return diagnostics;
}

export function referencesForPath(
  files: readonly TerraformValidationFileV1[],
  candidatePath: string | undefined,
  solutionRevisionId: string,
): {
  readonly path?: TerraformValidationFileV1["path"];
  readonly references: TerraformValidationReferenceV1;
} {
  if (candidatePath !== undefined) {
    const normalized = candidatePath
      .replaceAll("\\", "/")
      .replace(/^\.\//u, "");
    const exact = files.find(
      ({ path }) =>
        path === normalized || path === `infrastructure/${normalized}`,
    );
    const basename = normalized.split("/").at(-1);
    const byBasename = files.filter(
      ({ path }) => path.split("/").at(-1) === basename,
    );
    const file = exact ?? (byBasename.length === 1 ? byBasename[0] : undefined);
    if (file !== undefined)
      return { path: file.path, references: file.references };
  }
  return { references: emptyReferences(solutionRevisionId) };
}
