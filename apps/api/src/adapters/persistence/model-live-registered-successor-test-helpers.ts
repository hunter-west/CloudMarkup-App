import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadMigrations } from "./migrations.js";
import { sql, type SqlExecutor } from "./sql.js";

const contracts = {
  "0057": {
    count: 57,
    statements: 602,
    manifest:
      "5946daa4042a113b67ad011d942a32cb219e1474d03c3734da3a9724d90f6399",
  },
  "0058": {
    count: 58,
    statements: 631,
    manifest:
      "964b303e72e767a2647e6ec95faab3899090d3e6812e52d752e7a81c81c07569",
  },
  "0059": {
    count: 59,
    statements: 634,
    manifest:
      "b080813bf4b46f37b2babe90294974a771e72a9c00488c4116d8250c83b72451",
  },
  "0078": {
    count: 60,
    statements: 638,
    manifest:
      "fe774861e7c1b499d5a19a502714e0f5443d98ea1645d0ddae7ff4ca74156f45",
  },
  "0079": {
    count: 61,
    statements: 639,
    manifest:
      "706a719be7a97199dd05f3afd9906b714599ff97a1a8f49e7f31fa931e23ab38",
  },
  "0080": {
    count: 62,
    statements: 642,
    manifest:
      "706d9fe3798f6d3b29ffc5c0039b729c6c2e4e9ba2a4f4f090f563ab67e91011",
  },
  "0081": {
    count: 63,
    statements: 648,
    manifest:
      "73ade00e81289bf4b0bb04ecbbb23a1c5ed34fdd29ac472d74d47f940cd6275b",
  },
  "0082": {
    count: 64,
    statements: 650,
    manifest:
      "efa2b5c10f3261d6dbe33752d0de7fedd1cfdd0427dd6a557d0efefbc7515913",
  },
  "0083": {
    count: 65,
    statements: 654,
    manifest:
      "b99c37c3ea57835b5249727344bf925cd07bc789b32f3f448e6fe8bfb75b0f1f",
  },
  "0084": {
    count: 66,
    statements: 664,
    manifest:
      "58f7f290bcf5fffa841c52535f6a6ad2d39f2b7e23b76adf0f9325ea002b9a35",
  },
  "0085": {
    count: 67,
    statements: 669,
    manifest:
      "ac7c7e081f5e7712543d24c96b2855b188f3ee7bf139ff54e0868d80a00b0a62",
  },
  "0086": {
    count: 68,
    statements: 673,
    manifest:
      "8814f3193f6bede35bfd7a5096f3f8e4f2d1e6177b1097aaa736ff099838a929",
  },
  "0087": {
    count: 69,
    statements: 678,
    manifest:
      "2310f488e95884814be336f0d019110baf9daccb4b08a4c71e7fe5ac245b3557",
  },
  "0088": {
    count: 70,
    statements: 690,
    manifest:
      "3360c9f64af1ec9ca63ef93914f1dacf8e84d07e97dcf4407d0aaadeaa2c3135",
  },
  "0089": {
    count: 71,
    statements: 695,
    manifest:
      "a5edc4721a9542a8ee7504f6ebe251a064912b9ace4ab747477818b1b320cbf2",
  },
  "0090": {
    count: 72,
    statements: 701,
    manifest:
      "102f963f15e7756f1d4c07d5755ada944b12a8c3ad14b99f7f7b94bdf60df7c5",
  },
  "0091": {
    count: 73,
    statements: 716,
    manifest:
      "495d2055779ca1f85d4e2a7d3a91a2fba605ae379382a2ac2695ce720282adf0",
  },
  "0092": {
    count: 74,
    statements: 722,
    manifest:
      "834baaf28be228d235d6c9ee60298535f81c32ac0da2b9d530a3343f08568219",
  },
  "0093": {
    count: 75,
    statements: 733,
    manifest:
      "604b9bb3b1d536f6f8fc68b744095227a3f4f87766d45c2a679b1c38a43f1c7e",
  },
  "0094": {
    count: 76,
    statements: 738,
    manifest:
      "18d9f0f3faf01d5542488ca2435533ea3cc813f679bbfbcaa7d6a8abc59d5867",
  },
  "0095": {
    count: 77,
    statements: 760,
    manifest:
      "62596a3562ef19b69b229852aceb8a1440a391e6bda1f4b2e42bef80819d642e",
  },
  "0096": {
    count: 78,
    statements: 800,
    manifest:
      "61a4f1c86e806ad067162251629419445c4facfccfef5b8cba07033d24edfd5a",
  },
  "0097": {
    count: 79,
    statements: 805,
    manifest:
      "064f807b32aee545bfee82c7952def16a39a055792af6d4d302218d5f8323358",
  },
  "0098": {
    count: 80,
    statements: 826,
    manifest:
      "e9290391b5bbfe6bfb64536fd06b48db5c19c1487967f8658f9470d84edf6000",
  },
  "0131": {
    count: 113,
    statements: 1149,
    manifest:
      "a81ff3ec9ad31b6406ea15f8391cf60c0a3bf66c88198fe3280f8d2a437d65c9",
  },
  "0134": {
    count: 116,
    statements: 1234,
    manifest:
      "57a09c0dc980beb44a2ce4681fd08bad129c316f7e6e2e70cf550aed69168bb8",
  },
  "0135": {
    count: 117,
    statements: 1238,
    manifest:
      "fc7e9a2d56ad766605bc7b8f0335a61e9261e4b933748cfd33a32323feecce24",
  },
  "0136": {
    count: 118,
    statements: 1339,
    manifest:
      "34e4458d9d9eafc724ffd9ce7d0e6a672c9258d8b92eb20b55cece7ceab1fcd5",
  },
  "0137": {
    count: 119,
    statements: 1353,
    manifest:
      "1fa60c25694741c187e475839ef5a1e45bc35b3b05696956e7e183b27b4452fe",
  },
  "0138": {
    count: 120,
    statements: 1367,
    manifest:
      "bc316cae6997880786ecf27fee40f43f997669cfd521356dc942adca9d849a16",
  },
} as const;
export type RegisteredEvaluationSuccessorVersion = keyof typeof contracts;
export async function loadRegisteredEvaluationSuccessor(
  version: RegisteredEvaluationSuccessorVersion = "0059",
) {
  const directory = new URL("../../../migrations/", import.meta.url);
  const digest = (value: string | Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
  if (
    digest(await readFile(new URL("manifest.json", directory))) !==
    "bc316cae6997880786ecf27fee40f43f997669cfd521356dc942adca9d849a16"
  )
    throw Error("The exact current manifest is required.");
  // Authenticating all source bytes precedes selecting a historical prefix.
  const all = await loadMigrations(fileURLToPath(directory));
  const selected = all.filter((migration) => migration.version <= version);
  const contract = contracts[version];
  const prefix = {
    storageContractVersion: 1,
    migrations: selected.map(
      ({ version: entryVersion, file, checksumSha256 }) => ({
        version: entryVersion,
        file,
        checksumSha256,
      }),
    ),
  };
  if (
    all.length !== 120 ||
    selected.length !== contract.count ||
    selected.reduce(
      (sum, migration) => sum + migration.statements.length,
      0,
    ) !== contract.statements ||
    digest(JSON.stringify(prefix, null, 2) + "\n") !== contract.manifest
  )
    throw Error(
      "The exact registered evaluation migration prefix is required.",
    );
  return selected;
}
/** Read-only exact predecessor preflight for tests. Both migration runners
 * independently refuse forward backfill under their advisory transaction lock. */
export async function requireRegisteredEvaluationSuccessor(
  database: SqlExecutor,
  version?: RegisteredEvaluationSuccessorVersion,
) {
  const result = await database.query(
    sql(
      "SELECT version,checksum_sha256,applied_at FROM cloudmarkup_schema_migrations ORDER BY version",
    ),
  );
  // Historical upgrade fixtures retain 0059; current fixtures also include the
  // reviewed session and erasure additions. All ledgers must match exact source hashes,
  // counts and ordering. No unknown successor or incomplete prefix is admitted.
  const latestVersion = result.rows.at(-1)?.["version"];
  const currentSuccessor =
    latestVersion === "0094" ||
    latestVersion === "0095" ||
    latestVersion === "0096" ||
    latestVersion === "0097" ||
    latestVersion === "0098" ||
    latestVersion === "0131" ||
    latestVersion === "0134" ||
    latestVersion === "0135" ||
    latestVersion === "0136" ||
    latestVersion === "0137" ||
    latestVersion === "0138"
      ? latestVersion
      : undefined;
  const migrations = await loadRegisteredEvaluationSuccessor(
    version ??
      currentSuccessor ??
      (result.rows.at(-1)?.["version"] === "0093"
        ? "0093"
        : result.rows.at(-1)?.["version"] === "0092"
          ? "0092"
          : result.rows.at(-1)?.["version"] === "0091"
            ? "0091"
            : result.rows.at(-1)?.["version"] === "0090"
              ? "0090"
              : result.rows.at(-1)?.["version"] === "0089"
                ? "0089"
                : result.rows.at(-1)?.["version"] === "0088"
                  ? "0088"
                  : result.rows.at(-1)?.["version"] === "0087"
                    ? "0087"
                    : result.rows.at(-1)?.["version"] === "0086"
                      ? "0086"
                      : result.rows.at(-1)?.["version"] === "0085"
                        ? "0085"
                        : result.rows.at(-1)?.["version"] === "0084"
                          ? "0084"
                          : result.rows.at(-1)?.["version"] === "0083"
                            ? "0083"
                            : result.rows.at(-1)?.["version"] === "0082"
                              ? "0082"
                              : result.rows.at(-1)?.["version"] === "0081"
                                ? "0081"
                                : result.rows.at(-1)?.["version"] === "0080"
                                  ? "0080"
                                  : result.rows.at(-1)?.["version"] === "0079"
                                    ? "0079"
                                    : result.rows.at(-1)?.["version"] === "0078"
                                      ? "0078"
                                      : "0059"),
  );
  // The ordinary isolated fixture installs the complete published 0098
  // history plus the additive staff-credit policy. Authenticate the full
  // current registry above, then compare that exact sparse fixture ledger.
  const expected =
    version === undefined &&
    latestVersion === "0138" &&
    result.rows.length === 81 &&
    migrations.length === 120 &&
    migrations[79]?.version === "0098" &&
    migrations[119]?.version === "0138"
      ? [...migrations.slice(0, 80), ...migrations.slice(-1)]
      : migrations;
  if (
    result.rowCount !== expected.length ||
    expected.some((migration, index) => {
      const row = result.rows[index];
      return (
        row?.["version"] !== migration.version ||
        row["checksum_sha256"] !== migration.checksumSha256
      );
    })
  )
    throw Error(
      "The installed ledger must match the complete exact registered prefix.",
    );
  return result.rows;
}
