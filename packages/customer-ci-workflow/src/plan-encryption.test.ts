import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import type { CustomerCiWorkflowConfigV1 } from "./contracts.js";
import { sha256 } from "./security.js";
import { createCustomerCiWorkflowTestConfigV1 } from "./testing.js";
import {
  planDecryptionScriptV1,
  planEncryptionScriptV1,
} from "./workflow-scripts.js";

const DECRYPTION_FAILURE_MESSAGE =
  "The encrypted saved plan or customer decryption key failed exact validation.";

type PemKeyPair = Readonly<{
  privateKeyPem: string;
  publicKeyPem: string;
}>;

function generateRsaKeyPair(): PemKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
  });
  return {
    privateKeyPem: privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

function configFor(publicKeyPem: string): CustomerCiWorkflowConfigV1 {
  const config = structuredClone(createCustomerCiWorkflowTestConfigV1());
  config.plan.artifactEncryption.publicKeyPem = publicKeyPem;
  return config;
}

function executeEmbeddedNodeScript(
  script: string,
  cwd: string,
  environment: Readonly<Record<string, string>> = {},
): SpawnSyncReturns<string> {
  const lines = script.split("\n");
  const opening = /^node --input-type=module <<'([A-Z_]+)'$/.exec(
    lines[0] ?? "",
  );
  if (opening === null || lines.at(-1) !== opening[1]) {
    throw new Error("Malformed embedded Node script test fixture.");
  }
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", lines.slice(1, -1).join("\n")],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...environment },
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
}

async function expectMissing(path: string): Promise<void> {
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
}

function expectSafeDecryptionFailure(
  result: SpawnSyncReturns<string>,
  plaintext: Buffer,
  privateKeyPem: string,
): void {
  const output = `${result.stdout}${result.stderr}`;
  expect(result.status).not.toBe(0);
  expect(output).toContain(DECRYPTION_FAILURE_MESSAGE);
  expect(output).not.toContain(plaintext.toString("utf8"));
  expect(output).not.toContain(privateKeyPem.trim());
  expect(output).not.toContain("BEGIN PRIVATE KEY");
  expect(output).not.toMatch(
    /bad decrypt|oaep decoding error|unable to authenticate data|ERR_OSSL_/i,
  );
}

describe("saved-plan envelope encryption", () => {
  let reviewedKeys: PemKeyPair;
  let unrelatedKeys: PemKeyPair;

  beforeAll(() => {
    reviewedKeys = generateRsaKeyPair();
    unrelatedKeys = generateRsaKeyPair();
  }, 30_000);

  it("round-trips the exact plan while keeping plaintext out of the envelope", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "cloudmarkup-plan-envelope-"),
    );
    const plaintext = Buffer.from(
      "cloudmarkup-test-tfplan\u0000the exact saved plan must stay confidential\u0001",
    );
    const rawPlanPath = join(directory, "cloudmarkup.tfplan");
    const encryptedPlanPath = join(directory, "cloudmarkup.tfplan.encrypted");
    const decryptedPlanPath = join(
      directory,
      "cloudmarkup-decrypted",
      "cloudmarkup.tfplan",
    );
    const config = configFor(reviewedKeys.publicKeyPem);

    try {
      await writeFile(rawPlanPath, plaintext, { flag: "wx" });
      const encryption = executeEmbeddedNodeScript(
        planEncryptionScriptV1(config),
        directory,
      );
      expect(encryption.status).toBe(0);
      expect(encryption.stderr).toBe("");
      expect(encryption.stdout).toContain(
        "The saved plan was encrypted; plaintext will not be uploaded.",
      );

      const envelope = await readFile(encryptedPlanPath);
      expect(envelope.includes(plaintext)).toBe(false);
      expect(envelope.toString("utf8")).not.toContain(
        plaintext.toString("utf8"),
      );
      await expectMissing(decryptedPlanPath);

      await rm(rawPlanPath);
      const decryption = executeEmbeddedNodeScript(
        planDecryptionScriptV1(config),
        directory,
        {
          CLOUDMARKUP_DECRYPTED_PLAN: decryptedPlanPath,
          CLOUDMARKUP_PLAN_DECRYPTION_PRIVATE_KEY: reviewedKeys.privateKeyPem,
          EXPECTED_PLAN_CHECKSUM: sha256(plaintext),
          RUNNER_TEMP: directory,
          SAVED_PLAN_DIRECTORY: directory,
        },
      );
      expect(decryption.status).toBe(0);
      expect(decryption.stderr).toBe("");
      expect(decryption.stdout).toContain(
        "The exact encrypted saved plan was decrypted inside the approved environment job.",
      );
      expect(decryption.stdout).not.toContain(plaintext.toString("utf8"));
      expect(await readFile(decryptedPlanPath)).toEqual(plaintext);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects ciphertext tampering without recovering plaintext or leaking crypto details", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cloudmarkup-plan-tamper-"));
    const plaintext = Buffer.from(
      "cloudmarkup-tamper-fixture\u0000this content must never be recovered",
    );
    const rawPlanPath = join(directory, "cloudmarkup.tfplan");
    const encryptedPlanPath = join(directory, "cloudmarkup.tfplan.encrypted");
    const decryptedPlanPath = join(
      directory,
      "cloudmarkup-decrypted",
      "cloudmarkup.tfplan",
    );
    const config = configFor(reviewedKeys.publicKeyPem);

    try {
      await writeFile(rawPlanPath, plaintext, { flag: "wx" });
      const encryption = executeEmbeddedNodeScript(
        planEncryptionScriptV1(config),
        directory,
      );
      expect(encryption.status).toBe(0);

      const envelope = await readFile(encryptedPlanPath);
      const finalEnvelopeByte = envelope.at(-1);
      if (finalEnvelopeByte === undefined) {
        throw new Error("Generated encrypted plan envelope is empty.");
      }
      envelope[envelope.length - 1] = finalEnvelopeByte ^ 0xff;
      await writeFile(encryptedPlanPath, envelope);
      await rm(rawPlanPath);

      const decryption = executeEmbeddedNodeScript(
        planDecryptionScriptV1(config),
        directory,
        {
          CLOUDMARKUP_DECRYPTED_PLAN: decryptedPlanPath,
          CLOUDMARKUP_PLAN_DECRYPTION_PRIVATE_KEY: reviewedKeys.privateKeyPem,
          EXPECTED_PLAN_CHECKSUM: sha256(plaintext),
          RUNNER_TEMP: directory,
          SAVED_PLAN_DIRECTORY: directory,
        },
      );
      expectSafeDecryptionFailure(
        decryption,
        plaintext,
        reviewedKeys.privateKeyPem,
      );
      await expectMissing(decryptedPlanPath);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects an unrelated private key without recovering plaintext or exposing key material", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "cloudmarkup-plan-wrong-key-"),
    );
    const plaintext = Buffer.from(
      "cloudmarkup-wrong-key-fixture\u0000only the reviewed key may recover this",
    );
    const rawPlanPath = join(directory, "cloudmarkup.tfplan");
    const decryptedPlanPath = join(
      directory,
      "cloudmarkup-decrypted",
      "cloudmarkup.tfplan",
    );
    const config = configFor(reviewedKeys.publicKeyPem);

    try {
      await writeFile(rawPlanPath, plaintext, { flag: "wx" });
      const encryption = executeEmbeddedNodeScript(
        planEncryptionScriptV1(config),
        directory,
      );
      expect(encryption.status).toBe(0);
      await rm(rawPlanPath);

      const decryption = executeEmbeddedNodeScript(
        planDecryptionScriptV1(config),
        directory,
        {
          CLOUDMARKUP_DECRYPTED_PLAN: decryptedPlanPath,
          CLOUDMARKUP_PLAN_DECRYPTION_PRIVATE_KEY: unrelatedKeys.privateKeyPem,
          EXPECTED_PLAN_CHECKSUM: sha256(plaintext),
          RUNNER_TEMP: directory,
          SAVED_PLAN_DIRECTORY: directory,
        },
      );
      expectSafeDecryptionFailure(
        decryption,
        plaintext,
        unrelatedKeys.privateKeyPem,
      );
      await expectMissing(decryptedPlanPath);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
