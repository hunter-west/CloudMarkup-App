import { resolve } from "node:path";

import { calculateDeploymentAssemblyTreeDigest } from "./beta-deployment-workflow-policy.mjs";

const root = resolve(
  process.argv[2] ?? resolve("artifacts", "platform", "cdk.out"),
);
process.stdout.write(`${await calculateDeploymentAssemblyTreeDigest(root)}\n`);
