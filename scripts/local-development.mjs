import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import {
  localComposeProject,
  localDatabaseConfiguration,
  localDatabaseEnvironment,
  provisionLocalDatabase,
} from "./local-persistence.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = resolve(
  repositoryRoot,
  "scripts",
  "local",
  "docker-compose.yml",
);
const localRuntimeRoot = resolve(repositoryRoot, "tmp", localComposeProject);
const objectRoot = resolve(localRuntimeRoot, "objects");
const composeProjectName = localComposeProject;
const defaultPostgresPort = "55432";

const forbiddenCredentialVariables = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "COHERE_API_KEY",
  "MISTRAL_API_KEY",
];

const expectedModes = {
  CLOUDMARKUP_BILLING_MODE: "fake",
  CLOUDMARKUP_IDENTITY_MODE: "local",
  CLOUDMARKUP_JOB_MODE: "fake",
  CLOUDMARKUP_OBJECT_STORE_MODE: "filesystem",
  CLOUDMARKUP_RUNTIME_ENVIRONMENT: "local",
};

export const LOCAL_IDENTITY_TOKENS = Object.freeze([
  "local-owner",
  "local-team-owner",
  "local-team-administrator",
  "local-team-editor",
  "local-team-viewer",
]);
const defaultLocalIdentityToken = "local-owner";
const localApiBaseUrl = "http://127.0.0.1:8787";
const localWebOrigin = "http://127.0.0.1:4173";
const localBillingUrls = Object.freeze({
  CLOUDMARKUP_BILLING_CANCEL_URL:
    localWebOrigin + "/settings/billing?checkout=canceled",
  CLOUDMARKUP_BILLING_PORTAL_RETURN_URL: localWebOrigin + "/settings/billing",
  CLOUDMARKUP_BILLING_SUCCESS_URL:
    localWebOrigin + "/settings/billing?checkout=success",
});
export const LOCAL_WEB_PNPM_ARGUMENTS = Object.freeze([
  "--filter",
  "@cloudmarkup/web",
  "dev",
  "--host",
  "127.0.0.1",
  "--port",
  "4173",
  "--strictPort",
]);

function hasEnvironmentValue(name) {
  const value = process.env[name];
  return value !== undefined && value.trim().length > 0;
}

function resolveLocalIdentityToken(environment) {
  const token =
    environment["CLOUDMARKUP_LOCAL_IDENTITY_TOKEN"] ??
    defaultLocalIdentityToken;
  if (!LOCAL_IDENTITY_TOKENS.includes(token)) {
    throw new Error(
      "CLOUDMARKUP_LOCAL_IDENTITY_TOKEN must name one supported seeded local identity.",
    );
  }
  return token;
}

export function createLocalWebEnvironment(environment) {
  const identityToken = resolveLocalIdentityToken(environment);
  const configuredBaseUrl = environment["VITE_CLOUDMARKUP_API_BASE_URL"];
  if (
    configuredBaseUrl !== undefined &&
    configuredBaseUrl !== localApiBaseUrl
  ) {
    throw new Error(
      "VITE_CLOUDMARKUP_API_BASE_URL must target http://127.0.0.1:8787.",
    );
  }
  const configuredIdentityToken =
    environment["VITE_CLOUDMARKUP_LOCAL_IDENTITY_TOKEN"];
  if (
    configuredIdentityToken !== undefined &&
    configuredIdentityToken !== identityToken
  ) {
    throw new Error(
      "VITE_CLOUDMARKUP_LOCAL_IDENTITY_TOKEN must match CLOUDMARKUP_LOCAL_IDENTITY_TOKEN.",
    );
  }
  for (const [name, expected] of Object.entries(localBillingUrls)) {
    const configured = environment[name];
    if (configured !== undefined && configured !== expected) {
      throw new Error(name + " must target " + expected + ".");
    }
  }
  const webEnvironment = {
    ...environment,
    ...localBillingUrls,
    CLOUDMARKUP_LOCAL_IDENTITY_TOKEN: identityToken,
    VITE_CLOUDMARKUP_API_BASE_URL: localApiBaseUrl,
    VITE_CLOUDMARKUP_LOCAL_IDENTITY_TOKEN: identityToken,
  };
  delete webEnvironment.CLOUDMARKUP_DATABASE_URL;
  delete webEnvironment.CLOUDMARKUP_LOCAL_MIGRATOR_DATABASE_URL;
  delete webEnvironment.CLOUDMARKUP_LOCAL_BOOTSTRAP_DATABASE_URL;
  delete webEnvironment.CLOUDMARKUP_LOCAL_BOOTSTRAP_PASSWORD;
  return webEnvironment;
}

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  if (process.platform === "win32") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

function assertPathWithinRepository(target, label) {
  const relativePath = relative(repositoryRoot, target);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      `${label} must resolve to a non-root path inside the repository.`,
    );
  }
}

function readPostgresPort() {
  const value =
    process.env["CLOUDMARKUP_LOCAL_POSTGRES_PORT"] ?? defaultPostgresPort;
  if (!/^\d{4,5}$/.test(value)) {
    throw new Error(
      "CLOUDMARKUP_LOCAL_POSTGRES_PORT must be a numeric local port.",
    );
  }
  const port = Number.parseInt(value, 10);
  if (port < 1024 || port > 65535) {
    throw new Error(
      "CLOUDMARKUP_LOCAL_POSTGRES_PORT must be between 1024 and 65535.",
    );
  }
  return value;
}

function assertSafeLocalConfiguration() {
  assertPathWithinRepository(localRuntimeRoot, "Local runtime root");
  assertPathWithinRepository(objectRoot, "Filesystem object root");

  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "The local-development launcher refuses NODE_ENV=production.",
    );
  }

  for (const [name, expected] of Object.entries(expectedModes)) {
    const configured = process.env[name];
    if (configured !== undefined && configured !== expected) {
      throw new Error(`${name} must be ${expected} for local development.`);
    }
  }

  const configuredObjectRoot =
    process.env["CLOUDMARKUP_FILESYSTEM_OBJECT_ROOT"];
  if (
    configuredObjectRoot !== undefined &&
    !samePath(resolve(repositoryRoot, configuredObjectRoot), objectRoot)
  ) {
    throw new Error(
      "CLOUDMARKUP_FILESYSTEM_OBJECT_ROOT must use tmp/cloudmarkup-local-pg17-v1/objects.",
    );
  }

  const presentCredentials =
    forbiddenCredentialVariables.filter(hasEnvironmentValue);
  if (presentCredentials.length > 0) {
    throw new Error(
      "Local development is credentialless. Unset these variables: " +
        presentCredentials.join(", "),
    );
  }

  const postgresPort = readPostgresPort();
  const databases = localDatabaseConfiguration(process.env, postgresPort);
  const identityToken = resolveLocalIdentityToken(process.env);
  createLocalWebEnvironment(process.env);

  return { databases, identityToken, postgresPort };
}

function localEnvironment(migration = false) {
  const { databases, identityToken, postgresPort } =
    assertSafeLocalConfiguration();
  return localDatabaseEnvironment(
    {
      ...createLocalWebEnvironment(process.env),
      NODE_ENV: process.env["NODE_ENV"] ?? "development",
      CLOUDMARKUP_BILLING_MODE: "fake",
      CLOUDMARKUP_FILESYSTEM_OBJECT_ROOT: objectRoot,
      CLOUDMARKUP_IDENTITY_MODE: "local",
      CLOUDMARKUP_JOB_MODE: "fake",
      CLOUDMARKUP_LOCAL_IDENTITY_TOKEN: identityToken,
      CLOUDMARKUP_LOCAL_POSTGRES_PORT: postgresPort,
      CLOUDMARKUP_OBJECT_STORE_MODE: "filesystem",
      CLOUDMARKUP_RUNTIME_ENVIRONMENT: "local",
    },
    databases,
    migration,
  );
}

const windowsCommandArgumentPattern = /^[A-Za-z0-9@._:/=+-]+$/u;

export function resolveCommandInvocation(
  command,
  args,
  environment,
  platform = process.platform,
) {
  if (platform !== "win32" || command !== "pnpm") {
    return { args, command };
  }

  const commandProcessor = environment["ComSpec"] ?? environment["COMSPEC"];
  if (
    commandProcessor === undefined ||
    !win32.isAbsolute(commandProcessor) ||
    !/^[A-Za-z]:[\\/]/u.test(commandProcessor) ||
    win32.basename(commandProcessor).toLowerCase() !== "cmd.exe"
  ) {
    throw new Error(
      "Windows pnpm execution requires an absolute ComSpec path to cmd.exe.",
    );
  }
  if (args.some((argument) => !windowsCommandArgumentPattern.test(argument))) {
    throw new Error(
      "Windows pnpm execution accepts only fixed shell-safe arguments.",
    );
  }

  return {
    args: ["/d", "/s", "/c", "pnpm", ...args],
    command: commandProcessor,
  };
}

async function run(command, args, environment) {
  const childEnvironment =
    command === "docker"
      ? {
          ...environment,
          CLOUDMARKUP_LOCAL_BOOTSTRAP_PASSWORD:
            assertSafeLocalConfiguration().databases.bootstrap.password,
        }
      : environment;
  const invocation = resolveCommandInvocation(command, args, childEnvironment);
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: repositoryRoot,
      env: childEnvironment,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          signal === null
            ? `${command} exited with code ${String(code)}.`
            : `${command} stopped after signal ${signal}.`,
        ),
      );
    });
  });
}

function dockerComposeArguments() {
  return [
    "compose",
    "--project-name",
    composeProjectName,
    "--file",
    composeFile,
  ];
}

async function assertComposeFileExists() {
  await access(composeFile, constants.R_OK);
}

async function startPostgres(environment) {
  await assertComposeFileExists();
  await run(
    "docker",
    [
      ...dockerComposeArguments(),
      "up",
      "--detach",
      "--wait",
      "--wait-timeout",
      "60",
      "postgres",
    ],
    environment,
  );
}

async function stopPostgres(environment) {
  await assertComposeFileExists();
  await run(
    "docker",
    [...dockerComposeArguments(), "stop", "postgres"],
    environment,
  );
}

async function startObjects() {
  assertPathWithinRepository(objectRoot, "Filesystem object root");
  await mkdir(objectRoot, { recursive: true });
  console.log(
    "Filesystem object storage is ready at tmp/cloudmarkup-local-pg17-v1/objects.",
  );
}

function stopObjects() {
  console.log(
    "Filesystem object storage has no daemon; local objects are retained until local:cleanup.",
  );
}

async function cleanup(environment) {
  await assertComposeFileExists();
  await run(
    "docker",
    [...dockerComposeArguments(), "down", "--volumes", "--remove-orphans"],
    environment,
  );
  if (
    !samePath(
      localRuntimeRoot,
      resolve(repositoryRoot, "tmp", localComposeProject),
    )
  ) {
    throw new Error("Cleanup target changed; refusing recursive removal.");
  }
  assertPathWithinRepository(localRuntimeRoot, "Cleanup target");
  await rm(localRuntimeRoot, { force: true, recursive: true });
  console.log(
    "Removed the contributor PG17 volume and tmp/cloudmarkup-local-pg17-v1 recovery data.",
  );
}

function printHelp() {
  console.log(`CloudMarkup local-development commands:
  check             validate local-only configuration without starting services
  postgres:start    start the pinned loopback-only PostgreSQL container
  postgres:stop     stop PostgreSQL and retain its volume
  objects:start     initialize the repo-bounded filesystem object directory
  objects:stop      report the retained filesystem object directory
  services:start    start PostgreSQL and initialize filesystem objects
  services:stop     stop PostgreSQL and retain all local data
  bootstrap         explicitly provision the fresh PG17 database roles
  permissions       explicitly activate/check the fixed core runtime ACL
  migrate           apply the checksum-pinned standalone PG17 profile
  seed              recheck that profile and publish the idempotent synthetic seed
  api               run the API local adapter composition
  web               run Vite on 127.0.0.1:4173
  cleanup           delete only this profile's PostgreSQL volume/object directory`);
}

async function main() {
  const command = process.argv[2];
  if (command === undefined || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  const environment = localEnvironment();
  switch (command) {
    case "check":
      await assertComposeFileExists();
      console.log(
        "Local configuration is credentialless, loopback-only, fake-backed, and repo-bounded.",
      );
      break;
    case "postgres:start":
      await startPostgres(environment);
      break;
    case "postgres:stop":
      await stopPostgres(environment);
      break;
    case "objects:start":
      await startObjects();
      break;
    case "objects:stop":
      stopObjects();
      break;
    case "services:start":
      await startPostgres(environment);
      await startObjects();
      break;
    case "services:stop":
      stopObjects();
      await stopPostgres(environment);
      break;
    case "bootstrap":
    case "permissions": {
      const { databases } = assertSafeLocalConfiguration();
      // Declared public persistence entry, same fixed operator API as self-host.
      const api = await import("../apps/api/dist/persistence.js");
      for (const stage of command === "bootstrap"
        ? ["admin"]
        : ["roles", "acl", "check"])
        await provisionLocalDatabase(stage, databases, api);
      console.log(
        "Explicit local database provisioning completed; application acceptance remains separate.",
      );
      break;
    }
    case "migrate":
      await run(
        "pnpm",
        ["--filter", "@cloudmarkup/api", "migrate:local"],
        localEnvironment(true),
      );
      break;
    case "seed":
      await startObjects();
      await run(
        "pnpm",
        ["--filter", "@cloudmarkup/api", "seed:local"],
        localEnvironment(true),
      );
      break;
    case "api":
      await startObjects();
      await run(
        "pnpm",
        ["--filter", "@cloudmarkup/api", "dev:local"],
        environment,
      );
      break;
    case "web":
      await run(
        "pnpm",
        LOCAL_WEB_PNPM_ARGUMENTS,
        createLocalWebEnvironment(environment),
      );
      break;
    case "cleanup":
      await cleanup(environment);
      break;
    default:
      throw new Error(`Unknown local-development command: ${command}`);
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  samePath(fileURLToPath(import.meta.url), invokedPath)
) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown failure.";
    console.error("CloudMarkup local development failed: " + message);
    process.exitCode = 1;
  });
}
