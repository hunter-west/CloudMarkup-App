import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";

import {
  CANONICAL_PNPM_STORE_INDEX_PATH,
  PNPM_STORE_INDEX_DATABASE_PATH,
  exportCanonicalPnpmStoreIndex,
} from "../infra/images/application-build/service/pnpm-store-index.mjs";
import { findSecretPatterns } from "./security/secret-scan-core.mjs";
import {
  assertReviewedGoSourceArtifact,
  buildReviewedGoSource,
  readReviewedGoBuildInputs,
  readReviewedGoCache,
  writeReviewedGoCache,
} from "./beta-go-tool-builds.mjs";

const MANIFEST_NAME = "image-inputs-v1.json";
const ACQUISITION_NAME = "offline/acquisition-v1.json";
const PNPM_STORE_VERSION = "v11";
const PNPM_TARGET = Object.freeze({
  cpu: "x64",
  libc: "musl",
  os: "linux",
});
const PNPM_WORKSPACE_CONFIGURATION_BYTES = Buffer.from(
  [
    "packages:",
    "  - .",
    "supportedArchitectures:",
    "  os:",
    "    - linux",
    "  cpu:",
    "    - x64",
    "  libc:",
    "    - musl",
    "",
  ].join("\n"),
  "utf8",
);
const PNPM_DETERMINISTIC_CLOCK_PATH = "service/pnpm-deterministic-clock.cjs";
const PNPM_DETERMINISTIC_CLOCK_BYTES = Buffer.from(
  [
    '"use strict";',
    'const { isMainThread } = require("node:worker_threads");',
    "if (!isMainThread) {",
    '  Object.defineProperty(Date, "now", {',
    "    configurable: false,",
    "    enumerable: false,",
    "    value: () => -1_000_000_000_000,",
    "    writable: false,",
    "  });",
    "}",
    "",
  ].join("\n"),
  "utf8",
);
const PNPM_HOST_AUTHORITY = Object.freeze({
  implementation: Object.freeze({
    path: "dist/pnpm.mjs",
    sha256: "6d1d488e4ff9371a32cf4d322a01a8f6998e31b9c97342a77ca2bb179cf3234f",
    sizeBytes: 12_902_503,
  }),
  launchers: Object.freeze([
    Object.freeze({
      path: "bin/pnpm.cjs",
      sha256:
        "67b035e322203961795e8e34ca63a08c37a4386eda94107fb3d28f3246d882ad",
      sizeBytes: 105,
    }),
    Object.freeze({
      path: "bin/pnpm.mjs",
      sha256:
        "ff3224d46b47fbb24a7e9fe15fededef7e00892d07d4e376b6762d4899906bfd",
      sizeBytes: 1_464,
    }),
  ]),
  packageMetadata: Object.freeze({
    path: "package.json",
    sha256: "fb72b825a5b0ad77974b0af4a02e02aa1b108140cedf80c2a8e8a2f18f0d8944",
    sizeBytes: 2_349,
  }),
  worker: Object.freeze({
    path: "dist/worker.js",
    sha256: "86c0c2a1f8f927980560cbd66be94267829d3082cc12baa03b864da644bf9775",
    sizeBytes: 438_718,
  }),
});
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u;
const ROLE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const FORBIDDEN_VCS_SEGMENTS = new Set([".bzr", ".git", ".hg", ".svn"]);
const SECRET_SHAPED_SEGMENTS = [
  /^\.env(?:\.|$)/iu,
  /^\.netrc$/iu,
  /^credentials(?:\.[a-z0-9_-]+)?$/iu,
  /^id_(?:dsa|ecdsa|ed25519|rsa)$/iu,
  /\.(?:jks|key|p12|pfx|pem)$/iu,
];
const WINDOWS_RESERVED_SEGMENT =
  /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)(?:\.|$)/iu;
const APPROVED_ACQUISITION_HOSTS = new Set([
  "codeload.github.com",
  "dl-cdn.alpinelinux.org",
  "github.com",
  "registry.npmjs.org",
  "releases.hashicorp.com",
]);
const APPROVED_ACQUISITION_REDIRECT_HOSTS = new Set([
  "release-assets.githubusercontent.com",
]);
const MAXIMUM_ACQUISITION_REDIRECTS = 3;
const MAXIMUM_MANIFEST_BYTES = 1024 * 1024;
const MAXIMUM_GENERATED_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAXIMUM_FILES = 20_000;
const MAXIMUM_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAXIMUM_CONTEXT_BYTES = 3 * 1024 * 1024 * 1024;
const MAXIMUM_TEXT_SCAN_BYTES = 8 * 1024 * 1024;

const REVIEWED_IMAGE_AUTHORITIES = Object.freeze([
  Object.freeze({
    reference: "node:24.18.0-alpine3.24",
    imageDigest:
      "sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd",
  }),
]);
const REVIEWED_DOCKERFILE_FRONTEND_AUTHORITIES = Object.freeze({
  "application-build": Object.freeze({
    reference: "docker/dockerfile:1.7",
    imageDigest:
      "sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e",
  }),
  "terraform-validation": Object.freeze({
    reference: "docker/dockerfile:1.19.0",
    imageDigest:
      "sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6",
  }),
});
const REVIEWED_ACQUISITION_CANONICAL_SHA256 = Object.freeze({
  "application-build":
    "cb780b76e40d65ff3028a72cb63e8d19c21bcae724e3ed42838d375190b945ff",
  "terraform-validation":
    "b3c6336d831487d1564a44cd5df1efae45b729cb34f8e23e47c048bb174de7eb",
});
const REVIEWED_ZIP_LAYOUTS = new Map([
  [
    "https://github.com/terraform-linters/tflint/releases/download/v0.59.1/tflint_linux_amd64.zip",
    Object.freeze({
      dataDescriptor: true,
      extendedTimestampHex: "01410bb468",
      flags: 0x0008,
    }),
  ],
  [
    "https://releases.hashicorp.com/terraform-provider-aws/6.63.0/terraform-provider-aws_6.63.0_linux_amd64.zip",
    Object.freeze({
      dataDescriptor: true,
      extendedTimestampHex: "01a97b996a",
      flags: 0x0008,
    }),
  ],
  [
    "https://releases.hashicorp.com/terraform/1.13.5/terraform_1.13.5_linux_amd64.zip",
    Object.freeze({
      dataDescriptor: true,
      extendedTimestampHex: "01ed270b69",
      flags: 0x0008,
    }),
  ],
]);

const CONTEXT_SPECS = Object.freeze([
  Object.freeze({
    contextId: "application-build",
    relativeRoot: "infra/images/application-build",
    requiredMembers: Object.freeze([
      "Dockerfile",
      "service/application-build-service",
      "service/pnpm-deterministic-clock.cjs",
      "service/pnpm-store-index.mjs",
      "offline/acquisition-v1.json",
      "offline/toolchain/package.json",
      "offline/toolchain/pnpm-lock.yaml",
    ]),
    entrypoint: "service/application-build-service",
  }),
  Object.freeze({
    contextId: "terraform-validation",
    relativeRoot: "infra/images/terraform-validation",
    requiredMembers: Object.freeze([
      "Dockerfile",
      "service/terraform-validation-service",
      "offline/acquisition-v1.json",
      "offline/.terraform.lock.hcl",
      "offline/provider-mirror/index-v1.json",
      "offline/terraform.rc",
      "offline/tool-binaries-v1.json",
    ]),
    entrypoint: "service/terraform-validation-service",
  }),
]);

export class ImageContextError extends Error {
  constructor(code, path, message) {
    super(`${code}: ${path}: ${message}`);
    this.name = "ImageContextError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new ImageContextError(code, path, message);
}

function plain(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function comparePortable(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value, expected, path) {
  if (!plain(value)) fail("CONTEXT_SCHEMA_INVALID", path, "expected object");
  const actual = Object.keys(value).sort(comparePortable);
  const wanted = [...expected].sort(comparePortable);
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("CONTEXT_SCHEMA_INVALID", path, `expected keys ${wanted.join(", ")}`);
  }
}

function exactKeysFromSet(value, required, allowed, path) {
  if (!plain(value)) fail("CONTEXT_SCHEMA_INVALID", path, "expected object");
  const actual = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    actual.some((key) => !allowed.includes(key))
  ) {
    fail(
      "CONTEXT_SCHEMA_INVALID",
      path,
      `required keys are ${required.join(", ")}; no unknown keys are allowed`,
    );
  }
}

function string(value, path, pattern) {
  if (typeof value !== "string" || value.length === 0) {
    fail("CONTEXT_SCHEMA_INVALID", path, "expected non-empty string");
  }
  if (pattern !== undefined && !pattern.test(value)) {
    fail("CONTEXT_SCHEMA_INVALID", path, "value is outside the reviewed form");
  }
  return value;
}

function integer(value, path, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail(
      "CONTEXT_SCHEMA_INVALID",
      path,
      "expected bounded non-negative integer",
    );
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (!plain(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(comparePortable)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJson(value) {
  return Buffer.from(
    `${JSON.stringify(canonicalize(value), null, 2)}\n`,
    "utf8",
  );
}

function hasAsciiControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function portablePath(value, path) {
  string(value, path);
  if (
    value !== value.normalize("NFC") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.startsWith("/") ||
    isAbsolute(value) ||
    Buffer.byteLength(value, "utf8") > 255 ||
    hasAsciiControlCharacter(value)
  ) {
    fail("CONTEXT_PATH_INVALID", path, "path is not portable and relative");
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(" ") ||
        WINDOWS_RESERVED_SEGMENT.test(segment),
    )
  ) {
    fail("CONTEXT_PATH_INVALID", path, "path contains an unsafe segment");
  }
  return value;
}

function assertNoSensitivePath(memberPath, path) {
  const segments = memberPath.split("/");
  if (
    segments.some((segment) =>
      FORBIDDEN_VCS_SEGMENTS.has(segment.toLowerCase()),
    )
  ) {
    fail(
      "CONTEXT_NESTED_VCS",
      path,
      "nested source-control metadata is forbidden",
    );
  }
  if (
    segments.some((segment) =>
      SECRET_SHAPED_SEGMENTS.some((pattern) => pattern.test(segment)),
    )
  ) {
    fail(
      "CONTEXT_SECRET_SHAPED_PATH",
      path,
      "secret-shaped files are forbidden",
    );
  }
}

function parseMember(value, index) {
  const path = `members[${String(index)}]`;
  exactKeys(value, ["executable", "path", "role", "sha256", "sizeBytes"], path);
  const memberPath = portablePath(value.path, `${path}.path`);
  assertNoSensitivePath(memberPath, `${path}.path`);
  if (memberPath === MANIFEST_NAME) {
    fail(
      "CONTEXT_MANIFEST_RECURSIVE",
      path,
      "manifest must be represented only by self",
    );
  }
  string(value.role, `${path}.role`, ROLE_PATTERN);
  string(value.sha256, `${path}.sha256`, SHA256_PATTERN);
  integer(value.sizeBytes, `${path}.sizeBytes`, MAXIMUM_FILE_BYTES);
  if (typeof value.executable !== "boolean") {
    fail("CONTEXT_SCHEMA_INVALID", `${path}.executable`, "expected boolean");
  }
  return Object.freeze({
    executable: value.executable,
    path: memberPath,
    role: value.role,
    sha256: value.sha256,
    sizeBytes: value.sizeBytes,
  });
}

function validateOrderedUnique(records, label, key = "path") {
  let previous;
  const folded = new Set();
  for (const [index, record] of records.entries()) {
    const current = record[key];
    if (previous !== undefined && comparePortable(previous, current) >= 0) {
      fail(
        "CONTEXT_ORDER_INVALID",
        `${label}[${String(index)}].${key}`,
        "records must be strictly sorted and unique",
      );
    }
    const caseFolded = current.toLocaleLowerCase("en-US");
    if (folded.has(caseFolded)) {
      fail(
        "CONTEXT_CASE_COLLISION",
        `${label}[${String(index)}].${key}`,
        "portable paths cannot collide by case",
      );
    }
    folded.add(caseFolded);
    previous = current;
  }
}

function validateCommonManifest(value, spec) {
  const common = [
    "contextId",
    "generatedPrefixes",
    "kind",
    "members",
    "platform",
    "schemaVersion",
    "self",
  ];
  const specific =
    spec.contextId === "application-build"
      ? ["bindings", "toolchain"]
      : ["offlineInputs", "tools"];
  exactKeys(value, [...common, ...specific], MANIFEST_NAME);
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "cloudmarkup.image-context-inputs" ||
    value.contextId !== spec.contextId ||
    value.platform !== "linux/amd64"
  ) {
    fail(
      "CONTEXT_IDENTITY_INVALID",
      MANIFEST_NAME,
      "schema, kind, context ID, or platform differs from reviewed authority",
    );
  }
  exactKeys(value.self, ["executable", "path", "role"], "self");
  if (
    value.self.path !== MANIFEST_NAME ||
    value.self.role !== "context-manifest" ||
    value.self.executable !== false
  ) {
    fail("CONTEXT_SELF_INVALID", "self", "manifest self-record is invalid");
  }
  if (
    !Array.isArray(value.members) ||
    value.members.length === 0 ||
    value.members.length > MAXIMUM_FILES
  ) {
    fail(
      "CONTEXT_SCHEMA_INVALID",
      "members",
      "expected a bounded non-empty array",
    );
  }
  const members = value.members.map((member, index) =>
    parseMember(member, index),
  );
  validateOrderedUnique(members, "members");
  if (
    !Array.isArray(value.generatedPrefixes) ||
    value.generatedPrefixes.length === 0 ||
    value.generatedPrefixes.length > 16
  ) {
    fail(
      "CONTEXT_GENERATED_PREFIX_INVALID",
      "generatedPrefixes",
      "expected a bounded non-empty generated-prefix allowlist",
    );
  }
  const generatedPrefixes = value.generatedPrefixes.map((entry, index) => {
    const path = `generatedPrefixes[${String(index)}]`;
    exactKeys(entry, ["path", "role"], path);
    const prefix = portablePath(entry.path, `${path}.path`).replace(/\/$/u, "");
    assertNoSensitivePath(prefix, `${path}.path`);
    string(entry.role, `${path}.role`, ROLE_PATTERN);
    return Object.freeze({ path: prefix, role: entry.role });
  });
  validateOrderedUnique(generatedPrefixes, "generatedPrefixes");
  for (const [index, entry] of generatedPrefixes.entries()) {
    if (
      generatedPrefixes.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index &&
          entry.path.startsWith(`${candidate.path}/`),
      )
    ) {
      fail(
        "CONTEXT_GENERATED_PREFIX_INVALID",
        `generatedPrefixes[${String(index)}]`,
        "generated prefixes cannot overlap",
      );
    }
  }
  const byPath = new Map(members.map((member) => [member.path, member]));
  for (const required of spec.requiredMembers) {
    if (!byPath.has(required)) {
      fail(
        "CONTEXT_REQUIRED_MEMBER_MISSING",
        required,
        "required reviewed member is absent",
      );
    }
  }
  if (byPath.get("Dockerfile")?.executable !== false) {
    fail(
      "CONTEXT_EXECUTABLE_INVALID",
      "Dockerfile",
      "Dockerfile cannot be executable",
    );
  }
  if (byPath.get(spec.entrypoint)?.executable !== true) {
    fail(
      "CONTEXT_ENTRYPOINT_INVALID",
      spec.entrypoint,
      "entrypoint must declare canonical executable intent",
    );
  }
  return { byPath, generatedPrefixes, manifest: value, members };
}

function validateVersionMap(value, requiredKeys, allowedKeys, path) {
  exactKeysFromSet(value, requiredKeys, allowedKeys, path);
  for (const [key, version] of Object.entries(value)) {
    string(version, `${path}.${key}`, VERSION_PATTERN);
  }
}

function parseFileAuthority(value, path, { exactPath } = {}) {
  exactKeys(value, ["path", "sha256", "sizeBytes"], path);
  const authorityPath =
    exactPath === undefined
      ? portablePath(value.path, `${path}.path`)
      : string(value.path, `${path}.path`);
  if (exactPath !== undefined && authorityPath !== exactPath) {
    fail(
      "CONTEXT_LOCK_PATH_INVALID",
      `${path}.path`,
      "path differs from exact external authority",
    );
  }
  return {
    path: authorityPath,
    sha256: string(value.sha256, `${path}.sha256`, SHA256_PATTERN),
    sizeBytes: integer(
      value.sizeBytes,
      `${path}.sizeBytes`,
      MAXIMUM_FILE_BYTES,
    ),
  };
}

function approvedHttpsUrl(value, path) {
  const urlText = string(value, path);
  let url;
  try {
    url = new URL(urlText);
  } catch {
    fail("CONTEXT_ACQUISITION_URL_INVALID", path, "URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !APPROVED_ACQUISITION_HOSTS.has(url.hostname) ||
    url.href !== urlText
  ) {
    fail(
      "CONTEXT_ACQUISITION_URL_INVALID",
      path,
      "URL is outside the exact reviewed HTTPS hosts/form",
    );
  }
  return urlText;
}

function parseGeneratedOutput(
  value,
  path,
  { archivePath = false, derived = false } = {},
) {
  const keys = archivePath
    ? derived
      ? ["archivePath", "destination", "executable", "role"]
      : [
          "archivePath",
          "destination",
          "executable",
          "mode",
          "role",
          "sha256",
          "sizeBytes",
        ]
    : ["destination", "executable", "role", "sha256", "sizeBytes"];
  exactKeys(value, keys, path);
  const output = {
    destination: portablePath(value.destination, `${path}.destination`),
    executable: value.executable,
    role: string(value.role, `${path}.role`, ROLE_PATTERN),
  };
  assertNoSensitivePath(output.destination, `${path}.destination`);
  if (typeof output.executable !== "boolean") {
    fail("CONTEXT_SCHEMA_INVALID", `${path}.executable`, "expected boolean");
  }
  if (archivePath) {
    output.archivePath = portablePath(value.archivePath, `${path}.archivePath`);
  }
  if (!derived) {
    if (archivePath) {
      output.mode = string(value.mode, `${path}.mode`, /^(?:0644|0755)$/u);
      if ((output.mode === "0755") !== output.executable) {
        fail(
          "CONTEXT_ARCHIVE_MODE_INVALID",
          `${path}.mode`,
          "archive mode and executable intent differ",
        );
      }
    }
    output.sha256 = string(value.sha256, `${path}.sha256`, SHA256_PATTERN);
    output.sizeBytes = integer(
      value.sizeBytes,
      `${path}.sizeBytes`,
      MAXIMUM_FILE_BYTES,
    );
  }
  return output;
}

function parseAcquisition(value, contextId) {
  exactKeys(
    value,
    ["artifacts", "contextId", "kind", "recipes", "schemaVersion"],
    ACQUISITION_NAME,
  );
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "cloudmarkup.offline-acquisition" ||
    value.contextId !== contextId ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length > 32 ||
    !Array.isArray(value.recipes) ||
    value.recipes.length > 4
  ) {
    fail(
      "CONTEXT_ACQUISITION_INVALID",
      ACQUISITION_NAME,
      "acquisition identity, artifacts, or recipes are invalid",
    );
  }
  if (
    sha256(canonicalJson(value)) !==
    REVIEWED_ACQUISITION_CANONICAL_SHA256[contextId]
  ) {
    fail(
      "CONTEXT_ACQUISITION_AUTHORITY_DRIFT",
      ACQUISITION_NAME,
      "descriptor differs from the exact reviewed URLs, byte pins, members, or recipes",
    );
  }
  const artifacts = value.artifacts.map((artifact, index) => {
    const path = `artifacts[${String(index)}]`;
    if (artifact?.type === "https-go-source-v1") {
      assertReviewedGoSourceArtifact(artifact);
      if (contextId === "application-build" && artifact.tool !== "trivy") {
        fail(
          "CONTEXT_GO_AUTHORITY_DRIFT",
          path,
          "application runtime admits only the reviewed scanner",
        );
      }
      return {
        ...artifact,
        members: artifact.members.map((member, memberIndex) =>
          parseGeneratedOutput(
            member,
            `${path}.members[${String(memberIndex)}]`,
            { archivePath: true },
          ),
        ),
      };
    }
    if (artifact?.type === "https-file") {
      const hasZipMembers = Object.hasOwn(artifact, "zipMembers");
      exactKeys(
        artifact,
        [
          "destination",
          "executable",
          "role",
          "sha256",
          "sizeBytes",
          "type",
          "url",
          ...(hasZipMembers ? ["zipMembers"] : []),
        ],
        path,
      );
      let zipMembers;
      if (hasZipMembers) {
        if (
          !Array.isArray(artifact.zipMembers) ||
          artifact.zipMembers.length === 0
        ) {
          fail(
            "CONTEXT_ACQUISITION_INVALID",
            `${path}.zipMembers`,
            "ZIP verification members are invalid",
          );
        }
        zipMembers = artifact.zipMembers.map((member, memberIndex) => {
          const memberPath = `${path}.zipMembers[${String(memberIndex)}]`;
          exactKeys(
            member,
            [
              "archivePath",
              "externalAttributes",
              "mode",
              "sha256",
              "sizeBytes",
            ],
            memberPath,
          );
          const parsed = {
            archivePath: portablePath(
              member.archivePath,
              `${memberPath}.archivePath`,
            ),
            externalAttributes: member.externalAttributes,
            mode: string(member.mode, `${memberPath}.mode`, /^(?:0644|0755)$/u),
            sha256: string(
              member.sha256,
              `${memberPath}.sha256`,
              SHA256_PATTERN,
            ),
            sizeBytes: integer(
              member.sizeBytes,
              `${memberPath}.sizeBytes`,
              MAXIMUM_FILE_BYTES,
            ),
          };
          if (!Number.isInteger(parsed.externalAttributes)) {
            fail(
              "CONTEXT_SCHEMA_INVALID",
              `${memberPath}.externalAttributes`,
              "expected signed ZIP attributes integer",
            );
          }
          return parsed;
        });
        validateOrderedUnique(zipMembers, `${path}.zipMembers`, "archivePath");
      }
      return {
        type: artifact.type,
        url: approvedHttpsUrl(artifact.url, `${path}.url`),
        ...parseGeneratedOutput(
          {
            destination: artifact.destination,
            executable: artifact.executable,
            role: artifact.role,
            sha256: artifact.sha256,
            sizeBytes: artifact.sizeBytes,
          },
          path,
        ),
        ...(zipMembers === undefined ? {} : { zipMembers }),
      };
    }
    if (artifact?.type === "https-zip") {
      exactKeys(
        artifact,
        ["members", "sha256", "sizeBytes", "type", "url"],
        path,
      );
      if (
        !Array.isArray(artifact.members) ||
        artifact.members.length === 0 ||
        artifact.members.length > 16
      ) {
        fail(
          "CONTEXT_ACQUISITION_INVALID",
          `${path}.members`,
          "ZIP member allowlist is invalid",
        );
      }
      const members = artifact.members.map((member, memberIndex) =>
        parseGeneratedOutput(
          member,
          `${path}.members[${String(memberIndex)}]`,
          {
            archivePath: true,
          },
        ),
      );
      validateOrderedUnique(members, `${path}.members`, "archivePath");
      return {
        members,
        sha256: string(artifact.sha256, `${path}.sha256`, SHA256_PATTERN),
        sizeBytes: integer(
          artifact.sizeBytes,
          `${path}.sizeBytes`,
          MAXIMUM_FILE_BYTES,
        ),
        type: artifact.type,
        url: approvedHttpsUrl(artifact.url, `${path}.url`),
      };
    }
    if (artifact?.type === "https-tar-gzip") {
      exactKeys(
        artifact,
        ["members", "sha256", "sizeBytes", "type", "url"],
        path,
      );
      if (
        !Array.isArray(artifact.members) ||
        artifact.members.length === 0 ||
        artifact.members.length > 16
      ) {
        fail(
          "CONTEXT_ACQUISITION_INVALID",
          `${path}.members`,
          "tar.gz member allowlist is invalid",
        );
      }
      const members = artifact.members.map((member, memberIndex) => {
        const memberPath = `${path}.members[${String(memberIndex)}]`;
        if (member?.disposition === "ignore") {
          exactKeys(member, ["archivePath", "disposition"], memberPath);
          return {
            archivePath: portablePath(
              member.archivePath,
              `${memberPath}.archivePath`,
            ),
            disposition: member.disposition,
          };
        }
        exactKeys(
          member,
          [
            "archivePath",
            "destination",
            "disposition",
            "executable",
            "mode",
            "role",
            "sha256",
            "sizeBytes",
          ],
          memberPath,
        );
        if (member.disposition !== "extract") {
          fail(
            "CONTEXT_ACQUISITION_INVALID",
            `${memberPath}.disposition`,
            "only exact extracted members are supported",
          );
        }
        return {
          disposition: member.disposition,
          ...parseGeneratedOutput(
            {
              archivePath: member.archivePath,
              destination: member.destination,
              executable: member.executable,
              mode: member.mode,
              role: member.role,
              sha256: member.sha256,
              sizeBytes: member.sizeBytes,
            },
            memberPath,
            { archivePath: true },
          ),
        };
      });
      validateOrderedUnique(members, `${path}.members`, "archivePath");
      return {
        members,
        sha256: string(artifact.sha256, `${path}.sha256`, SHA256_PATTERN),
        sizeBytes: integer(
          artifact.sizeBytes,
          `${path}.sizeBytes`,
          MAXIMUM_FILE_BYTES,
        ),
        type: artifact.type,
        url: approvedHttpsUrl(artifact.url, `${path}.url`),
      };
    }
    if (artifact?.type === "oci-trivy-db-v1") {
      exactKeys(
        artifact,
        [
          "artifactType",
          "created",
          "layer",
          "manifestDigest",
          "members",
          "registry",
          "repository",
          "type",
        ],
        path,
      );
      exactKeys(
        artifact.layer,
        ["digest", "mediaType", "sizeBytes"],
        `${path}.layer`,
      );
      if (
        artifact.registry !== "ghcr.io" ||
        artifact.repository !== "aquasecurity/trivy-db" ||
        artifact.manifestDigest !==
          "sha256:98e1c199793bfcbe64fa41538fa3cf2c55650689a7920075bbba6165404a44d0" ||
        artifact.artifactType !==
          "application/vnd.aquasec.trivy.config.v1+json" ||
        artifact.created !== "2026-09-10T14:16:33Z" ||
        artifact.layer.mediaType !==
          "application/vnd.aquasec.trivy.db.layer.v1.tar+gzip" ||
        artifact.layer.digest !==
          "sha256:1edf7a495c6d68e691fb710b63926e4f1a3dbffa392fd8057cd10bdfd8c3eef5" ||
        artifact.layer.sizeBytes !== 117_915_639 ||
        !Array.isArray(artifact.members)
      ) {
        fail(
          "CONTEXT_OCI_AUTHORITY_INVALID",
          path,
          "Trivy DB OCI authority is not exact",
        );
      }
      const members = artifact.members.map((member, memberIndex) =>
        parseGeneratedOutput(
          member,
          `${path}.members[${String(memberIndex)}]`,
          {
            archivePath: true,
            derived: true,
          },
        ),
      );
      validateOrderedUnique(members, `${path}.members`, "archivePath");
      if (
        JSON.stringify(members.map((member) => member.archivePath)) !==
          JSON.stringify(["metadata.json", "trivy.db"]) ||
        members.some((member) => member.executable)
      ) {
        fail(
          "CONTEXT_OCI_AUTHORITY_INVALID",
          `${path}.members`,
          "Trivy DB must admit only metadata.json and trivy.db as data files",
        );
      }
      return { ...artifact, members };
    }
    fail(
      "CONTEXT_ACQUISITION_INVALID",
      `${path}.type`,
      "artifact type is not reviewed",
    );
  });
  let previousArtifact = "";
  for (const [index, artifact] of artifacts.entries()) {
    const current = `${artifact.type}\u0000${artifact.url ?? artifact.manifestDigest}`;
    if (comparePortable(previousArtifact, current) >= 0) {
      fail(
        "CONTEXT_ORDER_INVALID",
        `artifacts[${String(index)}]`,
        "artifacts must be strictly sorted and unique",
      );
    }
    previousArtifact = current;
  }
  const recipes = value.recipes.map((recipe, index) => {
    const path = `recipes[${String(index)}]`;
    exactKeys(
      recipe,
      [
        "destination",
        "lockPath",
        "packageManagerVersion",
        "target",
        "type",
        "workspaceConfiguration",
      ],
      path,
    );
    exactKeys(recipe.target, ["cpu", "libc", "os"], path + ".target");
    exactKeys(
      recipe.workspaceConfiguration,
      ["path", "sha256", "sizeBytes"],
      path + ".workspaceConfiguration",
    );
    if (
      recipe.type !== "pnpm-store-v1" ||
      contextId !== "application-build" ||
      recipe.destination !== "offline/pnpm-store" ||
      recipe.lockPath !== "offline/toolchain/pnpm-lock.yaml" ||
      recipe.packageManagerVersion !== "11.16.0" ||
      recipe.target.os !== PNPM_TARGET.os ||
      recipe.target.cpu !== PNPM_TARGET.cpu ||
      recipe.target.libc !== PNPM_TARGET.libc ||
      recipe.workspaceConfiguration.path !== "pnpm-workspace.yaml" ||
      recipe.workspaceConfiguration.sha256 !==
        sha256(PNPM_WORKSPACE_CONFIGURATION_BYTES) ||
      recipe.workspaceConfiguration.sizeBytes !==
        PNPM_WORKSPACE_CONFIGURATION_BYTES.byteLength
    ) {
      fail(
        "CONTEXT_RECIPE_INVALID",
        path,
        "pnpm store recipe differs from reviewed fixed authority",
      );
    }
    return { ...recipe };
  });
  if (
    (contextId === "application-build" && recipes.length !== 1) ||
    (contextId === "terraform-validation" && recipes.length !== 0)
  ) {
    fail(
      "CONTEXT_RECIPE_INVALID",
      "recipes",
      "context recipe set differs from reviewed authority",
    );
  }
  const outputs = artifacts.flatMap((artifact) =>
    artifact.type === "https-file"
      ? [artifact]
      : artifact.members.filter((member) => member.destination !== undefined),
  );
  validateOrderedUnique(
    [...outputs].sort((left, right) =>
      comparePortable(left.destination, right.destination),
    ),
    "generatedOutputs",
    "destination",
  );
  return { artifacts, outputs, recipes };
}

async function readJson(path, displayPath, maximum = MAXIMUM_MANIFEST_BYTES) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    fail(
      "CONTEXT_FILE_TYPE_INVALID",
      displayPath,
      "expected one regular, unlinked file",
    );
  }
  if (metadata.size > maximum) {
    fail(
      "CONTEXT_FILE_TOO_LARGE",
      displayPath,
      "JSON exceeds reviewed size limit",
    );
  }
  const bytes = await readFile(path);
  if (bytes.includes(0))
    fail("CONTEXT_JSON_INVALID", displayPath, "JSON contains NUL bytes");
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch {
    fail("CONTEXT_JSON_INVALID", displayPath, "JSON cannot be parsed");
  }
}

async function safeWalk(root, { allowHardLinks = false } = {}) {
  const files = [];
  const directories = [];
  let entriesSeen = 0;
  async function walk(directory, portableDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => comparePortable(left.name, right.name));
    for (const entry of entries) {
      entriesSeen += 1;
      if (entriesSeen > MAXIMUM_FILES * 4) {
        fail(
          "CONTEXT_ENTRY_LIMIT",
          portableDirectory || ".",
          "context entry limit exceeded",
        );
      }
      const portable =
        portableDirectory === ""
          ? entry.name
          : `${portableDirectory}/${entry.name}`;
      portablePath(portable, portable);
      assertNoSensitivePath(portable, portable);
      const absolute = resolve(directory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        fail(
          "CONTEXT_LINK_FORBIDDEN",
          portable,
          "symbolic links and junctions are forbidden",
        );
      }
      if (metadata.isDirectory()) {
        directories.push(portable);
        await walk(absolute, portable);
      } else if (metadata.isFile()) {
        if (!allowHardLinks && metadata.nlink !== 1) {
          fail(
            "CONTEXT_HARD_LINK_FORBIDDEN",
            portable,
            "hard-linked files are forbidden",
          );
        }
        files.push({ absolute, metadata, path: portable });
        if (files.length > MAXIMUM_FILES) {
          fail("CONTEXT_FILE_LIMIT", portable, "context file limit exceeded");
        }
      } else {
        fail(
          "CONTEXT_SPECIAL_FILE_FORBIDDEN",
          portable,
          "special files are forbidden",
        );
      }
    }
  }
  await walk(root, "");
  return { directories, files };
}

async function normalizeGeneratedHardLinks(root, stagingRoot) {
  const walked = await safeWalk(root, { allowHardLinks: true });
  if (walked.files.every(({ metadata }) => metadata.nlink === 1)) return;
  const scratch = await mkdtemp(
    resolve(stagingRoot, "pnpm-hardlink-normalization-"),
  );
  try {
    let sequence = 0;
    for (const file of walked.files) {
      const before = await lstat(file.absolute);
      if (!before.isFile() || before.isSymbolicLink()) {
        fail(
          "CONTEXT_FILE_TYPE_INVALID",
          file.path,
          "generated store member changed type before normalization",
        );
      }
      if (before.nlink === 1) continue;
      const bytes = await readFile(file.absolute);
      const after = await lstat(file.absolute);
      if (
        !after.isFile() ||
        after.isSymbolicLink() ||
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs
      ) {
        fail(
          "CONTEXT_CHANGED_DURING_READ",
          file.path,
          "generated store member changed during hard-link normalization",
        );
      }
      const temporary = resolve(scratch, String(sequence));
      sequence += 1;
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await unlink(file.absolute);
      await rename(temporary, file.absolute);
      const normalized = await lstat(file.absolute);
      if (!normalized.isFile() || normalized.nlink !== 1) {
        fail(
          "CONTEXT_HARD_LINK_FORBIDDEN",
          file.path,
          "generated store hard link could not be normalized",
        );
      }
    }
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

async function removeGeneratedPnpmProjectRegistration(
  storeRoot,
  toolchainRoot,
) {
  const projectsRoot = resolve(storeRoot, "v11", "projects");
  const projectsMetadata = await lstat(projectsRoot).catch(() => undefined);
  if (
    projectsMetadata === undefined ||
    !projectsMetadata.isDirectory() ||
    projectsMetadata.isSymbolicLink()
  ) {
    fail(
      "CONTEXT_PNPM_STORE_LAYOUT_INVALID",
      "offline/pnpm-store/v11/projects",
      "pnpm 11 project registry must be one real directory",
    );
  }
  const registrations = await readdir(projectsRoot, { withFileTypes: true });
  if (
    registrations.length !== 1 ||
    !/^[0-9a-f]{32}$/u.test(registrations[0].name)
  ) {
    fail(
      "CONTEXT_PNPM_STORE_LAYOUT_INVALID",
      "offline/pnpm-store/v11/projects",
      "expected exactly one bounded pnpm project registration",
    );
  }
  const registration = resolve(projectsRoot, registrations[0].name);
  const registrationMetadata = await lstat(registration);
  if (!registrationMetadata.isSymbolicLink()) {
    fail(
      "CONTEXT_PNPM_STORE_LAYOUT_INVALID",
      "offline/pnpm-store/v11/projects/" + registrations[0].name,
      "pnpm project registration must be the reviewed generated link form",
    );
  }
  const [actualTarget, expectedTarget] = await Promise.all([
    realpath(registration).catch(() => undefined),
    realpath(toolchainRoot),
  ]);
  if (
    actualTarget === undefined ||
    relative(expectedTarget, actualTarget) !== ""
  ) {
    fail(
      "CONTEXT_PNPM_PROJECT_LINK_INVALID",
      "offline/pnpm-store/v11/projects/" + registrations[0].name,
      "pnpm project registration does not target the controlled toolchain",
    );
  }
  await unlink(registration);
  if ((await readdir(projectsRoot)).length !== 0) {
    fail(
      "CONTEXT_PNPM_STORE_LAYOUT_INVALID",
      "offline/pnpm-store/v11/projects",
      "pnpm project registry was not normalized to an empty directory",
    );
  }
}

async function inspectFile(file, member, { scanSecrets = true } = {}) {
  if (file.metadata.size !== member.sizeBytes) {
    fail(
      "CONTEXT_SIZE_DRIFT",
      member.path,
      "size differs from manifest authority",
    );
  }
  if (file.metadata.size > MAXIMUM_FILE_BYTES) {
    fail(
      "CONTEXT_FILE_TOO_LARGE",
      member.path,
      "file exceeds reviewed size limit",
    );
  }
  if (process.platform !== "win32") {
    const actualExecutable = (file.metadata.mode & 0o111) !== 0;
    if (actualExecutable && !member.executable) {
      fail(
        "CONTEXT_UNDECLARED_EXECUTABLE",
        member.path,
        "executable mode is not declared",
      );
    }
  }
  const bytes = await readFile(file.absolute);
  if (
    bytes.byteLength !== member.sizeBytes ||
    sha256(bytes) !== member.sha256
  ) {
    fail(
      "CONTEXT_CONTENT_DRIFT",
      member.path,
      "content differs from manifest authority",
    );
  }
  const after = await lstat(file.absolute);
  if (
    after.size !== file.metadata.size ||
    after.mtimeMs !== file.metadata.mtimeMs ||
    after.ino !== file.metadata.ino ||
    after.dev !== file.metadata.dev
  ) {
    fail(
      "CONTEXT_CHANGED_DURING_READ",
      member.path,
      "file changed while it was admitted",
    );
  }
  if (
    scanSecrets &&
    bytes.byteLength <= MAXIMUM_TEXT_SCAN_BYTES &&
    !bytes.includes(0)
  ) {
    const text = bytes.toString("utf8");
    const findings = findSecretPatterns(text, member.path, 1);
    if (findings.length > 0) {
      fail(
        "CONTEXT_SECRET_FOUND",
        member.path,
        `${findings[0].label} pattern is forbidden`,
      );
    }
    if (
      basename(member.path).toLowerCase() === ".npmrc" &&
      /(?:_authToken|_password|password|username)\s*=/iu.test(text)
    ) {
      fail(
        "CONTEXT_SECRET_CONFIG",
        member.path,
        "package-manager authentication fields are forbidden",
      );
    }
  }
  return bytes;
}

function assertDockerfile(
  contextId,
  dockerfile,
  declaredPaths,
  generatedPrefixes,
) {
  if (dockerfile.byteLength < 128) {
    fail(
      "CONTEXT_DOCKERFILE_PLACEHOLDER",
      "Dockerfile",
      "Dockerfile is too small to implement the reviewed boundary",
    );
  }
  const text = dockerfile.toString("utf8");
  const frontendAuthority = REVIEWED_DOCKERFILE_FRONTEND_AUTHORITIES[contextId];
  const frontendDirectives = text.match(/^#\s*syntax\s*=.*$/gimu) ?? [];
  const firstLine = text.split(/\r?\n/u, 1)[0];
  const frontendMatch = /^# syntax=(\S+)@(sha256:[0-9a-f]{64})$/u.exec(
    firstLine,
  );
  if (frontendDirectives.length !== 1 || frontendMatch === null) {
    fail(
      "CONTEXT_DOCKER_FRONTEND_UNPINNED",
      "Dockerfile:1",
      "Dockerfile must start with one digest-pinned syntax frontend directive",
    );
  }
  const expectedFrontend =
    frontendAuthority === undefined
      ? undefined
      : frontendAuthority.reference + "@" + frontendAuthority.imageDigest;
  if (
    expectedFrontend === undefined ||
    frontendMatch[1] + "@" + frontendMatch[2] !== expectedFrontend
  ) {
    fail(
      "CONTEXT_DOCKER_FRONTEND_DRIFT",
      "Dockerfile:1",
      "Dockerfile syntax frontend differs from the context-specific reviewed authority",
    );
  }
  const baseLines = text.match(/^[ \t]*FROM\s+.+$/gimu) ?? [];
  const actualBases = [];
  const stageAliases = new Set();
  if (/^[ \t]*FROM\s+--platform=/imu.test(text)) {
    fail(
      "CONTEXT_DOCKER_BASE_PLATFORM_REDUNDANT",
      "Dockerfile",
      "constant Dockerfile base platforms are forbidden; the reviewed context manifest and build invocation select linux/amd64",
    );
  }
  for (const line of baseLines) {
    const match =
      /^[ \t]*FROM\s+(\S+)@(sha256:[0-9a-f]{64})(?:\s+AS\s+([A-Za-z][A-Za-z0-9._-]*))?\s*$/iu.exec(
        line,
      );
    if (match === null) {
      fail(
        "CONTEXT_DOCKER_BASE_UNPINNED",
        "Dockerfile",
        "all base images must use a fixed reviewed digest",
      );
    }
    actualBases.push(`${match[1]}@${match[2]}`);
    if (match[3] !== undefined) {
      if (stageAliases.has(match[3])) {
        fail(
          "CONTEXT_DOCKER_STAGE_INVALID",
          "Dockerfile",
          "Dockerfile stage aliases must be unique",
        );
      }
      stageAliases.add(match[3]);
    }
  }
  const reviewedBases = REVIEWED_IMAGE_AUTHORITIES.map(
    ({ reference, imageDigest }) => `${reference}@${imageDigest}`,
  ).sort(comparePortable);
  actualBases.sort(comparePortable);
  if (JSON.stringify(actualBases) !== JSON.stringify(reviewedBases)) {
    fail(
      "CONTEXT_DOCKER_BASE_DRIFT",
      "Dockerfile",
      "Dockerfile base images differ from the complete reviewed authority set",
    );
  }
  if (
    !/^USER\s+(?!0(?:\D|$)|root(?:\s|$))\S+/imu.test(text) ||
    !/^ENTRYPOINT\s+/imu.test(text)
  ) {
    fail(
      "CONTEXT_DOCKER_RUNTIME_UNSAFE",
      "Dockerfile",
      "non-root USER and fixed ENTRYPOINT are required",
    );
  }
  if (
    /^[ \t]*ADD\s|\b(?:curl|wget)\b|git\s+clone|--mount(?:=|\s)/imu.test(text)
  ) {
    fail(
      "CONTEXT_DOCKER_NETWORK_OR_SECRET_INPUT",
      "Dockerfile",
      "remote ADD/download and all build mounts are forbidden",
    );
  }
  const logicalLines = text.replaceAll(/\\\r?\n/gu, " ").split(/\r?\n/gu);
  for (const [lineIndex, rawLine] of logicalLines.entries()) {
    const line = rawLine.trim();
    if (!/^COPY\s+/iu.test(line)) continue;
    let rest = line.replace(/^COPY\s+/iu, "");
    let fromStage;
    while (rest.startsWith("--")) {
      const option = /^--([a-z-]+)=(?:"([^"]+)"|'([^']+)'|(\S+))\s+/iu.exec(
        rest,
      );
      if (option === null) {
        fail(
          "CONTEXT_DOCKER_COPY_INVALID",
          `Dockerfile:${String(lineIndex + 1)}`,
          "COPY options must be fixed key/value arguments",
        );
      }
      if (option[1].toLowerCase() === "from") {
        if (fromStage !== undefined) {
          fail(
            "CONTEXT_DOCKER_COPY_INVALID",
            `Dockerfile:${String(lineIndex + 1)}`,
            "COPY can declare only one source stage",
          );
        }
        fromStage = option[2] ?? option[3] ?? option[4];
      }
      rest = rest.slice(option[0].length);
    }
    if (fromStage !== undefined && !stageAliases.has(fromStage)) {
      fail(
        "CONTEXT_DOCKER_COPY_EXTERNAL_STAGE",
        `Dockerfile:${String(lineIndex + 1)}`,
        "COPY --from must reference a declared digest-pinned internal stage alias",
      );
    }
    let tokens;
    if (rest.startsWith("[")) {
      try {
        tokens = JSON.parse(rest);
      } catch {
        fail(
          "CONTEXT_DOCKER_COPY_INVALID",
          `Dockerfile:${String(lineIndex + 1)}`,
          "JSON COPY is malformed",
        );
      }
    } else {
      tokens = rest.split(/\s+/u);
    }
    if (fromStage !== undefined) {
      for (const source of tokens.slice(0, -1)) {
        if (
          /[$*?[\]]/u.test(source) ||
          !source.startsWith("/") ||
          source.includes("\\") ||
          source.split("/").includes("..")
        ) {
          fail(
            "CONTEXT_DOCKER_COPY_INVALID",
            `Dockerfile:${String(lineIndex + 1)}`,
            "internal-stage COPY source must be a fixed absolute path",
          );
        }
      }
      continue;
    }
    if (
      !Array.isArray(tokens) ||
      tokens.length < 2 ||
      tokens.some((token) => typeof token !== "string")
    ) {
      fail(
        "CONTEXT_DOCKER_COPY_INVALID",
        `Dockerfile:${String(lineIndex + 1)}`,
        "COPY sources must be fixed strings",
      );
    }
    for (const source of tokens.slice(0, -1)) {
      if (
        /[$*?[\]]/u.test(source) ||
        source.startsWith("/") ||
        source.includes("\\") ||
        source.split("/").includes("..")
      ) {
        fail(
          "CONTEXT_DOCKER_COPY_INVALID",
          `Dockerfile:${String(lineIndex + 1)}`,
          "COPY source is not a fixed context path",
        );
      }
      const normalized = source.replace(/^\.\//u, "").replace(/\/$/u, "");
      if (
        normalized !== "." &&
        !declaredPaths.has(normalized) &&
        ![...declaredPaths].some((path) => path.startsWith(`${normalized}/`)) &&
        !generatedPrefixes.some((path) => normalized.startsWith(`${path}/`))
      ) {
        fail(
          "CONTEXT_DOCKER_COPY_UNDECLARED",
          `Dockerfile:${String(lineIndex + 1)}`,
          "COPY source is not declared by the context manifest",
        );
      }
    }
  }
  if (contextId === "application-build") {
    const normalizedText = text
      .replaceAll(/\\\r?\n/gu, " ")
      .replaceAll(/\s+/gu, " ");
    const exactApkInstall =
      /\/sbin\/apk add --no-network --no-cache --repositories-file \/dev\/null --no-scripts --upgrade \/opt\/cloudmarkup\/apk\/libcrypto3-3\.5\.9-r0\.apk \/opt\/cloudmarkup\/apk\/libssl3-3\.5\.9-r0\.apk(?:\s|&&)/u;
    const requiredFragments = [
      "sha256sum /opt/cloudmarkup/apk/libcrypto3-3.5.9-r0.apk",
      "6632d758d8f5e9ea3b650fe966f23bbf9a202f8b8dceecac93da135dec5e3689",
      "sha256sum /opt/cloudmarkup/apk/libssl3-3.5.9-r0.apk",
      "05e3393fb95aa5751ca2f9d242f659f6cff82c1cc7767cc2df4a086f7ad01877",
      '/sbin/apk info -e "libcrypto3=3.5.9-r0"',
      '/sbin/apk info -e "libssl3=3.5.9-r0"',
      "test ! -e /opt/cloudmarkup/apk",
      "test ! -e /opt/yarn-v1.22.22",
      "test ! -e /usr/local/lib/node_modules/npm",
      "test ! -e /usr/local/bin/docker-entrypoint.sh",
      "test ! -L /usr/local/bin/docker-entrypoint.sh",
      "test ! -e /usr/local/bin/npm",
      "test ! -L /usr/local/bin/npm",
      "test ! -e /usr/local/bin/npx",
      "test ! -L /usr/local/bin/npx",
      "test ! -e /usr/local/bin/yarn",
      "test ! -L /usr/local/bin/yarn",
      "test ! -e /usr/local/bin/yarnpkg",
      "test ! -L /usr/local/bin/yarnpkg",
      "chown -R 65532:65532 /opt/cloudmarkup",
      "find /opt/cloudmarkup -xdev -type d -exec chmod 0555 {} +",
      'test -z "$(find /opt/cloudmarkup -xdev -type d ! -perm 0555 -print -quit)"',
      'test "$(stat -c \'%a\' /opt/cloudmarkup)" = "555"',
      "Version: 0.74.0",
    ];
    if (
      !exactApkInstall.test(normalizedText) ||
      /--allow-untrusted|--repository(?:=|\s)|--update-cache/u.test(
        normalizedText,
      ) ||
      requiredFragments.some((fragment) => !normalizedText.includes(fragment))
    ) {
      fail(
        "CONTEXT_DOCKER_RUNTIME_HARDENING_DRIFT",
        "Dockerfile",
        "application image must verify and install only the exact signed offline APKs, remove inherited package managers and entrypoint, and prove their absence",
      );
    }
    const lastCopy = normalizedText.lastIndexOf("COPY ");
    const ownership = normalizedText.lastIndexOf(
      "chown -R 65532:65532 /opt/cloudmarkup",
    );
    const directoryModes = normalizedText.lastIndexOf(
      "find /opt/cloudmarkup -xdev -type d -exec chmod 0555 {} +",
    );
    if (!(lastCopy < ownership && ownership < directoryModes)) {
      fail(
        "CONTEXT_DOCKER_RUNTIME_HARDENING_DRIFT",
        "Dockerfile",
        "application runtime directory modes must be finalized after all copies and ownership changes",
      );
    }
  }
}

function assertEntrypoint(bytes, path) {
  const text = bytes.toString("utf8");
  if (
    /\bplaceholder\b|\bTODO\b|echo\s+["']?(?:ok|pass|success)["']?\s*(?:\r?\n|;|$)/iu.test(
      text,
    )
  ) {
    fail(
      "CONTEXT_ENTRYPOINT_PLACEHOLDER",
      path,
      "placeholder success behavior is forbidden",
    );
  }
  if (bytes.byteLength < 256) {
    const isStrictFixedShellShim =
      /^#!\/bin\/sh\r?\n/u.test(text) &&
      /^set -eu\s*$/mu.test(text) &&
      /^exec \/usr\/local\/bin\/node \/opt\/cloudmarkup\/service\/[a-z0-9-]+\.mjs\s*$/mu.test(
        text,
      ) &&
      !/\$\{|`|eval\b|(?:curl|wget|nc)\b/iu.test(text);
    if (!isStrictFixedShellShim) {
      fail(
        "CONTEXT_ENTRYPOINT_PLACEHOLDER",
        path,
        "small entrypoints must be strict fixed shell shims to a reviewed service module",
      );
    }
  }
}

function memberAuthority(byPath, path, label) {
  const member = byPath.get(path);
  if (member === undefined)
    fail("CONTEXT_BINDING_MISSING", label, `member ${path} is absent`);
  return member;
}

function equalFileAuthority(authority, member, path) {
  if (
    authority.path !== member.path ||
    authority.sha256 !== member.sha256 ||
    authority.sizeBytes !== member.sizeBytes
  ) {
    fail(
      "CONTEXT_BINDING_DRIFT",
      path,
      "binding differs from member authority",
    );
  }
}

async function validateApplicationBindings({
  manifest,
  byPath,
  generatedPrefixes,
  recipe,
  root,
  repositoryRoot,
}) {
  validateVersionMap(
    manifest.toolchain,
    [
      "awsSdkClientDynamodb",
      "eslint",
      "node",
      "pnpm",
      "trivy",
      "typescript",
      "typescriptEslint",
      "vite",
      "vitest",
    ],
    [
      "awsSdkClientDynamodb",
      "eslint",
      "node",
      "pnpm",
      "trivy",
      "typescript",
      "typescriptEslint",
      "vite",
      "vitest",
    ],
    "toolchain",
  );
  if (
    manifest.toolchain.node !== "24.18.0" ||
    manifest.toolchain.pnpm !== "11.16.0" ||
    manifest.toolchain.typescript !== "6.0.3" ||
    manifest.toolchain.vitest !== "4.1.10" ||
    manifest.toolchain.eslint !== "9.39.5" ||
    manifest.toolchain.typescriptEslint !== "8.65.0" ||
    manifest.toolchain.vite !== "8.1.5" ||
    manifest.toolchain.trivy !== "0.74.0" ||
    manifest.toolchain.awsSdkClientDynamodb !== "3.1101.0"
  ) {
    fail(
      "CONTEXT_TOOLCHAIN_DRIFT",
      "toolchain",
      "application tool pins differ from repository authority",
    );
  }
  const reviewedGeneratedPrefixes = [
    { path: "offline/apk", role: "verified-runtime-package" },
    { path: "offline/bin", role: "verified-tool-binaries" },
    { path: "offline/licenses", role: "verified-tool-licenses" },
    { path: "offline/pnpm-store", role: "offline-package-byte" },
    { path: "offline/toolchain", role: "offline-toolchain" },
    { path: "offline/trivy-cache", role: "trivy-database" },
  ];
  if (
    JSON.stringify(generatedPrefixes) !==
    JSON.stringify(reviewedGeneratedPrefixes)
  ) {
    fail(
      "CONTEXT_GENERATED_PREFIX_INVALID",
      "generatedPrefixes",
      "application generated prefixes differ from the reviewed exact boundary",
    );
  }
  exactKeys(
    manifest.bindings,
    [
      "nodeBaseImage",
      "offlineStore",
      "repositoryLockfile",
      "toolchainLockfile",
      "trivyDatabase",
      "trivyBinary",
    ],
    "bindings",
  );
  exactKeys(
    manifest.bindings.nodeBaseImage,
    ["imageDigest", "indexDigest", "reference"],
    "bindings.nodeBaseImage",
  );
  exactKeys(
    manifest.bindings.trivyBinary,
    ["path", "sha256", "sizeBytes"],
    "bindings.trivyBinary",
  );
  exactKeys(
    manifest.bindings.trivyDatabase,
    ["layerDigest", "layerSizeBytes", "manifestDigest"],
    "bindings.trivyDatabase",
  );
  if (
    manifest.bindings.nodeBaseImage.reference !== "node:24.18.0-alpine3.24" ||
    manifest.bindings.nodeBaseImage.indexDigest !==
      "sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd" ||
    manifest.bindings.nodeBaseImage.imageDigest !==
      "sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc" ||
    manifest.bindings.trivyBinary.path !== "offline/bin/trivy" ||
    manifest.bindings.trivyBinary.sha256 !==
      "2f78848b474c6f0b27d0df1833ae8fc7d297640344c6d5c7a25f63cc9e22d3dc" ||
    manifest.bindings.trivyBinary.sizeBytes !== 168288382 ||
    manifest.bindings.trivyDatabase.manifestDigest !==
      "sha256:98e1c199793bfcbe64fa41538fa3cf2c55650689a7920075bbba6165404a44d0" ||
    manifest.bindings.trivyDatabase.layerDigest !==
      "sha256:1edf7a495c6d68e691fb710b63926e4f1a3dbffa392fd8057cd10bdfd8c3eef5" ||
    manifest.bindings.trivyDatabase.layerSizeBytes !== 117_915_639
  ) {
    fail(
      "CONTEXT_IMAGE_AUTHORITY_DRIFT",
      "bindings",
      "application base image or Trivy authority differs from reviewed pins",
    );
  }
  const repositoryLock = parseFileAuthority(
    manifest.bindings.repositoryLockfile,
    "bindings.repositoryLockfile",
    { exactPath: "../../../pnpm-lock.yaml" },
  );
  if (repositoryLock.path !== "../../../pnpm-lock.yaml") {
    fail(
      "CONTEXT_LOCK_PATH_INVALID",
      "bindings.repositoryLockfile.path",
      "only the root pnpm lock is authoritative",
    );
  }
  const lockPath = resolve(root, ...repositoryLock.path.split("/"));
  if (lockPath !== resolve(repositoryRoot, "pnpm-lock.yaml")) {
    fail(
      "CONTEXT_LOCK_PATH_INVALID",
      "bindings.repositoryLockfile.path",
      "lock path escapes its exact authority",
    );
  }
  const lockMetadata = await lstat(lockPath);
  const lockBytes = await readFile(lockPath);
  if (
    !lockMetadata.isFile() ||
    lockMetadata.isSymbolicLink() ||
    lockMetadata.nlink !== 1 ||
    lockBytes.byteLength !== repositoryLock.sizeBytes ||
    sha256(lockBytes) !== repositoryLock.sha256
  ) {
    fail(
      "CONTEXT_LOCK_DRIFT",
      "pnpm-lock.yaml",
      "repository lock differs from bound authority",
    );
  }
  const toolchainLock = parseFileAuthority(
    manifest.bindings.toolchainLockfile,
    "bindings.toolchainLockfile",
  );
  if (toolchainLock.path !== "offline/toolchain/pnpm-lock.yaml") {
    fail(
      "CONTEXT_LOCK_PATH_INVALID",
      "bindings.toolchainLockfile.path",
      "standalone toolchain lock path is invalid",
    );
  }
  if (
    toolchainLock.sha256 !==
      "c91be04f804ccb3e4aaafc5c9ce7d756c608fff1c95be482e1bfdf66cd2dba37" ||
    toolchainLock.sizeBytes !== 67_537
  ) {
    fail(
      "CONTEXT_OFFLINE_LOCK_DRIFT",
      "bindings.toolchainLockfile",
      "toolchain lock differs from the reviewed dependency authority",
    );
  }
  equalFileAuthority(
    toolchainLock,
    memberAuthority(byPath, toolchainLock.path, "bindings.toolchainLockfile"),
    "bindings.toolchainLockfile",
  );
  const toolchainPackagePath = "offline/toolchain/package.json";
  const { value: toolchainPackage } = await readJson(
    resolve(root, ...toolchainPackagePath.split("/")),
    toolchainPackagePath,
  );
  exactKeys(
    toolchainPackage,
    ["dependencies", "name", "packageManager", "private", "type", "version"],
    toolchainPackagePath,
  );
  exactKeys(
    toolchainPackage.dependencies,
    [
      "@aws-sdk/client-dynamodb",
      "@eslint/js",
      "@types/node",
      "eslint",
      "typescript",
      "typescript-eslint",
      "vite",
      "vitest",
    ],
    `${toolchainPackagePath}.dependencies`,
  );
  if (
    toolchainPackage.name !==
      "@cloudmarkup/application-build-image-toolchain" ||
    toolchainPackage.version !== "1.0.0" ||
    toolchainPackage.private !== true ||
    toolchainPackage.type !== "module" ||
    toolchainPackage.packageManager !== "pnpm@11.16.0" ||
    toolchainPackage.dependencies["@aws-sdk/client-dynamodb"] !==
      manifest.toolchain.awsSdkClientDynamodb ||
    toolchainPackage.dependencies["@eslint/js"] !== manifest.toolchain.eslint ||
    toolchainPackage.dependencies["@types/node"] !== "24.13.3" ||
    toolchainPackage.dependencies.eslint !== manifest.toolchain.eslint ||
    toolchainPackage.dependencies.typescript !==
      manifest.toolchain.typescript ||
    toolchainPackage.dependencies["typescript-eslint"] !==
      manifest.toolchain.typescriptEslint ||
    toolchainPackage.dependencies.vite !== manifest.toolchain.vite ||
    toolchainPackage.dependencies.vitest !== manifest.toolchain.vitest
  ) {
    fail(
      "CONTEXT_TOOLCHAIN_DRIFT",
      toolchainPackagePath,
      "toolchain package differs from the exact manifest tool pins",
    );
  }
  exactKeys(
    manifest.bindings.offlineStore,
    ["manifest", "network", "path"],
    "bindings.offlineStore",
  );
  if (
    manifest.bindings.offlineStore.path !== "offline/pnpm-store" ||
    manifest.bindings.offlineStore.manifest !==
      "offline/pnpm-store/manifest-v1.json" ||
    manifest.bindings.offlineStore.network !== "deny"
  ) {
    fail(
      "CONTEXT_OFFLINE_BINDING_INVALID",
      "bindings.offlineStore",
      "offline store boundary differs from reviewed authority",
    );
  }
  const storeManifestPath = manifest.bindings.offlineStore.manifest;
  const storeMember = byPath.get(storeManifestPath);
  if (storeMember === undefined) {
    if (!generatedPrefixes.some(({ path }) => path === "offline/pnpm-store")) {
      fail(
        "CONTEXT_OFFLINE_BINDING_INVALID",
        "generatedPrefixes",
        "pnpm store generation prefix is not declared",
      );
    }
    return { repositoryLock, storeMember: undefined, toolchainLock };
  }
  const { value: store } = await readJson(
    resolve(root, ...storeManifestPath.split("/")),
    storeManifestPath,
    MAXIMUM_GENERATED_MANIFEST_BYTES,
  );
  exactKeys(
    store,
    [
      "files",
      "kind",
      "lifecycleScripts",
      "network",
      "packageManager",
      "schemaVersion",
      "sourceLockfile",
      "storeIndex",
      "storeVersion",
      "target",
      "workspaceConfiguration",
    ],
    storeManifestPath,
  );
  if (
    store.schemaVersion !== 1 ||
    store.kind !== "cloudmarkup.pnpm-offline-store" ||
    store.storeVersion !== PNPM_STORE_VERSION ||
    store.network !== "deny" ||
    store.lifecycleScripts !== "deny"
  ) {
    fail(
      "CONTEXT_OFFLINE_STORE_INVALID",
      storeManifestPath,
      "offline store identity or policy is invalid",
    );
  }
  exactKeys(
    store.packageManager,
    [
      "implementation",
      "launchers",
      "name",
      "packageMetadata",
      "version",
      "worker",
    ],
    `${storeManifestPath}.packageManager`,
  );
  exactKeys(
    store.packageManager.implementation,
    ["path", "sha256", "sizeBytes"],
    storeManifestPath + ".packageManager.implementation",
  );
  exactKeys(
    store.packageManager.packageMetadata,
    ["path", "sha256", "sizeBytes"],
    storeManifestPath + ".packageManager.packageMetadata",
  );
  exactKeys(
    store.packageManager.worker,
    ["path", "sha256", "sizeBytes"],
    storeManifestPath + ".packageManager.worker",
  );
  if (
    !Array.isArray(store.packageManager.launchers) ||
    store.packageManager.launchers.length !==
      PNPM_HOST_AUTHORITY.launchers.length
  ) {
    fail(
      "CONTEXT_OFFLINE_STORE_INVALID",
      storeManifestPath + ".packageManager.launchers",
      "pnpm launcher authority set differs",
    );
  }
  for (const [index, launcher] of store.packageManager.launchers.entries()) {
    exactKeys(
      launcher,
      ["path", "sha256", "sizeBytes"],
      storeManifestPath + ".packageManager.launchers[" + String(index) + "]",
    );
  }
  if (
    store.packageManager.name !== "pnpm" ||
    store.packageManager.version !== manifest.toolchain.pnpm ||
    JSON.stringify(store.packageManager.implementation) !==
      JSON.stringify(PNPM_HOST_AUTHORITY.implementation) ||
    JSON.stringify(store.packageManager.launchers) !==
      JSON.stringify(PNPM_HOST_AUTHORITY.launchers) ||
    JSON.stringify(store.packageManager.packageMetadata) !==
      JSON.stringify(PNPM_HOST_AUTHORITY.packageMetadata) ||
    JSON.stringify(store.packageManager.worker) !==
      JSON.stringify(PNPM_HOST_AUTHORITY.worker)
  ) {
    fail(
      "CONTEXT_OFFLINE_STORE_INVALID",
      `${storeManifestPath}.packageManager`,
      "pnpm pin differs from toolchain",
    );
  }
  exactKeys(store.target, ["cpu", "libc", "os"], storeManifestPath + ".target");
  exactKeys(
    store.workspaceConfiguration,
    ["path", "sha256", "sizeBytes"],
    storeManifestPath + ".workspaceConfiguration",
  );
  if (
    store.target.os !== PNPM_TARGET.os ||
    store.target.cpu !== PNPM_TARGET.cpu ||
    store.target.libc !== PNPM_TARGET.libc ||
    store.target.os !== recipe.target.os ||
    store.target.cpu !== recipe.target.cpu ||
    store.target.libc !== recipe.target.libc ||
    store.workspaceConfiguration.path !== recipe.workspaceConfiguration.path ||
    store.workspaceConfiguration.sha256 !==
      recipe.workspaceConfiguration.sha256 ||
    store.workspaceConfiguration.sizeBytes !==
      recipe.workspaceConfiguration.sizeBytes ||
    store.workspaceConfiguration.sha256 !==
      sha256(PNPM_WORKSPACE_CONFIGURATION_BYTES) ||
    store.workspaceConfiguration.sizeBytes !==
      PNPM_WORKSPACE_CONFIGURATION_BYTES.byteLength
  ) {
    fail(
      "CONTEXT_PNPM_TARGET_DRIFT",
      storeManifestPath,
      "offline store target or workspace configuration differs from source authority",
    );
  }
  exactKeys(
    store.sourceLockfile,
    ["path", "sha256", "sizeBytes"],
    `${storeManifestPath}.sourceLockfile`,
  );
  if (
    store.sourceLockfile.path !== toolchainLock.path ||
    store.sourceLockfile.sha256 !== toolchainLock.sha256 ||
    store.sourceLockfile.sizeBytes !== toolchainLock.sizeBytes
  ) {
    fail(
      "CONTEXT_OFFLINE_LOCK_DRIFT",
      `${storeManifestPath}.sourceLockfile`,
      "offline store does not bind the root lock",
    );
  }
  exactKeys(
    store.storeIndex,
    ["entryCount", "path", "sha256", "sizeBytes"],
    `${storeManifestPath}.storeIndex`,
  );
  const storeIndex = parseFileAuthority(
    {
      path: store.storeIndex.path,
      sha256: store.storeIndex.sha256,
      sizeBytes: store.storeIndex.sizeBytes,
    },
    `${storeManifestPath}.storeIndex`,
  );
  if (
    !Number.isSafeInteger(store.storeIndex.entryCount) ||
    store.storeIndex.entryCount <= 0 ||
    store.storeIndex.entryCount > MAXIMUM_FILES ||
    storeIndex.path !== CANONICAL_PNPM_STORE_INDEX_PATH
  ) {
    fail(
      "CONTEXT_PNPM_STORE_INDEX_INVALID",
      `${storeManifestPath}.storeIndex`,
      "canonical package index authority is invalid or unbounded",
    );
  }
  if (!Array.isArray(store.files) || store.files.length === 0) {
    fail(
      "CONTEXT_OFFLINE_STORE_EMPTY",
      storeManifestPath,
      "offline store must declare real package bytes",
    );
  }
  const offlineFiles = store.files.map((file, index) => {
    const path = `${storeManifestPath}.files[${String(index)}]`;
    const parsed = parseFileAuthority(file, path);
    if (parsed.path === "manifest-v1.json") {
      fail(
        "CONTEXT_OFFLINE_STORE_INVALID",
        path,
        "offline manifest cannot hash itself",
      );
    }
    if (parsed.path === PNPM_STORE_INDEX_DATABASE_PATH) {
      fail(
        "CONTEXT_PNPM_STORE_INDEX_INVALID",
        path,
        "host-specific SQLite bytes cannot be context authority",
      );
    }
    return parsed;
  });
  validateOrderedUnique(offlineFiles, `${storeManifestPath}.files`);
  const indexedStoreFile = offlineFiles.find(
    ({ path }) => path === CANONICAL_PNPM_STORE_INDEX_PATH,
  );
  if (
    indexedStoreFile === undefined ||
    indexedStoreFile.sha256 !== storeIndex.sha256 ||
    indexedStoreFile.sizeBytes !== storeIndex.sizeBytes
  ) {
    fail(
      "CONTEXT_PNPM_STORE_INDEX_INVALID",
      `${storeManifestPath}.storeIndex`,
      "canonical package index differs from the declared store member",
    );
  }
  const expectedOfflinePaths = new Set();
  for (const file of offlineFiles) {
    const contextPath = `offline/pnpm-store/${file.path}`;
    const member = memberAuthority(
      byPath,
      contextPath,
      `${storeManifestPath}.files`,
    );
    equalFileAuthority(
      { ...file, path: contextPath },
      member,
      `${storeManifestPath}.files.${file.path}`,
    );
    expectedOfflinePaths.add(contextPath);
  }
  for (const member of byPath.values()) {
    if (
      member.path.startsWith("offline/pnpm-store/") &&
      member.path !== storeManifestPath &&
      !expectedOfflinePaths.has(member.path)
    ) {
      fail(
        "CONTEXT_OFFLINE_MEMBER_UNDECLARED",
        member.path,
        "offline store member is absent from its index",
      );
    }
  }
  return { repositoryLock, storeMember, toolchainLock };
}

async function validateTerraformBindings({
  manifest,
  byPath,
  generatedOutputByDestination,
  root,
}) {
  exactKeys(
    manifest.tools,
    ["node", "provider", "terraform", "tflint", "trivy"],
    "tools",
  );
  exactKeys(
    manifest.tools.node,
    ["baseImage", "imageDigest", "indexDigest", "version"],
    "tools.node",
  );
  exactKeys(manifest.tools.terraform, ["version"], "tools.terraform");
  exactKeys(manifest.tools.tflint, ["version"], "tools.tflint");
  exactKeys(manifest.tools.trivy, ["binarySha256", "version"], "tools.trivy");
  exactKeys(
    manifest.tools.provider,
    ["platform", "source", "version"],
    "tools.provider",
  );
  if (
    manifest.tools.node.version !== "24.18.0" ||
    manifest.tools.node.baseImage !== "node:24.18.0-alpine3.24" ||
    manifest.tools.node.indexDigest !==
      "sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd" ||
    manifest.tools.node.imageDigest !==
      "sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc" ||
    manifest.tools.terraform.version !== "1.16.2" ||
    manifest.tools.tflint.version !== "0.64.0" ||
    manifest.tools.trivy.version !== "0.74.0" ||
    manifest.tools.trivy.binarySha256 !==
      "2f78848b474c6f0b27d0df1833ae8fc7d297640344c6d5c7a25f63cc9e22d3dc" ||
    manifest.tools.provider.source !== "registry.terraform.io/hashicorp/aws" ||
    manifest.tools.provider.version !== "6.63.0" ||
    manifest.tools.provider.platform !== "linux_amd64"
  ) {
    fail(
      "CONTEXT_TOOLCHAIN_DRIFT",
      "tools",
      "Terraform validation tool pins differ from reviewed authority",
    );
  }
  const dockerfileText = await readFile(resolve(root, "Dockerfile"), "utf8");
  const apkInstallLines = dockerfileText
    .replaceAll(/\\\r?\n/gu, " ")
    .split(/\r?\n/gu)
    .map((line) => line.trim().replaceAll(/\s+/gu, " "))
    .filter((line) => /(?:^|\s)(?:\S*\/)?apk add(?:\s|$)/u.test(line));
  const apkAddCommandCount = apkInstallLines.reduce(
    (count, line) =>
      count +
      (line.match(/(?:^|[\s;&|])(?:\S*\/)?apk add(?=\s)/gu)?.length ?? 0),
    0,
  );
  const exactApkInstall =
    /^RUN \/sbin\/apk add --no-network --no-cache --repositories-file \/dev\/null --no-scripts --upgrade \/tmp\/cloudmarkup-apk\/libcrypto3-3\.5\.9-r0\.apk \/tmp\/cloudmarkup-apk\/libssl3-3\.5\.9-r0\.apk(?=\s+&&)/u;
  const requiredRuntimeFragments = [
    "COPY --chmod=0444 offline/apk/libcrypto3-3.5.9-r0.apk /tmp/cloudmarkup-apk/libcrypto3-3.5.9-r0.apk",
    "COPY --chmod=0444 offline/apk/libssl3-3.5.9-r0.apk /tmp/cloudmarkup-apk/libssl3-3.5.9-r0.apk",
    '/sbin/apk info -e "libcrypto3=3.5.9-r0"',
    '/sbin/apk info -e "libssl3=3.5.9-r0"',
    "rm -rf /usr/local/lib/node_modules/npm",
    "rm -rf /opt/yarn-v1.22.22",
    "rm -f /usr/local/bin/docker-entrypoint.sh",
    "test ! -e /usr/local/bin/npm",
    "test ! -e /usr/local/bin/npx",
    "test ! -e /usr/local/bin/yarn",
    "test ! -e /usr/local/bin/yarnpkg",
    "test ! -e /usr/local/bin/docker-entrypoint.sh",
    "find /opt/cloudmarkup -xdev -type d -exec chmod 0555 {} +",
    'test -z "$(find /opt/cloudmarkup -xdev -type d ! -perm 0555 -print -quit)"',
    'test "$(stat -c \'%a\' /opt/cloudmarkup)" = "555"',
  ];
  if (
    apkInstallLines.length !== 1 ||
    apkAddCommandCount !== 1 ||
    !exactApkInstall.test(apkInstallLines[0] ?? "") ||
    /--allow-untrusted|--repository(?:=|\s)|--update-cache/u.test(
      dockerfileText,
    ) ||
    requiredRuntimeFragments.some(
      (fragment) => !dockerfileText.includes(fragment),
    ) ||
    dockerfileText.lastIndexOf("COPY ") >
      dockerfileText.lastIndexOf(
        "find /opt/cloudmarkup -xdev -type d -exec chmod 0555 {} +",
      )
  ) {
    fail(
      "CONTEXT_DOCKER_RUNTIME_UNSAFE",
      "Dockerfile",
      "Terraform runtime package and package-manager hardening differs from reviewed authority",
    );
  }
  exactKeys(
    manifest.offlineInputs,
    [
      "acquisition",
      "providerLock",
      "providerMirror",
      "terraformCliConfig",
      "trivyDatabase",
    ],
    "offlineInputs",
  );
  const acquisition = parseFileAuthority(
    manifest.offlineInputs.acquisition,
    "offlineInputs.acquisition",
  );
  if (acquisition.path !== ACQUISITION_NAME) {
    fail(
      "CONTEXT_ACQUISITION_DRIFT",
      "offlineInputs.acquisition",
      "acquisition binding path is invalid",
    );
  }
  equalFileAuthority(
    acquisition,
    memberAuthority(byPath, acquisition.path, "offlineInputs.acquisition"),
    "offlineInputs.acquisition",
  );
  const providerLock = parseFileAuthority(
    manifest.offlineInputs.providerLock,
    "offlineInputs.providerLock",
  );
  if (providerLock.path !== "offline/.terraform.lock.hcl") {
    fail(
      "CONTEXT_LOCK_PATH_INVALID",
      "offlineInputs.providerLock.path",
      "provider lock path is invalid",
    );
  }
  if (
    providerLock.sha256 !==
      "01cb33612cba1305153a125d0a8f099b7d1b5a1642d1236c388883f82e7514ea" ||
    providerLock.sizeBytes !== 410
  ) {
    fail(
      "CONTEXT_PROVIDER_LOCK_DRIFT",
      "offlineInputs.providerLock",
      "provider lock differs from the reviewed offline authority",
    );
  }
  equalFileAuthority(
    providerLock,
    memberAuthority(byPath, providerLock.path, "offlineInputs.providerLock"),
    "offlineInputs.providerLock",
  );
  const terraformCliConfig = parseFileAuthority(
    manifest.offlineInputs.terraformCliConfig,
    "offlineInputs.terraformCliConfig",
  );
  if (terraformCliConfig.path !== "offline/terraform.rc") {
    fail(
      "CONTEXT_TERRAFORM_CONFIG_INVALID",
      terraformCliConfig.path,
      "Terraform CLI config path differs from reviewed authority",
    );
  }
  if (
    terraformCliConfig.sha256 !==
      "030170e12086e5587775f589eae9eb45027df55d8e6b088e0623340484d2682a" ||
    terraformCliConfig.sizeBytes !== 182
  ) {
    fail(
      "CONTEXT_TERRAFORM_CONFIG_INVALID",
      terraformCliConfig.path,
      "Terraform CLI config differs from the reviewed offline-only authority",
    );
  }
  equalFileAuthority(
    terraformCliConfig,
    memberAuthority(
      byPath,
      terraformCliConfig.path,
      "offlineInputs.terraformCliConfig",
    ),
    "offlineInputs.terraformCliConfig",
  );
  exactKeys(
    manifest.offlineInputs.trivyDatabase,
    ["layerDigest", "layerSizeBytes", "manifestDigest"],
    "offlineInputs.trivyDatabase",
  );
  if (
    manifest.offlineInputs.trivyDatabase.manifestDigest !==
      "sha256:98e1c199793bfcbe64fa41538fa3cf2c55650689a7920075bbba6165404a44d0" ||
    manifest.offlineInputs.trivyDatabase.layerDigest !==
      "sha256:1edf7a495c6d68e691fb710b63926e4f1a3dbffa392fd8057cd10bdfd8c3eef5" ||
    manifest.offlineInputs.trivyDatabase.layerSizeBytes !== 117_915_639
  ) {
    fail(
      "CONTEXT_OCI_AUTHORITY_INVALID",
      "offlineInputs.trivyDatabase",
      "Trivy database binding differs from reviewed OCI authority",
    );
  }
  exactKeys(
    manifest.offlineInputs.providerMirror,
    ["indexPath", "indexSha256"],
    "offlineInputs.providerMirror",
  );
  const indexPath = portablePath(
    manifest.offlineInputs.providerMirror.indexPath,
    "offlineInputs.providerMirror.indexPath",
  );
  const indexSha = string(
    manifest.offlineInputs.providerMirror.indexSha256,
    "offlineInputs.providerMirror.indexSha256",
    SHA256_PATTERN,
  );
  if (indexPath !== "offline/provider-mirror/index-v1.json") {
    fail(
      "CONTEXT_PROVIDER_MIRROR_INVALID",
      indexPath,
      "provider mirror index path is invalid",
    );
  }
  const indexMember = memberAuthority(
    byPath,
    indexPath,
    "offlineInputs.providerMirror.indexPath",
  );
  if (indexMember.sha256 !== indexSha) {
    fail(
      "CONTEXT_PROVIDER_MIRROR_DRIFT",
      indexPath,
      "mirror index digest differs from member authority",
    );
  }
  if (
    indexSha !==
      "21b5d76c0a3a633011fe8b91f14317768c31d85116cccd0ec2e6cc5206b2d0a7" ||
    indexMember.sizeBytes !== 846
  ) {
    fail(
      "CONTEXT_PROVIDER_MIRROR_DRIFT",
      indexPath,
      "mirror index differs from the reviewed provider authority",
    );
  }
  const { value: index } = await readJson(
    resolve(root, ...indexPath.split("/")),
    indexPath,
  );
  exactKeys(
    index,
    [
      "contextId",
      "kind",
      "lock",
      "providers",
      "schemaVersion",
      "terraformVersion",
    ],
    indexPath,
  );
  if (
    index.schemaVersion !== 1 ||
    index.kind !== "cloudmarkup.terraform-provider-mirror" ||
    index.contextId !== "terraform-validation" ||
    index.terraformVersion !== manifest.tools.terraform.version ||
    !Array.isArray(index.providers) ||
    index.providers.length === 0
  ) {
    fail(
      "CONTEXT_PROVIDER_MIRROR_INVALID",
      indexPath,
      "provider mirror identity or entries are invalid",
    );
  }
  exactKeys(index.lock, ["path", "sha256", "sizeBytes"], `${indexPath}.lock`);
  if (
    index.lock.path !== providerLock.path ||
    index.lock.sha256 !== providerLock.sha256 ||
    index.lock.sizeBytes !== providerLock.sizeBytes
  ) {
    fail(
      "CONTEXT_PROVIDER_LOCK_DRIFT",
      `${indexPath}.lock`,
      "mirror index does not bind provider lock",
    );
  }
  const lockBytes = await readFile(
    resolve(root, ...providerLock.path.split("/")),
  );
  const lockText = lockBytes.toString("utf8");
  const mirrorPaths = new Set();
  let previous = "";
  for (const [entryIndex, provider] of index.providers.entries()) {
    const path = `${indexPath}.providers[${String(entryIndex)}]`;
    exactKeys(
      provider,
      [
        "lockHashes",
        "packagePath",
        "platform",
        "sha256",
        "sizeBytes",
        "source",
        "version",
      ],
      path,
    );
    if (
      provider.source !== "registry.terraform.io/hashicorp/aws" ||
      provider.version !== manifest.tools.provider.version ||
      provider.platform !== "linux_amd64"
    ) {
      fail(
        "CONTEXT_PROVIDER_MIRROR_INVALID",
        path,
        "provider identity/version/platform is not approved",
      );
    }
    const packagePath = portablePath(
      provider.packagePath,
      `${path}.packagePath`,
    );
    if (
      comparePortable(previous, packagePath) >= 0 ||
      mirrorPaths.has(packagePath)
    ) {
      fail(
        "CONTEXT_OFFLINE_ORDER_INVALID",
        path,
        "providers must be strictly sorted and unique",
      );
    }
    previous = packagePath;
    mirrorPaths.add(packagePath);
    string(provider.sha256, `${path}.sha256`, SHA256_PATTERN);
    integer(provider.sizeBytes, `${path}.sizeBytes`, MAXIMUM_FILE_BYTES);
    if (!Array.isArray(provider.lockHashes) || provider.lockHashes.length < 1) {
      fail(
        "CONTEXT_PROVIDER_LOCK_DRIFT",
        `${path}.lockHashes`,
        "provider lock hashes are incomplete",
      );
    }
    const sortedHashes = [...provider.lockHashes].sort(comparePortable);
    if (
      JSON.stringify(sortedHashes) !== JSON.stringify(provider.lockHashes) ||
      new Set(provider.lockHashes).size !== provider.lockHashes.length
    ) {
      fail(
        "CONTEXT_OFFLINE_ORDER_INVALID",
        `${path}.lockHashes`,
        "lock hashes must be sorted and unique",
      );
    }
    const reviewedLockHashes = [
      "h1:9cre7jh1lSs/9igpgAcENMUAUlYW3HCtkav3up4oit0=",
      `zh:${provider.sha256}`,
    ];
    if (
      JSON.stringify(provider.lockHashes) !== JSON.stringify(reviewedLockHashes)
    ) {
      fail(
        "CONTEXT_PROVIDER_LOCK_DRIFT",
        `${path}.lockHashes`,
        "provider lock hashes differ from the exact reviewed authority",
      );
    }
    for (const [hashIndex, hash] of provider.lockHashes.entries()) {
      string(
        hash,
        `${path}.lockHashes[${String(hashIndex)}]`,
        /^(?:h1:[A-Za-z0-9+/]{43}=|zh:[0-9a-f]{64})$/u,
      );
      if (!lockText.includes(`"${hash}"`)) {
        fail(
          "CONTEXT_PROVIDER_LOCK_DRIFT",
          `${path}.lockHashes[${String(hashIndex)}]`,
          "provider hash is absent from lock file",
        );
      }
    }
    if (!provider.lockHashes.includes(`zh:${provider.sha256}`)) {
      fail(
        "CONTEXT_PROVIDER_CHECKSUM_DRIFT",
        path,
        "provider package SHA is not bound by a zh lock hash",
      );
    }
    if (
      !lockText.includes(`provider "${provider.source}"`) ||
      !lockText.includes(`version     = "${provider.version}"`)
    ) {
      fail(
        "CONTEXT_PROVIDER_LOCK_DRIFT",
        providerLock.path,
        "provider source/version is absent from lock file",
      );
    }
    const contextPath = `offline/provider-mirror/${packagePath}`;
    const member =
      byPath.get(contextPath) ?? generatedOutputByDestination.get(contextPath);
    if (
      member === undefined ||
      member.sha256 !== provider.sha256 ||
      member.sizeBytes !== provider.sizeBytes ||
      member.executable
    ) {
      fail(
        "CONTEXT_PROVIDER_CHECKSUM_DRIFT",
        contextPath,
        "provider package differs from mirror authority",
      );
    }
  }
  for (const member of byPath.values()) {
    if (
      member.path.startsWith("offline/provider-mirror/") &&
      member.path !== indexPath &&
      !mirrorPaths.has(member.path.slice("offline/provider-mirror/".length))
    ) {
      fail(
        "CONTEXT_OFFLINE_MEMBER_UNDECLARED",
        member.path,
        "provider mirror member is absent from its index",
      );
    }
  }
  const toolIndexPath = "offline/tool-binaries-v1.json";
  const { value: toolIndex } = await readJson(
    resolve(root, ...toolIndexPath.split("/")),
    toolIndexPath,
  );
  exactKeys(
    toolIndex,
    ["contextId", "kind", "schemaVersion", "tools"],
    toolIndexPath,
  );
  if (
    toolIndex.schemaVersion !== 1 ||
    toolIndex.kind !== "cloudmarkup.terraform-validation-tools" ||
    toolIndex.contextId !== "terraform-validation" ||
    !Array.isArray(toolIndex.tools) ||
    toolIndex.tools.length !== 3
  ) {
    fail(
      "CONTEXT_TOOL_BINARY_INDEX_INVALID",
      toolIndexPath,
      "tool binary index identity or cardinality is invalid",
    );
  }
  const toolRecords = toolIndex.tools.map((tool, toolIndexNumber) => {
    const path = `${toolIndexPath}.tools[${String(toolIndexNumber)}]`;
    exactKeys(
      tool,
      ["executable", "path", "role", "sha256", "sizeBytes"],
      path,
    );
    const parsed = {
      executable: tool.executable,
      path: portablePath(tool.path, `${path}.path`),
      role: string(tool.role, `${path}.role`, ROLE_PATTERN),
      sha256: string(tool.sha256, `${path}.sha256`, SHA256_PATTERN),
      sizeBytes: integer(
        tool.sizeBytes,
        `${path}.sizeBytes`,
        MAXIMUM_FILE_BYTES,
      ),
    };
    if (parsed.path.includes("/") || parsed.executable !== true) {
      fail(
        "CONTEXT_TOOL_BINARY_INDEX_INVALID",
        path,
        "tool entries must be executable basenames",
      );
    }
    return parsed;
  });
  validateOrderedUnique(toolRecords, `${toolIndexPath}.tools`);
  if (
    JSON.stringify(toolRecords.map(({ path }) => path)) !==
    JSON.stringify(["terraform", "tflint", "trivy"])
  ) {
    fail(
      "CONTEXT_TOOL_BINARY_INDEX_INVALID",
      `${toolIndexPath}.tools`,
      "tool binary index differs from the reviewed tool set",
    );
  }
  for (const tool of toolRecords) {
    const generated = generatedOutputByDestination.get(
      `offline/bin/${tool.path}`,
    );
    if (
      generated === undefined ||
      generated.sha256 !== tool.sha256 ||
      generated.sizeBytes !== tool.sizeBytes ||
      generated.executable !== tool.executable ||
      generated.role !== tool.role
    ) {
      fail(
        "CONTEXT_TOOL_BINARY_DRIFT",
        `${toolIndexPath}.tools.${tool.path}`,
        "tool index differs from the exact acquisition output authority",
      );
    }
  }
}

async function loadDeclaredContext(
  repositoryRoot,
  spec,
  maximumManifestBytes = MAXIMUM_MANIFEST_BYTES,
) {
  const root = resolve(repositoryRoot, ...spec.relativeRoot.split("/"));
  const rootMetadata = await lstat(root).catch(() => undefined);
  if (
    rootMetadata === undefined ||
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink()
  ) {
    fail(
      "CONTEXT_ROOT_INVALID",
      spec.relativeRoot,
      "context root must be a real directory",
    );
  }
  const { bytes: manifestBytes, value } = await readJson(
    resolve(root, MANIFEST_NAME),
    MANIFEST_NAME,
    maximumManifestBytes,
  );
  const parsed = validateCommonManifest(value, spec);
  const acquisitionMember = parsed.byPath.get(ACQUISITION_NAME);
  if (acquisitionMember === undefined) {
    fail(
      "CONTEXT_ACQUISITION_MISSING",
      ACQUISITION_NAME,
      "credentialless acquisition descriptor is required",
    );
  }
  const { value: acquisitionValue } = await readJson(
    resolve(root, ...ACQUISITION_NAME.split("/")),
    ACQUISITION_NAME,
  );
  const acquisition = parseAcquisition(acquisitionValue, spec.contextId);
  const generatedOutputByDestination = new Map(
    acquisition.outputs.map((output) => [output.destination, output]),
  );
  const generatedPrefixFor = (candidatePath) =>
    parsed.generatedPrefixes.find(({ path }) =>
      candidatePath.startsWith(`${path}/`),
    );
  for (const output of acquisition.outputs) {
    if (generatedPrefixFor(output.destination) === undefined) {
      fail(
        "CONTEXT_ACQUISITION_DESTINATION_INVALID",
        output.destination,
        "generated output is outside every reviewed generated prefix",
      );
    }
    const member = parsed.byPath.get(output.destination);
    if (
      member !== undefined &&
      ((output.sha256 !== undefined &&
        (member.sha256 !== output.sha256 ||
          member.sizeBytes !== output.sizeBytes)) ||
        member.executable !== output.executable ||
        member.role !== output.role)
    ) {
      fail(
        "CONTEXT_ACQUISITION_DRIFT",
        output.destination,
        "resolved member differs from acquisition authority",
      );
    }
  }
  if (spec.contextId === "application-build") {
    await validateApplicationBindings({
      ...parsed,
      generatedOutputByDestination,
      recipe: acquisition.recipes[0],
      repositoryRoot,
      root,
    });
  } else {
    await validateTerraformBindings({
      ...parsed,
      generatedOutputByDestination,
      root,
    });
  }
  return {
    ...parsed,
    ...acquisition,
    canonicalManifestBytes: canonicalJson(value),
    generatedOutputByDestination,
    generatedPrefixFor,
    manifestBytes,
    repositoryRoot,
    root,
    spec,
  };
}

export async function validateImageContext(
  repositoryRootInput,
  contextId,
  { allowMissingAcquired = true } = {},
) {
  const repositoryRoot = resolve(repositoryRootInput);
  const spec = CONTEXT_SPECS.find(
    (candidate) => candidate.contextId === contextId,
  );
  if (spec === undefined)
    fail("CONTEXT_ID_UNKNOWN", contextId, "context ID is not reviewed");
  const context = await loadDeclaredContext(
    repositoryRoot,
    spec,
    allowMissingAcquired
      ? MAXIMUM_MANIFEST_BYTES
      : MAXIMUM_GENERATED_MANIFEST_BYTES,
  );
  const walked = await safeWalk(context.root);
  const actualByPath = new Map(walked.files.map((file) => [file.path, file]));
  const expectedPaths = new Set([
    MANIFEST_NAME,
    ...context.members.map((member) => member.path),
  ]);
  for (const actual of actualByPath.keys()) {
    if (!expectedPaths.has(actual)) {
      fail(
        "CONTEXT_UNDECLARED_MEMBER",
        actual,
        "file is absent from the complete allowlist",
      );
    }
  }
  if (!allowMissingAcquired) {
    for (const output of context.outputs) {
      if (!actualByPath.has(output.destination)) {
        fail(
          "CONTEXT_ACQUISITION_MISSING",
          output.destination,
          "resolved context is missing a required generated output",
        );
      }
    }
    for (const { path } of context.generatedPrefixes) {
      if (
        ![...actualByPath.keys()].some((candidate) =>
          candidate.startsWith(`${path}/`),
        )
      ) {
        fail(
          "CONTEXT_GENERATED_PREFIX_EMPTY",
          path,
          "resolved context is missing a required generated input set",
        );
      }
    }
  }
  let totalBytes = context.canonicalManifestBytes.byteLength;
  const materializedBytes = new Map([
    [MANIFEST_NAME, context.canonicalManifestBytes],
  ]);
  for (const member of context.members) {
    const actual = actualByPath.get(member.path);
    if (actual === undefined) {
      if (
        allowMissingAcquired &&
        context.generatedPrefixFor(member.path) !== undefined
      ) {
        continue;
      }
      fail(
        "CONTEXT_MEMBER_MISSING",
        member.path,
        "allowlisted file is missing",
      );
    }
    const bytes = await inspectFile(actual, member, {
      scanSecrets: !new Set([
        "offline-package-byte",
        "terraform-provider-package",
        "trivy-database",
      ]).has(member.role),
    });
    if (member.path === "Dockerfile" || member.path === spec.entrypoint) {
      materializedBytes.set(member.path, bytes);
    }
    totalBytes += member.sizeBytes;
    if (totalBytes > MAXIMUM_CONTEXT_BYTES) {
      fail(
        "CONTEXT_SIZE_LIMIT",
        spec.contextId,
        "context exceeds reviewed aggregate size limit",
      );
    }
  }
  const manifestFile = actualByPath.get(MANIFEST_NAME);
  if (manifestFile === undefined)
    fail("CONTEXT_MEMBER_MISSING", MANIFEST_NAME, "manifest is missing");
  if (manifestFile.metadata.size !== context.manifestBytes.byteLength) {
    fail(
      "CONTEXT_CHANGED_DURING_READ",
      MANIFEST_NAME,
      "manifest changed while it was admitted",
    );
  }
  const dockerfile = materializedBytes.get("Dockerfile");
  const entrypoint = materializedBytes.get(spec.entrypoint);
  if (dockerfile === undefined || entrypoint === undefined) {
    fail(
      "CONTEXT_REQUIRED_MEMBER_MISSING",
      spec.contextId,
      "Dockerfile or entrypoint is unavailable",
    );
  }
  const declaredDockerPaths = new Set([
    ...expectedPaths,
    ...context.generatedPrefixes.map(({ path }) => path),
    ...context.outputs.map(({ destination }) => destination),
  ]);
  assertDockerfile(
    spec.contextId,
    dockerfile,
    declaredDockerPaths,
    context.generatedPrefixes.map(({ path }) => path),
  );
  assertEntrypoint(entrypoint, spec.entrypoint);
  return { ...context, actualByPath, materializedBytes, totalBytes };
}

function selectedContextSpecs(contextIds) {
  if (contextIds === undefined) return CONTEXT_SPECS;
  if (
    !Array.isArray(contextIds) ||
    contextIds.length === 0 ||
    new Set(contextIds).size !== contextIds.length ||
    contextIds.some(
      (id) => !CONTEXT_SPECS.some((spec) => spec.contextId === id),
    )
  )
    fail(
      "CONTEXT_SELECTION_INVALID",
      "contexts",
      "select unique reviewed context IDs",
    );
  return CONTEXT_SPECS.filter((spec) => contextIds.includes(spec.contextId));
}

export async function validateBetaImageContexts(
  repositoryRootInput = resolve("."),
  { contextIds, ...options } = {},
) {
  const repositoryRoot = resolve(repositoryRootInput);
  const results = [];
  for (const spec of selectedContextSpecs(contextIds)) {
    results.push(
      await validateImageContext(repositoryRoot, spec.contextId, options),
    );
  }
  return results;
}

async function copyDeclaredSource(context, stageRoot) {
  await mkdir(stageRoot, { recursive: false });
  for (const [memberPath, file] of context.actualByPath) {
    if (memberPath === MANIFEST_NAME) continue;
    const destination = resolve(stageRoot, ...memberPath.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(file.absolute), {
      flag: "wx",
      mode: 0o600,
    });
  }
  await writeFile(
    resolve(stageRoot, MANIFEST_NAME),
    context.canonicalManifestBytes,
    { flag: "wx", mode: 0o600 },
  );
}

async function readBoundedResponseBody(response, maximum, label) {
  const reader = response.body?.getReader?.();
  if (reader === undefined) {
    fail(
      "CONTEXT_RESPONSE_STREAM_INVALID",
      label,
      "response body is not a bounded readable stream",
    );
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        fail(
          "CONTEXT_RESPONSE_STREAM_INVALID",
          label,
          "response stream emitted a non-byte chunk",
        );
      }
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel().catch(() => undefined);
        fail(
          "CONTEXT_RESPONSE_SIZE_INVALID",
          label,
          "response exceeds its reviewed byte limit",
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function approvedRedirectUrl(location, currentUrl, label) {
  let target;
  try {
    target = new URL(location, currentUrl);
  } catch {
    fail(
      "CONTEXT_ACQUISITION_REDIRECT_INVALID",
      label,
      "redirect location is invalid",
    );
  }
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.port !== "" ||
    target.hash !== "" ||
    (!APPROVED_ACQUISITION_HOSTS.has(target.hostname) &&
      !APPROVED_ACQUISITION_REDIRECT_HOSTS.has(target.hostname))
  ) {
    fail(
      "CONTEXT_ACQUISITION_REDIRECT_INVALID",
      label,
      "redirect target is outside the reviewed release-asset boundary",
    );
  }
  return target.href;
}

async function fetchPinnedHttpsResponse(artifact, fetchImpl, label) {
  let currentUrl = artifact.url;
  const visited = new Set([currentUrl]);
  for (let redirectCount = 0; ; redirectCount += 1) {
    let response;
    try {
      response = await fetchImpl(currentUrl, {
        cache: "no-store",
        credentials: "omit",
        headers: { accept: "application/octet-stream" },
        redirect: "manual",
        referrerPolicy: "no-referrer",
      });
    } catch {
      fail(
        "CONTEXT_ACQUISITION_TRANSPORT_FAILED",
        currentUrl,
        "credentialless HTTPS request failed",
      );
    }
    if (response.status === 200 && response.ok && !response.redirected) {
      return response;
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel?.().catch(() => undefined);
      fail(
        "CONTEXT_ACQUISITION_FAILED",
        label,
        "exact HTTPS artifact was not returned",
      );
    }
    if (redirectCount >= MAXIMUM_ACQUISITION_REDIRECTS) {
      await response.body?.cancel?.().catch(() => undefined);
      fail(
        "CONTEXT_ACQUISITION_REDIRECT_LIMIT",
        label,
        "release-asset redirect limit was exceeded",
      );
    }
    const location = response.headers?.get?.("location");
    if (typeof location !== "string" || location.length === 0) {
      await response.body?.cancel?.().catch(() => undefined);
      fail(
        "CONTEXT_ACQUISITION_REDIRECT_INVALID",
        label,
        "redirect response omitted its location",
      );
    }
    const nextUrl = approvedRedirectUrl(location, currentUrl, label);
    if (visited.has(nextUrl)) {
      await response.body?.cancel?.().catch(() => undefined);
      fail(
        "CONTEXT_ACQUISITION_REDIRECT_LOOP",
        label,
        "release-asset redirect loop is forbidden",
      );
    }
    await response.body?.cancel?.().catch(() => undefined);
    visited.add(nextUrl);
    currentUrl = nextUrl;
  }
}

async function fetchPinnedArtifact(artifact, fetchImpl) {
  const label = artifact.destination ?? artifact.url;
  if (fetchImpl === undefined) {
    fail(
      "CONTEXT_NETWORK_DISABLED",
      label,
      "materialization requires an explicit credentialless fetch implementation",
    );
  }
  const response = await fetchPinnedHttpsResponse(artifact, fetchImpl, label);
  const contentLength = response.headers?.get?.("content-length");
  const contentEncoding = response.headers?.get?.("content-encoding");
  if (
    (contentEncoding !== null &&
      contentEncoding !== undefined &&
      contentEncoding !== "identity") ||
    (contentLength !== null &&
      contentLength !== undefined &&
      Number(contentLength) !== artifact.sizeBytes)
  ) {
    fail(
      "CONTEXT_ACQUISITION_SIZE_MISMATCH",
      label,
      "HTTP content length differs from authority",
    );
  }
  const bytes = await readBoundedResponseBody(
    response,
    artifact.sizeBytes,
    label,
  );
  if (
    bytes.byteLength !== artifact.sizeBytes ||
    sha256(bytes) !== artifact.sha256
  ) {
    fail(
      "CONTEXT_ACQUISITION_DIGEST_MISMATCH",
      label,
      "downloaded bytes differ from committed authority",
    );
  }
  return bytes;
}

async function fetchOciBytes(
  fetchImpl,
  url,
  { accept, authorization, maximum, redirectAuthority },
) {
  let response;
  let currentUrl = url;
  const visited = new Set([currentUrl]);
  for (let redirectCount = 0; ; redirectCount += 1) {
    try {
      response = await fetchImpl(currentUrl, {
        cache: "no-store",
        credentials: "omit",
        headers: {
          accept,
          ...(authorization === undefined || redirectCount > 0
            ? {}
            : { authorization: `Bearer ${authorization}` }),
        },
        redirect: "manual",
        referrerPolicy: "no-referrer",
      });
    } catch {
      fail(
        "CONTEXT_OCI_TRANSPORT_FAILED",
        currentUrl,
        "credentialless OCI request failed",
      );
    }
    if (response.ok && response.status === 200 && !response.redirected) break;
    if (
      redirectAuthority === undefined ||
      ![301, 302, 303, 307, 308].includes(response.status) ||
      redirectCount >= 2
    ) {
      await response.body?.cancel?.().catch(() => undefined);
      fail(
        "CONTEXT_OCI_FETCH_FAILED",
        currentUrl,
        "exact OCI object was not returned within its reviewed redirect boundary",
      );
    }
    const location = response.headers?.get?.("location");
    let target;
    try {
      target = new URL(location, currentUrl);
    } catch {
      await response.body?.cancel?.().catch(() => undefined);
      fail(
        "CONTEXT_OCI_REDIRECT_INVALID",
        currentUrl,
        "OCI redirect location is invalid",
      );
    }
    if (
      target.protocol !== "https:" ||
      target.hostname !== redirectAuthority.hostname ||
      target.username !== "" ||
      target.password !== "" ||
      target.port !== "" ||
      target.hash !== "" ||
      !target.pathname.endsWith(redirectAuthority.pathSuffix) ||
      visited.has(target.href)
    ) {
      await response.body?.cancel?.().catch(() => undefined);
      fail(
        "CONTEXT_OCI_REDIRECT_INVALID",
        currentUrl,
        "OCI redirect target differs from the reviewed layer host/path",
      );
    }
    await response.body?.cancel?.().catch(() => undefined);
    visited.add(target.href);
    currentUrl = target.href;
  }
  const length = response.headers?.get?.("content-length");
  const contentEncoding = response.headers?.get?.("content-encoding");
  if (
    (contentEncoding !== null &&
      contentEncoding !== undefined &&
      contentEncoding !== "identity") ||
    (length !== null &&
      length !== undefined &&
      (!Number.isSafeInteger(Number(length)) || Number(length) > maximum))
  ) {
    fail(
      "CONTEXT_OCI_SIZE_INVALID",
      url,
      "OCI response exceeds reviewed limit",
    );
  }
  return readBoundedResponseBody(response, maximum, url);
}

async function fetchTrivyDbArtifact(artifact, fetchImpl, cache) {
  const cacheKey = `${artifact.manifestDigest}\u0000${artifact.layer.digest}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  if (fetchImpl === undefined) {
    fail(
      "CONTEXT_NETWORK_DISABLED",
      artifact.manifestDigest,
      "OCI materialization requires credentialless fetch",
    );
  }
  const tokenUrl =
    "https://ghcr.io/token?service=ghcr.io&scope=repository%3Aaquasecurity%2Ftrivy-db%3Apull";
  const tokenBytes = await fetchOciBytes(fetchImpl, tokenUrl, {
    accept: "application/json",
    maximum: 64 * 1024,
  });
  let tokenValue;
  try {
    const tokenDocument = JSON.parse(tokenBytes.toString("utf8"));
    tokenValue = tokenDocument.token ?? tokenDocument.access_token;
  } catch {
    fail(
      "CONTEXT_OCI_TOKEN_INVALID",
      "ghcr.io",
      "anonymous token response is malformed",
    );
  }
  if (
    typeof tokenValue !== "string" ||
    tokenValue.length < 32 ||
    tokenValue.length > 8192 ||
    hasAsciiControlCharacter(tokenValue)
  ) {
    fail(
      "CONTEXT_OCI_TOKEN_INVALID",
      "ghcr.io",
      "anonymous pull token is invalid",
    );
  }
  const repositoryUrl = `https://ghcr.io/v2/${artifact.repository}`;
  const manifestUrl = `${repositoryUrl}/manifests/${artifact.manifestDigest}`;
  const manifestBytes = await fetchOciBytes(fetchImpl, manifestUrl, {
    accept:
      "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
    authorization: tokenValue,
    maximum: MAXIMUM_MANIFEST_BYTES,
  });
  if (`sha256:${sha256(manifestBytes)}` !== artifact.manifestDigest) {
    fail(
      "CONTEXT_OCI_MANIFEST_DRIFT",
      artifact.manifestDigest,
      "OCI manifest bytes differ from digest authority",
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail(
      "CONTEXT_OCI_MANIFEST_INVALID",
      artifact.manifestDigest,
      "OCI manifest JSON is malformed",
    );
  }
  if (
    manifest.schemaVersion !== 2 ||
    manifest.mediaType !== "application/vnd.oci.image.manifest.v1+json" ||
    manifest.artifactType !== artifact.artifactType ||
    !plain(manifest.config) ||
    !Array.isArray(manifest.layers) ||
    manifest.layers.length !== 1 ||
    manifest.config.mediaType !== "application/vnd.oci.empty.v1+json" ||
    manifest.config.digest !==
      "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a" ||
    manifest.config.size !== 2 ||
    manifest.config.data !== "e30=" ||
    manifest.layers[0]?.mediaType !== artifact.layer.mediaType ||
    manifest.layers[0]?.digest !== artifact.layer.digest ||
    manifest.layers[0]?.size !== artifact.layer.sizeBytes ||
    manifest.annotations?.["org.opencontainers.image.created"] !==
      artifact.created
  ) {
    fail(
      "CONTEXT_OCI_MANIFEST_INVALID",
      artifact.manifestDigest,
      "OCI config/layer descriptors differ from exact authority",
    );
  }
  const configBytes = Buffer.from(manifest.config.data, "base64");
  if (
    configBytes.byteLength !== manifest.config.size ||
    `sha256:${sha256(configBytes)}` !== manifest.config.digest
  ) {
    fail(
      "CONTEXT_OCI_CONFIG_DRIFT",
      manifest.config.digest,
      "OCI config differs from manifest authority",
    );
  }
  let config;
  try {
    config = JSON.parse(configBytes.toString("utf8"));
  } catch {
    fail(
      "CONTEXT_OCI_CONFIG_INVALID",
      manifest.config.digest,
      "OCI config JSON is malformed",
    );
  }
  if (!plain(config) || Object.keys(config).length !== 0) {
    fail(
      "CONTEXT_OCI_CONFIG_INVALID",
      manifest.config.digest,
      "OCI empty config content differs",
    );
  }
  const layerBytes = await fetchOciBytes(
    fetchImpl,
    `${repositoryUrl}/blobs/${artifact.layer.digest}`,
    {
      accept: artifact.layer.mediaType,
      authorization: tokenValue,
      maximum: artifact.layer.sizeBytes,
      redirectAuthority: {
        hostname: "pkg-containers.githubusercontent.com",
        pathSuffix: `/blobs/${artifact.layer.digest}`,
      },
    },
  );
  if (
    layerBytes.byteLength !== artifact.layer.sizeBytes ||
    `sha256:${sha256(layerBytes)}` !== artifact.layer.digest
  ) {
    fail(
      "CONTEXT_OCI_LAYER_DRIFT",
      artifact.layer.digest,
      "OCI layer differs from exact authority",
    );
  }
  const extracted = extractPinnedTarGzip(layerBytes, artifact);
  cache.set(cacheKey, extracted);
  return extracted;
}

let crc32Table;

function crc32(bytes) {
  if (crc32Table === undefined) {
    crc32Table = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      return value >>> 0;
    });
  }
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function findZipEnd(bytes, path) {
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  fail(
    "CONTEXT_ZIP_INVALID",
    path,
    "end-of-central-directory record is missing",
  );
}

function extractPinnedZip(bytes, artifact) {
  const layout = REVIEWED_ZIP_LAYOUTS.get(artifact.url) ?? {
    dataDescriptor: false,
    extendedTimestampHex: "",
    flags: 0x0800,
  };
  const reviewedExtra =
    layout.extendedTimestampHex === ""
      ? Buffer.alloc(0)
      : Buffer.from("55540500" + layout.extendedTimestampHex, "hex");
  const eocd = findZipEnd(bytes, artifact.url);
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8);
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  const commentLength = bytes.readUInt16LE(eocd + 20);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== totalEntries ||
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    commentLength !== 0 ||
    eocd + 22 !== bytes.byteLength ||
    centralOffset + centralSize !== eocd ||
    totalEntries !== artifact.members.length
  ) {
    fail(
      "CONTEXT_ZIP_INVALID",
      artifact.url,
      "multi-disk, ZIP64, comments, trailing bytes, or unreviewed members are forbidden",
    );
  }
  const expected = new Map(
    artifact.members.map((member) => [member.archivePath, member]),
  );
  const extracted = new Map();
  const regions = [];
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      fail(
        "CONTEXT_ZIP_INVALID",
        artifact.url,
        "central-directory entry is malformed",
      );
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const expectedCrc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const entryCommentLength = bytes.readUInt16LE(cursor + 32);
    const diskStart = bytes.readUInt16LE(cursor + 34);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (
      end > eocd ||
      flags !== layout.flags ||
      !new Set([0, 8]).has(method) ||
      extraLength !== reviewedExtra.byteLength ||
      entryCommentLength !== 0 ||
      diskStart !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff
    ) {
      fail(
        "CONTEXT_ZIP_INVALID",
        artifact.url,
        "flags, ZIP64 state, typed extra field, comments, or compression method differ from the reviewed layout",
      );
    }
    const archivePath = bytes
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");
    portablePath(archivePath, `${artifact.url}#member`);
    assertNoSensitivePath(archivePath, `${artifact.url}#${archivePath}`);
    const expectedMember = expected.get(archivePath);
    const centralExtra = bytes.subarray(
      cursor + 46 + nameLength,
      cursor + 46 + nameLength + extraLength,
    );
    if (!centralExtra.equals(reviewedExtra)) {
      fail(
        "CONTEXT_ZIP_EXTRA_INVALID",
        archivePath,
        "central extra field is unknown, duplicated, or differs from its exact archive authority",
      );
    }
    if (expectedMember === undefined || extracted.has(archivePath)) {
      fail(
        "CONTEXT_ZIP_MEMBER_INVALID",
        archivePath,
        "ZIP member is duplicate or undeclared",
      );
    }
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const unixType = unixMode & 0o170000;
    if (unixType !== 0 && unixType !== 0o100000) {
      fail(
        "CONTEXT_ZIP_LINK_FORBIDDEN",
        archivePath,
        "ZIP links and special members are forbidden",
      );
    }
    if (
      (expectedMember.externalAttributes !== undefined &&
        expectedMember.externalAttributes >>> 0 !== externalAttributes) ||
      (unixMode !== 0 &&
        (unixMode & 0o777) !== Number.parseInt(expectedMember.mode, 8))
    ) {
      fail(
        "CONTEXT_ARCHIVE_MODE_INVALID",
        archivePath,
        "ZIP external attributes differ from reviewed mode authority",
      );
    }
    if (
      localOffset + 30 > centralOffset ||
      bytes.readUInt32LE(localOffset) !== 0x04034b50
    ) {
      fail("CONTEXT_ZIP_INVALID", archivePath, "local header is malformed");
    }
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    const localCrc = bytes.readUInt32LE(localOffset + 14);
    const localCompressedSize = bytes.readUInt32LE(localOffset + 18);
    const localUncompressedSize = bytes.readUInt32LE(localOffset + 22);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localName = bytes
      .subarray(localOffset + 30, localOffset + 30 + localNameLength)
      .toString("utf8");
    const localExtra = bytes.subarray(
      localOffset + 30 + localNameLength,
      localOffset + 30 + localNameLength + localExtraLength,
    );
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    const recordEnd = dataEnd + (layout.dataDescriptor ? 16 : 0);
    const localSizeAuthorityValid = layout.dataDescriptor
      ? localCrc === 0 &&
        localCompressedSize === 0 &&
        localUncompressedSize === 0
      : localCrc === expectedCrc &&
        localCompressedSize === compressedSize &&
        localUncompressedSize === uncompressedSize;
    if (
      localFlags !== flags ||
      localMethod !== method ||
      !localSizeAuthorityValid ||
      localExtraLength !== reviewedExtra.byteLength ||
      !localExtra.equals(reviewedExtra) ||
      localName !== archivePath ||
      recordEnd > centralOffset
    ) {
      fail(
        "CONTEXT_ZIP_INVALID",
        archivePath,
        "local and central ZIP authority differs",
      );
    }
    if (layout.dataDescriptor) {
      const descriptor = bytes.subarray(dataEnd, recordEnd);
      if (
        descriptor.byteLength !== 16 ||
        descriptor.readUInt32LE(0) !== 0x08074b50 ||
        descriptor.readUInt32LE(4) !== expectedCrc ||
        descriptor.readUInt32LE(8) !== compressedSize ||
        descriptor.readUInt32LE(12) !== uncompressedSize
      ) {
        fail(
          "CONTEXT_ZIP_DESCRIPTOR_INVALID",
          archivePath,
          "signed data descriptor differs from the exact central authority",
        );
      }
    }
    if (
      uncompressedSize !== expectedMember.sizeBytes ||
      uncompressedSize > MAXIMUM_FILE_BYTES
    ) {
      fail(
        "CONTEXT_ZIP_MEMBER_DRIFT",
        archivePath,
        "ZIP uncompressed size differs from the exact member authority",
      );
    }
    if (
      regions.some(
        ([start, finish]) => localOffset < finish && recordEnd > start,
      )
    ) {
      fail("CONTEXT_ZIP_INVALID", archivePath, "ZIP data regions overlap");
    }
    regions.push([localOffset, recordEnd]);
    const compressed = bytes.subarray(dataOffset, dataEnd);
    let output;
    try {
      output =
        method === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, {
              maxOutputLength: expectedMember.sizeBytes,
            });
    } catch {
      fail(
        "CONTEXT_ZIP_INVALID",
        archivePath,
        "ZIP member decompression failed",
      );
    }
    if (
      output.byteLength !== uncompressedSize ||
      output.byteLength !== expectedMember.sizeBytes ||
      crc32(output) !== expectedCrc ||
      sha256(output) !== expectedMember.sha256
    ) {
      fail(
        "CONTEXT_ZIP_MEMBER_DRIFT",
        archivePath,
        "ZIP member differs from exact output authority",
      );
    }
    extracted.set(archivePath, {
      bytes: output,
      output: expectedMember,
    });
    cursor = end;
  }
  regions.sort(([left], [right]) => left - right);
  let localCoverage = 0;
  for (const [start, finish] of regions) {
    if (start !== localCoverage) {
      fail(
        "CONTEXT_ZIP_INVALID",
        artifact.url,
        "ZIP local records contain an unreviewed preamble or gap",
      );
    }
    localCoverage = finish;
  }
  if (
    cursor !== eocd ||
    extracted.size !== expected.size ||
    localCoverage !== centralOffset
  ) {
    fail(
      "CONTEXT_ZIP_INVALID",
      artifact.url,
      "ZIP member coverage is incomplete",
    );
  }
  return [...extracted.values()];
}

function tarText(header, offset, length) {
  const field = header.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.byteLength : end).toString("utf8");
}

function tarOctal(header, offset, length, path) {
  const value = tarText(header, offset, length).trim();
  if (!/^[0-7]+$/u.test(value)) {
    fail(
      "CONTEXT_TAR_INVALID",
      path,
      "tar numeric field is not canonical octal",
    );
  }
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed)) {
    fail(
      "CONTEXT_TAR_INVALID",
      path,
      "tar numeric field exceeds the safe range",
    );
  }
  return parsed;
}

function extractPinnedTarGzip(bytes, artifact) {
  let tar;
  try {
    tar = gunzipSync(bytes, {
      finishFlush: 4,
      maxOutputLength: MAXIMUM_CONTEXT_BYTES,
    });
  } catch {
    fail(
      "CONTEXT_TAR_INVALID",
      artifact.url ?? artifact.manifestDigest,
      "gzip decompression failed or exceeded limits",
    );
  }
  const expected = new Map(
    artifact.members.map((member) => [member.archivePath, member]),
  );
  const seen = new Set();
  const seenExpected = new Set();
  const seenFolded = new Set();
  const extracted = [];
  let cursor = 0;
  let zeroBlocks = 0;
  while (cursor + 512 <= tar.byteLength) {
    const header = tar.subarray(cursor, cursor + 512);
    cursor += 512;
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      continue;
    }
    if (zeroBlocks > 0) {
      fail(
        "CONTEXT_TAR_INVALID",
        artifact.url ?? artifact.manifestDigest,
        "non-zero data follows tar terminator",
      );
    }
    const storedChecksum = tarOctal(header, 148, 8, "tar.checksum");
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (storedChecksum !== actualChecksum) {
      fail(
        "CONTEXT_TAR_INVALID",
        artifact.url ?? artifact.manifestDigest,
        "tar header checksum differs",
      );
    }
    const name = tarText(header, 0, 100);
    const prefix = tarText(header, 345, 155);
    const archivePath = prefix === "" ? name : `${prefix}/${name}`;
    const type = header[156];
    const isDirectory = type === "5".charCodeAt(0);
    const checkedPath =
      isDirectory && archivePath.endsWith("/")
        ? archivePath.slice(0, -1)
        : archivePath;
    portablePath(
      checkedPath,
      `${artifact.url ?? artifact.manifestDigest}#member`,
    );
    assertNoSensitivePath(
      checkedPath,
      `${artifact.url ?? artifact.manifestDigest}#${checkedPath}`,
    );
    const foldedPath = checkedPath.toLocaleLowerCase("en-US");
    if (seen.has(checkedPath) || seenFolded.has(foldedPath)) {
      fail(
        "CONTEXT_TAR_MEMBER_INVALID",
        checkedPath,
        "tar member is duplicated or collides by portable case",
      );
    }
    seen.add(checkedPath);
    seenFolded.add(foldedPath);
    if (seen.size > MAXIMUM_FILES) {
      fail(
        "CONTEXT_TAR_INVALID",
        checkedPath,
        "tar member count exceeds its reviewed limit",
      );
    }
    const tarMagic = tarText(header, 257, 6);
    const tarVersion = tarText(header, 263, 2);
    const recognizedTarFormat =
      (tarMagic === "ustar" && tarVersion === "00") ||
      (tarMagic === "ustar " && tarVersion === " ");
    if (!recognizedTarFormat || tarText(header, 157, 100) !== "") {
      fail(
        "CONTEXT_TAR_INVALID",
        checkedPath,
        "tar format, version, or link target is not the reviewed regular form",
      );
    }
    const expectedMember = expected.get(archivePath);
    const isRegular = type === 0 || type === "0".charCodeAt(0);
    if (!isRegular && !isDirectory) {
      fail(
        "CONTEXT_TAR_LINK_FORBIDDEN",
        checkedPath,
        "tar links, metadata, and special members are forbidden",
      );
    }
    const mode = tarOctal(header, 100, 8, checkedPath) & 0o777;
    const size = tarOctal(header, 124, 12, checkedPath);
    const dataEnd = cursor + size;
    if (size > MAXIMUM_FILE_BYTES || dataEnd > tar.byteLength) {
      fail(
        "CONTEXT_TAR_INVALID",
        checkedPath,
        "tar member size exceeds its bounded archive",
      );
    }
    const output = tar.subarray(cursor, dataEnd);
    cursor += size + ((512 - (size % 512)) % 512);
    if (isDirectory) {
      if (size !== 0 || expectedMember !== undefined) {
        fail(
          "CONTEXT_TAR_MEMBER_INVALID",
          checkedPath,
          "tar directories must be empty and cannot be extraction targets",
        );
      }
      continue;
    }
    if (expectedMember === undefined) {
      if (artifact.type !== "https-tar-gzip") {
        fail(
          "CONTEXT_TAR_MEMBER_INVALID",
          checkedPath,
          "unreviewed regular members are forbidden in this archive type",
        );
      }
      continue;
    }
    seenExpected.add(archivePath);
    if (expectedMember.disposition === "ignore") continue;
    const outputDigest = sha256(output);
    if (expectedMember.sha256 === undefined) {
      if (expectedMember.executable || (mode & 0o111) !== 0) {
        fail(
          "CONTEXT_TAR_MEMBER_DRIFT",
          archivePath,
          "derived database member cannot be executable",
        );
      }
      extracted.push({
        bytes: output,
        output: {
          ...expectedMember,
          sha256: outputDigest,
          sizeBytes: size,
        },
      });
    } else {
      if (
        size !== expectedMember.sizeBytes ||
        outputDigest !== expectedMember.sha256 ||
        mode !== Number.parseInt(expectedMember.mode, 8)
      ) {
        fail(
          "CONTEXT_TAR_MEMBER_DRIFT",
          archivePath,
          "tar member differs from exact output authority",
        );
      }
      extracted.push({ bytes: output, output: expectedMember });
    }
  }
  if (
    zeroBlocks < 2 ||
    cursor !== tar.byteLength ||
    seenExpected.size !== expected.size
  ) {
    fail(
      "CONTEXT_TAR_INVALID",
      artifact.url ?? artifact.manifestDigest,
      "tar termination or member coverage is invalid",
    );
  }
  return extracted;
}

async function runFixedProcess(
  command,
  arguments_,
  { cwd, environment, timeoutMs, maximumOutputBytes = 64 * 1024 },
) {
  // Fixed public Go builds need module/progress diagnostics. Other processes
  // retain their smaller cap, and no caller may request unbounded output.
  if (
    !Number.isSafeInteger(maximumOutputBytes) ||
    maximumOutputBytes < 1 ||
    maximumOutputBytes > 1024 * 1024
  )
    throw new Error("fixed process output bound is invalid");
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      cwd,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks = [];
    let outputBytes = 0;
    const collect = (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes <= maximumOutputBytes) chunks.push(Buffer.from(chunk));
      else child.kill("SIGKILL");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      const output = Buffer.concat(chunks).toString("utf8");
      if (outputBytes > maximumOutputBytes) {
        rejectPromise(new Error("fixed process exceeded output limit"));
      } else if (code !== 0 || signal !== null) {
        rejectPromise(
          // This process receives only fixed public build inputs and an isolated,
          // credentialless environment. Retain a bounded diagnostic tail, never
          // the command environment or arguments, so CI failures are actionable.
          new Error(
            `fixed process failed (${String(code ?? signal)}): ${stripVTControlCharacters(output).slice(-8192)}`,
          ),
        );
      } else {
        resolvePromise(output);
      }
    });
  });
}

function pnpmFetchArguments(cliPath, toolchainRoot, storeRoot) {
  return [
    cliPath,
    "fetch",
    "--dir",
    toolchainRoot,
    "--frozen-lockfile",
    "--ignore-scripts",
    "--network-concurrency=1",
    "--store-dir",
    storeRoot,
  ];
}

function pnpmDeterministicNodeOptions(clockPath) {
  const portableClockPath = clockPath.split(sep).join("/");
  return `--require=${JSON.stringify(portableClockPath)}`;
}

function assertPnpmFetchContract(
  arguments_,
  environment,
  workspaceConfiguration,
  clockPath,
  cliPath,
  toolchainRoot,
  storeRoot,
) {
  const expectedArguments = pnpmFetchArguments(
    cliPath,
    toolchainRoot,
    storeRoot,
  );
  if (
    JSON.stringify(arguments_) !== JSON.stringify(expectedArguments) ||
    environment.NODE_OPTIONS !== pnpmDeterministicNodeOptions(clockPath) ||
    environment.PNPM_MAX_WORKERS !== "1" ||
    environment.SOURCE_DATE_EPOCH !== "0" ||
    !Buffer.from(workspaceConfiguration).equals(
      PNPM_WORKSPACE_CONFIGURATION_BYTES,
    )
  ) {
    fail(
      "CONTEXT_PNPM_FETCH_CONTRACT_INVALID",
      "pnpm fetch",
      "arguments, environment, or linux/x64/musl workspace configuration differ from the fixed authority",
    );
  }
}

async function stageVerifiedPnpmImplementation(cliCandidate, stagingRoot) {
  if (typeof cliCandidate !== "string" || !isAbsolute(cliCandidate)) {
    fail(
      "CONTEXT_PNPM_CLI_INVALID",
      "pnpm",
      "exact pnpm CLI path is unavailable",
    );
  }
  const candidateMetadata = await lstat(cliCandidate).catch(() => undefined);
  if (
    candidateMetadata === undefined ||
    !candidateMetadata.isFile() ||
    candidateMetadata.isSymbolicLink()
  ) {
    fail(
      "CONTEXT_PNPM_CLI_INVALID",
      "pnpm",
      "pnpm launcher must be one regular, non-symbolic path",
    );
  }
  const cliPath = await realpath(cliCandidate);
  if (
    basename(dirname(cliPath)) !== "bin" ||
    !new Set(["pnpm.cjs", "pnpm.mjs"]).has(basename(cliPath))
  ) {
    fail(
      "CONTEXT_PNPM_CLI_INVALID",
      "pnpm",
      "pnpm launcher must be an exact official bin/pnpm.cjs or bin/pnpm.mjs",
    );
  }
  const packageRoot = resolve(dirname(cliPath), "..");
  const runtimeAuthorities = [
    PNPM_HOST_AUTHORITY.packageMetadata,
    PNPM_HOST_AUTHORITY.implementation,
    PNPM_HOST_AUTHORITY.worker,
  ];
  const verifiedRuntimeBytes = new Map();
  for (const authority of [
    ...PNPM_HOST_AUTHORITY.launchers,
    ...runtimeAuthorities,
  ]) {
    const path = resolve(packageRoot, ...authority.path.split("/"));
    const [metadata, canonicalPath] = await Promise.all([
      lstat(path).catch(() => undefined),
      realpath(path).catch(() => undefined),
    ]);
    if (
      metadata === undefined ||
      canonicalPath === undefined ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      relative(packageRoot, canonicalPath).split(sep).join("/") !==
        authority.path
    ) {
      fail(
        "CONTEXT_PNPM_CLI_INVALID",
        authority.path,
        "pnpm CLI closure contains a link, special file, or path escape",
      );
    }
    const bytes = await readFile(path);
    if (
      bytes.byteLength !== authority.sizeBytes ||
      sha256(bytes) !== authority.sha256
    ) {
      fail(
        "CONTEXT_PNPM_CLI_DRIFT",
        authority.path,
        "pnpm CLI bytes differ from the exact 11.16.0 authority",
      );
    }
    if (runtimeAuthorities.includes(authority)) {
      verifiedRuntimeBytes.set(authority.path, bytes);
    }
  }
  const selectedLauncher = PNPM_HOST_AUTHORITY.launchers.find(
    ({ path }) => basename(path) === basename(cliPath),
  );
  const selectedBytes = await readFile(cliPath);
  if (
    selectedLauncher === undefined ||
    selectedBytes.byteLength !== selectedLauncher.sizeBytes ||
    sha256(selectedBytes) !== selectedLauncher.sha256
  ) {
    fail(
      "CONTEXT_PNPM_CLI_DRIFT",
      basename(cliPath),
      "selected pnpm launcher differs from its exact byte authority",
    );
  }
  for (const authority of runtimeAuthorities) {
    if (!verifiedRuntimeBytes.has(authority.path)) {
      fail(
        "CONTEXT_PNPM_CLI_INVALID",
        authority.path,
        "pnpm runtime closure is unavailable",
      );
    }
  }
  const controlledRoot = resolve(stagingRoot, "pnpm-host-11.16.0");
  await mkdir(controlledRoot, { recursive: false });
  await mkdir(resolve(controlledRoot, "dist"), { recursive: false });
  for (const authority of runtimeAuthorities) {
    const bytes = verifiedRuntimeBytes.get(authority.path);
    if (bytes === undefined) {
      fail(
        "CONTEXT_PNPM_CLI_INVALID",
        authority.path,
        "pnpm runtime closure is unavailable",
      );
    }
    await writeFile(
      resolve(controlledRoot, ...authority.path.split("/")),
      bytes,
      { flag: "wx", mode: 0o400 },
    );
  }
  return resolve(
    controlledRoot,
    ...PNPM_HOST_AUTHORITY.implementation.path.split("/"),
  );
}

async function materializePnpmStore({
  context,
  pnpmCliPath,
  stageRoot,
  stagingRoot,
}) {
  const recipe = context.recipes[0];
  if (recipe === undefined) return;
  const cliCandidate = pnpmCliPath ?? process.env.npm_execpath;
  const cliPath = await stageVerifiedPnpmImplementation(
    cliCandidate,
    stagingRoot,
  );
  const controlledPnpmRoot = resolve(dirname(cliPath), "..");
  const imagePnpmRoot = resolve(
    stageRoot,
    "offline",
    "toolchain",
    "pnpm-runtime",
  );
  for (const authority of [
    PNPM_HOST_AUTHORITY.packageMetadata,
    PNPM_HOST_AUTHORITY.implementation,
    PNPM_HOST_AUTHORITY.worker,
  ]) {
    const destination = resolve(imagePnpmRoot, ...authority.path.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(
      destination,
      await readFile(resolve(controlledPnpmRoot, ...authority.path.split("/"))),
      { flag: "wx", mode: 0o600 },
    );
  }
  const toolchainRoot = resolve(stagingRoot, "pnpm-toolchain");
  const storeRoot = resolve(stageRoot, ...recipe.destination.split("/"));
  const isolatedHome = resolve(stagingRoot, "pnpm-home");
  const clockPath = resolve(stagingRoot, "pnpm-deterministic-clock.cjs");
  await mkdir(toolchainRoot, { recursive: false });
  await mkdir(storeRoot, { recursive: true });
  await mkdir(isolatedHome, { recursive: false });
  const lockBytes = await readFile(
    resolve(context.root, ...recipe.lockPath.split("/")),
  );
  await writeFile(resolve(toolchainRoot, "pnpm-lock.yaml"), lockBytes, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(
    resolve(toolchainRoot, recipe.workspaceConfiguration.path),
    PNPM_WORKSPACE_CONFIGURATION_BYTES,
    { flag: "wx", mode: 0o600 },
  );
  const sourceClockBytes = await readFile(
    resolve(context.root, ...PNPM_DETERMINISTIC_CLOCK_PATH.split("/")),
  );
  if (!sourceClockBytes.equals(PNPM_DETERMINISTIC_CLOCK_BYTES)) {
    fail(
      "CONTEXT_PNPM_CLOCK_DRIFT",
      PNPM_DETERMINISTIC_CLOCK_PATH,
      "pnpm deterministic clock differs from its fixed authority",
    );
  }
  await writeFile(clockPath, sourceClockBytes, { flag: "wx", mode: 0o400 });
  const environment = {
    CI: "true",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    HOME: isolatedHome,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NO_COLOR: "1",
    NODE_OPTIONS: pnpmDeterministicNodeOptions(clockPath),
    PATH: dirname(process.execPath),
    PNPM_HOME: isolatedHome,
    PNPM_MAX_WORKERS: "1",
    SOURCE_DATE_EPOCH: "0",
    TZ: "UTC",
    ...(process.platform === "win32" && process.env.SystemRoot !== undefined
      ? { SystemRoot: process.env.SystemRoot }
      : {}),
  };
  let versionOutput;
  try {
    versionOutput = await runFixedProcess(
      process.execPath,
      [cliPath, "--version"],
      {
        cwd: toolchainRoot,
        environment,
        timeoutMs: 30_000,
      },
    );
  } catch {
    fail(
      "CONTEXT_PNPM_VERSION_FAILED",
      "pnpm",
      "fixed pnpm version check failed",
    );
  }
  if (versionOutput.trim() !== recipe.packageManagerVersion) {
    fail(
      "CONTEXT_PNPM_VERSION_DRIFT",
      "pnpm",
      "host pnpm differs from exact recipe pin",
    );
  }
  const fetchArguments = pnpmFetchArguments(cliPath, toolchainRoot, storeRoot);
  assertPnpmFetchContract(
    fetchArguments,
    environment,
    await readFile(resolve(toolchainRoot, recipe.workspaceConfiguration.path)),
    clockPath,
    cliPath,
    toolchainRoot,
    storeRoot,
  );
  try {
    await runFixedProcess(process.execPath, fetchArguments, {
      cwd: toolchainRoot,
      environment,
      timeoutMs: 10 * 60_000,
    });
  } catch {
    fail(
      "CONTEXT_PNPM_FETCH_FAILED",
      "offline/pnpm-store",
      "fixed credentialless pnpm fetch failed",
    );
  }
  await removeGeneratedPnpmProjectRegistration(storeRoot, toolchainRoot);
  await normalizeGeneratedHardLinks(storeRoot, stagingRoot);
  const canonicalStoreIndex = await exportCanonicalPnpmStoreIndex(storeRoot);
  const walked = await safeWalk(storeRoot);
  if (walked.files.length === 0) {
    fail(
      "CONTEXT_OFFLINE_STORE_EMPTY",
      "offline/pnpm-store",
      "pnpm fetch produced no physical store files",
    );
  }
  const files = [];
  for (const file of walked.files) {
    await chmod(file.absolute, 0o600);
    const bytes = await readFile(file.absolute);
    files.push({
      path: file.path,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
    });
  }
  files.sort((left, right) => comparePortable(left.path, right.path));
  const storeIndexFile = files.find(
    ({ path }) => path === CANONICAL_PNPM_STORE_INDEX_PATH,
  );
  if (storeIndexFile === undefined) {
    fail(
      "CONTEXT_PNPM_STORE_INDEX_INVALID",
      CANONICAL_PNPM_STORE_INDEX_PATH,
      "canonical package index is absent from the materialized store",
    );
  }
  const storeManifest = {
    files,
    kind: "cloudmarkup.pnpm-offline-store",
    lifecycleScripts: "deny",
    network: "deny",
    packageManager: {
      implementation: PNPM_HOST_AUTHORITY.implementation,
      launchers: PNPM_HOST_AUTHORITY.launchers,
      name: "pnpm",
      packageMetadata: PNPM_HOST_AUTHORITY.packageMetadata,
      version: recipe.packageManagerVersion,
      worker: PNPM_HOST_AUTHORITY.worker,
    },
    schemaVersion: 1,
    sourceLockfile: {
      path: recipe.lockPath,
      sha256: sha256(lockBytes),
      sizeBytes: lockBytes.byteLength,
    },
    storeIndex: {
      entryCount: canonicalStoreIndex.entryCount,
      ...storeIndexFile,
    },
    storeVersion: PNPM_STORE_VERSION,
    target: PNPM_TARGET,
    workspaceConfiguration: recipe.workspaceConfiguration,
  };
  const storeManifestBytes = canonicalJson(storeManifest);
  if (storeManifestBytes.byteLength > MAXIMUM_GENERATED_MANIFEST_BYTES) {
    fail(
      "CONTEXT_FILE_TOO_LARGE",
      "offline/pnpm-store/manifest-v1.json",
      "generated JSON exceeds reviewed size limit",
    );
  }
  await writeFile(resolve(storeRoot, "manifest-v1.json"), storeManifestBytes, {
    flag: "wx",
    mode: 0o600,
  });
}

async function writeStagedOutput(stageRoot, output, bytes) {
  if (
    output.sha256 !== undefined &&
    (bytes.byteLength !== output.sizeBytes || sha256(bytes) !== output.sha256)
  ) {
    fail(
      "CONTEXT_ACQUISITION_DIGEST_MISMATCH",
      output.destination,
      "generated output differs from acquisition authority",
    );
  }
  const destination = resolve(stageRoot, ...output.destination.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
}

async function resolveStagedManifest(source, stageRoot) {
  const walked = await safeWalk(stageRoot);
  const actualPaths = new Set(walked.files.map((file) => file.path));
  for (const output of source.outputs) {
    if (!actualPaths.has(output.destination)) {
      fail(
        "CONTEXT_ACQUISITION_MISSING",
        output.destination,
        "declared generated output was not materialized",
      );
    }
  }
  for (const { path } of source.generatedPrefixes) {
    if (
      ![...actualPaths].some((candidate) => candidate.startsWith(`${path}/`))
    ) {
      fail(
        "CONTEXT_GENERATED_PREFIX_EMPTY",
        path,
        "reviewed generated prefix produced no files",
      );
    }
  }
  const records = [];
  for (const file of walked.files) {
    if (file.path === MANIFEST_NAME) continue;
    const bytes = await readFile(file.absolute);
    const sourceMember = source.byPath.get(file.path);
    const generatedOutput = source.generatedOutputByDestination.get(file.path);
    const prefix = source.generatedPrefixFor(file.path);
    if (
      sourceMember === undefined &&
      generatedOutput === undefined &&
      prefix === undefined
    ) {
      fail(
        "CONTEXT_UNDECLARED_MEMBER",
        file.path,
        "staged file has no reviewed source or generated authority",
      );
    }
    const record = {
      executable:
        sourceMember?.executable ?? generatedOutput?.executable ?? false,
      path: file.path,
      role: sourceMember?.role ?? generatedOutput?.role ?? prefix.role,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
    };
    if (
      sourceMember !== undefined &&
      (record.sha256 !== sourceMember.sha256 ||
        record.sizeBytes !== sourceMember.sizeBytes)
    ) {
      fail(
        "CONTEXT_CONTENT_DRIFT",
        file.path,
        "source member changed during staging",
      );
    }
    if (
      generatedOutput?.sha256 !== undefined &&
      (record.sha256 !== generatedOutput.sha256 ||
        record.sizeBytes !== generatedOutput.sizeBytes)
    ) {
      fail(
        "CONTEXT_ACQUISITION_DRIFT",
        file.path,
        "staged output differs from pinned acquisition",
      );
    }
    records.push(record);
  }
  records.sort((left, right) => comparePortable(left.path, right.path));
  const resolvedManifest = structuredClone(source.manifest);
  resolvedManifest.members = records;
  const resolvedManifestBytes = canonicalJson(resolvedManifest);
  if (resolvedManifestBytes.byteLength > MAXIMUM_GENERATED_MANIFEST_BYTES) {
    fail(
      "CONTEXT_FILE_TOO_LARGE",
      MANIFEST_NAME,
      "generated JSON exceeds reviewed size limit",
    );
  }
  await writeFile(resolve(stageRoot, MANIFEST_NAME), resolvedManifestBytes, {
    mode: 0o600,
  });
}

export async function materializeBetaImageContexts(
  repositoryRootInput = resolve("."),
  {
    contextIds,
    dockerExecutable,
    fetchImpl,
    goToolCacheRoot,
    pnpmCliPath,
    stagingParent,
  } = {},
) {
  const repositoryRoot = resolve(repositoryRootInput);
  const selected = selectedContextSpecs(contextIds);
  if (goToolCacheRoot !== undefined) {
    const local = relative(
      resolve(repositoryRoot, ".cache"),
      resolve(goToolCacheRoot),
    );
    if (
      !local ||
      local === ".." ||
      local.startsWith(".." + sep) ||
      isAbsolute(local)
    )
      fail(
        "CONTEXT_GO_CACHE_INVALID",
        "cache",
        "cache must be inside the repository cache directory",
      );
  }
  // Check every declared source before acquiring only the requested consumer closure.
  const declaredContexts = await validateBetaImageContexts(repositoryRoot, {
    allowMissingAcquired: true,
  });
  const sourceContexts = declaredContexts.filter((context) =>
    selected.includes(context.spec),
  );
  for (const context of sourceContexts) {
    for (const artifact of context.artifacts) {
      if (artifact.type === "https-go-source-v1")
        await readReviewedGoBuildInputs(repositoryRoot, artifact.tool);
    }
  }
  const parent =
    stagingParent === undefined ? tmpdir() : resolve(stagingParent);
  const stagingRoot = await mkdtemp(
    resolve(parent, "cloudmarkup-beta-image-contexts-"),
  );
  let succeeded = false;
  try {
    const stagedRepository = resolve(stagingRoot, "repository");
    await mkdir(resolve(stagedRepository, "infra", "images"), {
      recursive: true,
    });
    await writeFile(
      resolve(stagedRepository, "pnpm-lock.yaml"),
      await readFile(resolve(repositoryRoot, "pnpm-lock.yaml")),
      { flag: "wx", mode: 0o600 },
    );
    const ociCache = new Map();
    const goBuildCache = new Map();
    for (const source of sourceContexts) {
      const stageRoot = resolve(
        stagedRepository,
        ...source.spec.relativeRoot.split("/"),
      );
      await mkdir(dirname(stageRoot), { recursive: true });
      await copyDeclaredSource(source, stageRoot);
      for (const artifact of source.artifacts) {
        if (artifact.type === "https-go-source-v1") {
          if (!goBuildCache.has(artifact.tool)) {
            let extracted = await readReviewedGoCache(
              goToolCacheRoot,
              artifact,
            );
            if (extracted === undefined) {
              extracted = await buildReviewedGoSource({
                artifact,
                sourceBytes: await fetchPinnedArtifact(artifact, fetchImpl),
                repositoryRoot,
                stagingRoot,
                dockerExecutable,
                runProcess: runFixedProcess,
              });
              await writeReviewedGoCache(goToolCacheRoot, artifact, extracted);
            }
            goBuildCache.set(artifact.tool, extracted);
          }
          for (const entry of goBuildCache.get(artifact.tool))
            await writeStagedOutput(stageRoot, entry.output, entry.bytes);
          continue;
        }
        if (artifact.type === "oci-trivy-db-v1") {
          const extracted = await fetchTrivyDbArtifact(
            artifact,
            fetchImpl,
            ociCache,
          );
          for (const entry of extracted) {
            const currentOutput = artifact.members.find(
              (member) => member.archivePath === entry.output.archivePath,
            );
            await writeStagedOutput(
              stageRoot,
              {
                ...currentOutput,
                sha256: entry.output.sha256,
                sizeBytes: entry.output.sizeBytes,
              },
              entry.bytes,
            );
          }
          continue;
        }
        const bytes = await fetchPinnedArtifact(artifact, fetchImpl);
        if (artifact.type === "https-file") {
          if (artifact.zipMembers !== undefined) {
            extractPinnedZip(bytes, {
              ...artifact,
              members: artifact.zipMembers,
            });
          }
          await writeStagedOutput(stageRoot, artifact, bytes);
        } else {
          const extracted =
            artifact.type === "https-zip"
              ? extractPinnedZip(bytes, artifact)
              : extractPinnedTarGzip(bytes, artifact);
          for (const entry of extracted) {
            await writeStagedOutput(stageRoot, entry.output, entry.bytes);
          }
        }
      }
      await materializePnpmStore({
        context: source,
        pnpmCliPath,
        stageRoot,
        stagingRoot,
      });
      await resolveStagedManifest(source, stageRoot);
    }
    ociCache.clear();
    const contexts = await validateBetaImageContexts(stagedRepository, {
      contextIds,
      allowMissingAcquired: false,
    });
    succeeded = true;
    return {
      contexts,
      dispose: async () => rm(stagingRoot, { force: true, recursive: true }),
      stagingRoot,
    };
  } finally {
    if (!succeeded) await rm(stagingRoot, { force: true, recursive: true });
  }
}

function tryEncodeTarPath(portable) {
  const full = Buffer.byteLength(portable, "utf8");
  if (full <= 100) return { name: portable, prefix: "" };
  for (
    let index = portable.lastIndexOf("/");
    index > 0;
    index = portable.lastIndexOf("/", index - 1)
  ) {
    const prefix = portable.slice(0, index);
    const name = portable.slice(index + 1);
    if (
      Buffer.byteLength(prefix, "utf8") <= 155 &&
      Buffer.byteLength(name, "utf8") <= 100
    ) {
      return { name, prefix };
    }
  }
  return undefined;
}

function encodeTarPath(portable) {
  const encoded = tryEncodeTarPath(portable);
  if (encoded !== undefined) return encoded;
  fail(
    "CONTEXT_TAR_PATH_INVALID",
    portable,
    "path cannot be represented in canonical ustar",
  );
}

function writeString(header, offset, length, value) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength > length)
    fail("CONTEXT_TAR_FIELD_INVALID", value, "tar field is too long");
  bytes.copy(header, offset);
}

function writeOctal(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length > length - 1)
    fail(
      "CONTEXT_TAR_FIELD_INVALID",
      String(value),
      "tar numeric field overflows",
    );
  writeString(header, offset, length, `${encoded}\0`);
}

function tarHeader(memberPath, size, executable, type = "0") {
  if (type !== "0" && type !== "x") {
    fail("CONTEXT_TAR_FIELD_INVALID", type, "tar type is not canonical");
  }
  const header = Buffer.alloc(512);
  const { name, prefix } = encodeTarPath(memberPath);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, executable ? 0o555 : 0o444);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function tarPaddingLength(size) {
  return (512 - (size % 512)) % 512;
}

function paxPathRecord(portable) {
  let length = Buffer.byteLength(`0 path=${portable}\n`, "utf8");
  while (true) {
    const record = Buffer.from(`${String(length)} path=${portable}\n`, "utf8");
    if (record.byteLength === length) return record;
    length = record.byteLength;
  }
}

function canonicalTarEnvelope(entry) {
  if (tryEncodeTarPath(entry.path) !== undefined) {
    return {
      memberHeader: tarHeader(entry.path, entry.sizeBytes, entry.executable),
      pax: undefined,
    };
  }
  const pathDigest = sha256(Buffer.from(entry.path, "utf8"));
  const bytes = paxPathRecord(entry.path);
  return {
    memberHeader: tarHeader(
      `PaxFiles/${pathDigest}`,
      entry.sizeBytes,
      entry.executable,
    ),
    pax: {
      bytes,
      header: tarHeader(
        `PaxHeaders/${pathDigest}`,
        bytes.byteLength,
        false,
        "x",
      ),
    },
  };
}

function canonicalTarEntrySize(entry) {
  const { pax } = canonicalTarEnvelope(entry);
  return (
    512 +
    entry.sizeBytes +
    tarPaddingLength(entry.sizeBytes) +
    (pax === undefined
      ? 0
      : 512 + pax.bytes.byteLength + tarPaddingLength(pax.bytes.byteLength))
  );
}

async function emitChunk(chunk, hash, output) {
  hash.update(chunk);
  if (output !== undefined) await output.write(chunk);
}

export async function createCanonicalContextArchive(context, outputPath) {
  const entries = canonicalArchiveEntries(context);
  let output;
  if (outputPath !== undefined) {
    const absoluteOutput = resolve(outputPath);
    const relativeToContext = relative(context.root, absoluteOutput);
    if (
      relativeToContext === "" ||
      (!relativeToContext.startsWith(`..${sep}`) && relativeToContext !== "..")
    ) {
      fail(
        "CONTEXT_ARCHIVE_OUTPUT_INVALID",
        outputPath,
        "archive output cannot be inside its input context",
      );
    }
    await mkdir(dirname(absoluteOutput), { recursive: true });
    output = await open(absoluteOutput, "wx", 0o600);
  }
  const hash = createHash("sha256");
  try {
    for (const entry of entries) {
      const bytes =
        entry.path === MANIFEST_NAME
          ? context.canonicalManifestBytes
          : await readFile(
              context.actualByPath.get(entry.path)?.absolute,
            ).catch(() => undefined);
      if (
        bytes === undefined ||
        (entry.path !== MANIFEST_NAME &&
          (bytes.byteLength !== entry.sizeBytes ||
            sha256(bytes) !== entry.sha256))
      ) {
        fail(
          "CONTEXT_MEMBER_MISSING",
          entry.path,
          "canonical archive input is missing or changed",
        );
      }
      const envelope = canonicalTarEnvelope({
        ...entry,
        sizeBytes: bytes.byteLength,
      });
      if (envelope.pax !== undefined) {
        await emitChunk(envelope.pax.header, hash, output);
        await emitChunk(envelope.pax.bytes, hash, output);
        const paxPadding = tarPaddingLength(envelope.pax.bytes.byteLength);
        if (paxPadding > 0) {
          await emitChunk(Buffer.alloc(paxPadding), hash, output);
        }
      }
      await emitChunk(envelope.memberHeader, hash, output);
      await emitChunk(bytes, hash, output);
      const padding = tarPaddingLength(bytes.byteLength);
      if (padding > 0) await emitChunk(Buffer.alloc(padding), hash, output);
    }
    await emitChunk(Buffer.alloc(1024), hash, output);
    return hash.digest("hex");
  } finally {
    await output?.close();
  }
}

function canonicalArchiveEntries(context) {
  if (
    !Buffer.isBuffer(context?.canonicalManifestBytes) ||
    !Array.isArray(context?.members) ||
    context.members.length === 0 ||
    context.members.length >= MAXIMUM_FILES
  ) {
    fail(
      "CONTEXT_CANONICAL_ARCHIVE_INVALID",
      "context",
      "canonical context authority is unavailable or unbounded",
    );
  }
  const entries = [
    {
      executable: false,
      path: MANIFEST_NAME,
      sha256: sha256(context.canonicalManifestBytes),
      sizeBytes: context.canonicalManifestBytes.byteLength,
    },
    ...context.members,
  ].sort((left, right) => comparePortable(left.path, right.path));
  const validated = entries.map((entry, index) => {
    const recordPath = `canonicalArchive.members[${String(index)}]`;
    if (!plain(entry)) {
      fail(
        "CONTEXT_CANONICAL_ARCHIVE_INVALID",
        recordPath,
        "canonical member authority must be an object",
      );
    }
    const memberPath = portablePath(entry.path, `${recordPath}.path`);
    assertNoSensitivePath(memberPath, `${recordPath}.path`);
    string(entry.sha256, `${recordPath}.sha256`, SHA256_PATTERN);
    integer(entry.sizeBytes, `${recordPath}.sizeBytes`, MAXIMUM_FILE_BYTES);
    if (typeof entry.executable !== "boolean") {
      fail(
        "CONTEXT_CANONICAL_ARCHIVE_INVALID",
        `${recordPath}.executable`,
        "canonical executable authority must be boolean",
      );
    }
    return {
      executable: entry.executable,
      path: memberPath,
      sha256: entry.sha256,
      sizeBytes: entry.sizeBytes,
    };
  });
  validateOrderedUnique(validated, "canonicalArchive.members");
  return validated;
}

async function readArchiveExact(handle, position, length, path) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(
      bytes,
      offset,
      length - offset,
      position + offset,
    );
    if (bytesRead === 0) {
      fail(
        "CONTEXT_CANONICAL_ARCHIVE_DRIFT",
        path,
        "canonical archive ended before its exact authority",
      );
    }
    offset += bytesRead;
  }
  return bytes;
}

async function writeAll(handle, bytes, position) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      position + offset,
    );
    if (bytesWritten === 0) {
      fail(
        "CONTEXT_BUILD_OUTPUT_INVALID",
        handle.path ?? "build-context",
        "canonical member could not be written completely",
      );
    }
    offset += bytesWritten;
  }
}

async function finalizeCanonicalExtraction({
  archive,
  destination,
  destinationCreated,
  operationError,
  result,
}) {
  let closeError;
  if (archive !== undefined) {
    try {
      await archive.close();
    } catch (error) {
      closeError = error;
    }
  }
  let cleanupError;
  if (
    destinationCreated &&
    (operationError !== undefined || closeError !== undefined)
  ) {
    try {
      await rm(destination, { force: true, recursive: true });
    } catch (error) {
      cleanupError = error;
    }
  }
  const cleanupErrors = [closeError, cleanupError].filter(
    (error) => error !== undefined,
  );
  if (operationError !== undefined) {
    if (cleanupErrors.length > 0 && operationError instanceof Error) {
      operationError.cause = new AggregateError(
        cleanupErrors,
        "canonical archive cleanup failed",
      );
    }
    throw operationError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "canonical archive close or cleanup failed",
    );
  }
  if (result === undefined) {
    fail(
      "CONTEXT_BUILD_OUTPUT_INVALID",
      destination,
      "canonical extraction produced no admitted result",
    );
  }
  return result;
}

export async function extractCanonicalContextArchive(
  context,
  archivePathInput,
  destinationInput,
  expectedDigest,
) {
  string(expectedDigest, "canonicalArchive.sha256", SHA256_PATTERN);
  const archivePath = resolve(archivePathInput);
  const destination = resolve(destinationInput);
  const destinationMetadata = await lstat(destination).catch(() => undefined);
  if (destinationMetadata !== undefined) {
    fail(
      "CONTEXT_BUILD_OUTPUT_INVALID",
      destination,
      "tar-derived build context destination must not already exist",
    );
  }
  const archiveMetadata = await lstat(archivePath).catch(() => undefined);
  if (
    archiveMetadata === undefined ||
    !archiveMetadata.isFile() ||
    archiveMetadata.isSymbolicLink() ||
    archiveMetadata.nlink !== 1
  ) {
    fail(
      "CONTEXT_CANONICAL_ARCHIVE_INVALID",
      archivePath,
      "canonical archive must be one regular, unlinked file",
    );
  }
  const entries = canonicalArchiveEntries(context);
  const expectedSize =
    entries.reduce((total, entry) => total + canonicalTarEntrySize(entry), 0) +
    1024;
  if (
    !Number.isSafeInteger(expectedSize) ||
    archiveMetadata.size !== expectedSize
  ) {
    fail(
      "CONTEXT_CANONICAL_ARCHIVE_DRIFT",
      archivePath,
      "canonical archive size differs from its admitted member set",
    );
  }
  const archiveHash = createHash("sha256");
  let position = 0;
  let archive;
  let result;
  let operationError;
  let destinationCreated = false;
  try {
    archive = await open(archivePath, "r");
    const openedMetadata = await archive.stat();
    if (
      !openedMetadata.isFile() ||
      openedMetadata.nlink !== 1 ||
      openedMetadata.size !== expectedSize ||
      openedMetadata.dev !== archiveMetadata.dev ||
      openedMetadata.ino !== archiveMetadata.ino
    ) {
      fail(
        "CONTEXT_CANONICAL_ARCHIVE_DRIFT",
        archivePath,
        "opened archive identity or size differs from the reviewed path",
      );
    }
    await mkdir(destination, { recursive: false });
    destinationCreated = true;
    for (const entry of entries) {
      const envelope = canonicalTarEnvelope(entry);
      if (envelope.pax !== undefined) {
        const paxHeader = await readArchiveExact(
          archive,
          position,
          512,
          archivePath,
        );
        position += 512;
        archiveHash.update(paxHeader);
        if (!paxHeader.equals(envelope.pax.header)) {
          fail(
            "CONTEXT_CANONICAL_ARCHIVE_DRIFT",
            entry.path,
            "PAX header is not the exact canonical path authority",
          );
        }
        const paxBytes = await readArchiveExact(
          archive,
          position,
          envelope.pax.bytes.byteLength,
          archivePath,
        );
        position += paxBytes.byteLength;
        archiveHash.update(paxBytes);
        if (!paxBytes.equals(envelope.pax.bytes)) {
          fail(
            "CONTEXT_CANONICAL_ARCHIVE_DRIFT",
            entry.path,
            "PAX path record differs from the exact canonical member path",
          );
        }
        const paxPaddingLength = tarPaddingLength(paxBytes.byteLength);
        if (paxPaddingLength > 0) {
          const paxPadding = await readArchiveExact(
            archive,
            position,
            paxPaddingLength,
            archivePath,
          );
          position += paxPaddingLength;
          archiveHash.update(paxPadding);
          if (!paxPadding.every((byte) => byte === 0)) {
            fail(
              "CONTEXT_CANONICAL_ARCHIVE_DRIFT",
              entry.path,
              "PAX record padding is not canonical",
            );
          }
        }
      }
      const header = await readArchiveExact(
        archive,
        position,
        512,
        archivePath,
      );
      position += 512;
      archiveHash.update(header);
      if (!header.equals(envelope.memberHeader)) {
        fail(
          "CONTEXT_CANONICAL_ARCHIVE_DRIFT",
          entry.path,
          "tar header is not the exact canonical member authority",
        );
      }
      const target = resolve(destination, ...entry.path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      const output = await open(target, "wx", 0o600);
      const memberHash = createHash("sha256");
      let written = 0;
      try {
        while (written < entry.sizeBytes) {
          const length = Math.min(1024 * 1024, entry.sizeBytes - written);
          const chunk = await readArchiveExact(
            archive,
            position,
            length,
            archivePath,
          );
          position += length;
          archiveHash.update(chunk);
          memberHash.update(chunk);
          await writeAll(output, chunk, written);
          written += length;
        }
      } finally {
        await output.close();
      }
      if (memberHash.digest("hex") !== entry.sha256) {
        fail(
          "CONTEXT_CANONICAL_ARCHIVE_DRIFT",
          entry.path,
          "tar member bytes differ from the admitted manifest authority",
        );
      }
      const paddingLength = tarPaddingLength(entry.sizeBytes);
      if (paddingLength > 0) {
        const padding = await readArchiveExact(
          archive,
          position,
          paddingLength,
          archivePath,
        );
        position += paddingLength;
        archiveHash.update(padding);
        if (!padding.every((byte) => byte === 0)) {
          fail(
            "CONTEXT_CANONICAL_ARCHIVE_DRIFT",
            entry.path,
            "tar member padding is not canonical",
          );
        }
      }
      await chmod(target, entry.executable ? 0o555 : 0o444);
    }
    const terminator = await readArchiveExact(
      archive,
      position,
      1024,
      archivePath,
    );
    position += 1024;
    archiveHash.update(terminator);
    if (!terminator.every((byte) => byte === 0)) {
      fail(
        "CONTEXT_CANONICAL_ARCHIVE_DRIFT",
        archivePath,
        "canonical archive terminator differs",
      );
    }
    const trailing = Buffer.alloc(1);
    const { bytesRead: trailingBytes } = await archive.read(
      trailing,
      0,
      1,
      position,
    );
    const finalMetadata = await archive.stat();
    const finalPathMetadata = await lstat(archivePath).catch(() => undefined);
    if (
      trailingBytes !== 0 ||
      !finalMetadata.isFile() ||
      finalMetadata.nlink !== 1 ||
      finalMetadata.size !== expectedSize ||
      finalMetadata.dev !== openedMetadata.dev ||
      finalMetadata.ino !== openedMetadata.ino ||
      finalPathMetadata === undefined ||
      !finalPathMetadata.isFile() ||
      finalPathMetadata.isSymbolicLink() ||
      finalPathMetadata.nlink !== 1 ||
      finalPathMetadata.size !== expectedSize ||
      finalPathMetadata.dev !== openedMetadata.dev ||
      finalPathMetadata.ino !== openedMetadata.ino
    ) {
      fail(
        "CONTEXT_CANONICAL_ARCHIVE_DRIFT",
        archivePath,
        "opened archive changed or contains trailing bytes",
      );
    }
    if (
      position !== expectedSize ||
      archiveHash.digest("hex") !== expectedDigest
    ) {
      fail(
        "CONTEXT_CANONICAL_ARCHIVE_DRIFT",
        archivePath,
        "canonical archive digest differs from the admitted authority",
      );
    }
    const extracted = await safeWalk(destination);
    const expectedPaths = entries.map(({ path }) => path);
    const actualPaths = extracted.files
      .map(({ path }) => path)
      .sort(comparePortable);
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
      fail(
        "CONTEXT_BUILD_OUTPUT_INVALID",
        destination,
        "tar-derived build context coverage differs from the canonical archive",
      );
    }
    result = { digest: expectedDigest, root: destination };
  } catch (error) {
    operationError = error;
  }
  return finalizeCanonicalExtraction({
    archive,
    destination,
    destinationCreated,
    operationError,
    result,
  });
}

export async function digestBetaImageContexts(
  repositoryRootInput = resolve("."),
  options = {},
) {
  const staged = await materializeBetaImageContexts(
    repositoryRootInput,
    options,
  );
  try {
    const result = {};
    for (const context of staged.contexts) {
      result[context.spec.contextId] =
        await createCanonicalContextArchive(context);
    }
    return result;
  } finally {
    await staged.dispose();
  }
}

async function requireEmptyRealDirectory(path, label) {
  const root = resolve(path);
  const metadata = await lstat(root).catch(() => undefined);
  if (
    metadata === undefined ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink()
  ) {
    fail(
      "CONTEXT_ARCHIVE_OUTPUT_INVALID",
      root,
      `${label} must be an existing real directory`,
    );
  }
  if ((await readdir(root)).length !== 0) {
    fail("CONTEXT_ARCHIVE_OUTPUT_INVALID", root, `${label} must be empty`);
  }
  return root;
}

export async function archiveBetaImageContexts(
  outputDirectory,
  repositoryRootInput = resolve("."),
  { resolvedOutputDirectory, ...options } = {},
) {
  const outputRoot = resolve(outputDirectory);
  await requireEmptyRealDirectory(outputRoot, "bundle output directory");
  const resolvedRoot =
    resolvedOutputDirectory === undefined
      ? undefined
      : await requireEmptyRealDirectory(
          resolvedOutputDirectory,
          "resolved context output directory",
        );
  if (resolvedRoot === outputRoot) {
    fail(
      "CONTEXT_ARCHIVE_OUTPUT_INVALID",
      outputRoot,
      "bundle and resolved context outputs must differ",
    );
  }
  const staged = await materializeBetaImageContexts(
    repositoryRootInput,
    options,
  );
  try {
    const result = {};
    for (const context of staged.contexts) {
      const archivePath = resolve(outputRoot, `${context.spec.contextId}.tar`);
      result[context.spec.contextId] = await createCanonicalContextArchive(
        context,
        archivePath,
      );
      if (resolvedRoot !== undefined) {
        await extractCanonicalContextArchive(
          context,
          archivePath,
          resolve(resolvedRoot, context.spec.contextId),
          result[context.spec.contextId],
        );
      }
    }
    await writeFile(
      resolve(outputRoot, "CONTEXT_DIGESTS"),
      formatBetaImageContextDigests(result, options.contextIds),
      { flag: "wx", mode: 0o600 },
    );
    return result;
  } finally {
    await staged.dispose();
  }
}

export function formatBetaImageContextDigests(result, contextIds) {
  const specs = selectedContextSpecs(contextIds);
  if (
    Object.keys(result).length !== specs.length ||
    specs.some(({ contextId }) => !SHA256_PATTERN.test(result[contextId] ?? ""))
  ) {
    fail(
      "CONTEXT_DIGEST_INVALID",
      "CONTEXT_DIGESTS",
      "exactly the requested canonical context digests are required",
    );
  }
  return specs
    .map(
      ({ contextId }) =>
        `${contextId.replaceAll("-", "_").toUpperCase()}_CONTEXT_SHA256=${result[contextId]}\n`,
    )
    .join("");
}

export const BETA_IMAGE_CONTEXT_SPECS = CONTEXT_SPECS;

export const BETA_IMAGE_CONTEXT_TESTING = Object.freeze({
  assertPnpmFetchContract,
  canonicalJson,
  extractPinnedTarGzip,
  extractPinnedZip,
  fetchOciBytes,
  fetchPinnedArtifact,
  finalizeCanonicalExtraction,
  normalizeGeneratedHardLinks,
  pnpmFetchArguments,
  pnpmDeterministicClockBytes: () =>
    Buffer.from(PNPM_DETERMINISTIC_CLOCK_BYTES),
  pnpmDeterministicClockPath: PNPM_DETERMINISTIC_CLOCK_PATH,
  pnpmDeterministicNodeOptions,
  pnpmHostAuthority: PNPM_HOST_AUTHORITY,
  pnpmStoreVersion: PNPM_STORE_VERSION,
  pnpmTarget: PNPM_TARGET,
  pnpmWorkspaceConfiguration: () =>
    Buffer.from(PNPM_WORKSPACE_CONFIGURATION_BYTES),
  parseAcquisition,
  removeGeneratedPnpmProjectRegistration,
  stageVerifiedPnpmImplementation,
  readBoundedResponseBody,
  sha256,
});
