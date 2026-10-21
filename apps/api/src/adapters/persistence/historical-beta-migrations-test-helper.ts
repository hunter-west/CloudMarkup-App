import { loadMigrations, type LoadedMigration } from "./migrations.js";

// Existing integration fixtures exercise the published 0098 application schema
// plus the additive staff-credit policy, which has no private role prerequisite.
// The 0099-0137 precursor is applied separately under the protected PG16 role
// topology; the ordinary CI PostgreSQL user cannot satisfy that admission.
export async function loadHistoricalBetaMigrations(
  directory: string,
): Promise<readonly LoadedMigration[]> {
  const registered = await loadMigrations(directory);
  const historicalEnd = registered.at(79);
  const latest = registered.at(-1);
  if (
    registered.length !== 120 ||
    historicalEnd?.version !== "0098" ||
    historicalEnd.checksumSha256 !==
      "1ceb0fc0f89f084dc537857718bbb2553b444ce7bbd9bdd669c2b250c583596f" ||
    registered.at(117)?.version !== "0136" ||
    registered.at(117)?.checksumSha256 !==
      "b058d620143fb9924fb07f2f43317b25c9112a8d695549121140adbde338d778" ||
    registered.at(118)?.version !== "0137" ||
    registered.at(118)?.checksumSha256 !==
      "c4265920980a11a2f0fd608f7b9d7907a378bde28f28ab9bdc3fcdf09017d0da" ||
    latest?.version !== "0138" ||
    latest.checksumSha256 !==
      "b5cd0bcb42f94baaa6266ed43e0222a89af7c4bd2b84535d9e6949a5c7a0ad4b"
  ) {
    throw new Error("The frozen beta migration registry changed");
  }
  return [...registered.slice(0, 80), latest];
}
