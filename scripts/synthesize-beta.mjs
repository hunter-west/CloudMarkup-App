import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { validateBetaReleaseEnvironment } from "./beta-release-gate-core.mjs";
import { betaServiceCdkContext } from "./beta-sandbox-delivery-admission.mjs";
import {
  assertCredentiallessCloudAssemblyManifest,
  createBetaCdkSynthesisArguments,
  createCredentiallessSynthesisEnvironment,
} from "./synthesize-beta-core.mjs";

const findings = validateBetaReleaseEnvironment(process.env, {
  requireActivation: false,
});
if (findings.length > 0) {
  process.stderr.write(
    `beta:synth input validation failed:\n${findings
      .map(({ code, detail, path }) => `${path}: ${code}: ${detail}`)
      .join("\n")}\n`,
  );
  process.exit(1);
}

await access(resolve("apps", "web", "dist", "index.html"));
const output = resolve("artifacts", "platform", "cdk.out");
if (output !== resolve("artifacts/platform/cdk.out")) {
  throw new Error(
    "The beta synthesis output must remain in artifacts/platform/cdk.out.",
  );
}
await rm(output, { force: true, recursive: true });

const context = [
  ["environment", "beta"],
  ["account", process.env["AWS_ACCOUNT_ID"]],
  ["region", process.env["AWS_REGION"]],
  ["baseUrl", process.env["BETA_BASE_URL"]],
  ["certificateArn", process.env["BETA_CERTIFICATE_ARN"]],
  ["createDnsRecords", process.env["BETA_CREATE_DNS_RECORDS"]],
  ...betaServiceCdkContext(process.env),
];
if (process.env["BETA_CREATE_DNS_RECORDS"] === "true") {
  context.push(
    ["hostedZoneId", process.env["BETA_HOSTED_ZONE_ID"]],
    ["hostedZoneName", process.env["BETA_HOSTED_ZONE_NAME"]],
  );
}
const pnpmCli = process.env["npm_execpath"];
if (typeof pnpmCli !== "string" || pnpmCli.length === 0) {
  throw new Error("Run beta synthesis through pnpm beta:synth.");
}
const args = createBetaCdkSynthesisArguments({ context, output, pnpmCli });
const isolationDirectory = await mkdtemp(
  join(tmpdir(), "cloudmarkup-beta-synthesis-"),
);
const configFile = join(isolationDirectory, "aws-config");
const credentialsFile = join(isolationDirectory, "aws-credentials");
await Promise.all([
  writeFile(configFile, "", { encoding: "utf8", flag: "wx", mode: 0o600 }),
  writeFile(credentialsFile, "", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  }),
]);
try {
  const childEnvironment = createCredentiallessSynthesisEnvironment(
    process.env,
    { configFile, credentialsFile },
  );
  const result = spawnSync(process.execPath, args, {
    cwd: resolve("."),
    env: childEnvironment,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Beta CDK synthesis exited with ${String(result.status)}.`);
  }
} finally {
  await rm(isolationDirectory, { force: true, recursive: true });
}
const manifest = JSON.parse(
  await readFile(resolve(output, "manifest.json"), "utf8"),
);
assertCredentiallessCloudAssemblyManifest(manifest);
process.stdout.write(
  "beta:synth: wrote one credentialless beta cloud assembly to artifacts/platform/cdk.out.\n",
);
