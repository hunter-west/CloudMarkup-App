import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadMigrations, type LoadedMigration } from "./migrations.js";

// Existing integration fixtures exercise the published 0098 application schema
// plus reviewed additive ordinary-business migrations, without private roles.
// The 0099-0137 precursor is applied separately under the protected PG16 role
// topology; the ordinary CI PostgreSQL user cannot satisfy that admission.
export async function loadHistoricalBetaMigrations(
  directory: string,
): Promise<readonly LoadedMigration[]> {
  const registered = await loadMigrations(directory);
  if (
    createHash("sha256")
      .update(await readFile(join(directory, "manifest.json")))
      .digest("hex") !==
    "77aa689bb5bc511a653e48da76fc9cda0fc9aa99853a9b61d40ff20304a7fa6c"
  )
    throw new Error("The exact current beta migration registry is required");
  return isolatedBetaFixtureMigrations(registered);
}

/** Isolated-schema fixture only, never a canonical migration or release profile.
 * 0140 deliberately qualifies public in production. Its fixture uses local
 * names and pg_catalog-only function lookup (the body reads only OLD/NEW),
 * with a DIFFERENT filename/checksum so no altered SQL masquerades as canonical.
 * Tests must still qualify the unchanged public-schema migration natively. */
export function isolatedBetaFixtureMigrations(
  registered: readonly LoadedMigration[],
): readonly LoadedMigration[] {
  const historicalEnd = registered.at(79);
  const creditProfile = registered.at(119);
  const exportProfile = registered.at(120);
  const latest = registered.at(-1);
  if (
    registered.length !== 124 ||
    historicalEnd?.version !== "0098" ||
    historicalEnd.checksumSha256 !==
      "1ceb0fc0f89f084dc537857718bbb2553b444ce7bbd9bdd669c2b250c583596f" ||
    registered.at(117)?.version !== "0136" ||
    registered.at(117)?.checksumSha256 !==
      "b058d620143fb9924fb07f2f43317b25c9112a8d695549121140adbde338d778" ||
    registered.at(118)?.version !== "0137" ||
    registered.at(118)?.checksumSha256 !==
      "c4265920980a11a2f0fd608f7b9d7907a378bde28f28ab9bdc3fcdf09017d0da" ||
    creditProfile?.version !== "0138" ||
    creditProfile.checksumSha256 !==
      "b5cd0bcb42f94baaa6266ed43e0222a89af7c4bd2b84535d9e6949a5c7a0ad4b" ||
    exportProfile?.version !== "0139" ||
    exportProfile.checksumSha256 !==
      "b2b99e854c95c8a33ed271de58a35a573e00ccb4c22b6e3b17b1758264864c31" ||
    registered.at(121)?.version !== "0140" ||
    registered.at(121)?.checksumSha256 !==
      "0506cd7b7d3419e2be1addbbe930f4e74016dd33984b9c504829c71ee0ab64f2" ||
    registered.at(122)?.version !== "0141" ||
    registered.at(122)?.checksumSha256 !==
      "358f79f5d19cd2e5540c03f3e72d1010bd726c5c82500e3174ef20ca3249b956" ||
    latest?.version !== "0142" ||
    latest.checksumSha256 !==
      "9ae4f3bc42624d52d3c17265539cf21650645a1035b91fce936023500d3f21f0"
  ) {
    throw new Error("The frozen beta migration registry changed");
  }
  return [...registered.slice(0, 80), ...registered.slice(119)].map((entry) => {
    if (entry.version !== "0140") return entry;
    const statements = entry.statements.map((statement) =>
      statement
        .replaceAll("public.beta_ai_invocations", "beta_ai_invocations")
        .replaceAll(
          "public.enforce_beta_ai_observed_usage_v3",
          "enforce_beta_ai_observed_usage_v3",
        )
        .replace(
          "SET search_path=pg_catalog,public",
          "SET search_path=pg_catalog",
        ),
    );
    if (statements.some((statement) => /\bpublic\b/u.test(statement)))
      throw new Error("An isolated fixture cannot access the public schema");
    return {
      ...entry,
      file: "0140_isolated_beta_usage_fixture.sql",
      statements,
      checksumSha256: createHash("sha256")
        .update(statements.join(";\n") + ";\n")
        .digest("hex"),
    };
  });
}
