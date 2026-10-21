import { resolve } from "node:path";

import {
  parseLocalPersistenceConfiguration,
  runLocalPersistenceCommand,
} from "./local-installation.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "migrate" && command !== "seed") {
    throw new Error("Expected a local persistence command.");
  }
  const count = await runLocalPersistenceCommand(
    command,
    parseLocalPersistenceConfiguration(process.env),
    resolve(process.cwd()),
  );
  if (command === "seed")
    process.stdout.write(
      `Published ${String(count)} deterministic local projects.\n`,
    );
}

try {
  await main();
} catch {
  process.stderr.write(
    "Local persistence setup failed. Check the PG17 profile, explicit bootstrap/permissions stages and local configuration.\n",
  );
  process.exitCode = 1;
}
