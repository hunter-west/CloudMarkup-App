import { createPublicKey } from "node:crypto";

import {
  CUSTOMER_CI_LIMITS_V1,
  CUSTOMER_CI_WORKFLOW_PATHS,
  type CustomerCiWorkflowConfigV1,
} from "./contracts.js";
import { canonicalJson, sha256 } from "./security.js";

const RAW_PLAN_MAX_BYTES = 8 * 1024 * 1024;
const JSON_ARTIFACT_MAX_BYTES = 8 * 1024 * 1024;
const MANIFEST_MAX_BYTES = 128 * 1024;
const BACKEND_CONFIG_MAX_BYTES = 8 * 1024;
const PLAN_BINARY_MAX_BYTES = 256 * 1024 * 1024;
const ENCRYPTED_PLAN_MAX_BYTES = PLAN_BINARY_MAX_BYTES + 64 * 1024;
const GITHUB_RUN_MAX_BYTES = 256 * 1024;
const PACKAGE_FILE_MAX_BYTES = 16 * 1024 * 1024;
const PACKAGE_TREE_MAX_ENTRIES = 10_000;
const PACKAGE_TREE_MAX_DEPTH = 32;
const PACKAGE_PATH_MAX_BYTES = 512;
const TERRAFORM_SOURCE_MAX_TOKENS = 250_000;
const TERRAFORM_SOURCE_MAX_DEPTH = 128;
const TERRAFORM_JSON_MAX_NODES = 100_000;
const PLAN_ISSUE_LIMIT = 256;
const PLAN_UNRESOLVED_BEHAVIOR =
  "Provider-computed values, account policy, quotas, and runtime behavior remain unresolved until the customer reviews and executes this plan.";

function packageFilePath(
  config: CustomerCiWorkflowConfigV1,
  path: string,
): string {
  return config.repository.destinationFolder === ""
    ? path
    : `${config.repository.destinationFolder}/${path}`;
}

function packageRelativeTerraformRoot(
  config: CustomerCiWorkflowConfigV1,
): string {
  return config.repository.destinationFolder === ""
    ? config.terraform.rootDirectory
    : config.terraform.rootDirectory.slice(
        config.repository.destinationFolder.length + 1,
      );
}

function planEncryptionPublicKeyDigest(
  config: CustomerCiWorkflowConfigV1,
): string {
  const publicKey = createPublicKey(
    config.plan.artifactEncryption.publicKeyPem,
  );
  if (
    publicKey.asymmetricKeyType !== "rsa" ||
    (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3_072
  ) {
    throw new TypeError(
      "Plan encryption requires a reviewed RSA-3072 or stronger public key.",
    );
  }
  return sha256(publicKey.export({ format: "der", type: "spki" }));
}

function terraformSourceInspectionScriptLines(): readonly string[] {
  return String.raw`
const terraformSourceTokenMaximum = ${String(TERRAFORM_SOURCE_MAX_TOKENS)};
const terraformSourceDepthMaximum = ${String(TERRAFORM_SOURCE_MAX_DEPTH)};
const terraformJsonNodeMaximum = ${String(TERRAFORM_JSON_MAX_NODES)};
const forbiddenTerraformBlockKinds = new Set(['module', 'provider', 'provisioner']);
const forbiddenTerraformAssignmentNames = new Set(['provider']);
const decodeTerraformSource = (bytes) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(); } };
const inspectTerraformJson = (source) => {
  let root; try { root = JSON.parse(source); } catch { fail(); }
  if (!plain(root)) fail();
  const pending = [{ depth: 0, value: root }]; let nodeCount = 0;
  while (pending.length > 0) {
    const current = pending.pop(); nodeCount += 1;
    if (nodeCount > terraformJsonNodeMaximum || current.depth > terraformSourceDepthMaximum) fail();
    if (Array.isArray(current.value)) {
      for (const value of current.value) pending.push({ depth: current.depth + 1, value });
    } else if (plain(current.value)) {
      for (const [key, value] of Object.entries(current.value)) {
        if (forbiddenTerraformBlockKinds.has(key)) fail();
        pending.push({ depth: current.depth + 1, value });
      }
    } else if (current.value !== null && typeof current.value !== 'string' && typeof current.value !== 'boolean' && !(typeof current.value === 'number' && Number.isFinite(current.value))) fail();
  }
};
const inspectTerraformHcl = (source) => {
  let index = 0; let tokenCount = 0; const nesting = []; const recent = [];
  const emit = (kind, value = '') => {
    tokenCount += 1; if (tokenCount > terraformSourceTokenMaximum) fail();
    recent.push({ kind, value }); if (recent.length > 3) recent.shift();
    if (kind === 'symbol' && value === '{' && recent.length === 3) {
      const keyword = recent[0]; const label = recent[1];
      if (keyword.kind === 'identifier' && forbiddenTerraformBlockKinds.has(keyword.value) && label.kind === 'string') fail();
    }
    if (kind === 'symbol' && value === '=' && recent.length >= 2) {
      const keyword = recent[recent.length - 2];
      if (keyword.kind === 'identifier' && forbiddenTerraformAssignmentNames.has(keyword.value)) fail();
    }
  };
  const wordStart = (character) => /[A-Za-z_]/.test(character) || character.charCodeAt(0) >= 0x80;
  const wordContinue = (character) => /[A-Za-z0-9_-]/.test(character) || character.charCodeAt(0) >= 0x80;
  while (index < source.length) {
    const character = source[index]; const next = source[index + 1] || '';
    if (character === ' ' || character === '\t' || character === '\r' || character === '\n') { index += 1; continue; }
    if (character === '#' || (character === '/' && next === '/')) { const newline = source.indexOf('\n', index + 1); index = newline < 0 ? source.length : newline + 1; continue; }
    if (character === '/' && next === '*') { const close = source.indexOf('*/', index + 2); if (close < 0) fail(); index = close + 2; continue; }
    if (character === '*' && next === '/') fail();
    if (character === '"') {
      index += 1; let closed = false;
      while (index < source.length) {
        const value = source[index];
        if (value === '"') { index += 1; closed = true; break; }
        if (value === '\\') {
          const escaped = source[index + 1]; if (!escaped) fail();
          const digits = escaped === 'u' ? 4 : escaped === 'U' ? 8 : 0;
          if (digits > 0) { const valueDigits = source.slice(index + 2, index + 2 + digits); if (valueDigits.length !== digits || !/^[0-9A-Fa-f]+$/.test(valueDigits)) fail(); index += 2 + digits; continue; }
          if (!['n', 'r', 't', '"', '\\'].includes(escaped)) fail(); index += 2; continue;
        }
        if (value === '\r' || value === '\n' || value.charCodeAt(0) < 0x20 || value.charCodeAt(0) === 0x7f) fail();
        index += 1;
      }
      if (!closed) fail(); emit('string'); continue;
    }
    if (character === '<' && next === '<') {
      index += 2; let indented = false; if (source[index] === '-') { indented = true; index += 1; }
      const labelMatch = /^[A-Za-z_][A-Za-z0-9_-]{0,127}/.exec(source.slice(index)); if (!labelMatch) fail(); const label = labelMatch[0]; index += label.length;
      const headerEnd = source.indexOf('\n', index); if (headerEnd < 0 || !/^[ \t]*\r?$/.test(source.slice(index, headerEnd))) fail(); index = headerEnd + 1;
      let closed = false;
      while (index <= source.length) {
        const lineEnd = source.indexOf('\n', index); const end = lineEnd < 0 ? source.length : lineEnd; let line = source.slice(index, end); if (line.endsWith('\r')) line = line.slice(0, -1);
        const candidate = indented ? line.replace(/^[ \t]*/, '') : line;
        if (candidate === label) { index = lineEnd < 0 ? source.length : lineEnd + 1; closed = true; break; }
        if (lineEnd < 0) break; index = lineEnd + 1;
      }
      if (!closed) fail(); emit('heredoc'); continue;
    }
    if (wordStart(character) || /[0-9]/.test(character)) {
      const start = index; index += 1; while (index < source.length && wordContinue(source[index])) index += 1;
      const value = source.slice(start, index); emit(wordStart(character) ? 'identifier' : 'word', value); continue;
    }
    if (character === '{' || character === '[' || character === '(') {
      const expected = character === '{' ? '}' : character === '[' ? ']' : ')'; nesting.push(expected); if (nesting.length > terraformSourceDepthMaximum) fail(); emit('symbol', character); index += 1; continue;
    }
    if (character === '}' || character === ']' || character === ')') { if (nesting.pop() !== character) fail(); emit('symbol', character); index += 1; continue; }
    if (character === "'" || character === '\\' || character.charCodeAt(0) === 0x60 || character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f) fail();
    emit('symbol', character); index += 1;
  }
  if (nesting.length !== 0) fail();
};
`
    .trim()
    .split("\n");
}

function terraformBackendInspectionScriptLines(): readonly string[] {
  return String.raw`
const inspectTerraformBackendConfig = (bytes, expectedRegion) => {
  if (bytes.byteLength < 1 || bytes.byteLength > ${String(BACKEND_CONFIG_MAX_BYTES)} || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) fail();
  const source = decodeTerraformSource(bytes);
  if (!source.endsWith('\n') || source.includes('\r') || /#|\/\/|\/\*|\*\//.test(source)) fail();
  const lines = source.slice(0, -1).split('\n'); if (lines.length !== 6) fail();
  const allowed = new Set(['bucket', 'encrypt', 'key', 'region', 'use_lockfile', 'workspace_key_prefix']); const assignments = new Map();
  for (const line of lines) {
    const match = /^([a-z][a-z0-9_]*)[ \t]*=[ \t]*(true|"[A-Za-z0-9._\/-]+")$/.exec(line);
    if (!match || !allowed.has(match[1]) || assignments.has(match[1])) fail(); assignments.set(match[1], match[2]);
  }
  if (assignments.size !== allowed.size || [...allowed].some((key) => !assignments.has(key))) fail();
  const stringValue = (name, maximum, pattern) => {
    const token = assignments.get(name); if (typeof token !== 'string' || !token.startsWith('"') || !token.endsWith('"')) fail();
    const value = token.slice(1, -1); if (Buffer.byteLength(value, 'utf8') < 1 || Buffer.byteLength(value, 'utf8') > maximum || !pattern.test(value)) fail(); return value;
  };
  const safePath = (name, maximum) => {
    const value = stringValue(name, maximum, /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/);
    if (value.startsWith('/') || value.endsWith('/') || value.includes('//') || value.split('/').some((part) => part === '.' || part === '..')) fail(); return value;
  };
  const bucket = stringValue('bucket', 63, /^[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])$/);
  if (bucket.includes('..') || bucket.includes('.-') || bucket.includes('-.') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucket)) fail();
  safePath('key', 512); safePath('workspace_key_prefix', 256);
  const region = stringValue('region', 64, /^[a-z]{2}(?:-[a-z0-9]{1,16}){1,3}-[1-9][0-9]?$/);
  if (assignments.get('encrypt') !== 'true' || assignments.get('use_lockfile') !== 'true') fail();
  if (expectedRegion !== '' && (typeof expectedRegion !== 'string' || region !== expectedRegion)) fail();
};
`
    .trim()
    .split("\n");
}

function environmentConfigs(config: CustomerCiWorkflowConfigV1) {
  return Object.fromEntries(
    config.environments.map((environment) => [
      environment.id,
      {
        approvedBranches: environment.approvedBranches,
        backend: config.terraform.backend,
        githubEnvironment: environment.githubEnvironment,
        protected: environment.protected,
        requiredApprovals: environment.requiredApprovals,
        smokeBaseUrlDigest: environment.smokeBaseUrlDigest,
        workspace: environment.workspace,
      },
    ]),
  );
}
function targetAuthorityScriptLines(
  config: CustomerCiWorkflowConfigV1,
): readonly string[] {
  const oidcSubjects = Object.fromEntries(
    config.environments.map(({ githubEnvironment, id }) => [
      id,
      `${config.repository.oidcSubject.subjectPrefix}${githubEnvironment}`,
    ]),
  );
  return [
    `const targetOidcSubjects = ${canonicalJson(oidcSubjects)};`,
    `const targetRepository = ${JSON.stringify(`${config.repository.owner}/${config.repository.name}`)}; const targetRepositoryId = ${JSON.stringify(config.repository.oidcSubject.repositoryId)}; const targetRepositoryOwnerId = ${JSON.stringify(config.repository.oidcSubject.repositoryOwnerId)};`,
    "const targetAccountId = process.env.CLOUDMARKUP_AWS_ACCOUNT_ID || ''; const targetRegion = process.env.CLOUDMARKUP_AWS_REGION || ''; const targetPlanRoleArn = process.env.CLOUDMARKUP_PLAN_ROLE_ARN || ''; const targetDeployRoleArn = process.env.CLOUDMARKUP_DEPLOY_ROLE_ARN || ''; const targetDriftRoleArn = process.env.CLOUDMARKUP_DRIFT_ROLE_ARN || '';",
    "const targetRoles = [targetPlanRoleArn, targetDeployRoleArn, targetDriftRoleArn]; const targetRolePattern = /^arn:aws:iam::([0-9]{12}):role\\/[A-Za-z0-9+=,.@_/-]{1,512}$/; const targetRegionPattern = /^[a-z]{2}(?:-[a-z0-9]{1,16}){1,3}-[1-9][0-9]?$/;",
    "if (!/^[0-9]{12}$/.test(targetAccountId) || !targetRegionPattern.test(targetRegion) || new Set(targetRoles).size !== 3 || process.env.GITHUB_REPOSITORY !== targetRepository || process.env.GITHUB_REPOSITORY_ID !== targetRepositoryId || process.env.GITHUB_REPOSITORY_OWNER_ID !== targetRepositoryOwnerId || typeof targetOidcSubjects[environment] !== 'string') fail();",
    "for (const role of targetRoles) { const match = targetRolePattern.exec(role); if (match?.[1] !== targetAccountId || role.includes('..') || /[\\u0000-\\u001f\\u007f]/.test(role)) fail(); }",
    "const targetAuthority = { accountId: targetAccountId, deployRoleArnDigest: digest(Buffer.from(targetDeployRoleArn)), driftRoleArnDigest: digest(Buffer.from(targetDriftRoleArn)), oidcSubject: targetOidcSubjects[environment], partition: 'aws', planRoleArnDigest: digest(Buffer.from(targetPlanRoleArn)), region: targetRegion };",
    "const targetEnvironmentConfigDigest = digest(Buffer.from(JSON.stringify({ staticConfig: configs[environment], targetAuthority })));",
  ];
}

const resolvedRolePattern =
  /^arn:aws:iam::([0-9]{12}):role\/[A-Za-z0-9+=,.@_/-]{1,512}$/;

export function validateResolvedCustomerCiRolesV1(input: unknown): void {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Resolved customer CI role bindings are invalid.");
  }
  const value = input as {
    accountId?: unknown;
    roles?: unknown;
  };
  if (
    typeof value.accountId !== "string" ||
    !/^[0-9]{12}$/.test(value.accountId) ||
    !Array.isArray(value.roles) ||
    value.roles.length !== 3 ||
    value.roles.some((role) => typeof role !== "string") ||
    new Set(value.roles).size !== value.roles.length
  ) {
    throw new Error("Resolved customer CI role bindings are invalid.");
  }
  for (const role of value.roles as string[]) {
    const match = resolvedRolePattern.exec(role);
    if (match?.[1] !== value.accountId || role.includes("..")) {
      throw new Error("Resolved customer CI role bindings are invalid.");
    }
  }
}

export function roleAdmissionScriptV1(): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_ROLE_ADMISSION'",
    "const fail = () => { throw new Error('Resolved customer CI role bindings are invalid.'); };",
    "const accountId = process.env.CLOUDMARKUP_AWS_ACCOUNT_ID || ''; const roles = [process.env.CLOUDMARKUP_PLAN_ROLE_ARN || '', process.env.CLOUDMARKUP_DEPLOY_ROLE_ARN || '', process.env.CLOUDMARKUP_DRIFT_ROLE_ARN || ''];",
    "if (!/^[0-9]{12}$/.test(accountId) || new Set(roles).size !== 3) fail(); const pattern = /^arn:aws:iam::([0-9]{12}):role\\/[A-Za-z0-9+=,.@_/-]{1,512}$/;",
    "for (const role of roles) { const match = pattern.exec(role); if (match?.[1] !== accountId || role.includes('..')) fail(); }",
    "CLOUDMARKUP_ROLE_ADMISSION",
  ].join("\n");
}

export function terraformCliVerificationScriptV1(
  config: CustomerCiWorkflowConfigV1,
): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_TERRAFORM_CLI'",
    "import { createHash } from 'node:crypto';",
    "import { lstat, readFile, realpath } from 'node:fs/promises';",
    "import { delimiter, resolve } from 'node:path';",
    "const fail = () => { throw new Error('The Terraform CLI binary does not match the reviewed Linux AMD64 checksum.'); };",
    "if (process.platform !== 'linux' || process.arch !== 'x64') fail();",
    "const candidates = (process.env.PATH || '').split(delimiter).filter(Boolean).map((entry) => resolve(entry, 'terraform')); let selected; for (const candidate of candidates) { try { const resolved = await realpath(candidate); const stat = await lstat(resolved); if (stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 268435456) { selected = resolved; break; } } catch {} } if (!selected) fail();",
    "const bytes = await readFile(selected); if (bytes.byteLength > 268435456) fail(); const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;",
    `if (actual !== ${JSON.stringify(config.terraform.cliSha256LinuxAmd64)}) fail();`,
    "console.log('The Terraform CLI binary matches the reviewed checksum.');",
    "CLOUDMARKUP_TERRAFORM_CLI",
  ].join("\n");
}

export function planEncryptionScriptV1(
  config: CustomerCiWorkflowConfigV1,
): string {
  const encryption = config.plan.artifactEncryption;
  const publicKeyDigest = planEncryptionPublicKeyDigest(config);
  return [
    "node --input-type=module <<'CLOUDMARKUP_ENCRYPT_PLAN'",
    "import { constants, createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto';",
    "import { lstat, readFile, writeFile } from 'node:fs/promises';",
    "const fail = () => { throw new Error('The saved plan could not be encrypted with the reviewed customer public key.'); }; const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;",
    "const stat = await lstat('cloudmarkup.tfplan'); if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > 268435456) fail(); const plaintext = await readFile('cloudmarkup.tfplan'); if (plaintext.byteLength > 268435456) fail();",
    `const publicKey = createPublicKey(${JSON.stringify(encryption.publicKeyPem)}); const publicDer = publicKey.export({ format: 'der', type: 'spki' }); if (publicKey.asymmetricKeyType !== 'rsa' || (publicKey.asymmetricKeyDetails?.modulusLength || 0) < 3072 || digest(publicDer) !== ${JSON.stringify(publicKeyDigest)}) fail();`,
    "const key = randomBytes(32); const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]); const tag = cipher.getAuthTag(); const encryptedKey = publicEncrypt({ key: publicKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, key);",
    `const header = { algorithm: ${JSON.stringify(encryption.algorithm)}, encryptedKey: encryptedKey.toString('base64'), iv: iv.toString('base64'), plaintextChecksum: digest(plaintext), publicKeyDigest: ${JSON.stringify(publicKeyDigest)}, tag: tag.toString('base64') };`,
    "const headerBytes = Buffer.from(JSON.stringify(header)); if (headerBytes.byteLength > 16384) fail(); const prefix = Buffer.alloc(4); prefix.writeUInt32BE(headerBytes.byteLength); const envelope = Buffer.concat([prefix, headerBytes, ciphertext]); if (envelope.byteLength > 268500992) fail(); await writeFile('cloudmarkup.tfplan.encrypted', envelope, { flag: 'wx', mode: 0o600 });",
    "console.log('The saved plan was encrypted; plaintext will not be uploaded.');",
    "CLOUDMARKUP_ENCRYPT_PLAN",
  ].join("\n");
}

export function planDecryptionScriptV1(
  config: CustomerCiWorkflowConfigV1,
): string {
  const encryption = config.plan.artifactEncryption;
  const publicKeyDigest = planEncryptionPublicKeyDigest(config);
  return [
    "node --input-type=module <<'CLOUDMARKUP_DECRYPT_PLAN'",
    "import { constants, createDecipheriv, createHash, createPrivateKey, createPublicKey, privateDecrypt } from 'node:crypto';",
    "import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';",
    "import { dirname, resolve } from 'node:path';",
    "const fail = () => { throw new Error('The encrypted saved plan or customer decryption key failed exact validation.'); }; const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;",
    "const directory = resolve(process.env.SAVED_PLAN_DIRECTORY || ''); const path = resolve(directory, 'cloudmarkup.tfplan.encrypted'); const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 5 || stat.size > 268500992) fail(); const envelope = await readFile(path); if (envelope.byteLength !== stat.size) fail(); const headerLength = envelope.readUInt32BE(0); if (headerLength < 1 || headerLength > 16384 || 4 + headerLength >= envelope.byteLength) fail(); let header; try { header = JSON.parse(envelope.subarray(4, 4 + headerLength)); } catch { fail(); }",
    "const keys = ['algorithm','encryptedKey','iv','plaintextChecksum','publicKeyDigest','tag']; if (!header || typeof header !== 'object' || Array.isArray(header) || JSON.stringify(Object.keys(header).sort()) !== JSON.stringify(keys.sort())) fail();",
    `if (header.algorithm !== ${JSON.stringify(encryption.algorithm)} || header.publicKeyDigest !== ${JSON.stringify(publicKeyDigest)} || header.plaintextChecksum !== process.env.EXPECTED_PLAN_CHECKSUM || !/^sha256:[a-f0-9]{64}$/.test(header.plaintextChecksum)) fail();`,
    "let privateKey; try { privateKey = createPrivateKey(process.env.CLOUDMARKUP_PLAN_DECRYPTION_PRIVATE_KEY || ''); } catch { fail(); } const publicKey = createPublicKey(privateKey); const publicDer = publicKey.export({ format: 'der', type: 'spki' }); if (privateKey.asymmetricKeyType !== 'rsa' || (privateKey.asymmetricKeyDetails?.modulusLength || 0) < 3072 || digest(publicDer) !== header.publicKeyDigest) fail();",
    "let key; let plaintext; try { key = privateDecrypt({ key: privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(header.encryptedKey, 'base64')); const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64')); decipher.setAuthTag(Buffer.from(header.tag, 'base64')); plaintext = Buffer.concat([decipher.update(envelope.subarray(4 + headerLength)), decipher.final()]); } catch { fail(); } if (key.byteLength !== 32 || plaintext.byteLength < 1 || plaintext.byteLength > 268435456 || digest(plaintext) !== header.plaintextChecksum) fail();",
    "const runnerTemp = resolve(process.env.RUNNER_TEMP || ''); const output = resolve(process.env.CLOUDMARKUP_DECRYPTED_PLAN || ''); const expectedOutput = resolve(runnerTemp, 'cloudmarkup-decrypted', 'cloudmarkup.tfplan'); if (!process.env.RUNNER_TEMP || output !== expectedOutput) fail(); await mkdir(dirname(output), { mode: 0o700, recursive: false }); await writeFile(output, plaintext, { flag: 'wx', mode: 0o600 }); console.log('The exact encrypted saved plan was decrypted inside the approved environment job.');",
    "CLOUDMARKUP_DECRYPT_PLAN",
  ].join("\n");
}

export function packageVerificationScriptV1(
  config: CustomerCiWorkflowConfigV1,
): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_VERIFY'",
    "import { createHash } from 'node:crypto';",
    "import { lstat, readFile, readdir } from 'node:fs/promises';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    "const fail = () => { throw new Error('The reviewed Solution package tree failed integrity validation.'); };",
    "const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);",
    "const digestPattern = /^sha256:[a-f0-9]{64}$/;",
    "const safePathPattern = /^[A-Za-z0-9._@()+,= -]+(?:\\/[A-Za-z0-9._@()+,= -]+)*$/;",
    "const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;",
    "const repositoryRoot = resolve('.');",
    `const packageRoot = resolve(repositoryRoot, ${JSON.stringify(config.repository.destinationFolder === "" ? "." : config.repository.destinationFolder)});`,
    `const terraformRoot = resolve(repositoryRoot, ${JSON.stringify(config.terraform.rootDirectory)});`,
    `const configuredBackendDescriptor = ${canonicalJson(config.terraform.backend)};`,
    `const configuredBackendPath = ${JSON.stringify(config.terraform.backend.configPath)};`,
    `const configuredProviderLock = ${JSON.stringify(config.terraform.providerLockPath)};`,
    `const allowedProviderSources = ${canonicalJson(config.terraform.allowedProviderSources)};`,
    `const expectedPackageTreeDigest = ${JSON.stringify(config.terraform.packageTreeDigest)};`,
    "const inside = (base, target, allowEqual = false) => { const value = relative(base, target); return (allowEqual && value === '') || (value !== '' && !value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value)); };",
    "if (!inside(repositoryRoot, packageRoot, true) || !inside(repositoryRoot, terraformRoot)) fail();",
    "const assertPath = (value) => { if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > " +
      String(PACKAGE_PATH_MAX_BYTES) +
      " || !safePathPattern.test(value) || value.includes('\\\\') || value.split('/').some((part) => part === '.' || part === '..') || /[\\u0000-\\u001f\\u007f]/.test(value)) fail(); return value; };",
    "const backendDescriptorKeys = ['configPath', 'contractVersion', 'encryption', 'locking', 'type', 'workspaceIsolation'];",
    "if (!plain(configuredBackendDescriptor) || JSON.stringify(Object.keys(configuredBackendDescriptor).sort()) !== JSON.stringify(backendDescriptorKeys) || configuredBackendDescriptor.configPath !== configuredBackendPath || configuredBackendDescriptor.contractVersion !== 1 || configuredBackendDescriptor.encryption !== 'required' || configuredBackendDescriptor.locking !== 's3-native-lockfile' || configuredBackendDescriptor.type !== 'aws-s3' || configuredBackendDescriptor.workspaceIsolation !== 'workspace-key-prefix') fail();",
    "assertPath(configuredBackendPath); const configuredBackendFile = resolve(repositoryRoot, configuredBackendPath); if (!inside(terraformRoot, configuredBackendFile) || configuredBackendFile !== resolve(terraformRoot, 'backend.hcl')) fail();",
    "const assertNoSymlinkPath = async (base, target, finalKind) => {",
    "  if (!inside(base, target, finalKind === 'directory')) fail();",
    "  const parts = relative(base, target).split(/[\\\\/]/).filter(Boolean); let current = base;",
    "  for (let index = 0; index < parts.length; index += 1) { current = resolve(current, parts[index]); const stat = await lstat(current); if (stat.isSymbolicLink()) fail(); const final = index === parts.length - 1; if ((!final || finalKind === 'directory') && !stat.isDirectory()) fail(); if (final && finalKind === 'file' && !stat.isFile()) fail(); }",
    "};",
    "await assertNoSymlinkPath(repositoryRoot, packageRoot, 'directory');",
    "await assertNoSymlinkPath(repositoryRoot, terraformRoot, 'directory');",
    "const readBoundedFile = async (path, maximum) => { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximum) fail(); const bytes = await readFile(path); if (bytes.byteLength > maximum) fail(); return bytes; };",
    "const manifestPath = resolve(packageRoot, 'cloudmarkup/cloudmarkup.manifest.json');",
    "const lockPath = resolve(packageRoot, 'cloudmarkup/cloudmarkup.lock.json');",
    "await assertNoSymlinkPath(repositoryRoot, manifestPath, 'file'); await assertNoSymlinkPath(repositoryRoot, lockPath, 'file');",
    "let manifest; let lock; let manifestBytes; try { manifestBytes = await readBoundedFile(manifestPath, " +
      String(RAW_PLAN_MAX_BYTES) +
      "); manifest = JSON.parse(manifestBytes); lock = JSON.parse(await readBoundedFile(lockPath, " +
      String(MANIFEST_MAX_BYTES) +
      ")); } catch { fail(); }",
    "if (!plain(manifest) || !plain(lock) || manifest.kind !== 'cloudmarkup.solution-export-manifest' || manifest.contractVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 4096 || !plain(manifest.solutionRevision) || !plain(lock.solutionRevision) || !plain(manifest.repositoryWorkflows) || !Array.isArray(manifest.repositoryWorkflows.files)) fail();",
    "if (manifest.solutionRevision.id !== lock.solutionRevision.id || manifest.solutionRevision.digest !== lock.solutionRevision.digest) fail();",
    `if (lock.solutionRevision.id !== ${JSON.stringify(config.solutionRevision.id)} || lock.solutionRevision.digest !== ${JSON.stringify(config.solutionRevision.digest)}) fail();`,
    "if (!plain(manifest.target) || !Array.isArray(manifest.target.providers) || manifest.target.providers.length !== allowedProviderSources.length || JSON.stringify(manifest.target.providers.map((provider) => provider?.source).sort()) !== JSON.stringify([...allowedProviderSources].sort()) || manifest.target.providers.some((provider) => !plain(provider) || typeof provider.versionConstraint !== 'string' || provider.versionConstraint.length < 1 || provider.versionConstraint.length > 256)) fail();",
    "if (process.env.EXPECTED_REVISION_ID && process.env.EXPECTED_REVISION_ID !== lock.solutionRevision.id) fail();",
    `const expectedWorkflowPaths = ${JSON.stringify(Object.values(CUSTOMER_CI_WORKFLOW_PATHS).sort())};`,
    "const workflowFiles = manifest.repositoryWorkflows.files; if (workflowFiles.length !== expectedWorkflowPaths.length || JSON.stringify(workflowFiles.map((file) => file?.path).sort()) !== JSON.stringify(expectedWorkflowPaths)) fail(); const declaredFiles = [...manifest.files, ...workflowFiles];",
    "const declared = new Set(); const portablePaths = new Set(); const declaredTerraform = new Set(); const declaredTerraformFiles = []; const applicationFiles = new Map();",
    "for (const file of declaredFiles) {",
    "  if (!plain(file)) fail(); const path = assertPath(file.path); if (!digestPattern.test(file.checksum) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || file.sizeBytes > " +
      String(PACKAGE_FILE_MAX_BYTES) +
      ") fail();",
    `  const repositoryPath = path.startsWith('.github/workflows/') ? path : ${JSON.stringify(config.repository.destinationFolder === "" ? "" : `${config.repository.destinationFolder}/`)} + path;`,
    "  const normalizedRepositoryPath = repositoryPath.normalize('NFC'); const portableKey = normalizedRepositoryPath.toLocaleLowerCase('en-US');",
    "  if (declared.has(repositoryPath) || portablePaths.has(portableKey)) fail(); declared.add(repositoryPath); portablePaths.add(portableKey);",
    "  const target = resolve(repositoryRoot, repositoryPath); if (!inside(repositoryRoot, target)) fail(); await assertNoSymlinkPath(repositoryRoot, target, 'file');",
    "  const bytes = await readBoundedFile(target, " +
      String(PACKAGE_FILE_MAX_BYTES) +
      "); if (bytes.byteLength !== file.sizeBytes || sha(bytes) !== file.checksum) fail();",
    "  if (/^application\\/(?:artifacts|evidence)\\//.test(path)) applicationFiles.set(path, { bytes, file });",
    "  if (target === terraformRoot || inside(terraformRoot, target)) { const terraformPath = relative(repositoryRoot, target).replaceAll('\\\\', '/'); const packageTerraformPath = relative(packageRoot, target).replaceAll('\\\\', '/'); declaredTerraform.add(terraformPath); declaredTerraformFiles.push({ checksum: file.checksum, path: packageTerraformPath }); }",
    "}",
    "const handlerArtifactPattern = /^application\\/artifacts\\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\\/function\\.zip$/;",
    "const handlerArtifacts = manifest.files.filter((file) => plain(file) && handlerArtifactPattern.test(file.path)); if (handlerArtifacts.length > 256 || handlerArtifacts.some((file) => file.ownership !== 'generated-build-artifact')) fail();",
    "for (const artifactFile of handlerArtifacts) {",
    "  const match = handlerArtifactPattern.exec(artifactFile.path); const artifact = applicationFiles.get(artifactFile.path); if (!match || !artifact || artifactFile.mediaType !== 'application/zip' || artifact.bytes.byteLength < 4 || artifact.bytes[0] !== 0x50 || artifact.bytes[1] !== 0x4b) fail();",
    "  const evidencePath = `application/evidence/${match[1]}/application-build-evidence.json`; const evidenceFile = applicationFiles.get(evidencePath); if (!evidenceFile || evidenceFile.file.ownership !== 'evidence-artifact' || evidenceFile.file.mediaType !== 'application/json') fail();",
    "  let evidence; try { evidence = JSON.parse(evidenceFile.bytes); } catch { fail(); }",
    "  if (!plain(evidence) || evidence.contractVersion !== 1 || evidence.solutionRevisionId !== lock.solutionRevision.id || evidence.layer !== 'generated' || !plain(evidence.level) || evidence.level.kind !== 'application-build-and-tests' || evidence.level.rank !== 5 || !plain(evidence.staleness) || evidence.staleness.state !== 'current' || !plain(evidence.provenance) || !plain(evidence.provenance.actor) || evidence.provenance.actor.kind !== 'deterministic-tool' || !Array.isArray(evidence.artifacts) || !Array.isArray(evidence.checks)) fail();",
    "  const artifactRecord = evidence.artifacts.find((entry) => plain(entry) && entry.digest === artifactFile.checksum && entry.mediaType === 'application/zip' && entry.sizeBytes === artifactFile.sizeBytes); if (!artifactRecord) fail();",
    "  const requiredChecks = [['cloudmarkup.evidence.application-build-and-tests','application-build-and-tests'],['cloudmarkup.evidence.application-security-checks','application-security-checks']];",
    "  for (const [checkId, requirement] of requiredChecks) { const check = evidence.checks.find((entry) => plain(entry) && entry.checkId === checkId); if (!check || check.status !== 'passed' || check.generationCoverageRequirement !== requirement || !Array.isArray(check.issueIds) || check.issueIds.length !== 0 || !Array.isArray(check.artifactDigests) || !check.artifactDigests.includes(artifactFile.checksum)) fail(); }",
    "}",
    ...terraformSourceInspectionScriptLines(),
    ...terraformBackendInspectionScriptLines(),
    "const actualTerraform = new Set(); const actualPortable = new Set(); let entryCount = 0;",
    "const walk = async (directory, depth) => {",
    "  if (depth > " +
      String(PACKAGE_TREE_MAX_DEPTH) +
      ") fail(); const entries = await readdir(directory, { withFileTypes: true });",
    "  for (const entry of entries) { entryCount += 1; if (entryCount > " +
      String(PACKAGE_TREE_MAX_ENTRIES) +
      ") fail();",
    "    const target = resolve(directory, entry.name); const stat = await lstat(target); if (stat.isSymbolicLink()) fail();",
    "    const repositoryPath = relative(repositoryRoot, target).replaceAll('\\\\', '/'); if (Buffer.byteLength(repositoryPath, 'utf8') > " +
      String(PACKAGE_PATH_MAX_BYTES) +
      " || repositoryPath.normalize('NFC') !== repositoryPath) fail();",
    "    const portableKey = repositoryPath.toLocaleLowerCase('en-US'); if (actualPortable.has(portableKey)) fail(); actualPortable.add(portableKey);",
    "    if (stat.isDirectory()) await walk(target, depth + 1); else if (stat.isFile()) { if (!declaredTerraform.has(repositoryPath)) fail(); const sourceBytes = await readBoundedFile(target, " +
      String(PACKAGE_FILE_MAX_BYTES) +
      "); if (/\\.tf(?:\\.json)?$/.test(repositoryPath)) { const source = decodeTerraformSource(sourceBytes); if (/\\.tf\\.json$/.test(repositoryPath)) inspectTerraformJson(source); else inspectTerraformHcl(source); } actualTerraform.add(repositoryPath); } else fail();",
    "  }",
    "};",
    "await walk(terraformRoot, 0);",
    "const backendConfigPaths = [...actualTerraform].filter((path) => /(?:^|\\/)backend\\.hcl$/.test(path));",
    "if (actualTerraform.size === 0 || actualTerraform.size !== declaredTerraform.size || [...declaredTerraform].some((path) => !actualTerraform.has(path)) || !declaredTerraform.has(configuredBackendPath) || backendConfigPaths.length !== 1 || backendConfigPaths[0] !== configuredBackendPath || !declaredTerraform.has(configuredProviderLock) || ![...declaredTerraform].some((path) => /\\.tf(?:\\.json)?$/.test(path))) fail();",
    "const treeProjection = declaredTerraformFiles.sort((left, right) => left.path.localeCompare(right.path, 'en')); if (sha(Buffer.from(JSON.stringify(treeProjection))) !== expectedPackageTreeDigest) fail();",
    "const backendConfigBytes = await readBoundedFile(configuredBackendFile, " +
      String(BACKEND_CONFIG_MAX_BYTES) +
      "); inspectTerraformBackendConfig(backendConfigBytes, process.env.CLOUDMARKUP_AWS_REGION || '');",
    "const providerLockBytes = await readBoundedFile(resolve(repositoryRoot, configuredProviderLock), " +
      String(PACKAGE_FILE_MAX_BYTES) +
      "); const providerLockText = providerLockBytes.toString('utf8'); const providerBlockPattern = /provider\\s+\"registry\\.terraform\\.io\\/([a-z0-9][a-z0-9._/-]{0,127})\"\\s*\\{([\\s\\S]*?)\\}/g; const providerBlocks = [...providerLockText.matchAll(providerBlockPattern)]; const remainder = providerLockText.replace(providerBlockPattern, '').replace(/#[^\\n]*/g, '').replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').trim(); if (remainder || providerBlocks.length !== allowedProviderSources.length) fail(); const lockSources = []; for (const match of providerBlocks) { const source = match[1]; const body = match[2] || ''; if (!allowedProviderSources.includes(source) || lockSources.includes(source) || !/version\\s*=\\s*\"[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?\"/.test(body) || !/hashes\\s*=\\s*\\[[\\s\\S]*(?:h1:[A-Za-z0-9+/=]+|zh:[a-f0-9]{64})[\\s\\S]*\\]/.test(body)) fail(); lockSources.push(source); } if (JSON.stringify(lockSources.sort()) !== JSON.stringify([...allowedProviderSources].sort())) fail();",
    "console.log('The reviewed Solution package tree, exact revision, and remote backend authority are intact.');",
    "CLOUDMARKUP_VERIFY",
  ].join("\n");
}

export function generatedSourceSecurityVerificationScriptV1(
  config: CustomerCiWorkflowConfigV1,
): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_GENERATED_SOURCE_SECURITY'",
    "import { createHash } from 'node:crypto';",
    "import { lstat, readFile } from 'node:fs/promises';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    "const fail = () => { throw new Error('The manifest-bound application source failed static security validation; matched content is redacted.'); };",
    "const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);",
    "const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`; const digestPattern = /^sha256:[a-f0-9]{64}$/;",
    "const safePathPattern = /^[A-Za-z0-9._@()+,= -]+(?:\\/[A-Za-z0-9._@()+,= -]+)*$/;",
    `const packageRoot = resolve('.', ${JSON.stringify(config.repository.destinationFolder === "" ? "." : config.repository.destinationFolder)});`,
    "const inside = (base, target) => { const value = relative(base, target); return value !== '' && !value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value); };",
    "const manifestPath = resolve(packageRoot, 'cloudmarkup/cloudmarkup.manifest.json'); const manifestStat = await lstat(manifestPath); if (manifestStat.isSymbolicLink() || !manifestStat.isFile() || manifestStat.size < 1 || manifestStat.size > 8388608) fail();",
    "const manifestBytes = await readFile(manifestPath); if (manifestBytes.byteLength !== manifestStat.size || manifestBytes.byteLength > 8388608) fail(); let manifest; try { manifest = JSON.parse(manifestBytes); } catch { fail(); }",
    "if (!plain(manifest) || manifest.contractVersion !== 1 || manifest.kind !== 'cloudmarkup.solution-export-manifest' || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 4096) fail();",
    "const sourceMediaTypes = new Set(['application/json','text/markdown','text/plain','text/typescript']); const sourceOwnership = new Set(['generated-replaceable','user-owned-extension']);",
    "const sourceFiles = manifest.files.filter((file) => plain(file) && typeof file.path === 'string' && file.path.startsWith('application/') && !file.path.startsWith('application/artifacts/') && !file.path.startsWith('application/evidence/') && sourceMediaTypes.has(file.mediaType) && sourceOwnership.has(file.ownership)); if (sourceFiles.length > 4096) fail();",
    "const secretPatterns = [/-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/, /\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b/, /\\b(?:gh[pousr]_[A-Za-z0-9_]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\\b/, /\\bxox[baprs]-[A-Za-z0-9-]{20,255}\\b/, /\\b[rs]k_(?:live|test)_[A-Za-z0-9]{8,255}\\b/, /\\bwhsec_[A-Za-z0-9]{8,255}\\b/];",
    "const generatedExecutionPatterns = [/(?:\\bnode:child_process\\b|\\bfrom\\s+[\"']child_process[\"']|\\brequire\\s*\\(\\s*[\"']child_process[\"']\\s*\\))/, /\\b(?:eval|Function)\\s*\\(/, /\\b(?:Bun\\.spawn|Deno\\.Command)\\b/];",
    "const findings = []; const inventory = [];",
    "for (const file of sourceFiles) {",
    "  const path = file.path; if (Buffer.byteLength(path, 'utf8') > 512 || !safePathPattern.test(path) || path.includes('\\\\') || path.split('/').some((part) => part === '.' || part === '..') || !digestPattern.test(file.checksum) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || file.sizeBytes > 16777216) fail();",
    "  const target = resolve(packageRoot, path); if (!inside(packageRoot, target)) fail(); const parts = relative(packageRoot, target).split(/[\\\\/]/).filter(Boolean); let current = packageRoot;",
    "  for (const [index, part] of parts.entries()) { current = resolve(current, part); const stat = await lstat(current); if (stat.isSymbolicLink()) fail(); const final = index === parts.length - 1; if (!final && !stat.isDirectory()) fail(); if (final && (!stat.isFile() || stat.size !== file.sizeBytes || stat.size > 16777216)) fail(); }",
    "  const bytes = await readFile(target); if (bytes.byteLength !== file.sizeBytes || bytes.byteLength > 16777216 || digest(bytes) !== file.checksum) fail(); let source; try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(); } if (source.includes('\\u0000')) fail();",
    "  if (secretPatterns.some((pattern) => pattern.test(source))) findings.push({ path, reason: 'secret-pattern' });",
    "  if (file.ownership === 'generated-replaceable' && generatedExecutionPatterns.some((pattern) => pattern.test(source))) findings.push({ path, reason: 'execution-primitive' });",
    "  if (findings.length > 64) fail(); inventory.push({ checksum: file.checksum, ownership: file.ownership, path });",
    "}",
    "if (findings.length > 0) { console.error(`Static application-source validation rejected ${findings.length} redacted finding(s).`); fail(); }",
    "inventory.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0); console.log(`Scanned ${inventory.length} exact manifest-bound application source file(s); the scanner invoked no network client, credential, or repository-selected command; inventory ${digest(Buffer.from(JSON.stringify(inventory)))}.`);",
    "CLOUDMARKUP_GENERATED_SOURCE_SECURITY",
  ].join("\n");
}

export function smokeTestExtensionVerificationScriptV1(
  config: CustomerCiWorkflowConfigV1,
  phase: "validate" | "plan" | "deploy" | "smoke",
): string {
  const extensions = config.smoke.extensions;
  return [
    "node --input-type=module <<'CLOUDMARKUP_SMOKE_EXTENSIONS'",
    "import { createHash } from 'node:crypto';",
    "import { lstat, readFile } from 'node:fs/promises';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    "const fail = (stage = 'metadata') => { throw new Error(`The declarative smoke-test extension metadata failed exact validation at ${stage}.`); };",
    "const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`; ",
    `const extensions = ${canonicalJson(extensions)};`,
    `const expectedSetDigest = ${JSON.stringify(sha256(canonicalJson(extensions)))};`,
    `const phase = ${JSON.stringify(phase)};`,
    `const packageRoot = resolve('.', ${JSON.stringify(config.repository.destinationFolder === "" ? "." : config.repository.destinationFolder)});`,
    "const inside = (base, target) => { const value = relative(base, target); return value !== '' && !value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value); };",
    "if (!['validate','plan','deploy','smoke'].includes(phase) || digest(Buffer.from(`${JSON.stringify(extensions, null, 2)}\\n`)) !== expectedSetDigest) fail('set');",
    "const rootStat = await lstat(packageRoot); if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail('root');",
    "const seen = new Set();",
    "for (const extension of extensions) {",
    "  if (!extension || typeof extension !== 'object' || Array.isArray(extension) || extension.contractVersion !== 1 || seen.has(extension.id)) fail('descriptor'); seen.add(extension.id);",
    "  const target = resolve(packageRoot, extension.specificationPath); if (!inside(packageRoot, target)) fail('path');",
    "  const parts = relative(packageRoot, target).split(/[\\\\/]/).filter(Boolean); let current = packageRoot;",
    "  for (let index = 0; index < parts.length; index += 1) { current = resolve(current, parts[index]); const stat = await lstat(current); if (stat.isSymbolicLink()) fail('filesystem'); const final = index === parts.length - 1; if (!final && !stat.isDirectory()) fail('filesystem'); if (final && (!stat.isFile() || stat.size > 131072)) fail('filesystem'); }",
    "  const bytes = await readFile(target); if (bytes.byteLength > 131072 || digest(bytes) !== extension.specificationChecksum) fail('checksum');",
    "  let specification; try { specification = JSON.parse(bytes.toString('utf8')); } catch { fail('json'); }",
    "  const keys = ['contractVersion','extensionId','kind','state','workloadId'];",
    "  if (!specification || typeof specification !== 'object' || Array.isArray(specification) || JSON.stringify(Object.keys(specification).sort()) !== JSON.stringify(keys) || specification.contractVersion !== 1 || specification.extensionId !== extension.id || specification.kind !== 'cloudmarkup.smoke-test-extension-specification' || specification.state !== 'customer-implementation-required' || specification.workloadId !== extension.workloadId) fail('schema');",
    "}",
    "console.log(`Validated ${extensions.length} checksum-bound declarative smoke-test extension specification(s) for ${phase}; no customer command was executed.`);",
    "CLOUDMARKUP_SMOKE_EXTENSIONS",
  ].join("\n");
}

export function branchAdmissionScriptV1(
  config: CustomerCiWorkflowConfigV1,
  mode: "plan" | "deploy" | "smoke" | "drift",
): string {
  const branches = Object.fromEntries(
    config.environments.map(({ approvedBranches, id }) => [
      id,
      approvedBranches.map((branch) => `refs/heads/${branch}`),
    ]),
  );
  return [
    "node --input-type=module <<'CLOUDMARKUP_REF'",
    `const expectedRepository = ${JSON.stringify(`${config.repository.owner}/${config.repository.name}`)};`,
    `const allowed = ${canonicalJson(branches)};`,
    `const mode = ${JSON.stringify(mode)};`,
    "const environment = process.env.CLOUDMARKUP_ENVIRONMENT || '';",
    "if (process.env.GITHUB_REPOSITORY !== expectedRepository || !Object.hasOwn(allowed, environment) || !allowed[environment].includes(process.env.GITHUB_REF) || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '')) throw new Error('Repository, branch, environment, or commit admission failed.');",
    "const event = process.env.GITHUB_EVENT_NAME || '';",
    "if (mode === 'plan' && !['push', 'workflow_dispatch'].includes(event)) throw new Error('Planning requires an approved push or manual dispatch.');",
    "if ((mode === 'deploy' || mode === 'smoke') && event !== 'workflow_dispatch') throw new Error('This operation requires an explicit manual dispatch.');",
    "if (mode === 'drift' && !['schedule', 'workflow_dispatch'].includes(event)) throw new Error('Drift inspection requires the reviewed schedule or a manual dispatch.');",
    "CLOUDMARKUP_REF",
  ].join("\n");
}
export function workflowCommitAdmissionScriptV1(): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_WORKFLOW_COMMIT'",
    "const commitPattern = /^[a-f0-9]{40}$/;",
    "const expected = process.env.CLOUDMARKUP_EXPECTED_EXECUTION_COMMIT || ''; const runSha = process.env.CLOUDMARKUP_EXECUTION_RUN_SHA || ''; const workflowSha = process.env.CLOUDMARKUP_EXECUTION_WORKFLOW_SHA || '';",
    "if (!commitPattern.test(expected) || runSha !== expected || workflowSha !== expected) throw new Error('The executing workflow revision and run commit must exactly match the reviewed plan or deployment commit.');",
    "console.log('The workflow revision and run commit match the exact reviewed commit.');",
    "CLOUDMARKUP_WORKFLOW_COMMIT",
  ].join("\n");
}

export function githubRunInspectionScriptV1(
  config: CustomerCiWorkflowConfigV1,
  workflowKind: "plan" | "deploy" | "smoke",
): string {
  const branches = Object.fromEntries(
    config.environments.map(({ approvedBranches, id }) => [
      id,
      approvedBranches.map((branch) => `refs/heads/${branch}`),
    ]),
  );
  const expectedPath = CUSTOMER_CI_WORKFLOW_PATHS[workflowKind];
  const allowedEvents =
    workflowKind === "plan"
      ? ["push", "workflow_dispatch"]
      : ["workflow_dispatch"];
  const artifactMaximumBytes =
    workflowKind === "plan"
      ? ENCRYPTED_PLAN_MAX_BYTES +
        JSON_ARTIFACT_MAX_BYTES * 3 +
        MANIFEST_MAX_BYTES * 2
      : workflowKind === "smoke"
        ? JSON_ARTIFACT_MAX_BYTES * 2 + MANIFEST_MAX_BYTES
        : MANIFEST_MAX_BYTES * 2;
  const artifactNamePrefix =
    workflowKind === "plan"
      ? "cloudmarkup-plan-"
      : workflowKind === "smoke"
        ? "cloudmarkup-smoke-evidence-"
        : "cloudmarkup-deployment-receipt-";
  return [
    "node --input-type=module <<'CLOUDMARKUP_RUN_PROVENANCE'",
    "import { createHash } from 'node:crypto';",
    "import { appendFile } from 'node:fs/promises';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    `const expectedRepository = ${JSON.stringify(`${config.repository.owner}/${config.repository.name}`)};`,
    `const expectedPath = ${JSON.stringify(expectedPath)};`,
    `const allowedEvents = ${canonicalJson(allowedEvents)};`,
    `const allowedRefs = ${canonicalJson(branches)};`,
    `const artifactMaximumBytes = ${String(artifactMaximumBytes)}; const artifactNamePrefix = ${JSON.stringify(artifactNamePrefix)};`,
    "const fail = () => { throw new Error('The referenced GitHub Actions run did not match the reviewed provenance.'); };",
    "const runId = process.env.EXPECTED_RUN_ID || ''; const expectedCommit = process.env.EXPECTED_RUN_COMMIT || ''; const environment = process.env.EXPECTED_RUN_ENVIRONMENT || ''; const artifactName = artifactNamePrefix + environment;",
    "if (!/^[1-9][0-9]{0,15}$/.test(runId) || !/^[a-f0-9]{40}$/.test(expectedCommit) || !Object.hasOwn(allowedRefs, environment)) fail();",
    "const exactEvent = process.env.EXPECTED_RUN_EVENT || ''; const exactRef = process.env.EXPECTED_RUN_REF || ''; const exactAttempt = process.env.EXPECTED_RUN_ATTEMPT || '';",
    "if ((exactEvent && !allowedEvents.includes(exactEvent)) || (exactRef && !allowedRefs[environment].includes(exactRef)) || (exactAttempt && !/^[1-9][0-9]{0,2}$/.test(exactAttempt))) fail();",
    "const token = process.env.GITHUB_TOKEN || ''; if (!token || token.length > 4096 || /[\\u0000-\\u001f\\u007f]/.test(token)) fail();",
    `const url = new URL(${JSON.stringify(`https://api.github.com/repos/${config.repository.owner}/${config.repository.name}/actions/runs/`)} + runId);`,
    "let response; try { response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(10_000) }); } catch { fail(); }",
    "if (!response.ok || response.redirected || response.url !== url.href) fail();",
    "const declaredLength = Number(response.headers.get('content-length')); if (Number.isFinite(declaredLength) && declaredLength > " +
      String(GITHUB_RUN_MAX_BYTES) +
      ") fail();",
    "const chunks = []; let total = 0; const reader = response.body?.getReader(); if (!reader) fail();",
    "while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > " +
      String(GITHUB_RUN_MAX_BYTES) +
      ") { await reader.cancel(); fail(); } chunks.push(part.value); }",
    "let run; try { run = JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total)); } catch { fail(); }",
    "const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value); if (!plain(run) || !plain(run.repository) || !plain(run.head_repository) || !Array.isArray(run.pull_requests)) fail();",
    "if (!Number.isSafeInteger(run.id) || String(run.id) !== runId || run.status !== 'completed' || run.conclusion !== 'success' || run.repository.full_name !== expectedRepository || run.head_repository.full_name !== expectedRepository || run.head_repository.fork !== false || !Number.isSafeInteger(run.repository.id) || run.head_repository.id !== run.repository.id) fail();",
    "if (typeof run.head_branch !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/.test(run.head_branch)) fail(); const ref = `refs/heads/${run.head_branch}`;",
    "if (!allowedRefs[environment].includes(ref) || run.head_sha !== expectedCommit || !allowedEvents.includes(run.event) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 || run.run_attempt > 100) fail();",
    "if (run.path !== expectedPath && run.path !== `${expectedPath}@${ref}`) fail();",
    "if ((exactEvent && run.event !== exactEvent) || (exactRef && ref !== exactRef) || (exactAttempt && String(run.run_attempt) !== exactAttempt)) fail();",
    "const artifactsUrl = new URL(url.href + '/artifacts'); artifactsUrl.searchParams.set('name', artifactName);",
    "let artifactsResponse; try { artifactsResponse = await fetch(artifactsUrl, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(10_000) }); } catch { fail(); }",
    "if (!artifactsResponse.ok || artifactsResponse.redirected || artifactsResponse.url !== artifactsUrl.href) fail(); const artifactDeclaredLength = Number(artifactsResponse.headers.get('content-length')); if (Number.isFinite(artifactDeclaredLength) && artifactDeclaredLength > " +
      String(GITHUB_RUN_MAX_BYTES) +
      ") fail();",
    "const artifactChunks = []; let artifactTotal = 0; const artifactReader = artifactsResponse.body?.getReader(); if (!artifactReader) fail(); while (true) { const part = await artifactReader.read(); if (part.done) break; artifactTotal += part.value.byteLength; if (artifactTotal > " +
      String(GITHUB_RUN_MAX_BYTES) +
      ") { await artifactReader.cancel(); fail(); } artifactChunks.push(part.value); }",
    "let listing; try { listing = JSON.parse(Buffer.concat(artifactChunks.map((chunk) => Buffer.from(chunk)), artifactTotal)); } catch { fail(); } if (!plain(listing) || listing.total_count !== 1 || !Array.isArray(listing.artifacts) || listing.artifacts.length !== 1) fail();",
    "const artifact = listing.artifacts[0]; if (!plain(artifact) || !Number.isSafeInteger(artifact.id) || artifact.id < 1 || artifact.name !== artifactName || artifact.expired !== false || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1 || artifact.size_in_bytes > artifactMaximumBytes || (artifact.workflow_run !== undefined && (!plain(artifact.workflow_run) || artifact.workflow_run.id !== run.id))) fail();",
    "const projection = { attempt: run.run_attempt, event: run.event, path: expectedPath, ref, runId }; const projectionDigest = `sha256:${createHash('sha256').update(JSON.stringify(projection)).digest('hex')}`;",
    "const output = process.env.GITHUB_OUTPUT || ''; const runnerTemp = resolve(process.env.RUNNER_TEMP || ''); if (!output || !isAbsolute(output) || !runnerTemp || !(relative(runnerTemp, resolve(output)) !== '' && !relative(runnerTemp, resolve(output)).startsWith(`..${sep}`) && !isAbsolute(relative(runnerTemp, resolve(output))))) fail();",
    "await appendFile(output, `attempt=${String(run.run_attempt)}\\nevent=${run.event}\\npath=${expectedPath}\\nprovenance_digest=${projectionDigest}\\nref=${ref}\\nrun_id=${runId}\\n`);",
    "CLOUDMARKUP_RUN_PROVENANCE",
  ].join("\n");
}

export function planSanitizerScriptV1(): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_SANITIZE'",
    "import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';",
    "import { createHash } from 'node:crypto';",
    "const rawPath = 'cloudmarkup-plan.raw.json'; const sanitizedPath = 'cloudmarkup-plan.sanitized.json'; const analysisPath = 'cloudmarkup-plan.analysis.json'; const sanitizedTemp = sanitizedPath + '.tmp'; const analysisTemp = analysisPath + '.tmp';",
    "const fail = (message) => { throw new Error(message); }; const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);",
    "const credentialShape = (value) => [/AKIA[0-9A-Z]{16}/, /ASIA[0-9A-Z]{16}/, /aws_access_key_id\\s*[:=]/i, /aws_secret_access_key\\s*[:=]/i, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /https?:\\/\\/[^\\s/@]+:[^\\s/@]+@/].some((pattern) => pattern.test(value));",
    "const metadata = (value, maximum) => { if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value, 'utf8') > maximum || /[\\u0000-\\u001f\\u007f]/.test(value) || credentialShape(value)) fail('Terraform plan structural metadata is unsafe or malformed.'); return value; };",
    "const allowedActions = new Set(['create', 'read', 'update', 'delete', 'no-op']);",
    "const normalizeActions = (value) => { if (!Array.isArray(value) || value.length < 1 || value.length > 2 || value.some((item) => typeof item !== 'string') || new Set(value).size !== value.length || value.some((item) => !allowedActions.has(item))) fail('Terraform plan actions are malformed or unsupported.'); if (value.length === 2) { if (value.includes('delete') && value.includes('create')) return ['replace']; fail('Terraform plan action combinations are unsupported.'); } return value; };",
    "const digestAddress = (value) => `sha256:${createHash('sha256').update(`cloudmarkup.terraform-resource-address.v1\\0${value}`).digest('hex')}`;",
    "const iamOrPolicy = (type) => type.startsWith('aws_iam_') || type.includes('_policy') || type === 'aws_kms_grant' || type.startsWith('aws_lakeformation_permissions') || type.startsWith('aws_ssoadmin_');",
    "const networkPrefixes = ['aws_alb','aws_api_gateway_vpc_link','aws_apigatewayv2_vpc_link','aws_ec2_transit_gateway','aws_eip','aws_elb','aws_globalaccelerator','aws_internet_gateway','aws_lb','aws_nat_gateway','aws_network_acl','aws_network_interface','aws_route','aws_security_group','aws_subnet','aws_vpc'];",
    "const securityPrefixes = ['aws_accessanalyzer_','aws_acm_','aws_cloudtrail','aws_config_','aws_detective_','aws_guardduty_','aws_inspector','aws_kms_','aws_macie2_','aws_networkfirewall_','aws_s3_bucket_public_access_block','aws_secretsmanager_','aws_securityhub_','aws_shield_','aws_wafv2_'];",
    "await Promise.all([sanitizedPath, analysisPath, sanitizedTemp, analysisTemp].map((path) => rm(path, { force: true })));",
    "try {",
    "  const rawStat = await stat(rawPath); if (!rawStat.isFile() || rawStat.size > " +
      String(RAW_PLAN_MAX_BYTES) +
      ") fail('Terraform plan JSON exceeds the sanitization limit.');",
    "  const bytes = await readFile(rawPath); if (bytes.byteLength > " +
      String(RAW_PLAN_MAX_BYTES) +
      ") fail('Terraform plan JSON exceeds the sanitization limit.');",
    "  let raw; try { raw = JSON.parse(bytes); } catch { fail('Terraform plan JSON is malformed.'); } if (!plain(raw) || !Array.isArray(raw.resource_changes)) fail('Terraform plan JSON has no resource_changes array.'); if (raw.resource_changes.length > " +
      String(CUSTOMER_CI_LIMITS_V1.planResources) +
      ") fail('Terraform plan contains too many resource changes.');",
    "  const seenAddresses = new Set(); const resourceChanges = raw.resource_changes.map((item) => { if (!plain(item) || !plain(item.change) || !['managed', 'data'].includes(item.mode)) fail('Terraform plan resource changes are malformed.'); const rawAddress = metadata(item.address, 512); if (seenAddresses.has(rawAddress)) fail('Terraform plan resource addresses must be unique.'); seenAddresses.add(rawAddress); const providerName = metadata(item.provider_name, 256); if (providerName !== 'registry.terraform.io/hashicorp/aws') fail('Terraform plan provider is unsupported; only registry.terraform.io/hashicorp/aws is allowed.'); const type = metadata(item.type, 256); if (!/^aws_[a-z0-9_]{1,251}$/.test(type)) fail('Terraform plan resource type is unsupported.'); return { actions: normalizeActions(item.change.actions), address: digestAddress(rawAddress), mode: item.mode, providerName, type }; }).sort((left, right) => left.address.localeCompare(right.address, 'en'));",
    "  const sanitized = { formatVersion: metadata(raw.format_version, 32), resourceChanges, terraformVersion: metadata(raw.terraform_version, 32) };",
    "  const counts = { create: 0, delete: 0, noOp: 0, read: 0, replace: 0, update: 0 }; for (const change of resourceChanges) for (const action of change.actions) { const key = action === 'no-op' ? 'noOp' : action; counts[key] += 1; }",
    "  const issues = []; let omitted = 0; const addIssue = (code, message, field) => { if (issues.length < " +
      String(PLAN_ISSUE_LIMIT - 1) +
      ") issues.push({ code, field, message, severity: 'warning' }); else omitted += 1; };",
    "  for (const item of resourceChanges) { const changesInfrastructure = item.actions.some((action) => action !== 'no-op' && action !== 'read');",
    "    if (item.actions.includes('delete') || item.actions.includes('replace')) addIssue('DESTRUCTIVE_PLAN_CHANGE', 'This change removes or replaces a resource and needs explicit review.', item.address);",
    "    if (changesInfrastructure && iamOrPolicy(item.type)) addIssue('IAM_OR_POLICY_PLAN_CHANGE', 'This change affects permissions or a policy. Review the allowed actions, resources, and trust conditions.', item.address);",
    "    if (changesInfrastructure && networkPrefixes.some((prefix) => item.type.startsWith(prefix))) addIssue('NETWORK_BOUNDARY_PLAN_CHANGE', 'This change affects network routing or an access boundary. Review ingress, egress, routes, and exposure.', item.address);",
    "    if (changesInfrastructure && securityPrefixes.some((prefix) => item.type.startsWith(prefix))) addIssue('SECURITY_CONTROL_PLAN_CHANGE', 'This change affects a security control, key, secret, certificate, audit trail, or threat-detection setting and needs explicit review.', item.address);",
    "  }",
    "  if (omitted > 0) issues.push({ code: 'PLAN_SECURITY_REVIEW_OVERFLOW', message: `${String(omitted)} additional security-sensitive or destructive findings need review; inspect the complete sanitized change list.`, severity: 'warning' });",
    `  const analysis = { changes: resourceChanges.map(({ actions, address, type }) => ({ actions, address, type })), contractVersion: 1, counts, issues, kind: 'cloudmarkup.terraform-semantic-plan-analysis', unresolvedBehavior: ${JSON.stringify(PLAN_UNRESOLVED_BEHAVIOR)} };`,
    "  await writeFile(sanitizedTemp, JSON.stringify(sanitized) + '\\n', { flag: 'wx' }); await writeFile(analysisTemp, JSON.stringify(analysis) + '\\n', { flag: 'wx' }); await rename(sanitizedTemp, sanitizedPath); await rename(analysisTemp, analysisPath);",
    "} catch (error) { await Promise.all([sanitizedPath, analysisPath, sanitizedTemp, analysisTemp].map((path) => rm(path, { force: true }))); throw error; } finally { await rm(rawPath, { force: true }); }",
    "CLOUDMARKUP_SANITIZE",
  ].join("\n");
}

export function planManifestScriptV1(
  config: CustomerCiWorkflowConfigV1,
  workflowPolicyDigest: string,
): string {
  const workflowConfigDigest = sha256(canonicalJson(config));
  const configs = environmentConfigs(config);
  const terraformManifestRoot = packageRelativeTerraformRoot(config);
  const publicKeyDigest = planEncryptionPublicKeyDigest(config);
  return [
    "node --input-type=module <<'CLOUDMARKUP_MANIFEST'",
    "import { createHash } from 'node:crypto';",
    "import { lstat, readFile, writeFile } from 'node:fs/promises';",
    "const fail = () => { throw new Error('The saved-plan provenance could not be established.'); }; const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`; const readBounded = async (path, maximum) => { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximum) fail(); const bytes = await readFile(path); if (bytes.byteLength > maximum) fail(); return bytes; }; const sha = async (path, maximum) => digest(await readBounded(path, maximum));",
    `const lockPath = ${JSON.stringify(packageFilePath(config, "cloudmarkup/cloudmarkup.lock.json"))};`,
    `const exportManifestPath = ${JSON.stringify(packageFilePath(config, "cloudmarkup/cloudmarkup.manifest.json"))};`,
    "const lockBytes = await readBounded(lockPath, " +
      String(MANIFEST_MAX_BYTES) +
      "); const exportManifestBytes = await readBounded(exportManifestPath, " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      "); let lock; let exportManifest; try { lock = JSON.parse(lockBytes); exportManifest = JSON.parse(exportManifestBytes); } catch { fail(); }",
    `if (lock.solutionRevision?.id !== ${JSON.stringify(config.solutionRevision.id)} || lock.solutionRevision?.digest !== ${JSON.stringify(config.solutionRevision.digest)}) fail();`,
    "const createdAt = new Date();",
    `const expiresAt = new Date(createdAt.getTime() + ${String(config.plan.expiresAfterMinutes)} * 60_000);`,
    "const environment = process.env.CLOUDMARKUP_ENVIRONMENT || '';",
    `const configs = ${canonicalJson(configs)};`,
    "if (!Object.hasOwn(configs, environment)) fail();",
    ...targetAuthorityScriptLines(config),
    "const runId = process.env.GITHUB_RUN_ID || ''; const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT); const runEvent = process.env.GITHUB_EVENT_NAME || ''; const runRef = process.env.GITHUB_REF || '';",
    "if (!/^[1-9][0-9]{0,15}$/.test(runId) || !Number.isSafeInteger(runAttempt) || runAttempt < 1 || runAttempt > 100 || !['push', 'workflow_dispatch'].includes(runEvent) || !configs[environment].approvedBranches.map((branch) => `refs/heads/${branch}`).includes(runRef) || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '')) fail();",
    `if (process.env.GITHUB_WORKFLOW_REF !== ${JSON.stringify(`${config.repository.owner}/${config.repository.name}/${CUSTOMER_CI_WORKFLOW_PATHS.plan}@`)} + runRef) fail();`,
    `const terraformManifestRoot = ${JSON.stringify(terraformManifestRoot)};`,
    "const infrastructure = exportManifest.files.filter((file) => file.path === terraformManifestRoot || String(file.path).startsWith(`${terraformManifestRoot}/`)).map(({ checksum, path, semanticChecksum }) => ({ checksum, path, semanticChecksum })).sort((left, right) => left.path.localeCompare(right.path, 'en')); if (infrastructure.length === 0) fail();",
    "const manifest = {",
    "  artifactName: `cloudmarkup-plan-${environment}`, backendConfigDigest: await sha(process.env.CLOUDMARKUP_BACKEND_CONFIG, " +
      String(PACKAGE_FILE_MAX_BYTES) +
      "), commitSha: process.env.GITHUB_SHA, contractVersion: 1, createdAt: createdAt.toISOString(), encryptedPlanChecksum: await sha('cloudmarkup.tfplan.encrypted', " +
      String(ENCRYPTED_PLAN_MAX_BYTES) +
      "), environment, environmentConfigDigest: targetEnvironmentConfigDigest, expiresAt: expiresAt.toISOString(), infrastructureArtifactDigest: digest(Buffer.from(JSON.stringify(infrastructure))), kind: 'cloudmarkup.saved-terraform-plan',",
    `  planChecksum: await sha('cloudmarkup.tfplan', ${String(PLAN_BINARY_MAX_BYTES)}), planEncryption: { algorithm: ${JSON.stringify(config.plan.artifactEncryption.algorithm)}, publicKeyDigest: ${JSON.stringify(publicKeyDigest)} }, planRunAttempt: runAttempt, planRunEvent: runEvent, planRunId: runId, planRunPath: ${JSON.stringify(CUSTOMER_CI_WORKFLOW_PATHS.plan)}, planRunRef: runRef, providerLockHash: await sha(process.env.CLOUDMARKUP_PROVIDER_LOCK, ${String(PACKAGE_FILE_MAX_BYTES)}), sanitizedPlanChecksum: await sha('cloudmarkup-plan.sanitized.json', ${String(JSON_ARTIFACT_MAX_BYTES)}), semanticAnalysisChecksum: await sha('cloudmarkup-plan.analysis.json', ${String(JSON_ARTIFACT_MAX_BYTES)}),`,
    "  solutionExportManifestDigest: digest(exportManifestBytes), solutionRepositoryLockDigest: digest(lockBytes), solutionRevision: lock.solutionRevision, targetAuthority, terraformVersion: process.env.CLOUDMARKUP_TERRAFORM_VERSION,",
    `  workflowConfigDigest: ${JSON.stringify(workflowConfigDigest)}, workflowPolicyDigest: ${JSON.stringify(workflowPolicyDigest)}, workspace: process.env.CLOUDMARKUP_WORKSPACE,`,
    "};",
    "const manifestBytes = Buffer.from(JSON.stringify(manifest) + '\\n'); if (manifestBytes.byteLength > " +
      String(MANIFEST_MAX_BYTES) +
      ") fail(); const manifestDigest = digest(manifestBytes); await writeFile('cloudmarkup-plan.manifest.json', manifestBytes, { flag: 'wx' });",
    "const planReceipt = { commitSha: manifest.commitSha, contractVersion: 1, createdAt: manifest.createdAt, environment, idempotencyKey: `plan-${manifestDigest.slice(7, 39)}`, inputDigests: [manifestDigest, manifest.planChecksum], kind: 'cloudmarkup.customer-ci-stage-receipt', outputDigests: [manifest.encryptedPlanChecksum, manifest.planChecksum, manifest.sanitizedPlanChecksum, manifest.semanticAnalysisChecksum], receiptId: `receipt-plan-${runId}`, solutionRevision: manifest.solutionRevision, stage: 'plan', status: 'passed', targetAuthorityDigest: manifest.environmentConfigDigest }; const planReceiptBytes = Buffer.from(JSON.stringify(planReceipt) + '\\n'); if (planReceiptBytes.byteLength > " +
      String(MANIFEST_MAX_BYTES) +
      ") fail(); const planReceiptDigest = digest(planReceiptBytes); await writeFile('cloudmarkup-plan.receipt.json', planReceiptBytes, { flag: 'wx' });",
    "const evidence = { artifacts: [{ digest: planReceiptDigest, mediaType: 'application/json', sizeBytes: planReceiptBytes.byteLength }, { digest: manifest.encryptedPlanChecksum, mediaType: 'application/octet-stream', sizeBytes: (await readBounded('cloudmarkup.tfplan.encrypted', " +
      String(ENCRYPTED_PLAN_MAX_BYTES) +
      ")).byteLength }, { digest: manifest.sanitizedPlanChecksum, mediaType: 'application/json', sizeBytes: (await readBounded('cloudmarkup-plan.sanitized.json', " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      ")).byteLength }, { digest: manifest.semanticAnalysisChecksum, mediaType: 'application/json', sizeBytes: (await readBounded('cloudmarkup-plan.analysis.json', " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      ")).byteLength }], checks: [{ artifactDigests: [planReceiptDigest, manifest.encryptedPlanChecksum, manifest.sanitizedPlanChecksum, manifest.semanticAnalysisChecksum], checkId: 'cloudmarkup.customer-ci.saved-plan-integrity', issueIds: [], status: 'passed', summary: 'The customer-owned CI job encrypted and bound a revision-specific saved Terraform plan.' }], ciIdentity: `github:${process.env.GITHUB_REPOSITORY}:run:${runId}`, contractVersion: 1, environment: { environmentId: environment, environmentType: environment === 'dev' ? 'development' : environment }, id: `evidence-plan-${runId}`, layer: 'planned', level: { kind: 'cloud-plan-change-set', rank: 6 }, models: [], provenance: { actor: { ciIdentity: `github:${process.env.GITHUB_REPOSITORY}:run:${runId}`, kind: 'ci' }, createdAt: manifest.createdAt, inputDigests: [planReceiptDigest, manifest.backendConfigDigest, manifest.providerLockHash, manifest.solutionExportManifestDigest, manifest.solutionRepositoryLockDigest, manifest.infrastructureArtifactDigest, manifest.environmentConfigDigest, manifest.workflowConfigDigest, manifest.planChecksum] }, solutionRevisionId: lock.solutionRevision.id, staleness: { assessedAt: manifest.createdAt, state: 'current', validUntil: manifest.expiresAt }, tools: [{ id: 'hashicorp.terraform', version: manifest.terraformVersion }] };",
    "const evidenceBytes = Buffer.from(JSON.stringify(evidence) + '\\n'); if (evidenceBytes.byteLength > " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      ") fail(); await writeFile('cloudmarkup-plan.evidence.json', evidenceBytes, { flag: 'wx' });",
    "CLOUDMARKUP_MANIFEST",
  ].join("\n");
}
export function savedPlanManifestInspectionScriptV1(
  config: CustomerCiWorkflowConfigV1,
  workflowPolicyDigest: string,
): string {
  const workflowConfigDigest = sha256(canonicalJson(config));
  const configs = environmentConfigs(config);
  const publicKeyDigest = planEncryptionPublicKeyDigest(config);
  const allowedRefs = Object.fromEntries(
    config.environments.map(({ approvedBranches, id }) => [
      id,
      approvedBranches.map((branch) => `refs/heads/${branch}`),
    ]),
  );
  const exactKeys = [
    "artifactName",
    "backendConfigDigest",
    "commitSha",
    "contractVersion",
    "createdAt",
    "environment",
    "encryptedPlanChecksum",
    "environmentConfigDigest",
    "expiresAt",
    "infrastructureArtifactDigest",
    "kind",
    "planChecksum",
    "planRunAttempt",
    "planEncryption",
    "planRunEvent",
    "planRunId",
    "planRunPath",
    "planRunRef",
    "providerLockHash",
    "sanitizedPlanChecksum",
    "semanticAnalysisChecksum",
    "solutionExportManifestDigest",
    "solutionRepositoryLockDigest",
    "solutionRevision",
    "terraformVersion",
    "targetAuthority",
    "workflowConfigDigest",
    "workflowPolicyDigest",
    "workspace",
  ].sort();
  return [
    "node --input-type=module <<'CLOUDMARKUP_INSPECT'",
    "import { createHash } from 'node:crypto';",
    "import { appendFile, lstat, readFile, readdir } from 'node:fs/promises';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    "const fail = () => { throw new Error('The downloaded saved-plan package failed exact manifest validation.'); }; const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value); const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;",
    "const digestPattern = /^sha256:[a-f0-9]{64}$/; const commitPattern = /^[a-f0-9]{40}$/; const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/; const refPattern = /^refs\\/heads\\/[A-Za-z0-9](?:[A-Za-z0-9._\\/-]*[A-Za-z0-9])?$/;",
    "const exactKeys = (value, keys) => { if (!plain(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(); };",
    "const utc = (value) => { if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(value)) fail(); const parsed = Date.parse(value); if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail(); return parsed; };",
    "const directory = resolve(process.env.SAVED_PLAN_DIRECTORY || ''); const runnerTemp = resolve(process.env.RUNNER_TEMP || ''); const relation = relative(runnerTemp, directory); if (!process.env.RUNNER_TEMP || !relation || relation.startsWith(`..${sep}`) || isAbsolute(relation)) fail();",
    "const directoryStat = await lstat(directory); if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) fail(); const maximumByFile = { 'cloudmarkup-conformance.plan.json': " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      ", 'cloudmarkup-plan.analysis.json': " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      ", 'cloudmarkup-plan.evidence.json': " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      ", 'cloudmarkup-plan.manifest.json': " +
      String(MANIFEST_MAX_BYTES) +
      ", 'cloudmarkup-plan.receipt.json': " +
      String(MANIFEST_MAX_BYTES) +
      ", 'cloudmarkup-plan.sanitized.json': " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      ", 'cloudmarkup.tfplan.encrypted': " +
      String(ENCRYPTED_PLAN_MAX_BYTES) +
      " }; const expectedFiles = Object.keys(maximumByFile).sort(); const entries = await readdir(directory); if (JSON.stringify([...entries].sort()) !== JSON.stringify(expectedFiles)) fail(); let totalBytes = 0; for (const entry of entries) { const item = await lstat(resolve(directory, entry)); if (item.isSymbolicLink() || !item.isFile() || item.size > maximumByFile[entry]) fail(); totalBytes += item.size; } if (totalBytes > " +
      String(
        ENCRYPTED_PLAN_MAX_BYTES +
          JSON_ARTIFACT_MAX_BYTES * 4 +
          MANIFEST_MAX_BYTES * 2,
      ) +
      ") fail();",
    "const manifestPath = resolve(directory, 'cloudmarkup-plan.manifest.json'); const stat = await lstat(manifestPath); if (stat.size > " +
      String(MANIFEST_MAX_BYTES) +
      ") fail(); const bytes = await readFile(manifestPath); if (bytes.byteLength > " +
      String(MANIFEST_MAX_BYTES) +
      ") fail();",
    "const manifestDigest = digest(bytes); if (!digestPattern.test(process.env.EXPECTED_MANIFEST_CHECKSUM || '') || manifestDigest !== process.env.EXPECTED_MANIFEST_CHECKSUM) fail(); let manifest; try { manifest = JSON.parse(bytes); } catch { fail(); }",
    `exactKeys(manifest, ${canonicalJson(exactKeys)}); exactKeys(manifest.solutionRevision, ['digest', 'id']); exactKeys(manifest.planEncryption, ['algorithm', 'publicKeyDigest']); exactKeys(manifest.targetAuthority, ['accountId', 'deployRoleArnDigest', 'driftRoleArnDigest', 'oidcSubject', 'partition', 'planRoleArnDigest', 'region']);`,
    "for (const field of ['backendConfigDigest', 'encryptedPlanChecksum', 'environmentConfigDigest', 'infrastructureArtifactDigest', 'planChecksum', 'providerLockHash', 'sanitizedPlanChecksum', 'semanticAnalysisChecksum', 'solutionExportManifestDigest', 'solutionRepositoryLockDigest', 'workflowConfigDigest', 'workflowPolicyDigest']) if (!digestPattern.test(manifest[field])) fail();",
    "if (!commitPattern.test(manifest.commitSha) || !stableIdPattern.test(manifest.solutionRevision.id) || !digestPattern.test(manifest.solutionRevision.digest) || !/^1\\.\\d{1,2}\\.\\d{1,2}$/.test(manifest.terraformVersion) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,89}$/.test(manifest.workspace)) fail();",
    "if (!['dev', 'staging', 'production'].includes(manifest.environment) || manifest.contractVersion !== 1 || manifest.kind !== 'cloudmarkup.saved-terraform-plan' || manifest.artifactName !== `cloudmarkup-plan-${manifest.environment}`) fail();",
    `if (manifest.planEncryption.algorithm !== ${JSON.stringify(config.plan.artifactEncryption.algorithm)} || manifest.planEncryption.publicKeyDigest !== ${JSON.stringify(publicKeyDigest)} || manifest.targetAuthority.partition !== 'aws') fail();`,
    "const created = utc(manifest.createdAt); const expires = utc(manifest.expiresAt); const now = Date.now(); if (expires <= created || expires <= now || created > now + 300_000 || expires - created !== " +
      String(config.plan.expiresAfterMinutes * 60_000) +
      ") fail();",
    "if (!Number.isSafeInteger(manifest.planRunAttempt) || manifest.planRunAttempt < 1 || manifest.planRunAttempt > 100 || !/^[1-9][0-9]{0,15}$/.test(manifest.planRunId) || !['push', 'workflow_dispatch'].includes(manifest.planRunEvent) || manifest.planRunPath !== " +
      JSON.stringify(CUSTOMER_CI_WORKFLOW_PATHS.plan) +
      " || !refPattern.test(manifest.planRunRef)) fail();",
    `const allowedRefs = ${canonicalJson(allowedRefs)}; if (!allowedRefs[manifest.environment]?.includes(manifest.planRunRef)) fail();`,
    `const configs = ${canonicalJson(configs)}; const environment = process.env.CLOUDMARKUP_ENVIRONMENT || ''; if (!Object.hasOwn(configs, environment) || manifest.environment !== environment) fail();`,
    ...targetAuthorityScriptLines(config),
    "if (JSON.stringify(manifest.targetAuthority) !== JSON.stringify(targetAuthority) || manifest.environmentConfigDigest !== targetEnvironmentConfigDigest) fail();",
    "const encryptedPlanBytes = await readFile(resolve(directory, 'cloudmarkup.tfplan.encrypted')); if (encryptedPlanBytes.byteLength < 5 || encryptedPlanBytes.byteLength > " +
      String(ENCRYPTED_PLAN_MAX_BYTES) +
      " || digest(encryptedPlanBytes) !== manifest.encryptedPlanChecksum) fail();",
    "const expected = { commit: process.env.EXPECTED_COMMIT || '', environment: process.env.CLOUDMARKUP_ENVIRONMENT || '', plan: process.env.EXPECTED_PLAN_CHECKSUM || '', revisionDigest: process.env.EXPECTED_REVISION_DIGEST || '', revisionId: process.env.EXPECTED_REVISION_ID || '', runAttempt: process.env.EXPECTED_PLAN_RUN_ATTEMPT || '', runEvent: process.env.EXPECTED_PLAN_RUN_EVENT || '', runId: process.env.EXPECTED_PLAN_RUN_ID || '', runPath: process.env.EXPECTED_PLAN_RUN_PATH || '', runRef: process.env.EXPECTED_PLAN_RUN_REF || '' };",
    "if (!commitPattern.test(expected.commit) || !digestPattern.test(expected.plan) || !digestPattern.test(expected.revisionDigest) || !stableIdPattern.test(expected.revisionId) || !/^[1-9][0-9]{0,15}$/.test(expected.runId) || !/^[1-9][0-9]{0,2}$/.test(expected.runAttempt) || !['push', 'workflow_dispatch'].includes(expected.runEvent) || expected.runPath !== " +
      JSON.stringify(CUSTOMER_CI_WORKFLOW_PATHS.plan) +
      " || !refPattern.test(expected.runRef)) fail();",
    "if (manifest.commitSha !== expected.commit || manifest.environment !== expected.environment || manifest.planChecksum !== expected.plan || manifest.solutionRevision.id !== expected.revisionId || manifest.solutionRevision.digest !== expected.revisionDigest || manifest.planRunId !== expected.runId || String(manifest.planRunAttempt) !== expected.runAttempt || manifest.planRunEvent !== expected.runEvent || manifest.planRunPath !== expected.runPath || manifest.planRunRef !== expected.runRef || manifest.workspace !== process.env.CLOUDMARKUP_WORKSPACE) fail();",
    `if (manifest.solutionRevision.id !== ${JSON.stringify(config.solutionRevision.id)} || manifest.solutionRevision.digest !== ${JSON.stringify(config.solutionRevision.digest)} || manifest.workflowConfigDigest !== ${JSON.stringify(workflowConfigDigest)} || manifest.workflowPolicyDigest !== ${JSON.stringify(workflowPolicyDigest)} || manifest.terraformVersion !== ${JSON.stringify(config.terraform.version)}) fail();`,
    "const planReceiptPath = resolve(directory, 'cloudmarkup-plan.receipt.json'); const planReceiptStat = await lstat(planReceiptPath); if (planReceiptStat.size > " +
      String(MANIFEST_MAX_BYTES) +
      ") fail(); const planReceiptBytes = await readFile(planReceiptPath); if (planReceiptBytes.byteLength > " +
      String(MANIFEST_MAX_BYTES) +
      ") fail(); let planReceipt; try { planReceipt = JSON.parse(planReceiptBytes); } catch { fail(); }",
    "exactKeys(planReceipt, ['commitSha', 'contractVersion', 'createdAt', 'environment', 'idempotencyKey', 'inputDigests', 'kind', 'outputDigests', 'receiptId', 'solutionRevision', 'stage', 'status', 'targetAuthorityDigest']); exactKeys(planReceipt.solutionRevision, ['digest', 'id']);",
    "if (planReceipt.contractVersion !== 1 || planReceipt.kind !== 'cloudmarkup.customer-ci-stage-receipt' || planReceipt.stage !== 'plan' || planReceipt.status !== 'passed' || planReceipt.commitSha !== manifest.commitSha || planReceipt.createdAt !== manifest.createdAt || planReceipt.environment !== manifest.environment || planReceipt.idempotencyKey !== `plan-${manifestDigest.slice(7, 39)}` || planReceipt.receiptId !== `receipt-plan-${manifest.planRunId}` || planReceipt.solutionRevision.id !== manifest.solutionRevision.id || planReceipt.solutionRevision.digest !== manifest.solutionRevision.digest || planReceipt.targetAuthorityDigest !== manifest.environmentConfigDigest || JSON.stringify(planReceipt.inputDigests) !== JSON.stringify([manifestDigest, manifest.planChecksum]) || JSON.stringify(planReceipt.outputDigests) !== JSON.stringify([manifest.encryptedPlanChecksum, manifest.planChecksum, manifest.sanitizedPlanChecksum, manifest.semanticAnalysisChecksum])) fail();",
    "const output = process.env.GITHUB_OUTPUT || ''; const outputRelation = relative(runnerTemp, resolve(output)); if (!output || !isAbsolute(output) || !outputRelation || outputRelation.startsWith(`..${sep}`) || isAbsolute(outputRelation)) fail(); await appendFile(output, `commit=${manifest.commitSha}\\n`);",
    "CLOUDMARKUP_INSPECT",
  ].join("\n");
}

export function deployIntegrityScriptV1(
  config: CustomerCiWorkflowConfigV1,
  workflowPolicyDigest: string,
): string {
  const workflowConfigDigest = sha256(canonicalJson(config));
  const configs = environmentConfigs(config);
  const terraformManifestRoot = packageRelativeTerraformRoot(config);
  return [
    "node --input-type=module <<'CLOUDMARKUP_INTEGRITY'",
    "import { createHash } from 'node:crypto';",
    "import { lstat, readFile } from 'node:fs/promises';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    "const fail = () => { throw new Error('The saved-plan package no longer matches the reviewed plan bindings.'); }; const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`; const readBounded = async (path, maximum) => { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximum) fail(); const bytes = await readFile(path); if (bytes.byteLength > maximum) fail(); return bytes; }; const sha = async (path, maximum) => digest(await readBounded(path, maximum));",
    "const savedPlanDirectory = resolve(process.env.SAVED_PLAN_DIRECTORY || ''); const runnerTemp = resolve(process.env.RUNNER_TEMP || ''); const relation = relative(runnerTemp, savedPlanDirectory); if (!process.env.RUNNER_TEMP || !relation || relation.startsWith(`..${sep}`) || isAbsolute(relation)) fail();",
    "let manifest; try { manifest = JSON.parse(await readBounded(resolve(savedPlanDirectory, 'cloudmarkup-plan.manifest.json'), " +
      String(MANIFEST_MAX_BYTES) +
      ")); } catch { fail(); }",
    `const lockPath = ${JSON.stringify(packageFilePath(config, "cloudmarkup/cloudmarkup.lock.json"))};`,
    `const exportManifestPath = ${JSON.stringify(packageFilePath(config, "cloudmarkup/cloudmarkup.manifest.json"))};`,
    "const lockBytes = await readBounded(lockPath, " +
      String(MANIFEST_MAX_BYTES) +
      "); const exportManifestBytes = await readBounded(exportManifestPath, " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      "); let lock; let exportManifest; try { lock = JSON.parse(lockBytes); exportManifest = JSON.parse(exportManifestBytes); } catch { fail(); }",
    `const configs = ${canonicalJson(configs)};`,
    `const terraformManifestRoot = ${JSON.stringify(terraformManifestRoot)};`,
    "const environment = process.env.CLOUDMARKUP_ENVIRONMENT || ''; const environmentConfig = configs[environment]; if (!environmentConfig) fail(); const infrastructure = exportManifest.files.filter((file) => file.path === terraformManifestRoot || String(file.path).startsWith(`${terraformManifestRoot}/`)).map(({ checksum, path, semanticChecksum }) => ({ checksum, path, semanticChecksum })).sort((left, right) => left.path.localeCompare(right.path, 'en'));",
    ...targetAuthorityScriptLines(config),
    "const checks = { encryptedPlanChecksum: await sha(resolve(savedPlanDirectory, 'cloudmarkup.tfplan.encrypted'), " +
      String(ENCRYPTED_PLAN_MAX_BYTES) +
      "), planChecksum: await sha(process.env.CLOUDMARKUP_DECRYPTED_PLAN, " +
      String(PLAN_BINARY_MAX_BYTES) +
      "), providerLockHash: await sha(process.env.CLOUDMARKUP_PROVIDER_LOCK, " +
      String(PACKAGE_FILE_MAX_BYTES) +
      "), backendConfigDigest: await sha(process.env.CLOUDMARKUP_BACKEND_CONFIG, " +
      String(PACKAGE_FILE_MAX_BYTES) +
      "), sanitizedPlanChecksum: await sha(resolve(savedPlanDirectory, 'cloudmarkup-plan.sanitized.json'), " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      "), semanticAnalysisChecksum: await sha(resolve(savedPlanDirectory, 'cloudmarkup-plan.analysis.json'), " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      "), solutionExportManifestDigest: digest(exportManifestBytes), solutionRepositoryLockDigest: digest(lockBytes), infrastructureArtifactDigest: digest(Buffer.from(JSON.stringify(infrastructure))), environmentConfigDigest: targetEnvironmentConfigDigest };",
    "for (const [field, actual] of Object.entries(checks)) if (manifest[field] !== actual) fail();",
    "if (JSON.stringify(manifest.targetAuthority) !== JSON.stringify(targetAuthority)) fail();",
    "if (manifest.workspace !== process.env.CLOUDMARKUP_WORKSPACE || lock.solutionRevision?.id !== manifest.solutionRevision?.id || lock.solutionRevision?.digest !== manifest.solutionRevision?.digest) fail();",
    `if (manifest.workflowConfigDigest !== ${JSON.stringify(workflowConfigDigest)} || manifest.workflowPolicyDigest !== ${JSON.stringify(workflowPolicyDigest)}) fail();`,
    "if (process.env.CLOUDMARKUP_DEPLOY_ENABLED !== 'true') throw new Error('Customer deployment is disabled by the environment kill switch.');",
    "CLOUDMARKUP_INTEGRITY",
  ].join("\n");
}

export function savedPlanExpiryAdmissionScriptV1(): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_EXPIRY'",
    "import { createHash } from 'node:crypto';",
    "import { lstat, readFile } from 'node:fs/promises';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    "const fail = () => { throw new Error('The approved saved plan expired or changed before apply. Create and approve a new plan.'); }; const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`; const digestPattern = /^sha256:[a-f0-9]{64}$/;",
    "const directory = resolve(process.env.SAVED_PLAN_DIRECTORY || ''); const runnerTemp = resolve(process.env.RUNNER_TEMP || ''); const relation = relative(runnerTemp, directory); if (!process.env.RUNNER_TEMP || !relation || relation.startsWith(`..${sep}`) || isAbsolute(relation)) fail();",
    "const path = resolve(directory, 'cloudmarkup-plan.manifest.json'); const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > " +
      String(MANIFEST_MAX_BYTES) +
      ") fail(); const bytes = await readFile(path); if (bytes.byteLength < 1 || bytes.byteLength > " +
      String(MANIFEST_MAX_BYTES) +
      ") fail();",
    "const expectedChecksum = process.env.EXPECTED_MANIFEST_CHECKSUM || ''; const actualChecksum = digest(bytes); if (!digestPattern.test(expectedChecksum) || actualChecksum !== expectedChecksum) fail();",
    "let manifest; try { manifest = JSON.parse(bytes); } catch { fail(); } const expiresAt = manifest?.expiresAt; if (typeof expiresAt !== 'string') fail(); const expires = Date.parse(expiresAt); if (!Number.isFinite(expires) || new Date(expires).toISOString() !== expiresAt || expires <= Date.now()) fail();",
    "const expectedPlanChecksum = process.env.EXPECTED_PLAN_CHECKSUM || ''; if (!digestPattern.test(expectedPlanChecksum) || manifest?.planChecksum !== expectedPlanChecksum) fail();",
    "const planPath = resolve(process.env.CLOUDMARKUP_DECRYPTED_PLAN || ''); const planRelation = relative(runnerTemp, planPath); if (!process.env.CLOUDMARKUP_DECRYPTED_PLAN || !planRelation || planRelation.startsWith(`..${sep}`) || isAbsolute(planRelation)) fail(); const planStat = await lstat(planPath); if (planStat.isSymbolicLink() || !planStat.isFile() || planStat.size < 1 || planStat.size > " +
      String(PLAN_BINARY_MAX_BYTES) +
      ") fail(); const planBytes = await readFile(planPath); if (planBytes.byteLength < 1 || planBytes.byteLength > " +
      String(PLAN_BINARY_MAX_BYTES) +
      " || digest(planBytes) !== expectedPlanChecksum) fail();",
    "CLOUDMARKUP_EXPIRY",
  ].join("\n");
}

export function promotionAdmissionScriptV1(): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_PROMOTION'",
    "import { appendFile } from 'node:fs/promises';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    "const fail = () => { throw new Error('The deployment promotion predecessor inputs are invalid.'); }; const environment = process.env.CLOUDMARKUP_ENVIRONMENT || ''; const runId = process.env.PREDECESSOR_RUN_ID || ''; const receiptDigest = process.env.PREDECESSOR_RECEIPT_DIGEST || ''; const smokeRunId = process.env.PREDECESSOR_SMOKE_RUN_ID || ''; const smokeReceiptDigest = process.env.PREDECESSOR_SMOKE_RECEIPT_DIGEST || '';",
    "const predecessor = { staging: 'dev', production: 'staging' }; if (environment === 'dev') { if (runId || receiptDigest || smokeRunId || smokeReceiptDigest) fail(); process.exit(0); } if (!Object.hasOwn(predecessor, environment) || !/^[1-9][0-9]{0,15}$/.test(runId) || !/^sha256:[a-f0-9]{64}$/.test(receiptDigest) || !/^[1-9][0-9]{0,15}$/.test(smokeRunId) || !/^sha256:[a-f0-9]{64}$/.test(smokeReceiptDigest)) fail();",
    "const output = process.env.GITHUB_OUTPUT || ''; const runnerTemp = resolve(process.env.RUNNER_TEMP || ''); const relation = relative(runnerTemp, resolve(output)); if (!output || !isAbsolute(output) || !relation || relation.startsWith(`..${sep}`) || isAbsolute(relation)) fail(); await appendFile(output, `predecessor_environment=${predecessor[environment]}\\n`);",
    "CLOUDMARKUP_PROMOTION",
  ].join("\n");
}

export function predecessorReceiptInspectionScriptV1(
  config: CustomerCiWorkflowConfigV1,
): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_PREDECESSOR_RECEIPT'",
    "import { createHash } from 'node:crypto';",
    "import { appendFile, lstat, readFile, readdir } from 'node:fs/promises';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    "const fail = () => { throw new Error('The predecessor deployment receipt failed exact promotion validation.'); }; const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value); const digestPattern = /^sha256:[a-f0-9]{64}$/; const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;",
    "const directory = resolve(process.env.PREDECESSOR_DIRECTORY || ''); const runnerTemp = resolve(process.env.RUNNER_TEMP || ''); const relation = relative(runnerTemp, directory); if (!process.env.RUNNER_TEMP || !relation || relation.startsWith(`..${sep}`) || isAbsolute(relation)) fail(); const directoryStat = await lstat(directory); if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) fail(); const maximumByFile = { 'cloudmarkup-deployment.receipt.json': " +
      String(MANIFEST_MAX_BYTES) +
      ", 'cloudmarkup-conformance.deployment.json': " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      " }; const entries = await readdir(directory); if (JSON.stringify([...entries].sort()) !== JSON.stringify(Object.keys(maximumByFile).sort())) fail(); for (const entry of entries) { const item = await lstat(resolve(directory, entry)); if (item.isSymbolicLink() || !item.isFile() || item.size > maximumByFile[entry]) fail(); }",
    "const receiptPath = resolve(directory, 'cloudmarkup-deployment.receipt.json'); const stat = await lstat(receiptPath); if (stat.size > " +
      String(MANIFEST_MAX_BYTES) +
      ") fail(); const bytes = await readFile(receiptPath); if (bytes.byteLength > " +
      String(MANIFEST_MAX_BYTES) +
      ") fail(); const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;",
    "if (!digestPattern.test(process.env.PREDECESSOR_RECEIPT_DIGEST || '') || digest !== process.env.PREDECESSOR_RECEIPT_DIGEST) fail(); let receipt; try { receipt = JSON.parse(bytes); } catch { fail(); }",
    "const allowedKeys = ['commitSha', 'contractVersion', 'createdAt', 'environment', 'idempotencyKey', 'inputDigests', 'kind', 'outputDigests', 'predecessorReceiptDigest', 'receiptId', 'solutionRevision', 'stage', 'status', 'targetAuthorityDigest', ...(receipt?.promotionPredecessorReceiptDigest === undefined ? [] : ['promotionPredecessorReceiptDigest']), ...(receipt?.promotionPredecessorSmokeReceiptDigest === undefined ? [] : ['promotionPredecessorSmokeReceiptDigest'])].sort(); if (!plain(receipt) || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(allowedKeys) || !plain(receipt.solutionRevision) || JSON.stringify(Object.keys(receipt.solutionRevision).sort()) !== JSON.stringify(['digest', 'id'])) fail();",
    "const created = Date.parse(receipt.createdAt); if (!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(receipt.createdAt || '') || !Number.isFinite(created) || new Date(created).toISOString() !== receipt.createdAt) fail();",
    "if (receipt.contractVersion !== 1 || receipt.kind !== 'cloudmarkup.customer-ci-stage-receipt' || receipt.stage !== 'deploy' || receipt.status !== 'passed' || !['dev', 'staging'].includes(receipt.environment) || !/^[a-f0-9]{40}$/.test(receipt.commitSha) || !stableIdPattern.test(receipt.idempotencyKey) || !stableIdPattern.test(receipt.solutionRevision.id) || !digestPattern.test(receipt.solutionRevision.digest) || !digestPattern.test(receipt.predecessorReceiptDigest) || !digestPattern.test(receipt.targetAuthorityDigest) || !Array.isArray(receipt.inputDigests) || receipt.inputDigests.length > 16 || !Array.isArray(receipt.outputDigests) || receipt.outputDigests.length > 16 || receipt.inputDigests.some((item) => !digestPattern.test(item)) || receipt.outputDigests.some((item) => !digestPattern.test(item))) fail();",
    "const runId = process.env.PREDECESSOR_RUN_ID || ''; const predecessorEnvironment = process.env.PREDECESSOR_ENVIRONMENT || ''; if (receipt.receiptId !== `receipt-deploy-${runId}` || receipt.environment !== predecessorEnvironment || receipt.commitSha !== process.env.EXPECTED_COMMIT || receipt.solutionRevision.id !== process.env.EXPECTED_REVISION_ID || receipt.solutionRevision.digest !== process.env.EXPECTED_REVISION_DIGEST) fail();",
    `if (receipt.solutionRevision.id !== ${JSON.stringify(config.solutionRevision.id)} || receipt.solutionRevision.digest !== ${JSON.stringify(config.solutionRevision.digest)}) fail();`,
    "if ((predecessorEnvironment === 'dev' && (receipt.promotionPredecessorReceiptDigest !== undefined || receipt.promotionPredecessorSmokeReceiptDigest !== undefined)) || (predecessorEnvironment === 'staging' && (!digestPattern.test(receipt.promotionPredecessorReceiptDigest || '') || !digestPattern.test(receipt.promotionPredecessorSmokeReceiptDigest || '')))) fail();",
    "const promotionInputDigests = predecessorEnvironment === 'dev' ? [] : [receipt.promotionPredecessorReceiptDigest, receipt.promotionPredecessorSmokeReceiptDigest]; const expectedInputDigests = [receipt.inputDigests[0], receipt.inputDigests[1], receipt.predecessorReceiptDigest, ...promotionInputDigests]; if (JSON.stringify(receipt.inputDigests) !== JSON.stringify(expectedInputDigests) || receipt.idempotencyKey !== `deploy-${receipt.inputDigests[0].slice(7, 39)}` || JSON.stringify(receipt.outputDigests) !== JSON.stringify([receipt.inputDigests[1]])) fail();",
    "const output = process.env.GITHUB_OUTPUT || ''; const outputRelation = relative(runnerTemp, resolve(output)); if (!output || !isAbsolute(output) || !outputRelation || outputRelation.startsWith(`..${sep}`) || isAbsolute(outputRelation)) fail(); await appendFile(output, `receipt_digest=${digest}\\ntarget_authority_digest=${receipt.targetAuthorityDigest}\\n`);",
    "CLOUDMARKUP_PREDECESSOR_RECEIPT",
  ].join("\n");
}

export function predecessorSmokeReceiptInspectionScriptV1(
  config: CustomerCiWorkflowConfigV1,
): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_PREDECESSOR_SMOKE'",
    "import { createHash } from 'node:crypto';",
    "import { appendFile, lstat, readFile, readdir } from 'node:fs/promises';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    "const fail = () => { throw new Error('The predecessor smoke receipt failed exact promotion validation.'); }; const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value); const ordered = (value) => Array.isArray(value) ? value.map(ordered) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value; const canonical = (value) => `${JSON.stringify(ordered(value), null, 2)}\\n`; const digestPattern = /^sha256:[a-f0-9]{64}$/; const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/; const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;",
    "const directory = resolve(process.env.PREDECESSOR_SMOKE_DIRECTORY || ''); const runnerTemp = resolve(process.env.RUNNER_TEMP || ''); const relation = relative(runnerTemp, directory); if (!process.env.RUNNER_TEMP || !relation || relation.startsWith(`..${sep}`) || isAbsolute(relation)) fail(); const directoryStat = await lstat(directory); if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) fail();",
    "const maximumByFile = { 'cloudmarkup-smoke.evidence.json': " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      ", 'cloudmarkup-conformance.deployment.smoke.json': " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      ", 'cloudmarkup-smoke.receipt.json': " +
      String(MANIFEST_MAX_BYTES) +
      ", 'cloudmarkup-smoke.result.json': " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      " }; const entries = await readdir(directory); if (JSON.stringify([...entries].sort()) !== JSON.stringify(Object.keys(maximumByFile).sort())) fail(); const readBounded = async (name) => { const path = resolve(directory, name); const item = await lstat(path); if (item.isSymbolicLink() || !item.isFile() || item.size < 1 || item.size > maximumByFile[name]) fail(); const bytes = await readFile(path); if (bytes.byteLength !== item.size) fail(); return bytes; };",
    "const receiptBytes = await readBounded('cloudmarkup-smoke.receipt.json'); const resultBytes = await readBounded('cloudmarkup-smoke.result.json'); const evidenceBytes = await readBounded('cloudmarkup-smoke.evidence.json'); const conformanceBytes = await readBounded('cloudmarkup-conformance.deployment.smoke.json'); const receiptDigest = digest(receiptBytes); const resultDigest = digest(resultBytes); const evidenceDigest = digest(evidenceBytes);",
    "if (!digestPattern.test(process.env.PREDECESSOR_SMOKE_RECEIPT_DIGEST || '') || receiptDigest !== process.env.PREDECESSOR_SMOKE_RECEIPT_DIGEST) fail(); let receipt; let result; let evidence; let conformance; try { receipt = JSON.parse(receiptBytes); result = JSON.parse(resultBytes); evidence = JSON.parse(evidenceBytes); conformance = JSON.parse(conformanceBytes); } catch { fail(); }",
    "const exactKeys = (value, keys) => { if (!plain(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(); }; exactKeys(receipt, ['commitSha','contractVersion','createdAt','environment','idempotencyKey','inputDigests','kind','outputDigests','predecessorReceiptDigest','receiptId','solutionRevision','stage','status','targetAuthorityDigest']); exactKeys(receipt.solutionRevision, ['digest','id']);",
    "const environment = process.env.PREDECESSOR_ENVIRONMENT || ''; const deploymentReceiptDigest = process.env.PREDECESSOR_RECEIPT_DIGEST || ''; const targetAuthorityDigest = process.env.PREDECESSOR_TARGET_AUTHORITY_DIGEST || ''; const smokeRunId = process.env.PREDECESSOR_SMOKE_RUN_ID || ''; const deploymentRunId = process.env.PREDECESSOR_RUN_ID || '';",
    "const created = Date.parse(receipt.createdAt); if (!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(receipt.createdAt || '') || !Number.isFinite(created) || new Date(created).toISOString() !== receipt.createdAt) fail();",
    "if (receipt.contractVersion !== 1 || receipt.kind !== 'cloudmarkup.customer-ci-stage-receipt' || receipt.stage !== 'smoke' || receipt.status !== 'passed' || !['dev','staging'].includes(environment) || receipt.environment !== environment || !/^[1-9][0-9]{0,15}$/.test(smokeRunId) || !/^[1-9][0-9]{0,15}$/.test(deploymentRunId) || receipt.receiptId !== `receipt-smoke-${smokeRunId}-${environment}` || receipt.idempotencyKey !== `smoke-${deploymentReceiptDigest.slice(7, 39)}-${environment}-read-only` || !stableIdPattern.test(receipt.idempotencyKey) || receipt.commitSha !== process.env.EXPECTED_COMMIT || receipt.solutionRevision.id !== process.env.EXPECTED_REVISION_ID || receipt.solutionRevision.digest !== process.env.EXPECTED_REVISION_DIGEST || receipt.predecessorReceiptDigest !== deploymentReceiptDigest || receipt.targetAuthorityDigest !== targetAuthorityDigest || !digestPattern.test(targetAuthorityDigest) || JSON.stringify(receipt.inputDigests) !== JSON.stringify([deploymentReceiptDigest, targetAuthorityDigest]) || JSON.stringify(receipt.outputDigests) !== JSON.stringify([resultDigest])) fail();",
    `if (receipt.solutionRevision.id !== ${JSON.stringify(config.solutionRevision.id)} || receipt.solutionRevision.digest !== ${JSON.stringify(config.solutionRevision.digest)}) fail();`,
    "exactKeys(result, ['attemptLimit','contractVersion','deployedCommit','deploymentReceiptDigest','deploymentRunId','environment','kind','rawResponseRetained','requestTimeoutSeconds','resourceLifecycle','solutionRevision','status','targetAuthorityDigest','targetMode']); exactKeys(result.solutionRevision, ['digest','id']);",
    `if (result.contractVersion !== 1 || result.kind !== 'cloudmarkup.customer-ci-sanitized-smoke-result' || result.status !== 'passed' || result.targetMode !== 'read-only' || result.resourceLifecycle !== 'none' || result.rawResponseRetained !== false || result.attemptLimit !== ${String(config.smoke.maxAttempts)} || result.requestTimeoutSeconds !== ${String(config.smoke.requestTimeoutSeconds)} || result.deployedCommit !== receipt.commitSha || result.deploymentReceiptDigest !== deploymentReceiptDigest || result.deploymentRunId !== deploymentRunId || result.environment !== environment || result.targetAuthorityDigest !== targetAuthorityDigest || JSON.stringify(result.solutionRevision) !== JSON.stringify(receipt.solutionRevision)) fail();`,
    "exactKeys(evidence, ['artifacts','checks','ciIdentity','contractVersion','environment','id','layer','level','models','provenance','solutionRevisionId','staleness','tools']); exactKeys(evidence.environment, ['environmentId','environmentType']); exactKeys(evidence.level, ['kind','rank']); exactKeys(evidence.provenance, ['actor','createdAt','inputDigests']); exactKeys(evidence.provenance.actor, ['ciIdentity','kind']); exactKeys(evidence.staleness, ['assessedAt','state']);",
    `const expectedCiIdentity = ${JSON.stringify(`github:${config.repository.owner}/${config.repository.name}:run:`)} + smokeRunId; const environmentType = environment === 'dev' ? 'development' : environment; if (evidence.contractVersion !== 1 || evidence.id !== \`evidence-smoke-\${smokeRunId}-\${environment}\` || evidence.ciIdentity !== expectedCiIdentity || evidence.layer !== 'deployed' || evidence.solutionRevisionId !== receipt.solutionRevision.id || evidence.environment.environmentId !== environment || evidence.environment.environmentType !== environmentType || evidence.level.kind !== 'deployment-smoke-integration' || evidence.level.rank !== 7 || !Array.isArray(evidence.models) || evidence.models.length !== 0 || !Array.isArray(evidence.tools) || evidence.tools.length !== 0) fail();`,
    "if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length !== 2) fail(); for (const artifact of evidence.artifacts) exactKeys(artifact, ['digest','mediaType','sizeBytes']); const expectedArtifacts = [{ digest: resultDigest, mediaType: 'application/json', sizeBytes: resultBytes.byteLength }, { digest: receiptDigest, mediaType: 'application/json', sizeBytes: receiptBytes.byteLength }]; if (JSON.stringify(evidence.artifacts) !== JSON.stringify(expectedArtifacts)) fail();",
    "if (!Array.isArray(evidence.checks) || evidence.checks.length !== 1) fail(); const check = evidence.checks[0]; exactKeys(check, ['artifactDigests','checkId','issueIds','status','summary']); if (check.checkId !== 'customer-ci.bounded-smoke' || check.status !== 'passed' || check.summary !== 'The approved bounded smoke check passed against the exact deployed revision.' || JSON.stringify(check.artifactDigests) !== JSON.stringify([resultDigest, receiptDigest]) || !Array.isArray(check.issueIds) || check.issueIds.length !== 0) fail();",
    "if (evidence.provenance.actor.kind !== 'ci' || evidence.provenance.actor.ciIdentity !== expectedCiIdentity || evidence.provenance.createdAt !== receipt.createdAt || JSON.stringify(evidence.provenance.inputDigests) !== JSON.stringify([deploymentReceiptDigest, resultDigest, receiptDigest]) || evidence.staleness.assessedAt !== receipt.createdAt || evidence.staleness.state !== 'current') fail();",
    "const { evidenceChecksum: conformanceChecksum, ...conformanceProjection } = conformance; if (!digestPattern.test(conformanceChecksum || '') || digest(Buffer.from(canonical(conformanceProjection))) !== conformanceChecksum || conformance.kind !== 'cloudmarkup.normalized-deployment-conformance' || conformance.completeness !== 'partial' || conformance.commitSha !== receipt.commitSha || conformance.environmentId !== environment || conformance.solutionRevision?.id !== receipt.solutionRevision.id || conformance.solutionRevision?.digest !== receipt.solutionRevision.digest || conformance.smoke?.state !== 'passed' || conformance.smoke?.evidenceDigest !== evidenceDigest || !Array.isArray(conformance.issues) || conformance.issues.some((issue) => issue.code === 'CONFORMANCE_DEPLOYMENT_SMOKE_MISSING')) fail();",
    "const output = process.env.GITHUB_OUTPUT || ''; const outputRelation = relative(runnerTemp, resolve(output)); if (!output || !isAbsolute(output) || !outputRelation || outputRelation.startsWith(`..${sep}`) || isAbsolute(outputRelation)) fail(); await appendFile(output, `receipt_digest=${receiptDigest}\\n`);",
    "CLOUDMARKUP_PREDECESSOR_SMOKE",
  ].join("\n");
}

export function deploymentReceiptInspectionScriptV1(
  config: CustomerCiWorkflowConfigV1,
): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_DEPLOYMENT_RECEIPT'",
    "import { createHash } from 'node:crypto';",
    "import { appendFile, lstat, readFile, readdir } from 'node:fs/promises';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    "const fail = () => { throw new Error('The deployment receipt failed exact deployed-baseline validation.'); }; const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value); const ordered = (value) => Array.isArray(value) ? value.map(ordered) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value; const canonical = (value) => `${JSON.stringify(ordered(value), null, 2)}\\n`; const digestPattern = /^sha256:[a-f0-9]{64}$/; const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/; const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;",
    `const configs = ${canonicalJson(environmentConfigs(config))};`,
    "const environment = process.env.CLOUDMARKUP_ENVIRONMENT || ''; if (!configs[environment]) fail();",
    "const directory = resolve(process.env.DEPLOYMENT_DIRECTORY || ''); const runnerTemp = resolve(process.env.RUNNER_TEMP || ''); const relation = relative(runnerTemp, directory); if (!process.env.RUNNER_TEMP || !relation || relation.startsWith(`..${sep}`) || isAbsolute(relation)) fail(); const directoryStat = await lstat(directory); if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) fail(); const maximumByFile = { 'cloudmarkup-deployment.receipt.json': " +
      String(MANIFEST_MAX_BYTES) +
      ", 'cloudmarkup-conformance.deployment.json': " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      " }; const entries = await readdir(directory); if (JSON.stringify([...entries].sort()) !== JSON.stringify(Object.keys(maximumByFile).sort())) fail(); for (const entry of entries) { const item = await lstat(resolve(directory, entry)); if (item.isSymbolicLink() || !item.isFile() || item.size > maximumByFile[entry]) fail(); }",
    "const receiptPath = resolve(directory, 'cloudmarkup-deployment.receipt.json'); const stat = await lstat(receiptPath); if (stat.size > " +
      String(MANIFEST_MAX_BYTES) +
      ") fail(); const bytes = await readFile(receiptPath); if (bytes.byteLength > " +
      String(MANIFEST_MAX_BYTES) +
      ") fail(); const receiptDigest = digest(bytes); const conformanceBytes = await readFile(resolve(directory, 'cloudmarkup-conformance.deployment.json')); if (conformanceBytes.byteLength > " +
      String(JSON_ARTIFACT_MAX_BYTES) +
      ") fail();",
    "if (!digestPattern.test(process.env.EXPECTED_DEPLOYMENT_RECEIPT_DIGEST || '') || receiptDigest !== process.env.EXPECTED_DEPLOYMENT_RECEIPT_DIGEST) fail(); let receipt; let conformance; try { receipt = JSON.parse(bytes); conformance = JSON.parse(conformanceBytes); } catch { fail(); }",
    ...targetAuthorityScriptLines(config),
    "if (receipt.targetAuthorityDigest !== targetEnvironmentConfigDigest) fail();",
    "const allowedKeys = ['commitSha', 'contractVersion', 'createdAt', 'environment', 'idempotencyKey', 'inputDigests', 'kind', 'outputDigests', 'predecessorReceiptDigest', 'receiptId', 'solutionRevision', 'stage', 'status', 'targetAuthorityDigest', ...(receipt?.promotionPredecessorReceiptDigest === undefined ? [] : ['promotionPredecessorReceiptDigest']), ...(receipt?.promotionPredecessorSmokeReceiptDigest === undefined ? [] : ['promotionPredecessorSmokeReceiptDigest'])].sort(); if (!plain(receipt) || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(allowedKeys) || !plain(receipt.solutionRevision) || JSON.stringify(Object.keys(receipt.solutionRevision).sort()) !== JSON.stringify(['digest', 'id'])) fail();",
    "const created = Date.parse(receipt.createdAt); if (!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(receipt.createdAt || '') || !Number.isFinite(created) || new Date(created).toISOString() !== receipt.createdAt) fail();",
    "if (receipt.contractVersion !== 1 || receipt.kind !== 'cloudmarkup.customer-ci-stage-receipt' || receipt.stage !== 'deploy' || receipt.status !== 'passed' || !['dev', 'staging', 'production'].includes(receipt.environment) || !/^[a-f0-9]{40}$/.test(receipt.commitSha) || !stableIdPattern.test(receipt.idempotencyKey) || !stableIdPattern.test(receipt.solutionRevision.id) || !digestPattern.test(receipt.solutionRevision.digest) || !digestPattern.test(receipt.predecessorReceiptDigest) || !digestPattern.test(receipt.targetAuthorityDigest) || !Array.isArray(receipt.inputDigests) || receipt.inputDigests.length > 16 || !Array.isArray(receipt.outputDigests) || receipt.outputDigests.length > 16 || receipt.inputDigests.some((item) => !digestPattern.test(item)) || receipt.outputDigests.some((item) => !digestPattern.test(item))) fail();",
    "if (receipt.environment !== environment || receipt.receiptId !== `receipt-deploy-${process.env.EXPECTED_DEPLOYMENT_RUN_ID}` || receipt.commitSha !== process.env.EXPECTED_DEPLOYED_COMMIT || receipt.solutionRevision.digest !== process.env.EXPECTED_DEPLOYED_REVISION_DIGEST || (receipt.environment === 'dev' ? (receipt.promotionPredecessorReceiptDigest !== undefined || receipt.promotionPredecessorSmokeReceiptDigest !== undefined) : (!digestPattern.test(receipt.promotionPredecessorReceiptDigest || '') || !digestPattern.test(receipt.promotionPredecessorSmokeReceiptDigest || '')))) fail();",
    `if (receipt.solutionRevision.id !== ${JSON.stringify(config.solutionRevision.id)} || receipt.solutionRevision.digest !== ${JSON.stringify(config.solutionRevision.digest)}) fail();`,
    "if (!plain(conformance)) fail(); const { evidenceChecksum, ...conformanceProjection } = conformance; if (!digestPattern.test(evidenceChecksum || '') || digest(Buffer.from(canonical(conformanceProjection))) !== evidenceChecksum || conformance.kind !== 'cloudmarkup.normalized-deployment-conformance' || conformance.contractVersion !== 1 || conformance.completeness !== 'partial' || conformance.commitSha !== receipt.commitSha || conformance.environmentId !== receipt.environment || canonical(conformance.solutionRevision) !== canonical(receipt.solutionRevision) || !['terraform','cloudformation'].includes(conformance.target) || !digestPattern.test(conformance.generatedManifestDigest || '') || !digestPattern.test(conformance.planEvidenceChecksum || '') || !digestPattern.test(conformance.planIdentityDigest || '') || !Array.isArray(conformance.artifactAttestations) || !Array.isArray(conformance.issues) || !plain(conformance.smoke) || conformance.smoke.state !== 'not-run' || !plain(conformance.workflow)) fail();",
    "const issueCodes = conformance.issues.map((issue) => issue?.code); if (!issueCodes.includes('CONFORMANCE_DEPLOYMENT_ARTIFACT_ATTESTATIONS_UNAVAILABLE') || !issueCodes.includes('CONFORMANCE_DEPLOYMENT_SMOKE_MISSING')) fail();",
    "const output = process.env.GITHUB_OUTPUT || ''; const outputRelation = relative(runnerTemp, resolve(output)); if (!output || !isAbsolute(output) || !outputRelation || outputRelation.startsWith(`..${sep}`) || isAbsolute(outputRelation)) fail(); await appendFile(output, `commit=${receipt.commitSha}\\nconformance_evidence_checksum=${evidenceChecksum}\\nconformance_target=${conformance.target}\\nreceipt_digest=${receiptDigest}\\nrevision_digest=${receipt.solutionRevision.digest}\\nrevision_id=${receipt.solutionRevision.id}\\ntarget_authority_digest=${targetEnvironmentConfigDigest}\\n`);",
    "CLOUDMARKUP_DEPLOYMENT_RECEIPT",
  ].join("\n");
}

export function deployReceiptScriptV1(): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_DEPLOY_RECEIPT'",
    "import { createHash } from 'node:crypto';",
    "import { lstat, readFile, writeFile } from 'node:fs/promises';",
    "import { resolve } from 'node:path';",
    "const fail = () => { throw new Error('Deployment receipt bindings are malformed.'); }; const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`; const digestPattern = /^sha256:[a-f0-9]{64}$/; const readBounded = async (path, maximum) => { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximum) fail(); const bytes = await readFile(path); if (bytes.byteLength > maximum) fail(); return bytes; };",
    "const manifestBytes = await readBounded(resolve(process.env.SAVED_PLAN_DIRECTORY, 'cloudmarkup-plan.manifest.json'), " +
      String(MANIFEST_MAX_BYTES) +
      "); const planReceiptBytes = await readBounded(resolve(process.env.SAVED_PLAN_DIRECTORY, 'cloudmarkup-plan.receipt.json'), " +
      String(MANIFEST_MAX_BYTES) +
      "); let manifest; try { manifest = JSON.parse(manifestBytes); } catch { fail(); } const manifestDigest = digest(manifestBytes); const planReceiptDigest = digest(planReceiptBytes); const now = new Date().toISOString(); const promotionPredecessor = process.env.PREDECESSOR_RECEIPT_DIGEST || ''; const promotionSmokePredecessor = process.env.PROMOTION_PREDECESSOR_SMOKE_RECEIPT_DIGEST || '';",
    "if (!digestPattern.test(planReceiptDigest) || (manifest.environment === 'dev' ? (promotionPredecessor !== '' || promotionSmokePredecessor !== '') : (!digestPattern.test(promotionPredecessor) || !digestPattern.test(promotionSmokePredecessor)))) fail(); const inputDigests = [manifestDigest, manifest.planChecksum, planReceiptDigest, ...(promotionPredecessor ? [promotionPredecessor, promotionSmokePredecessor] : [])];",
    "const receipt = { commitSha: manifest.commitSha, contractVersion: 1, createdAt: now, environment: manifest.environment, idempotencyKey: `deploy-${manifestDigest.slice(7, 39)}`, inputDigests, kind: 'cloudmarkup.customer-ci-stage-receipt', outputDigests: [manifest.planChecksum], predecessorReceiptDigest: planReceiptDigest, ...(promotionPredecessor ? { promotionPredecessorReceiptDigest: promotionPredecessor, promotionPredecessorSmokeReceiptDigest: promotionSmokePredecessor } : {}), receiptId: `receipt-deploy-${process.env.GITHUB_RUN_ID}`, solutionRevision: manifest.solutionRevision, stage: 'deploy', status: 'passed', targetAuthorityDigest: manifest.environmentConfigDigest };",
    "const receiptBytes = Buffer.from(JSON.stringify(receipt) + '\\n'); if (receiptBytes.byteLength > " +
      String(MANIFEST_MAX_BYTES) +
      ") fail(); await writeFile('cloudmarkup-deployment.receipt.json', receiptBytes, { flag: 'wx', mode: 0o600 });",
    "CLOUDMARKUP_DEPLOY_RECEIPT",
  ].join("\n");
}

export function conformancePlanRecordScriptV1(): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_CONFORMANCE_PLAN'",
    "import { createHash } from 'node:crypto';",
    "import { lstat, readFile, writeFile } from 'node:fs/promises';",
    "const fail = () => { throw new Error('The bounded conformance plan record could not be verified.'); }; const ordered = (value) => Array.isArray(value) ? value.map(ordered) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value; const canonical = (value) => `${JSON.stringify(ordered(value), null, 2)}\\n`; const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`; const readBounded = async (path, maximum) => { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximum) fail(); const bytes = await readFile(path); if (bytes.byteLength > maximum) fail(); return bytes; };",
    "const manifestBytes = await readBounded('cloudmarkup-plan.manifest.json', 131072); const planBytes = await readBounded('cloudmarkup-plan.sanitized.json', 8388608); let manifest; let plan; try { manifest = JSON.parse(manifestBytes); plan = JSON.parse(planBytes); } catch { fail(); } if (digest(planBytes) !== manifest.sanitizedPlanChecksum || !Array.isArray(plan.resourceChanges)) fail();",
    "const compare = (left, right) => left === right ? 0 : left < right ? -1 : 1; const action = (actions) => actions.includes('replace') ? 'replace' : actions.includes('create') ? 'create' : actions.includes('update') ? 'update' : actions.includes('delete') ? 'delete' : undefined; const changes = plan.resourceChanges.map((change) => ({ action: action(change.actions), change })).filter(({ action }) => action !== undefined).map(({ action, change }) => ({ action, applicationBinding: 'unknown', confidence: 'partial', iam: 'unknown', network: 'unknown', ownership: 'unknown', resourceIdentityDigest: change.address, resourceType: change.type })).sort((left, right) => compare(left.resourceIdentityDigest, right.resourceIdentityDigest));",
    "const sourceRepresentationChecksum = digest(Buffer.from(canonical(plan))); const tool = { digest: digest(Buffer.from(`hashicorp.terraform\\0${manifest.terraformVersion}`)), id: 'hashicorp.terraform', version: manifest.terraformVersion }; const projection = { backendConfigDigest: manifest.backendConfigDigest, changes, commitSha: manifest.commitSha, contractVersion: 1, createdAt: manifest.createdAt, environmentId: manifest.environment, expiresAt: manifest.expiresAt, generatedManifestDigest: manifest.solutionExportManifestDigest, kind: 'cloudmarkup.normalized-conformance-plan', planChecksum: sourceRepresentationChecksum, scope: 'partial', solutionRevision: manifest.solutionRevision, sourceRepresentationChecksum, target: 'terraform', tool, workspace: manifest.workspace }; const record = { ...projection, evidenceChecksum: digest(Buffer.from(canonical(projection))) }; const bytes = Buffer.from(canonical(record)); if (bytes.byteLength > 8388608) fail(); await writeFile('cloudmarkup-conformance.plan.json', bytes, { flag: 'wx', mode: 0o600 });",
    "CLOUDMARKUP_CONFORMANCE_PLAN",
  ].join("\n");
}

export function conformanceDeploymentRecordScriptV1(): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_CONFORMANCE_DEPLOYMENT'",
    "import { createHash } from 'node:crypto';",
    "import { lstat, readFile, writeFile } from 'node:fs/promises';",
    "import { resolve } from 'node:path';",
    "const fail = () => { throw new Error('The bounded conformance deployment record could not be verified.'); }; const ordered = (value) => Array.isArray(value) ? value.map(ordered) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value; const canonical = (value) => `${JSON.stringify(ordered(value), null, 2)}\\n`; const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`; const readBounded = async (path, maximum) => { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximum) fail(); const bytes = await readFile(path); if (bytes.byteLength > maximum) fail(); return bytes; };",
    "const directory = process.env.SAVED_PLAN_DIRECTORY || ''; const planBytes = await readBounded(resolve(directory, 'cloudmarkup-conformance.plan.json'), 8388608); const manifestBytes = await readBounded(resolve(directory, 'cloudmarkup-plan.manifest.json'), 131072); const receiptBytes = await readBounded('cloudmarkup-deployment.receipt.json', 131072); let plan; let manifest; let receipt; try { plan = JSON.parse(planBytes); manifest = JSON.parse(manifestBytes); receipt = JSON.parse(receiptBytes); } catch { fail(); } const { evidenceChecksum, ...planProjection } = plan; if (digest(Buffer.from(canonical(planProjection))) !== evidenceChecksum || plan.kind !== 'cloudmarkup.normalized-conformance-plan' || !['terraform','cloudformation'].includes(plan.target) || receipt.environment !== plan.environmentId || receipt.commitSha !== plan.commitSha || canonical(receipt.solutionRevision) !== canonical(plan.solutionRevision) || manifest.solutionExportManifestDigest !== plan.generatedManifestDigest) fail();",
    "const workflow = { runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), runId: process.env.GITHUB_RUN_ID, workflowDigest: digest(Buffer.from(process.env.GITHUB_WORKFLOW_REF || '')) }; if (!Number.isSafeInteger(workflow.runAttempt) || workflow.runAttempt < 1 || !/^[1-9][0-9]{0,15}$/.test(workflow.runId || '')) fail(); const projection = { artifactAttestations: [], commitSha: receipt.commitSha, completeness: 'partial', contractVersion: 1, environmentId: receipt.environment, generatedManifestDigest: plan.generatedManifestDigest, issues: [{ code: 'CONFORMANCE_DEPLOYMENT_ARTIFACT_ATTESTATIONS_UNAVAILABLE', field: 'artifactAttestations', severity: 'warning' }, { code: 'CONFORMANCE_DEPLOYMENT_SMOKE_MISSING', field: 'smoke', severity: 'warning' }], kind: 'cloudmarkup.normalized-deployment-conformance', observedAt: receipt.createdAt, planEvidenceChecksum: plan.evidenceChecksum, planIdentityDigest: digest(manifestBytes), smoke: { state: 'not-run' }, solutionRevision: receipt.solutionRevision, target: plan.target, workflow }; const record = { ...projection, evidenceChecksum: digest(Buffer.from(canonical(projection))) }; const bytes = Buffer.from(canonical(record)); if (bytes.byteLength > 8388608) fail(); await writeFile('cloudmarkup-conformance.deployment.json', bytes, { flag: 'wx', mode: 0o600 });",
    "CLOUDMARKUP_CONFORMANCE_DEPLOYMENT",
  ].join("\n");
}

export function conformanceDriftRecordScriptV1(): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_CONFORMANCE_DRIFT'",
    "import { createHash } from 'node:crypto';",
    "import { lstat, readFile, writeFile } from 'node:fs/promises';",
    "import { resolve } from 'node:path';",
    "const fail = () => { throw new Error('The bounded conformance drift record could not be verified.'); }; const ordered = (value) => Array.isArray(value) ? value.map(ordered) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value; const canonical = (value) => `${JSON.stringify(ordered(value), null, 2)}\\n`; const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`; const readBounded = async (path, maximum) => { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximum) fail(); const bytes = await readFile(path); if (bytes.byteLength > maximum) fail(); return bytes; };",
    "const analysisBytes = await readBounded('cloudmarkup-plan.analysis.json', 8388608); const resultBytes = await readBounded('cloudmarkup-drift.result.json', 8388608); const receiptBytes = await readBounded('cloudmarkup-drift.receipt.json', 131072); const deploymentDirectory = resolve(process.env.DEPLOYMENT_DIRECTORY || ''); const deploymentReceiptBytes = await readBounded(resolve(deploymentDirectory, 'cloudmarkup-deployment.receipt.json'), 131072); const deploymentBytes = await readBounded(resolve(deploymentDirectory, 'cloudmarkup-conformance.deployment.json'), 8388608); let analysis; let result; let receipt; let deployment; try { analysis = JSON.parse(analysisBytes); result = JSON.parse(resultBytes); receipt = JSON.parse(receiptBytes); deployment = JSON.parse(deploymentBytes); } catch { fail(); } const { evidenceChecksum: deploymentEvidenceChecksum, ...deploymentProjection } = deployment; const approvedBaseline = process.env.DEPLOYMENT_EVIDENCE_CHECKSUM || ''; const deploymentReceiptDigest = digest(deploymentReceiptBytes); if (!/^sha256:[a-f0-9]{64}$/.test(approvedBaseline) || approvedBaseline !== deploymentEvidenceChecksum || digest(Buffer.from(canonical(deploymentProjection))) !== deploymentEvidenceChecksum || deployment.kind !== 'cloudmarkup.normalized-deployment-conformance' || deployment.completeness === 'invalid' || deployment.target !== 'terraform' || result.deploymentReceiptDigest !== deploymentReceiptDigest || receipt.predecessorReceiptDigest !== deploymentReceiptDigest || result.environment !== receipt.environment || result.environment !== deployment.environmentId || canonical(result.solutionRevision) !== canonical(receipt.solutionRevision) || canonical(result.solutionRevision) !== canonical(deployment.solutionRevision)) fail();",
    "const compare = (left, right) => left === right ? 0 : left < right ? -1 : 1; const issueCodesByAddress = new Map(); for (const issue of analysis.issues || []) { const values = issueCodesByAddress.get(issue.field) || []; issueCodesByAddress.set(issue.field, [...values, issue.code]); } const action = (actions) => actions.includes('replace') ? 'replace' : actions.includes('create') ? 'create' : actions.includes('update') ? 'update' : actions.includes('delete') ? 'delete' : undefined; const classification = (address) => { const codes = issueCodesByAddress.get(address) || []; return codes.includes('IAM_OR_POLICY_PLAN_CHANGE') ? 'permission-drift' : codes.includes('NETWORK_BOUNDARY_PLAN_CHANGE') ? 'network-drift' : 'managed-drift'; }; const changes = (analysis.changes || []).map((change) => ({ action: action(change.actions), change })).filter(({ action }) => action !== undefined).map(({ action, change }) => ({ action, classification: classification(change.address), confidence: 'partial', ownership: 'unknown', resourceIdentityDigest: change.address })).sort((left, right) => compare(left.resourceIdentityDigest, right.resourceIdentityDigest));",
    "const observed = Date.parse(receipt.createdAt); const countTotal = Object.values(analysis.counts || {}).reduce((sum, count) => sum + (Number.isSafeInteger(count) ? count : NaN), 0); if (!Number.isFinite(observed) || !Number.isFinite(countTotal) || (result.driftDetected ? changes.length === 0 : changes.length !== 0)) fail(); const projection = { baselineDeploymentEvidenceChecksum: deploymentEvidenceChecksum, changes, contractVersion: 1, environmentId: receipt.environment, issues: [{ code: 'CONFORMANCE_DRIFT_SCOPE_INCOMPLETE', field: 'scope', severity: 'warning' }], kind: 'cloudmarkup.normalized-drift-conformance', observedAt: receipt.createdAt, remediation: 'none', scope: 'partial', solutionRevision: receipt.solutionRevision, source: 'terraform-refresh-only', staleness: 'current', target: deployment.target, validUntil: new Date(observed + 86400000).toISOString() }; const record = { ...projection, evidenceChecksum: digest(Buffer.from(canonical(projection))) }; const bytes = Buffer.from(canonical(record)); if (bytes.byteLength > 8388608) fail(); await writeFile('cloudmarkup-conformance.drift.json', bytes, { flag: 'wx', mode: 0o600 });",
    "CLOUDMARKUP_CONFORMANCE_DRIFT",
  ].join("\n");
}
