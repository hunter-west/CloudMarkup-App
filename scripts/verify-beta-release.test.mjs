import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, test } from "node:test";

import { checkCloudMarkupBrandAssets } from "./generate-cloudmarkup-brand-assets.mjs";
import {
  BETA_WEB_BRAND_ASSETS,
  validateBetaWebBuild,
} from "./beta-release-gate-core.mjs";
import {
  bindBetaServiceProfile,
  readBetaAssembly,
  validateBetaReleaseVerificationEnvironment,
} from "./verify-beta-release.mjs";

const workspaces = [];
const stableBetaEnvironment = Object.freeze({
  AWS_ACCOUNT_ID: "000000000000",
  AWS_REGION: "us-east-1",
  BETA_BASE_URL: "https://beta.example.invalid",
  BETA_CERTIFICATE_ARN:
    "arn:aws:acm:us-east-1:000000000000:certificate/12345678-1234-1234-1234-123456789abc",
  BETA_CREATE_DNS_RECORDS: "false",
  CLOUDMARKUP_ENVIRONMENT: "beta",
});

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-beta-assembly-"));
  workspaces.push(root);
  return root;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function manifest(artifacts = {}) {
  return { artifacts, version: "54.0.0" };
}

function assemblyArtifact(directoryName) {
  return {
    properties: { directoryName },
    type: "cdk:cloud-assembly",
  };
}

function assetManifestArtifact(file = "assets.json") {
  return {
    properties: { file },
    type: "cdk:asset-manifest",
  };
}

function stackArtifact(stackName, templateFile) {
  return {
    properties: { stackName, templateFile },
    type: "aws:cloudformation:stack",
  };
}

test("policy and artifact verification require only stable credentialless beta inputs", () => {
  for (const mode of ["--policy-only", "--artifacts-only"]) {
    assert.deepEqual(
      validateBetaReleaseVerificationEnvironment(stableBetaEnvironment, mode),
      [],
    );
  }
});

test("release verification rejects unknown modes", () => {
  assert.throws(
    () =>
      validateBetaReleaseVerificationEnvironment(
        stableBetaEnvironment,
        "--deploy",
      ),
    /verification mode is invalid/u,
  );
});

test("the production receipt-binding CLI accepts no path or validation override", () => {
  for (const extra of ["--skip-validation", "--assembly=elsewhere"]) {
    const result = spawnSync(
      process.execPath,
      [
        resolve("scripts", "verify-beta-release.mjs"),
        "--bind-service-profile",
        extra,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /accepts no path or validation overrides/u);
  }
});

async function assertNoServiceReceipt(bundle) {
  await assert.rejects(readFile(join(bundle, "SERVICE_PROFILE.json"), "utf8"), {
    code: "ENOENT",
  });
}

async function incompleteCopiedBundle() {
  const bundle = await workspace();
  const assembly = join(bundle, "cdk.out");
  await writeJson(
    join(assembly, "manifest.json"),
    manifest({
      Application: stackArtifact(
        "cloudmarkup-beta-application",
        "application.template.json",
      ),
    }),
  );
  await writeJson(join(assembly, "application.template.json"), {
    Resources: {
      Queue: {
        Type: "AWS::SQS::Queue",
        Properties: { QueueName: "unreviewed.fifo" },
      },
    },
  });
  return bundle;
}

test("service binding refuses malformed or mismatched profile inputs without creating a receipt", async () => {
  const bundle = await incompleteCopiedBundle();
  const current =
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/webhook-signing-secret-a1b2c3";
  for (const selectors of [
    { BETA_SERVICE_PROFILE: "unreviewed" },
    { BETA_STRIPE_SANDBOX_SESSIONS_ENABLED: "true" },
    { BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN: current },
    { BETA_SERVICE_PROFILE: "stripe-sandbox-v1" },
    { BETA_SERVICE_PROFILE: "stripe-sandbox-github-connections-v1" },
    {
      BETA_SERVICE_PROFILE: "stripe-sandbox-v1",
      BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN: current + "*",
    },
  ]) {
    await assert.rejects(
      bindBetaServiceProfile(
        { ...stableBetaEnvironment, ...selectors },
        bundle,
      ),
      /BETA_SERVICE_PROFILE_INVALID/u,
    );
    await assertNoServiceReceipt(bundle);
  }
  await assert.rejects(
    bindBetaServiceProfile(stableBetaEnvironment, bundle),
    /BETA_SANDBOX_CORE_ACTIVATION/u,
  );
  await assertNoServiceReceipt(bundle);
});

test("the new connections profile cannot bind a copied assembly without its exact API authority", async () => {
  const bundle = await incompleteCopiedBundle();
  await assert.rejects(
    bindBetaServiceProfile(
      {
        ...stableBetaEnvironment,
        BETA_SERVICE_PROFILE: "stripe-sandbox-github-connections-v1",
        BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN:
          "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/webhook-signing-secret-a1b2c3",
      },
      bundle,
    ),
    /BETA_SANDBOX_GITHUB_CONNECTION_CONFIGURATION/u,
  );
  await assertNoServiceReceipt(bundle);
});

test("service binding snapshots inputs before asynchronous assembly reads and never serializes fresh values", async () => {
  const bundle = await incompleteCopiedBundle();
  const environment = {
    ...stableBetaEnvironment,
    BETA_SERVICE_PROFILE: "stripe-sandbox-v1",
    BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN:
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/webhook-signing-secret-a1b2c3",
  };
  const binding = bindBetaServiceProfile(environment, bundle);
  environment.BETA_SERVICE_PROFILE = "core-v1";
  environment.BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN = "";
  await assert.rejects(binding, (error) => {
    assert.match(error.message, /BETA_SANDBOX_RESOURCE_SET/u);
    assert.doesNotMatch(
      error.message,
      /BETA_SANDBOX_CORE_ACTIVATION|BETA_SERVICE_PROFILE_INVALID/u,
    );
    return true;
  });
  await assertNoServiceReceipt(bundle);
});

test("service binding reads only the copied cdk.out and preserves an existing receipt on rejection", async () => {
  const bundle = await workspace();
  await assert.rejects(
    bindBetaServiceProfile(stableBetaEnvironment, bundle),
    /The beta CDK assembly root is missing/u,
  );
  await assertNoServiceReceipt(bundle);
  const incomplete = await incompleteCopiedBundle();
  const receipt = join(incomplete, "SERVICE_PROFILE.json");
  await writeFile(receipt, "existing receipt", { flag: "wx" });
  await assert.rejects(
    bindBetaServiceProfile(stableBetaEnvironment, incomplete),
    /BETA_SANDBOX_CORE_ACTIVATION/u,
  );
  assert.equal(await readFile(receipt, "utf8"), "existing receipt");
});

test("keeps the supplied logo exact and every derived brand icon reproducible", async () => {
  const assets = await checkCloudMarkupBrandAssets();
  assert.deepEqual(assets, [
    {
      byteLength: 14_068,
      file: "app-icon-192.png",
      sha256:
        "095ac95ff35ffd1827f575517d1e21d793d338517eb04b505321ea7dc69124b2",
    },
    {
      byteLength: 76_220,
      file: "app-icon-512.png",
      sha256:
        "e709f179d32d7cf347310deaa7336257aecded9a28efe80c02f3f2e13c47890f",
    },
    {
      byteLength: 12_644,
      file: "apple-touch-icon.png",
      sha256:
        "72821d128eb2a35071c1bcaea0509c8c47278991a09c5c0c579c1f8dc52bacbe",
    },
    {
      byteLength: 34_983,
      file: "favicon.ico",
      sha256:
        "642c6ea593ac33a7af644bb6fb3e5fec71abd33b52095b5782b564d14889bcc2",
    },
  ]);
});

test("keeps the checked web document and manifest bound to local brand assets", async () => {
  const [index, manifest] = await Promise.all([
    readFile(resolve("apps", "web", "index.html"), "utf8"),
    readFile(
      resolve(
        "apps",
        "web",
        "src",
        "assets",
        "brand",
        "public",
        "site.webmanifest",
      ),
      "utf8",
    ),
  ]);
  assert.deepEqual(
    validateBetaWebBuild([
      { path: "index.html", text: index },
      { path: "site.webmanifest", text: manifest },
      ...BETA_WEB_BRAND_ASSETS,
      {
        path: "assets/application.js",
        text: '"cloudmarkup.auth-composition/cognito-pkce-v1";',
      },
    ]),
    [],
  );
});

test("inventories binary deployable web files with bounded byte identities", async () => {
  const root = await workspace();
  await writeJson(
    join(root, "manifest.json"),
    manifest({ WebAssets: assetManifestArtifact() }),
  );
  await writeJson(join(root, "assets.json"), {
    dockerImages: {},
    files: {
      web: {
        destinations: {},
        displayName: "DeployWebAssets/Asset1",
        source: { packaging: "zip", path: "web" },
      },
    },
    version: "54.0.0",
  });
  await mkdir(join(root, "web"));
  await writeFile(join(root, "web", "index.html"), "<main></main>\n", "utf8");
  await writeFile(
    join(root, "web", "favicon.ico"),
    Buffer.from([0, 0, 1, 0, 0, 0]),
  );

  const assembly = await readBetaAssembly(root);
  assert.deepEqual(assembly.deployableAssets[0].files, [
    {
      byteLength: 6,
      path: "favicon.ico",
      sha256:
        "025fc246f13759c192cbbae2a68f2b59b6478f21b31a05d77483a87e417906dd",
    },
    {
      byteLength: 14,
      path: "index.html",
      sha256:
        "26d0d95e38ce0bcfe0d460cc1a237c182c64922f2b1a77d2da0fc7a510f9457b",
      text: "<main></main>\n",
    },
  ]);
});

test("inventories sandbox and cleanup runtime assets through the real bounded file reader", async () => {
  const root = await workspace();
  await writeJson(
    join(root, "manifest.json"),
    manifest({ SandboxAssets: assetManifestArtifact() }),
  );
  const files = {};
  for (const [id, displayName] of [
    ["webhook", "SandboxBillingDelivery/WebhookFunction/Code"],
    ["worker", "SandboxBillingDelivery/WorkerFunction/Code"],
    ["cleanup", "ProjectContentCleanup/WorkerFunction/Code"],
  ]) {
    files[id] = {
      destinations: {},
      displayName,
      source: { packaging: "zip", path: id },
    };
    await mkdir(join(root, id));
    await writeFile(
      join(root, id, "index.js"),
      'exports.handler = () => "' + id + '";\n',
      "utf8",
    );
  }
  await writeJson(join(root, "assets.json"), {
    dockerImages: {},
    files,
    version: "54.0.0",
  });
  const { deployableAssets } = await readBetaAssembly(root);
  assert.equal(deployableAssets.length, 3);
  for (const asset of deployableAssets) {
    assert.match(asset.fingerprint, /^[a-f0-9]{64}$/u);
    assert.equal(asset.packaging, "zip");
    assert.equal(asset.files.length, 1);
    assert.equal(asset.files[0].path, "index.js");
    assert.ok(asset.files[0].text.includes(asset.id));
  }
  await writeFile(join(root, "worker", "index.js"), "changed bytes", "utf8");
  const changed = await readBetaAssembly(root);
  assert.notEqual(
    changed.deployableAssets.find((asset) => asset.id === "worker").fingerprint,
    deployableAssets.find((asset) => asset.id === "worker").fingerprint,
  );
});

test("follows only cloud assemblies referenced from the root manifest", async () => {
  const root = await workspace();
  await writeJson(
    join(root, "manifest.json"),
    manifest({ Beta: assemblyArtifact("assembly-beta") }),
  );
  await writeJson(
    join(root, "assembly-beta", "manifest.json"),
    manifest({
      Application: stackArtifact(
        "cloudmarkup-beta-application",
        "application.template.json",
      ),
    }),
  );
  await writeJson(join(root, "assembly-beta", "application.template.json"), {
    Resources: { Marker: { Type: "AWS::SNS::Topic" } },
  });

  const assembly = await readBetaAssembly(root);

  assert.deepEqual(assembly.deployableAssets, []);
  assert.equal(assembly.stacks.length, 1);
  assert.equal(assembly.stacks[0].stackName, "cloudmarkup-beta-application");
  assert.equal(
    assembly.stacks[0].path,
    "assembly-beta/application.template.json",
  );
});

test("rejects an orphan assembly that could mask the authoritative assembly", async () => {
  const root = await workspace();
  await writeJson(
    join(root, "manifest.json"),
    manifest({ Authority: assemblyArtifact("zzz-authoritative") }),
  );
  await writeJson(
    join(root, "zzz-authoritative", "manifest.json"),
    manifest({
      Application: stackArtifact(
        "cloudmarkup-beta-application",
        "application.template.json",
      ),
    }),
  );
  await writeJson(
    join(root, "zzz-authoritative", "application.template.json"),
    {
      Resources: {
        AuthoritativeDifferentMarker: { Type: "AWS::SQS::Queue" },
      },
    },
  );
  await writeJson(
    join(root, "aaa-safe-orphan", "manifest.json"),
    manifest({
      SafeLookingApplication: stackArtifact(
        "cloudmarkup-beta-application",
        "application.template.json",
      ),
    }),
  );
  await writeJson(join(root, "aaa-safe-orphan", "application.template.json"), {
    Resources: { SafeLookingMarker: { Type: "AWS::SNS::Topic" } },
  });

  await assert.rejects(readBetaAssembly(root), /unreferenced CDK manifest/u);
});

test("rejects a missing referenced assembly directory", async () => {
  const root = await workspace();
  await writeJson(
    join(root, "manifest.json"),
    manifest({ Missing: assemblyArtifact("missing") }),
  );

  await assert.rejects(
    readBetaAssembly(root),
    /Referenced CDK cloud-assembly directory is missing/u,
  );
});

test("rejects a referenced assembly with no manifest", async () => {
  const root = await workspace();
  await writeJson(
    join(root, "manifest.json"),
    manifest({ MissingManifest: assemblyArtifact("assembly-beta") }),
  );
  await mkdir(join(root, "assembly-beta"));

  await assert.rejects(readBetaAssembly(root), /CDK manifest is missing/u);
});

test("rejects absolute and outside-root assembly references", async () => {
  const absoluteRoot = await workspace();
  await writeJson(
    join(absoluteRoot, "manifest.json"),
    manifest({
      Absolute: assemblyArtifact(resolve(absoluteRoot, "assembly-beta")),
    }),
  );
  await assert.rejects(
    readBetaAssembly(absoluteRoot),
    /must be a non-empty relative path/u,
  );

  const outsideRoot = await workspace();
  await writeJson(
    join(outsideRoot, "manifest.json"),
    manifest({ Outside: assemblyArtifact("../outside") }),
  );
  await assert.rejects(
    readBetaAssembly(outsideRoot),
    /must stay inside the beta assembly root/u,
  );
});

test("rejects cyclic cloud-assembly references", async () => {
  const root = await workspace();
  await writeJson(
    join(root, "manifest.json"),
    manifest({ AssemblyA: assemblyArtifact("assembly-a") }),
  );
  await writeJson(
    join(root, "assembly-a", "manifest.json"),
    manifest({ AssemblyB: assemblyArtifact("../assembly-b") }),
  );
  await writeJson(
    join(root, "assembly-b", "manifest.json"),
    manifest({ AssemblyA: assemblyArtifact("../assembly-a") }),
  );

  await assert.rejects(readBetaAssembly(root), /cannot contain a cycle/u);
});

test("rejects stack templates that are not referenced by the trusted graph", async () => {
  const root = await workspace();
  await writeJson(
    join(root, "manifest.json"),
    manifest({ Beta: assemblyArtifact("assembly-beta") }),
  );
  await writeJson(join(root, "assembly-beta", "manifest.json"), manifest({}));
  await writeJson(join(root, "assembly-beta", "orphan.template.json"), {
    Resources: {},
  });

  await assert.rejects(readBetaAssembly(root), /unreferenced stack template/u);
});

test("rejects command-bearing and Docker CDK asset sources", async () => {
  const executableRoot = await workspace();
  await writeJson(
    join(executableRoot, "manifest.json"),
    manifest({ Assets: assetManifestArtifact() }),
  );
  await writeJson(join(executableRoot, "assets.json"), {
    dockerImages: {},
    files: {
      malicious: {
        destinations: {},
        displayName: "MaliciousExecutable",
        source: {
          executable: ["node", "producer-controlled.mjs"],
          packaging: "zip",
        },
      },
    },
    version: "54.0.0",
  });
  await assert.rejects(
    readBetaAssembly(executableRoot),
    /must contain exactly packaging, path/u,
  );

  const dockerRoot = await workspace();
  await writeJson(
    join(dockerRoot, "manifest.json"),
    manifest({ Assets: assetManifestArtifact() }),
  );
  await writeJson(join(dockerRoot, "assets.json"), {
    dockerImages: {
      malicious: {
        destinations: {},
        source: { executable: ["node", "producer-controlled.mjs"] },
      },
    },
    files: {},
    version: "54.0.0",
  });
  await assert.rejects(
    readBetaAssembly(dockerRoot),
    /cannot contain Docker-image assets/u,
  );
});

test("rejects legacy stack asset metadata that can execute Docker", async () => {
  const root = await workspace();
  const maliciousStack = stackArtifact(
    "cloudmarkup-beta-application",
    "application.template.json",
  );
  maliciousStack.metadata = {
    "/cloudmarkup-beta-application/MaliciousAsset": [
      {
        data: {
          buildSecrets: {
            accessKey: "env=AWS_ACCESS_KEY_ID",
            secretKey: "env=AWS_SECRET_ACCESS_KEY",
            sessionToken: "env=AWS_SESSION_TOKEN",
          },
          packaging: "container-image",
          path: "malicious-docker-context",
        },
        type: "aws:cdk:asset",
      },
    ],
  };
  await writeJson(
    join(root, "manifest.json"),
    manifest({ Application: maliciousStack }),
  );
  await writeJson(join(root, "application.template.json"), {
    Resources: { Marker: { Type: "AWS::SNS::Topic" } },
  });
  await mkdir(join(root, "malicious-docker-context"));
  await writeFile(
    join(root, "malicious-docker-context", "Dockerfile"),
    "FROM scratch\n",
    "utf8",
  );

  await assert.rejects(
    readBetaAssembly(root),
    /cannot contain legacy aws:cdk:asset entries/u,
  );
});

test("inventories the parser checksum and ELF header from actual layer bytes", async () => {
  const root = await workspace();
  await writeJson(
    join(root, "manifest.json"),
    manifest({ ParserAssets: assetManifestArtifact() }),
  );
  await mkdir(join(root, "parser"));
  const bytes = Buffer.alloc(128);
  Buffer.from("7f454c460201", "hex").copy(bytes);
  bytes.writeUInt16LE(183, 18);
  await writeFile(join(root, "parser", "cloudmarkup-iac-import"), bytes);
  await writeJson(join(root, "assets.json"), {
    dockerImages: {},
    version: "54.0.0",
    files: {
      parser: {
        destinations: {},
        displayName: "RepositoryImportParser/Code",
        source: { packaging: "zip", path: "parser" },
      },
    },
  });
  const result = await readBetaAssembly(root);
  assert.equal(result.deployableAssets.length, 1);
  const entry = result.deployableAssets[0].files[0];
  assert.equal(entry.path, "cloudmarkup-iac-import");
  assert.equal(entry.byteLength, bytes.length);
  assert.equal(entry.headerHex, bytes.subarray(0, 20).toString("hex"));
  assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(entry.text, undefined);
});
