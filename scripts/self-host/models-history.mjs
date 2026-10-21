import { readFile } from "node:fs/promises";
import { cli, fail, isMain, privateFile } from "./self-host.mjs";

export async function initializeProviderDispatchHistory({
  configuration,
  api,
}) {
  if (configuration?.acknowledge !== "new-independent-provider-dispatch-v1")
    fail(
      "New independent dispatch history requires explicit offline acknowledgement.",
    );
  return api.provisionSelfHostProviderDispatchHistory(configuration);
}
export async function main(command = process.argv[2]) {
  if (command !== "provision" || process.platform !== "linux")
    fail("Dispatch history provisioning requires the isolated Linux operator.");
  const path = await privateFile(
    process.env.CLOUDMARKUP_PROVIDER_DISPATCH_CONFIGURATION_FILE,
  );
  const configuration = JSON.parse(await readFile(path, "utf8"));
  // Exact compiled entry declared as @cloudmarkup/api/self-host-model-history,
  // following the existing owner initializer; the root is not an API workspace.
  const api = await import("../../apps/api/dist/self-host-model-history.js");
  process.stdout.write(
    `${JSON.stringify(await initializeProviderDispatchHistory({ configuration, api }))}\n`,
  );
}
if (isMain(import.meta.url)) void cli(() => main());
