import { createHash } from "node:crypto";

import {
  serializeCanonicalJson,
  sha256DigestSchema,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import type {
  SolutionExportMediaTypeV1,
  SolutionExportOwnershipKindV1,
} from "./contracts.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const fixedRoots = [
  ".github/workflows/",
  "application/",
  "cloudmarkup/",
  "diagram/",
  "evidence/",
  "infrastructure/",
] as const;
const forbiddenSegments = new Set([
  ".cache",
  ".git",
  ".terraform",
  ".turbo",
  "build",
  "cdk.out",
  "coverage",
  "dist",
  "node_modules",
  "storybook-static",
]);
const windowsDeviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const expectedMediaTypeByExtension = new Map<
  string,
  readonly SolutionExportMediaTypeV1[]
>([
  [".hcl", ["application/vnd.hashicorp.terraform"]],
  [
    ".json",
    [
      "application/json",
      "application/vnd.amazon.cloudformation.template+json",
      "application/vnd.cyclonedx+json",
    ],
  ],
  [".yaml", ["application/yaml"]],
  [".yml", ["application/yaml"]],
  [".md", ["text/markdown"]],
  [".pdf", ["application/pdf"]],
  [".png", ["image/png"]],
  [".svg", ["image/svg+xml"]],
  [".tf", ["application/vnd.hashicorp.terraform"]],
  [".ts", ["text/typescript"]],
  [".mjs", ["text/javascript"]],
  [".txt", ["text/plain"]],
  [".zip", ["application/zip"]],
]);

const prohibitedTextPatterns = [
  {
    code: "EXPORT_CONTENT_PRIVATE_KEY",
    pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u,
  },
  {
    code: "EXPORT_CONTENT_AWS_ACCESS_KEY",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  },
  {
    code: "EXPORT_CONTENT_TOKEN",
    pattern:
      /\b(?:github_pat_|ghp_|glpat-|sk_live_|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/u,
  },
  {
    code: "EXPORT_CONTENT_BEARER_TOKEN",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/iu,
  },
  {
    code: "EXPORT_CONTENT_SECRET_VALUE",
    pattern:
      /\b(?:api[_-]?key|access[_-]?token|password|passwd|secret[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9+/_.=-]{12,}/iu,
  },
  {
    code: "EXPORT_CONTENT_SIGNED_URL",
    pattern:
      /[?&](?:X-Amz-(?:Credential|Security-Token|Signature)|sig|token)=/iu,
  },
  {
    code: "EXPORT_CONTENT_LOCAL_PATH",
    pattern:
      /(?:[A-Za-z]:\\(?:Users|Windows|Temp)\\|\/(?:Users|home|tmp|var\/tmp)\/)/u,
  },
  {
    code: "EXPORT_CONTENT_FILE_URL",
    pattern: /\bfile:\/\//iu,
  },
  {
    code: "EXPORT_CONTENT_RAW_PROMPT",
    pattern:
      /(?:<\|(?:system|developer|user)\|>|"(?:rawPrompt|systemPrompt)"\s*:)/iu,
  },
  {
    code: "EXPORT_CONTENT_INTERNAL_LOG",
    pattern: /^\s*\[(?:debug|trace|internal)\]/imu,
  },
] as const;

export function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function sha256Digest(value: string | Uint8Array): Sha256Digest {
  return sha256DigestSchema.parse(
    `sha256:${createHash("sha256").update(value).digest("hex")}`,
  );
}

export function encodeUtf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function decodeUtf8(value: Uint8Array): string {
  return textDecoder.decode(value);
}

export function decodeBase64(value: string): Uint8Array {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new TypeError("Base64 content is not canonical.");
  }
  return new Uint8Array(decoded);
}

export function canonicalSemanticDigest(
  mediaType: SolutionExportMediaTypeV1,
  bytes: Uint8Array,
): Sha256Digest {
  if (
    mediaType === "application/json" ||
    mediaType === "application/vnd.amazon.cloudformation.template+json"
  ) {
    const parsed = JSON.parse(decodeUtf8(bytes)) as unknown;
    return sha256Digest(serializeCanonicalJson(parsed));
  }
  if (
    mediaType.startsWith("text/") ||
    mediaType === "application/yaml" ||
    mediaType === "application/vnd.hashicorp.terraform" ||
    mediaType === "image/svg+xml"
  ) {
    return sha256Digest(decodeUtf8(bytes).replaceAll("\r\n", "\n"));
  }
  return sha256Digest(bytes);
}

export interface PathIssue {
  readonly code: string;
  readonly message: string;
}

export function inspectExportPath(
  path: string,
  maxPathBytes: number,
): PathIssue | undefined {
  if (path !== path.normalize("NFC")) {
    return {
      code: "EXPORT_PATH_NOT_NFC",
      message: "Export paths must use canonical NFC normalization.",
    };
  }
  if (encodeUtf8(path).byteLength > maxPathBytes) {
    return {
      code: "EXPORT_PATH_LIMIT_EXCEEDED",
      message: "Export path exceeds the configured UTF-8 byte limit.",
    };
  }
  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:/u.test(path) ||
    path.includes("\\") ||
    path.includes(":") ||
    path.includes("\u0000")
  ) {
    return {
      code: "EXPORT_PATH_ABSOLUTE_OR_PLATFORM_SPECIFIC",
      message:
        "Export paths must be relative POSIX paths without drives, backslashes, or ADS syntax.",
    };
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(" "),
    )
  ) {
    return {
      code: "EXPORT_PATH_TRAVERSAL_OR_EMPTY_SEGMENT",
      message:
        "Export paths cannot contain traversal, empty, or non-portable segments.",
    };
  }
  if (segments.some((segment) => windowsDeviceName.test(segment))) {
    return {
      code: "EXPORT_PATH_DEVICE_NAME",
      message: "Export paths cannot use reserved device names.",
    };
  }
  if (
    segments.some((segment) => forbiddenSegments.has(segment.toLowerCase()))
  ) {
    return {
      code: "EXPORT_PATH_FORBIDDEN_OUTPUT",
      message:
        "Export paths cannot include caches, dependencies, or local build output.",
    };
  }
  const fileName = segments.at(-1)?.toLowerCase() ?? "";
  if (
    fileName === ".env" ||
    fileName.startsWith(".env.") ||
    fileName.endsWith(".log") ||
    fileName === "terraform.tfstate" ||
    fileName.startsWith("terraform.tfstate.") ||
    fileName.endsWith(".tfplan") ||
    fileName.endsWith(".plan")
  ) {
    return {
      code: "EXPORT_PATH_FORBIDDEN_FILE",
      message:
        "Export path names a forbidden environment, log, state, or plan file.",
    };
  }
  if (
    path !== "README.md" &&
    !fixedRoots.some((root) => path.startsWith(root))
  ) {
    return {
      code: "EXPORT_PATH_OUTSIDE_FIXED_ROOT",
      message: "Export files must stay inside a fixed repository package root.",
    };
  }
  return undefined;
}

export function inspectMediaType(
  path: string,
  mediaType: SolutionExportMediaTypeV1,
  ownership: SolutionExportOwnershipKindV1,
): PathIssue | undefined {
  const fileName = path.split("/").at(-1)?.toLowerCase() ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  const extension = dotIndex >= 0 ? fileName.slice(dotIndex) : "";
  const expected =
    fileName === "terraform.tfvars.example"
      ? (["application/vnd.hashicorp.terraform"] as const)
      : expectedMediaTypeByExtension.get(extension);
  if (expected?.includes(mediaType) !== true) {
    return {
      code: "EXPORT_MEDIA_TYPE_MISMATCH",
      message:
        "Export filename extension and media type are not an approved pair.",
    };
  }
  if (
    mediaType === "application/zip" &&
    ownership !== "generated-build-artifact"
  ) {
    return {
      code: "EXPORT_ZIP_OWNERSHIP_INVALID",
      message:
        "Nested ZIP bytes are allowed only as generated build artifacts.",
    };
  }
  return undefined;
}

export function inspectTextContent(
  mediaType: SolutionExportMediaTypeV1,
  bytes: Uint8Array,
): PathIssue | undefined {
  if (
    !mediaType.startsWith("text/") &&
    mediaType !== "application/yaml" &&
    mediaType !== "application/json" &&
    mediaType !== "application/vnd.amazon.cloudformation.template+json" &&
    mediaType !== "application/vnd.hashicorp.terraform" &&
    mediaType !== "image/svg+xml"
  ) {
    return undefined;
  }
  let text: string;
  try {
    text = decodeUtf8(bytes);
  } catch {
    return {
      code: "EXPORT_TEXT_INVALID_UTF8",
      message: "Textual export content must be valid UTF-8.",
    };
  }
  const prohibited = prohibitedTextPatterns.find(({ pattern }) =>
    pattern.test(text),
  );
  if (prohibited !== undefined) {
    return {
      code: prohibited.code,
      message:
        "Export content contains prohibited sensitive or local material.",
    };
  }
  return undefined;
}

function replaceControlCharacters(value: string): string {
  let output = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    output += codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  }
  return output;
}

export function sanitizeMarkdownInline(value: string): string {
  return replaceControlCharacters(value.normalize("NFKC"))
    .replace(/[\\`*_[\]<>#]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 128);
}

export function portableArchiveStem(value: string): string {
  const safe = sanitizeMarkdownInline(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  if (safe.length === 0 || windowsDeviceName.test(safe)) {
    return "cloudmarkup-solution";
  }
  return safe;
}
